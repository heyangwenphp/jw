/**
 * Project Library Database Operations Mixin
 *
 * Stores project-library workspaces and their folder/document tree.
 * Project master records live in the standalone project-master.db store.
 */

const PROJECT_LIBRARY_NODE_TYPES = new Set(['markdown', 'folder', 'file'])
const PROJECT_WORKSPACE_TYPES = new Set(['track', 'company', 'topic', 'custom'])
const DEFAULT_PROJECT_LIBRARY_TEMPLATE_NODES = [
  { name: '项目概况.md', nodeType: 'markdown', content: '', sortOrder: 0, children: [] },
  { name: 'notes.md', nodeType: 'markdown', content: '', sortOrder: 1, children: [] },
  { name: '纪要', nodeType: 'folder', content: '', sortOrder: 2, children: [] },
  { name: '公告', nodeType: 'folder', content: '', sortOrder: 3, children: [] },
  { name: '其他', nodeType: 'folder', content: '', sortOrder: 4, children: [] }
]

function createProjectExistsError() {
  const error = new Error('项目已存在')
  error.code = 'PROJECT_EXISTS'
  return error
}

function normalizeWorkspaceType(type) {
  return PROJECT_WORKSPACE_TYPES.has(type) ? type : 'custom'
}

function normalizeNodeType(nodeType) {
  return PROJECT_LIBRARY_NODE_TYPES.has(nodeType) ? nodeType : 'folder'
}

function normalizeTemplateNodes(nodes = []) {
  if (!Array.isArray(nodes)) return []
  return nodes
    .map((node, index) => {
      const name = String(node?.name || '').trim()
      if (!name) return null
      const nodeType = normalizeNodeType(node?.nodeType || node?.node_type)
      return {
        name,
        nodeType,
        content: nodeType === 'markdown' ? String(node?.content || '') : '',
        sortOrder: Number.isFinite(Number(node?.sortOrder)) ? Number(node.sortOrder) : index,
        children: nodeType === 'folder' ? normalizeTemplateNodes(node?.children || []) : []
      }
    })
    .filter(Boolean)
}

function mapWorkspace(row, items = undefined) {
  if (!row) return null
  const workspace = {
    id: row.id,
    masterRecordId: row.master_record_id,
    name: row.name,
    type: row.type,
    description: row.description || '',
    createdByUserId: row.created_by_user_id,
    agentSessionId: row.agent_session_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (items !== undefined) workspace.items = items
  return workspace
}

function mapItem(row) {
  if (!row) return null
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    name: row.name,
    nodeType: row.node_type,
    content: row.content || '',
    filePath: row.file_path || '',
    mimeType: row.mime_type || '',
    sizeBytes: Number(row.size_bytes || 0),
    originalName: row.original_name || '',
    agentSessionId: row.agent_session_id || null,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function canAccessWorkspace(row, { userId, isAdmin = false } = {}) {
  if (!row) return false
  if (isAdmin) return true
  return row.created_by_user_id != null && Number(row.created_by_user_id) === Number(userId)
}

function canAccessItem(row, access = {}) {
  if (!row) return false
  if (access.isAdmin) return true
  return row.created_by_user_id != null && Number(row.created_by_user_id) === Number(access.userId)
}

function withProjectLibraryOperations(BaseClass) {
  return class extends BaseClass {
    hasProjectLibraryWorkspaceName({ userId, name, masterRecordId = null, excludeId = null } = {}) {
      if (!this.ensureDb()) return false
      const normalizedName = String(name || '').trim()
      const normalizedMasterRecordId = Number(masterRecordId)
      const hasMasterRecordId = Number.isFinite(normalizedMasterRecordId) && normalizedMasterRecordId > 0
      if (!normalizedName && !hasMasterRecordId) return false

      const userCondition = userId == null ? 'created_by_user_id IS NULL' : 'created_by_user_id = ?'
      const excludeCondition = excludeId ? 'AND id != ?' : ''
      const conflictConditions = []
      const params = userId == null ? [] : [userId]
      if (normalizedName) {
        conflictConditions.push('lower(trim(name)) = lower(?)')
        params.push(normalizedName)
      }
      if (hasMasterRecordId) {
        conflictConditions.push('master_record_id = ?')
        params.push(normalizedMasterRecordId)
      }
      if (excludeId) params.push(excludeId)

      const row = this.db.prepare(`
        SELECT id FROM project_library_workspaces
        WHERE ${userCondition}
          AND (${conflictConditions.join(' OR ')})
          ${excludeCondition}
        LIMIT 1
      `).get(...params)
      return Boolean(row)
    }

    countProjectLibraryWorkspacesByMasterRecord(masterRecordId) {
      if (!this.ensureDb()) return 0
      return this.db.prepare('SELECT COUNT(*) AS count FROM project_library_workspaces WHERE master_record_id = ?')
        .get(masterRecordId)?.count || 0
    }

    listProjectLibraryWorkspaces({ userId, isAdmin = false } = {}) {
      if (!this.ensureDb()) return []
      const rows = isAdmin
        ? this.db.prepare(`
          SELECT * FROM project_library_workspaces
          ORDER BY created_at ASC, id ASC
        `).all()
        : this.db.prepare(`
        SELECT * FROM project_library_workspaces
        WHERE created_by_user_id = ?
        ORDER BY created_at ASC, id ASC
      `).all(userId)

      return rows.map(row => mapWorkspace(row, this.listProjectLibraryTree(row.id, {
        userId,
        isAdmin
      })))
    }

    getProjectLibraryWorkspace(id, access = {}) {
      if (!this.ensureDb()) return null
      const row = this.db.prepare('SELECT * FROM project_library_workspaces WHERE id = ?').get(id)
      if (!canAccessWorkspace(row, access)) return null
      return mapWorkspace(row, this.listProjectLibraryTree(id, access))
    }

    createProjectLibraryWorkspace({ masterRecordId, masterRecord = null, userId, name, description, type = 'custom' } = {}) {
      if (!this.ensureDb()) return null
      const hasMasterRecordId = masterRecordId !== undefined && masterRecordId !== null
      const master = masterRecord || null
      if (hasMasterRecordId && !master) throw new Error('Project master record not found')
      if (hasMasterRecordId && master?.id && Number(master.id) !== Number(masterRecordId)) {
        throw new Error('Project master record not found')
      }

      const now = Date.now()
      const workspaceName = String(master?.name || name || '').trim()
      if (!workspaceName) throw new Error('Project name cannot be empty')
      if (this.hasProjectLibraryWorkspaceName({
        userId,
        name: workspaceName,
        masterRecordId: hasMasterRecordId ? Number(masterRecordId) : null
      })) throw createProjectExistsError()

      const workspaceType = master?.type || normalizeWorkspaceType(type)
      const hasInputDescription = description !== undefined && description !== null
      const workspaceDescription = hasInputDescription
        ? String(description || '').trim()
        : (master?.description || '')
      const templateNodes = master?.templateNodes?.length
        ? master.templateNodes
        : DEFAULT_PROJECT_LIBRARY_TEMPLATE_NODES

      const createWorkspace = this.db.transaction(() => {
        const result = this.db.prepare(`
          INSERT INTO project_library_workspaces (
            master_record_id, name, type, description, created_by_user_id, agent_session_id, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
        `).run(
          hasMasterRecordId ? Number(masterRecordId) : null,
          workspaceName,
          workspaceType,
          workspaceDescription,
          userId || null,
          now,
          now
        )

        const workspaceId = result.lastInsertRowid
        const insertTemplateNodes = (nodes, parentId = null) => {
          for (const node of nodes) {
            const item = this.createProjectLibraryItem({
              workspaceId,
              parentId,
              name: node.name,
              nodeType: node.nodeType,
              content: node.content || '',
              sortOrder: node.sortOrder || 0
            })
            if (node.nodeType === 'folder' && Array.isArray(node.children) && node.children.length > 0) {
              insertTemplateNodes(node.children, item.id)
            }
          }
        }
        insertTemplateNodes(templateNodes)
        return workspaceId
      })

      return this.getProjectLibraryWorkspace(createWorkspace(), { userId, isAdmin: true })
    }

    deleteProjectLibraryWorkspace(id, access = {}) {
      if (!this.ensureDb()) return { success: false, error: 'Database not available' }
      const workspace = this.db.prepare('SELECT * FROM project_library_workspaces WHERE id = ?').get(id)
      if (!canAccessWorkspace(workspace, access)) {
        return { success: false, error: 'Project workspace not found' }
      }

      const removeWorkspace = this.db.transaction(() => {
        this.db.prepare('DELETE FROM project_library_items WHERE workspace_id = ?').run(id)
        this.db.prepare('DELETE FROM project_library_workspaces WHERE id = ?').run(id)
      })
      removeWorkspace()
      return { success: true }
    }

    listProjectLibraryTree(workspaceId, access = {}) {
      if (!this.ensureDb()) return []
      const workspace = this.db.prepare('SELECT * FROM project_library_workspaces WHERE id = ?').get(workspaceId)
      if (!canAccessWorkspace(workspace, access)) return []
      return this.db.prepare(`
        SELECT * FROM project_library_items
        WHERE workspace_id = ?
        ORDER BY parent_id IS NOT NULL, parent_id ASC, sort_order ASC, id ASC
      `).all(workspaceId).map(mapItem)
    }

    createProjectLibraryItem({
      workspaceId,
      parentId = null,
      name,
      nodeType,
      content = '',
      sortOrder = 0,
      filePath = '',
      mimeType = '',
      sizeBytes = 0,
      originalName = ''
    } = {}) {
      if (!this.ensureDb()) return null
      const workspace = this.db.prepare('SELECT * FROM project_library_workspaces WHERE id = ?').get(workspaceId)
      if (!workspace) throw new Error('Project workspace not found')
      if (parentId) {
        const parent = this.db.prepare('SELECT * FROM project_library_items WHERE id = ? AND workspace_id = ?').get(parentId, workspaceId)
        if (!parent) throw new Error('Parent folder not found')
        if (parent.node_type !== 'folder') throw new Error('Items can only be created under folders')
      }

      const normalizedName = String(name || '').trim()
      if (!normalizedName) throw new Error('Name cannot be empty')
      const normalizedNodeType = normalizeNodeType(nodeType)
      const now = Date.now()
      const result = this.db.prepare(`
        INSERT INTO project_library_items (
          workspace_id, parent_id, name, node_type, content, file_path, mime_type, size_bytes, original_name, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workspaceId,
        parentId || null,
        normalizedName,
        normalizedNodeType,
        normalizedNodeType === 'markdown' ? String(content || '') : '',
        normalizedNodeType === 'file' ? String(filePath || '') : '',
        normalizedNodeType === 'file' ? String(mimeType || '') : '',
        normalizedNodeType === 'file' && Number.isFinite(Number(sizeBytes)) ? Number(sizeBytes) : 0,
        normalizedNodeType === 'file' ? String(originalName || normalizedName) : '',
        Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
        now,
        now
      )

      this.db.prepare('UPDATE project_library_workspaces SET updated_at = ? WHERE id = ?').run(now, workspaceId)
      return mapItem(this.db.prepare('SELECT * FROM project_library_items WHERE id = ?').get(result.lastInsertRowid))
    }

    getProjectLibraryItem(id, access = {}) {
      if (!this.ensureDb()) return null
      const row = this.db.prepare(`
        SELECT item.*, workspace.created_by_user_id
        FROM project_library_items item
        JOIN project_library_workspaces workspace ON workspace.id = item.workspace_id
        WHERE item.id = ?
      `).get(id)
      if (!canAccessItem(row, access)) return null
      return mapItem(row)
    }

    updateProjectLibraryItem(id, updates = {}, access = {}) {
      if (!this.ensureDb()) return null
      const existing = this.db.prepare(`
        SELECT item.*, workspace.created_by_user_id
        FROM project_library_items item
        JOIN project_library_workspaces workspace ON workspace.id = item.workspace_id
        WHERE item.id = ?
      `).get(id)
      if (!canAccessItem(existing, access)) throw new Error('Project item not found')

      const fields = []
      const values = []
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'name') {
          const nextName = String(value || '').trim()
          if (!nextName) throw new Error('Name cannot be empty')
          fields.push('name = ?')
          values.push(nextName)
        } else if (key === 'sortOrder') {
          fields.push('sort_order = ?')
          values.push(Number.isFinite(Number(value)) ? Number(value) : 0)
        } else if (key === 'content') {
          fields.push('content = ?')
          values.push(String(value || ''))
        }
      }

      if (fields.length === 0) return mapItem(existing)
      fields.push('updated_at = ?')
      const now = Date.now()
      values.push(now, id)
      this.db.prepare(`UPDATE project_library_items SET ${fields.join(', ')} WHERE id = ?`).run(...values)
      this.db.prepare('UPDATE project_library_workspaces SET updated_at = ? WHERE id = ?').run(now, existing.workspace_id)
      return mapItem(this.db.prepare('SELECT * FROM project_library_items WHERE id = ?').get(id))
    }

    deleteProjectLibraryItem(id, access = {}) {
      if (!this.ensureDb()) return { success: false, error: 'Database not available' }
      const existing = this.db.prepare(`
        SELECT item.*, workspace.created_by_user_id
        FROM project_library_items item
        JOIN project_library_workspaces workspace ON workspace.id = item.workspace_id
        WHERE item.id = ?
      `).get(id)
      if (!canAccessItem(existing, access)) {
        return { success: false, error: 'Project item not found' }
      }
      if (existing.node_type === 'folder') {
        const childCount = this.db.prepare('SELECT COUNT(*) AS count FROM project_library_items WHERE parent_id = ?').get(id)?.count || 0
        if (childCount > 0) {
          return { success: false, error: '请先删除文件夹内的内容' }
        }
      }
      const now = Date.now()
      this.db.prepare('DELETE FROM project_library_items WHERE id = ?').run(id)
      this.db.prepare('UPDATE project_library_workspaces SET updated_at = ? WHERE id = ?').run(now, existing.workspace_id)
      return { success: true }
    }

    bindProjectWorkspaceAgentSession(workspaceId, sessionId) {
      if (!this.ensureDb()) return null
      const now = Date.now()
      this.db.prepare(`
        UPDATE project_library_workspaces
        SET agent_session_id = ?, updated_at = ?
        WHERE id = ?
      `).run(sessionId || null, now, workspaceId)
      return mapWorkspace(this.db.prepare('SELECT * FROM project_library_workspaces WHERE id = ?').get(workspaceId))
    }

    bindProjectLibraryItemAgentSession(itemId, sessionId, access = {}) {
      if (!this.ensureDb()) return null
      const existing = this.db.prepare(`
        SELECT item.*, workspace.created_by_user_id
        FROM project_library_items item
        JOIN project_library_workspaces workspace ON workspace.id = item.workspace_id
        WHERE item.id = ?
      `).get(itemId)
      if (!canAccessItem(existing, access)) throw new Error('Project item not found')

      const now = Date.now()
      this.db.prepare(`
        UPDATE project_library_items
        SET agent_session_id = ?, updated_at = ?
        WHERE id = ?
      `).run(sessionId || null, now, itemId)
      this.db.prepare('UPDATE project_library_workspaces SET updated_at = ? WHERE id = ?').run(now, existing.workspace_id)
      return mapItem(this.db.prepare('SELECT * FROM project_library_items WHERE id = ?').get(itemId))
    }
  }
}

module.exports = {
  DEFAULT_PROJECT_LIBRARY_TEMPLATE_NODES,
  withProjectLibraryOperations,
  normalizeTemplateNodes
}
