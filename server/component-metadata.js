const fs = require('fs')
const path = require('path')
const { ADMIN_PHONE } = require('../src/main/auth-manager')

const VALID_VISIBILITY = new Set(['private', 'public'])
const METADATA_EXTRA_FIELDS = [
  'source',
  'createdBy',
  'originConversationId',
  'originMessageId',
  'copiedFrom'
]

function normalizeOwnerUserId(ownerUserId) {
  const numeric = Number(ownerUserId)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function normalizeVisibility(visibility) {
  return VALID_VISIBILITY.has(visibility) ? visibility : 'private'
}

function normalizeMetadataExtraValue(value) {
  if (value == null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'object') return value
  return null
}

function pickMetadataExtras(...sources) {
  const extras = {}
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const field of METADATA_EXTRA_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(source, field)) continue
      extras[field] = normalizeMetadataExtraValue(source[field])
    }
  }
  return extras
}

class ComponentMetadataStore {
  constructor(filePath) {
    this.filePath = filePath
  }

  read() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { skills: {}, agents: {}, builtInSkillStates: {}, builtInAgentStates: {} }
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      return {
        skills: parsed && typeof parsed.skills === 'object' ? parsed.skills : {},
        agents: parsed && typeof parsed.agents === 'object' ? parsed.agents : {},
        builtInSkillStates: parsed && typeof parsed.builtInSkillStates === 'object'
          ? parsed.builtInSkillStates
          : {},
        builtInAgentStates: parsed && typeof parsed.builtInAgentStates === 'object'
          ? parsed.builtInAgentStates
          : {}
      }
    } catch (err) {
      console.error('[ComponentMetadata] Failed to read metadata:', err.message)
      return { skills: {}, agents: {}, builtInSkillStates: {}, builtInAgentStates: {} }
    }
  }

  write(data) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify({
      skills: data.skills || {},
      agents: data.agents || {},
      builtInSkillStates: data.builtInSkillStates || {},
      builtInAgentStates: data.builtInAgentStates || {}
    }, null, 2), 'utf-8')
  }

  _getBuiltInComponentState(bucketName, componentId) {
    const id = typeof componentId === 'string' ? componentId.trim() : ''
    if (!id) return { enabled: true, disabled: false, updatedBy: null, updatedAt: null }
    const data = this.read()
    const existing = data[bucketName]?.[id] || {}
    const enabled = existing.enabled !== false
    return {
      enabled,
      disabled: !enabled,
      updatedBy: existing.updatedBy || null,
      updatedAt: existing.updatedAt || null
    }
  }

  _setBuiltInComponentEnabled(bucketName, componentId, enabled, currentUser, idLabel) {
    const id = typeof componentId === 'string' ? componentId.trim() : ''
    if (!id) {
      return { success: false, error: `${idLabel} is required.` }
    }
    if (!currentUser || (currentUser.phone !== ADMIN_PHONE && currentUser.isAdmin !== true)) {
      const error = new Error('Access denied')
      error.code = 'AUTH_FORBIDDEN'
      throw error
    }

    const data = this.read()
    const bucket = data[bucketName] || {}
    const timestamp = new Date().toISOString()
    bucket[id] = {
      enabled: enabled !== false,
      updatedBy: currentUser.phone || String(currentUser.id || ''),
      updatedAt: timestamp
    }
    data[bucketName] = bucket
    this.write(data)
    return {
      success: true,
      enabled: bucket[id].enabled,
      disabled: !bucket[id].enabled,
      updatedBy: bucket[id].updatedBy,
      updatedAt: timestamp
    }
  }

  getBuiltInSkillState(skillId) {
    return this._getBuiltInComponentState('builtInSkillStates', skillId)
  }

  isBuiltInSkillEnabled(skillId) {
    return this.getBuiltInSkillState(skillId).enabled
  }

  setBuiltInSkillEnabled(skillId, enabled, currentUser) {
    return {
      ...this._setBuiltInComponentEnabled('builtInSkillStates', skillId, enabled, currentUser, 'Skill ID'),
      skillId: typeof skillId === 'string' ? skillId.trim() : ''
    }
  }

  getBuiltInAgentState(agentId) {
    return this._getBuiltInComponentState('builtInAgentStates', agentId)
  }

  isBuiltInAgentEnabled(agentId) {
    return this.getBuiltInAgentState(agentId).enabled
  }

  setBuiltInAgentEnabled(agentId, enabled, currentUser) {
    return {
      ...this._setBuiltInComponentEnabled('builtInAgentStates', agentId, enabled, currentUser, 'Agent ID'),
      agentId: typeof agentId === 'string' ? agentId.trim() : ''
    }
  }

  get(type, componentId) {
    const data = this.read()
    return data[type]?.[componentId] || null
  }

  ensure(type, componentId, defaults = {}) {
    const data = this.read()
    const bucket = data[type] || {}
    const existing = bucket[componentId] || {}
    const timestamp = Date.now()
    const next = {
      ownerUserId: normalizeOwnerUserId(existing.ownerUserId || defaults.ownerUserId),
      visibility: normalizeVisibility(existing.visibility || defaults.visibility),
      ...pickMetadataExtras(defaults, existing),
      createdAt: existing.createdAt || defaults.createdAt || timestamp,
      updatedAt: existing.updatedAt || defaults.updatedAt || timestamp
    }
    bucket[componentId] = next
    data[type] = bucket
    this.write(data)
    return next
  }

  update(type, componentId, updates = {}) {
    const data = this.read()
    const bucket = data[type] || {}
    const existing = bucket[componentId] || {}
    const next = {
      ownerUserId: normalizeOwnerUserId(updates.ownerUserId || existing.ownerUserId),
      visibility: normalizeVisibility(updates.visibility || existing.visibility),
      ...pickMetadataExtras(existing, updates),
      createdAt: existing.createdAt || updates.createdAt || Date.now(),
      updatedAt: Date.now()
    }
    bucket[componentId] = next
    data[type] = bucket
    this.write(data)
    return next
  }

  setVisibility(type, componentId, { ownerUserId, visibility }) {
    return this.update(type, componentId, { ownerUserId, visibility })
  }

  remove(type, componentId) {
    const data = this.read()
    if (data[type]) {
      delete data[type][componentId]
      this.write(data)
    }
  }

  permissions(meta, currentUser) {
    const currentUserId = normalizeOwnerUserId(currentUser?.id)
    const ownerUserId = normalizeOwnerUserId(meta?.ownerUserId)
    const isOwner = Boolean(currentUserId && ownerUserId && currentUserId === ownerUserId)
    const isAdmin = Boolean(currentUser?.isAdmin === true || currentUser?.phone === ADMIN_PHONE)
    const isPublic = normalizeVisibility(meta?.visibility) === 'public'
    const canRead = isOwner || isPublic || isAdmin
    return {
      ownerUserId,
      visibility: normalizeVisibility(meta?.visibility),
      isOwner,
      isAdmin,
      canUse: canRead,
      canView: canRead,
      canCopy: canRead,
      canManage: isOwner,
      canToggleVisibility: isOwner
    }
  }

  assertOwner(type, componentId, currentUser) {
    const meta = this.get(type, componentId)
    const permissions = this.permissions(meta, currentUser)
    if (!permissions.isOwner) {
      const error = new Error('Access denied')
      error.code = 'AUTH_FORBIDDEN'
      throw error
    }
    return meta
  }
}

module.exports = {
  ComponentMetadataStore,
  normalizeVisibility,
  normalizeOwnerUserId,
  pickMetadataExtras
}
