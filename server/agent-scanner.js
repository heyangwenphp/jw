const fs = require('fs')
const path = require('path')
const os = require('os')
const yaml = require('js-yaml')
const { ADMIN_PHONE } = require('../src/main/auth-manager')

const VALID_AGENT_ID = /^[a-zA-Z0-9-]+$/

function parseAgentFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null

  try {
    const parsed = yaml.load(match[1]) || {}
    return {
      ...parsed,
      name: typeof parsed.name === 'string' ? parsed.name.trim() : '',
      description: typeof parsed.description === 'string' ? parsed.description.trim() : '',
      model: typeof parsed.model === 'string' ? parsed.model.trim() : 'inherit',
      color: typeof parsed.color === 'string' ? parsed.color.trim() : 'blue'
    }
  } catch {
    return null
  }
}

function mapAgent({ agentId, content, source, filePath = null, projectPath = null, disabled = false }) {
  const meta = parseAgentFrontmatter(content) || {}
  return {
    id: agentId,
    name: meta.name || agentId,
    fullName: agentId,
    description: meta.description || '',
    model: meta.model || 'inherit',
    color: meta.color || 'blue',
    tools: meta.tools || '',
    source,
    editable: source === 'user' || source === 'project',
    filePath,
    agentPath: filePath,
    projectPath: source === 'project' ? projectPath : undefined,
    invocationType: 'auto',
    disabled
  }
}

function scanAgentFiles(agentsDir, source, extra = {}) {
  const agents = []
  if (!fs.existsSync(agentsDir)) return agents

  for (const item of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!item.isFile() || (!item.name.endsWith('.md') && !item.name.endsWith('.md.disabled'))) continue
    if (item.name.startsWith('.') || item.name === '.DS_Store') continue

    const disabled = item.name.endsWith('.md.disabled')
    const agentId = item.name.replace(/\.md(?:\.disabled)?$/, '')
    if (!VALID_AGENT_ID.test(agentId)) continue

    const filePath = path.join(agentsDir, item.name)
    const content = fs.readFileSync(filePath, 'utf-8')
    agents.push(mapAgent({
      agentId,
      content,
      source,
      filePath,
      disabled,
      ...extra
    }))
  }

  return agents
}

function uniqueById(agents) {
  const seen = new Set()
  return agents.filter(agent => {
    if (seen.has(agent.id)) return false
    seen.add(agent.id)
    return true
  })
}

function scanBuiltInAgents(projectRoot) {
  const agents = [
    ...scanAgentFiles(path.join(projectRoot, 'agents'), 'built-in')
  ]
  const skillsDir = path.join(projectRoot, 'skills')
  if (fs.existsSync(skillsDir)) {
    for (const item of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue
      agents.push(...scanAgentFiles(path.join(skillsDir, item.name, 'agents'), 'built-in'))
    }
  }
  return agents
}

function scanUserAgents(userAgentsDir) {
  return uniqueById(scanAgentFiles(userAgentsDir, 'user'))
}

function attachAgentPermissions(agent, { metadataStore, currentUser, fallbackOwnerUserId, sourceOverride } = {}) {
  if (!metadataStore) {
    return {
      ...agent,
      visibility: 'private',
      isOwner: agent.source === 'user',
      canUse: true,
      canView: true,
      canCopy: true,
      canManage: agent.source === 'user' || agent.source === 'project',
      canToggleVisibility: false
    }
  }

  const meta = metadataStore.ensure('agents', agent.id, {
    ownerUserId: fallbackOwnerUserId,
    visibility: 'private'
  })
  const permissions = metadataStore.permissions(meta, currentUser)
  return {
    ...agent,
    ...permissions,
    source: sourceOverride || agent.source
  }
}

function attachBuiltInAgentState(agent, { metadataStore, currentUser } = {}) {
  const state = metadataStore?.getBuiltInAgentState
    ? metadataStore.getBuiltInAgentState(agent.id)
    : { enabled: true, disabled: false, updatedBy: null, updatedAt: null }
  const canManage = Boolean(currentUser && (currentUser.phone === ADMIN_PHONE || currentUser.isAdmin === true))

  return {
    ...agent,
    disabled: Boolean(agent.disabled || state.disabled),
    enabled: !agent.disabled && state.enabled !== false,
    canUse: !agent.disabled && state.enabled !== false,
    canView: true,
    canCopy: !agent.disabled && state.enabled !== false,
    canManage,
    canToggleBuiltIn: canManage,
    globalDisabled: Boolean(state.disabled),
    disabledUpdatedBy: state.updatedBy || null,
    disabledUpdatedAt: state.updatedAt || null
  }
}

function scanProjectAgents(projectPath) {
  if (!projectPath) return []
  return uniqueById([
    ...scanAgentFiles(path.join(projectPath, '.codex', 'agents'), 'project', { projectPath }),
    ...scanAgentFiles(path.join(projectPath, '.claude', 'agents'), 'project', { projectPath })
  ])
}

function safeRelativePath(relativePath) {
  const normalized = String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/')

  if (!normalized || normalized.startsWith('../') || normalized.includes('/../') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid file path: ${relativePath}`)
  }

  return normalized
}

function safeJoin(baseDir, relativePath) {
  const targetPath = path.resolve(baseDir, relativePath)
  const basePath = path.resolve(baseDir)
  if (targetPath !== basePath && !targetPath.startsWith(`${basePath}${path.sep}`)) {
    throw new Error(`Invalid file path: ${relativePath}`)
  }
  return targetPath
}

function cleanupTempDir(tempDir) {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function getWebAgentPath({ source, agentId, projectPath, userAgentsDir, projectRoot }) {
  if (!VALID_AGENT_ID.test(agentId || '')) {
    throw new Error(`Invalid agent id: ${agentId}`)
  }

  if (source === 'user') return path.join(userAgentsDir, `${agentId}.md`)
  if (source === 'project') {
    if (!projectPath) throw new Error('Project path is required.')
    return path.join(projectPath, '.codex', 'agents', `${agentId}.md`)
  }
  if (source === 'built-in') {
    const builtInAgent = scanBuiltInAgents(projectRoot).find(agent => agent.id === agentId)
    if (builtInAgent?.agentPath) return builtInAgent.agentPath
    return path.join(projectRoot, 'agents', `${agentId}.md`)
  }
  throw new Error(`Unsupported agent source: ${source}`)
}

function getDisabledWebAgentPath({ source, agentId, projectPath, userAgentsDir, projectRoot }) {
  return `${getWebAgentPath({ source, agentId, projectPath, userAgentsDir, projectRoot })}.disabled`
}

function getExistingWebAgentPath({ source, agentId, projectPath, userAgentsDir, projectRoot }) {
  const primary = getWebAgentPath({ source, agentId, projectPath, userAgentsDir, projectRoot })
  if (fs.existsSync(primary)) return primary
  const disabledPrimary = getDisabledWebAgentPath({ source, agentId, projectPath, userAgentsDir, projectRoot })
  if (fs.existsSync(disabledPrimary)) return disabledPrimary

  if (source === 'project' && projectPath) {
    const legacyPath = path.join(projectPath, '.claude', 'agents', `${agentId}.md`)
    if (fs.existsSync(legacyPath)) return legacyPath
    const disabledLegacyPath = `${legacyPath}.disabled`
    if (fs.existsSync(disabledLegacyPath)) return disabledLegacyPath
  }

  return primary
}

function assertPublicAgentReadable({ agentId, metadataStore, currentUser }) {
  if (!metadataStore) {
    const err = new Error('Access denied')
    err.code = 'AUTH_FORBIDDEN'
    throw err
  }
  const meta = metadataStore.get('agents', agentId)
  const permissions = metadataStore.permissions(meta, currentUser)
  if (!permissions.canView || (!permissions.isOwner && permissions.visibility !== 'public')) {
    const err = new Error('Access denied')
    err.code = 'AUTH_FORBIDDEN'
    throw err
  }
}

function validateAgentFile(filePath) {
  const fileName = path.basename(filePath)
  const agentId = path.basename(filePath, '.md')

  if (!fileName.endsWith('.md')) {
    return { valid: false, error: `"${fileName}" is not a Markdown agent file.` }
  }
  if (!VALID_AGENT_ID.test(agentId)) {
    return { valid: false, error: `Invalid agent file name "${agentId}". Use letters, numbers and hyphens only.` }
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { valid: false, error: `"${fileName}" is not a valid file.` }
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  const frontmatter = parseAgentFrontmatter(content)
  if (!frontmatter) {
    return { valid: false, error: `"${fileName}" is missing valid YAML frontmatter.` }
  }

  return {
    valid: true,
    agentId,
    name: frontmatter.name || agentId,
    description: frontmatter.description || '',
    color: frontmatter.color || 'blue',
    frontmatter,
    sourcePath: filePath
  }
}

function findMarkdownFiles(rootDir) {
  const results = []
  if (!fs.existsSync(rootDir)) return results

  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '__pycache__') continue
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(entryPath)
      }
    }
  }

  walk(rootDir)
  return results
}

function materializeWebAgentImportSource(source) {
  if (!source || typeof source !== 'object') {
    throw new Error('Missing import source.')
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jedi-web-agent-import-'))
  try {
    if (source.type === 'files') {
      const files = Array.isArray(source.files) ? source.files : []
      if (files.length === 0) throw new Error('No files were selected.')

      for (const file of files) {
        const relativePath = safeRelativePath(file.relativePath || file.fileName)
        const targetPath = safeJoin(tempDir, relativePath)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, Buffer.from(file.dataBase64 || '', 'base64'))
      }

      return { tempDir, rootDir: tempDir }
    }

    if (source.type === 'zip') {
      const AdmZip = require('adm-zip')
      const zip = new AdmZip(Buffer.from(source.dataBase64 || '', 'base64'))
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue
        const relativePath = safeRelativePath(entry.entryName)
        const targetPath = safeJoin(tempDir, relativePath)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, entry.getData())
      }

      return { tempDir, rootDir: tempDir }
    }

    throw new Error('Import source must be Markdown files or zip.')
  } catch (err) {
    cleanupTempDir(tempDir)
    throw err
  }
}

function validateMaterializedImportSource(materialized) {
  const result = { valid: true, type: null, agents: [], errors: [], _tempDir: materialized.tempDir }
  const files = findMarkdownFiles(materialized.rootDir)

  for (const filePath of files) {
    const validation = validateAgentFile(filePath)
    if (validation.valid) {
      result.agents.push(validation)
    } else {
      result.errors.push(validation.error)
    }
  }

  if (result.agents.length === 0) {
    result.valid = false
    result.errors.push('No valid agent files were found.')
  }

  return result
}

function validateWebAgentImportPayload(source) {
  const materialized = materializeWebAgentImportSource(source)
  const result = validateMaterializedImportSource(materialized)
  result.type = source.type
  return result
}

function cleanImportResult(validation) {
  const { _tempDir, ...publicResult } = validation
  return publicResult
}

function checkWebAgentImportConflicts({ agents, projectPath, userAgentsDir }) {
  const existingIds = new Map()
  const sourceLabel = source => source === 'project' ? 'project' : 'user'
  for (const agent of [
    ...scanUserAgents(userAgentsDir),
    ...scanProjectAgents(projectPath)
  ]) {
    existingIds.set(agent.id, agent.source)
  }

  return {
    results: agents.map(agent => {
      if (existingIds.has(agent.agentId)) {
        return {
          agentId: agent.agentId,
          name: agent.name,
          canImport: false,
          reason: `${sourceLabel(existingIds.get(agent.agentId))} agent with same ID already exists.`
        }
      }
      return { agentId: agent.agentId, name: agent.name, canImport: true, reason: null }
    })
  }
}

function importWebAgents({ source, targetSource = 'user', projectPath, selectedAgentIds = [], userAgentsDir, metadataStore, currentUser }) {
  let validation
  try {
    validation = validateWebAgentImportPayload(source)
    if (!validation.valid) return { success: false, errors: validation.errors }

    const selected = new Set(selectedAgentIds || [])
    const agentsToImport = selected.size > 0
      ? validation.agents.filter(agent => selected.has(agent.agentId))
      : validation.agents
    if (agentsToImport.length === 0) {
      return { success: false, errors: ['No selected agents can be imported.'] }
    }

    const conflictCheck = checkWebAgentImportConflicts({
      agents: agentsToImport,
      projectPath,
      userAgentsDir
    })
    const results = { imported: [], skipped: [], errors: [] }

    for (const agent of agentsToImport) {
      const conflict = conflictCheck.results.find(item => item.agentId === agent.agentId)
      if (conflict && !conflict.canImport) {
        results.skipped.push({ agentId: agent.agentId, name: agent.name, reason: conflict.reason })
        continue
      }

      try {
        const targetPath = getWebAgentPath({
          source: targetSource,
          agentId: agent.agentId,
          projectPath,
          userAgentsDir
        })
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.copyFileSync(agent.sourcePath, targetPath)
        if (targetSource === 'user' && metadataStore) {
          metadataStore.ensure('agents', agent.agentId, {
            ownerUserId: currentUser?.id,
            visibility: 'private'
          })
        }
        results.imported.push({ agentId: agent.agentId, name: agent.name })
      } catch (err) {
        results.errors.push({ agentId: agent.agentId, error: err.message })
      }
    }

    return { success: true, ...results }
  } catch (err) {
    return { success: false, errors: [err.message] }
  } finally {
    cleanupTempDir(validation?._tempDir)
  }
}

function exportWebAgents({ source, scope = 'single', agentId, agentIds = [], projectPath, userAgentsDir, projectRoot }) {
  const AdmZip = require('adm-zip')
  const zip = new AdmZip()
  const ids = scope === 'single' ? [agentId] : agentIds
  const validIds = ids.filter(Boolean)
  if (validIds.length === 0) {
    return { success: false, error: 'No agents selected.' }
  }

  let count = 0
  for (const id of validIds) {
    const agentPath = getExistingWebAgentPath({ source, agentId: id, projectPath, userAgentsDir, projectRoot })
    if (!fs.existsSync(agentPath)) continue
    zip.addLocalFile(agentPath, '', `${id}.md`)
    count += 1
  }

  if (count === 0) {
    return { success: false, error: 'No exportable agents found.' }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return {
    success: true,
    buffer: zip.toBuffer(),
    filename: scope === 'single' ? `${validIds[0]}.zip` : `agents-export-${timestamp}.zip`,
    count
  }
}

function createWebAgentRaw({ source, agentId, rawContent, projectPath, userAgentsDir, metadataStore, currentUser, metadataDefaults = {} }) {
  try {
    if (!VALID_AGENT_ID.test(agentId || '')) {
      return { success: false, error: 'Agent ID can only contain letters, numbers and hyphens.' }
    }
    const agentPath = getWebAgentPath({ source, agentId, projectPath, userAgentsDir })
    if (fs.existsSync(agentPath)) {
      return { success: false, error: `Agent "${agentId}" already exists.` }
    }
    fs.mkdirSync(path.dirname(agentPath), { recursive: true })
    fs.writeFileSync(agentPath, rawContent || '', 'utf-8')
    if (source === 'user' && metadataStore) {
      metadataStore.ensure('agents', agentId, {
        ...metadataDefaults,
        ownerUserId: currentUser?.id,
        visibility: 'private'
      })
    }
    return { success: true, agentPath }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function updateWebAgentRaw({ source, agentId, rawContent, projectPath, userAgentsDir, metadataStore, currentUser }) {
  try {
    const agentPath = getExistingWebAgentPath({ source, agentId, projectPath, userAgentsDir })
    if (!fs.existsSync(agentPath)) {
      return { success: false, error: `Agent "${agentId}" does not exist.` }
    }
    if (source === 'user' && metadataStore) {
      metadataStore.assertOwner('agents', agentId, currentUser)
    }
    fs.writeFileSync(agentPath, rawContent || '', 'utf-8')
    return { success: true, agentPath }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function getWebAgentRawContent({ source, agentId, projectPath, userAgentsDir, projectRoot, metadataStore, currentUser }) {
  try {
    if (source === 'public') {
      assertPublicAgentReadable({ agentId, metadataStore, currentUser })
    }
    const agentPath = source === 'public'
      ? getExistingWebAgentPath({ source: 'user', agentId, projectPath, userAgentsDir, projectRoot })
      : getExistingWebAgentPath({ source, agentId, projectPath, userAgentsDir, projectRoot })
    if (!fs.existsSync(agentPath)) {
      return { success: false, error: `Agent "${agentId}" does not exist.` }
    }
    return {
      success: true,
      content: fs.readFileSync(agentPath, 'utf-8'),
      agentPath
    }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function deleteWebAgent({ source, agentId, projectPath, userAgentsDir, metadataStore, currentUser }) {
  try {
    const agentPath = getExistingWebAgentPath({ source, agentId, projectPath, userAgentsDir })
    if (!fs.existsSync(agentPath)) {
      return { success: false, error: `Agent "${agentId}" does not exist.` }
    }
    if (source === 'user' && metadataStore) {
      metadataStore.assertOwner('agents', agentId, currentUser)
    }
    fs.unlinkSync(agentPath)
    if (source === 'user' && metadataStore) {
      metadataStore.remove('agents', agentId)
    }
    return { success: true }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function toggleWebAgentDisabled({ source, agentId, disabled, projectPath, userAgentsDir, projectRoot, metadataStore, currentUser }) {
  try {
    if (source === 'built-in') {
      if (!metadataStore?.setBuiltInAgentEnabled) {
        return { success: false, error: 'Component metadata store is not available.' }
      }
      const exists = scanBuiltInAgents(projectRoot).some(agent => agent.id === agentId)
      if (!exists) {
        return { success: false, error: `Agent "${agentId}" does not exist.` }
      }
      return metadataStore.setBuiltInAgentEnabled(agentId, !disabled, currentUser)
    }

    if (source !== 'user' && source !== 'project') {
      return { success: false, error: `Unsupported agent source: ${source}` }
    }
    if (source === 'user' && metadataStore) {
      metadataStore.assertOwner('agents', agentId, currentUser)
    }

    const activePath = getWebAgentPath({ source, agentId, projectPath, userAgentsDir, projectRoot })
    const disabledPath = getDisabledWebAgentPath({ source, agentId, projectPath, userAgentsDir, projectRoot })
    const legacyActivePath = source === 'project' && projectPath
      ? path.join(projectPath, '.claude', 'agents', `${agentId}.md`)
      : ''
    const legacyDisabledPath = legacyActivePath ? `${legacyActivePath}.disabled` : ''
    const existingActivePath = fs.existsSync(activePath)
      ? activePath
      : (legacyActivePath && fs.existsSync(legacyActivePath) ? legacyActivePath : '')
    const existingDisabledPath = fs.existsSync(disabledPath)
      ? disabledPath
      : (legacyDisabledPath && fs.existsSync(legacyDisabledPath) ? legacyDisabledPath : '')

    if (disabled) {
      if (!existingActivePath) {
        return existingDisabledPath
          ? { success: true, disabled: true }
          : { success: false, error: `Agent "${agentId}" does not exist.` }
      }
      const targetPath = `${existingActivePath}.disabled`
      if (fs.existsSync(targetPath)) {
        return { success: false, error: `Disabled agent file already exists: ${path.basename(targetPath)}` }
      }
      fs.renameSync(existingActivePath, targetPath)
      return { success: true, disabled: true }
    }

    if (!existingDisabledPath) {
      return existingActivePath
        ? { success: true, disabled: false }
        : { success: false, error: `Agent "${agentId}" does not exist.` }
    }
    const targetPath = existingDisabledPath.replace(/\.disabled$/, '')
    if (fs.existsSync(targetPath)) {
      return { success: false, error: `Enabled agent file already exists: ${path.basename(targetPath)}` }
    }
    fs.renameSync(existingDisabledPath, targetPath)
    return { success: true, disabled: false }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function renameWebAgent({ source, oldAgentId, newAgentId, projectPath, userAgentsDir, metadataStore, currentUser }) {
  try {
    if (!VALID_AGENT_ID.test(newAgentId || '')) {
      return { success: false, error: 'Agent ID can only contain letters, numbers and hyphens.' }
    }
    const oldPath = getExistingWebAgentPath({ source, agentId: oldAgentId, projectPath, userAgentsDir })
    const newPath = getWebAgentPath({ source, agentId: newAgentId, projectPath, userAgentsDir })
    if (!fs.existsSync(oldPath)) {
      return { success: false, error: `Agent "${oldAgentId}" does not exist.` }
    }
    if (fs.existsSync(newPath)) {
      return { success: false, error: `Agent "${newAgentId}" already exists.` }
    }
    if (source === 'user' && metadataStore) {
      metadataStore.assertOwner('agents', oldAgentId, currentUser)
    }
    fs.mkdirSync(path.dirname(newPath), { recursive: true })
    fs.renameSync(oldPath, newPath)
    if (source === 'user' && metadataStore) {
      const oldMeta = metadataStore.get('agents', oldAgentId)
      metadataStore.update('agents', newAgentId, {
        ownerUserId: oldMeta?.ownerUserId || currentUser?.id,
        visibility: oldMeta?.visibility || 'private',
        createdAt: oldMeta?.createdAt
      })
      metadataStore.remove('agents', oldAgentId)
    }
    return { success: true }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

function copyWebAgent({ fromSource, agentId, toSource, newAgentId, projectPath, userAgentsDir, projectRoot, metadataStore, currentUser }) {
  try {
    const targetAgentId = newAgentId || agentId
    const sourcePath = fromSource === 'public'
      ? getExistingWebAgentPath({ source: 'user', agentId, projectPath, userAgentsDir, projectRoot })
      : getExistingWebAgentPath({
        source: fromSource,
        agentId,
        projectPath,
        userAgentsDir,
        projectRoot
      })
    const targetPath = getWebAgentPath({
      source: toSource,
      agentId: targetAgentId,
      projectPath,
      userAgentsDir,
      projectRoot
    })

    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Source agent "${agentId}" does not exist.` }
    }
    if (fromSource === 'public' && metadataStore) {
      const meta = metadataStore.get('agents', agentId)
      const permissions = metadataStore.permissions(meta, currentUser)
      if (!permissions.canCopy) {
        return { success: false, error: 'Access denied' }
      }
    }
    if (fs.existsSync(targetPath)) {
      return { success: false, error: `Agent "${targetAgentId}" already exists.` }
    }

    let content = fs.readFileSync(sourcePath, 'utf-8')
    if (targetAgentId !== agentId) {
      content = content.replace(/^(\s*name:\s*)(.*)$/m, `$1${targetAgentId}`)
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, content, 'utf-8')
    if (toSource === 'user' && metadataStore) {
      metadataStore.ensure('agents', targetAgentId, {
        ownerUserId: currentUser?.id,
        visibility: 'private'
      })
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

function scanAgentsForWeb({
  projectRoot = path.resolve(__dirname, '..'),
  projectPath = projectRoot,
  userAgentsDir = null,
  metadataStore = null,
  currentUser = null
} = {}) {
  const currentUserId = currentUser?.id || null
  const scannedUser = userAgentsDir ? scanUserAgents(userAgentsDir) : []
  const user = []
  const publicAgents = []

  for (const agent of scannedUser) {
    const item = attachAgentPermissions(agent, {
      metadataStore,
      currentUser,
      fallbackOwnerUserId: currentUserId
    })
    if (item.isOwner || item.isAdmin) {
      user.push({ ...item, source: 'user' })
    } else if (item.visibility === 'public') {
      publicAgents.push({ ...item, source: 'public' })
    }
  }

  const project = uniqueById(scanProjectAgents(projectPath))
  const ownedIds = new Set([...user, ...project].map(agent => agent.id))
  const publicVisible = uniqueById(publicAgents).filter(agent => !ownedIds.has(agent.id))
  const existingIds = new Set([...user, ...publicVisible, ...project].map(agent => agent.id))
  const builtIn = uniqueById(scanBuiltInAgents(projectRoot))
    .filter(agent => !existingIds.has(agent.id))
    .map(agent => attachBuiltInAgentState(agent, { metadataStore, currentUser }))
  const plugin = []

  return {
    user,
    public: publicVisible,
    project,
    plugin,
    builtIn,
    all: [...project, ...user, ...publicVisible, ...plugin, ...builtIn]
  }
}

function updateWebAgentVisibility({ agentId, visibility, metadataStore, currentUser }) {
  try {
    if (!metadataStore) {
      return { success: false, error: 'Component metadata store is not available.' }
    }
    if (!VALID_AGENT_ID.test(agentId || '')) {
      return { success: false, error: `Invalid agent id: ${agentId}` }
    }
    metadataStore.assertOwner('agents', agentId, currentUser)
    const meta = metadataStore.setVisibility('agents', agentId, {
      ownerUserId: currentUser?.id,
      visibility
    })
    return { success: true, metadata: meta }
  } catch (err) {
    return { success: false, code: err.code, error: err.message }
  }
}

module.exports = {
  parseAgentFrontmatter,
  scanAgentsForWeb,
  validateWebAgentImportPayload,
  cleanImportResult,
  importWebAgents,
  exportWebAgents,
  createWebAgentRaw,
  updateWebAgentRaw,
  getWebAgentRawContent,
  deleteWebAgent,
  toggleWebAgentDisabled,
  renameWebAgent,
  copyWebAgent,
  updateWebAgentVisibility,
  attachBuiltInAgentState
}
