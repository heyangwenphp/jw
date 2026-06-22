const fs = require('fs')
const os = require('os')
const path = require('path')

const PROJECT_MASTER_TYPES = new Set(['track', 'company', 'topic', 'custom'])
const PROJECT_MASTER_DB_FILENAME = 'project-master.db'

let DefaultDatabase = null
function getDefaultDatabase() {
  if (!DefaultDatabase) {
    DefaultDatabase = require('better-sqlite3')
  }
  return DefaultDatabase
}

function parseJsonArray(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function normalizeMasterType(type) {
  return PROJECT_MASTER_TYPES.has(type) ? type : 'custom'
}

function normalizeNodeType(nodeType) {
  return nodeType === 'markdown' || nodeType === 'folder' ? nodeType : 'folder'
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

function mapProjectMasterRecord(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description || '',
    tags: parseJsonArray(row.tags_json),
    enabled: Boolean(row.enabled),
    templateNodes: parseJsonArray(row.template_nodes_json),
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function createProjectExistsError() {
  const error = new Error('项目已存在')
  error.code = 'PROJECT_EXISTS'
  return error
}

class ProjectMasterDatabase {
  constructor(options = {}) {
    this.db = null
    this.dbPath = null
    this._userDataPath = options.userDataPath || null
    this._Database = options.Database || null
  }

  init() {
    if (this.db) return
    const userDataPath = this._userDataPath || path.join(os.homedir(), '.config', 'jedi-web')
    this.dbPath = path.join(userDataPath, PROJECT_MASTER_DB_FILENAME)
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })

    const Database = this._Database || getDefaultDatabase()
    this.db = new Database(this.dbPath)
    this._createSchema()
    this._migrateLegacyProjectMasterRecords(userDataPath, Database)
    this._createIndexes()
  }

  ensureDb() {
    if (this.db) return true
    try {
      this.init()
      return true
    } catch (err) {
      console.error('[ProjectMasterDB] Failed to initialize:', err.message)
      return false
    }
  }

  close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_master_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'custom',
        description TEXT DEFAULT '',
        tags_json TEXT DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        template_nodes_json TEXT DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  }

  _createIndexes() {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_project_master_enabled ON project_master_records(enabled);
      CREATE INDEX IF NOT EXISTS idx_project_master_name ON project_master_records(lower(trim(name)));
    `)
  }

  _migrateLegacyProjectMasterRecords(userDataPath, Database) {
    const currentCount = this.db.prepare('SELECT COUNT(*) AS count FROM project_master_records').get()?.count || 0
    if (currentCount > 0) return

    const legacyPath = path.join(userDataPath, 'sessions.db')
    if (!fs.existsSync(legacyPath)) return

    const legacyDb = new Database(legacyPath, { readonly: true })
    try {
      const legacyTable = legacyDb.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'project_master_records'
      `).get()
      if (!legacyTable) return

      const legacyRows = legacyDb.prepare('SELECT * FROM project_master_records ORDER BY id ASC').all()
      if (legacyRows.length === 0) return

      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO project_master_records (
          id, name, type, description, tags_json, enabled, template_nodes_json, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const migrate = this.db.transaction((rows) => {
        for (const row of rows) {
          insert.run(
            row.id,
            row.name,
            row.type,
            row.description || '',
            row.tags_json || '[]',
            row.enabled === 0 ? 0 : 1,
            row.template_nodes_json || '[]',
            Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
            row.created_at || Date.now(),
            row.updated_at || Date.now()
          )
        }
      })
      migrate(legacyRows)
      console.log(`[ProjectMasterDB] Migrated ${legacyRows.length} legacy project master records`)
    } finally {
      legacyDb.close()
    }
  }

  listProjectMasterRecords({ enabledOnly = false } = {}) {
    if (!this.ensureDb()) return []
    const sql = `
      SELECT * FROM project_master_records
      ${enabledOnly ? 'WHERE enabled = 1' : ''}
      ORDER BY sort_order ASC, updated_at DESC, id DESC
    `
    return this.db.prepare(sql).all().map(mapProjectMasterRecord)
  }

  getProjectMasterRecord(id) {
    if (!this.ensureDb()) return null
    return mapProjectMasterRecord(this.db.prepare('SELECT * FROM project_master_records WHERE id = ?').get(id))
  }

  hasProjectMasterRecordName(name, excludeId = null) {
    if (!this.ensureDb()) return false
    const normalizedName = String(name || '').trim()
    if (!normalizedName) return false
    const row = excludeId
      ? this.db.prepare(`
        SELECT id FROM project_master_records
        WHERE lower(trim(name)) = lower(?) AND id != ?
        LIMIT 1
      `).get(normalizedName, excludeId)
      : this.db.prepare(`
        SELECT id FROM project_master_records
        WHERE lower(trim(name)) = lower(?)
        LIMIT 1
      `).get(normalizedName)
    return Boolean(row)
  }

  createProjectMasterRecord(payload = {}) {
    if (!this.ensureDb()) return null
    const now = Date.now()
    const name = String(payload.name || '').trim()
    if (!name) throw new Error('项目名称不能为空')
    if (this.hasProjectMasterRecordName(name)) throw createProjectExistsError()

    const result = this.db.prepare(`
      INSERT INTO project_master_records (
        name, type, description, tags_json, enabled, template_nodes_json, sort_order, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      normalizeMasterType(payload.type),
      String(payload.description || ''),
      JSON.stringify(Array.isArray(payload.tags) ? payload.tags : []),
      payload.enabled === false ? 0 : 1,
      JSON.stringify(normalizeTemplateNodes(payload.templateNodes)),
      Number.isFinite(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0,
      now,
      now
    )

    return this.getProjectMasterRecord(result.lastInsertRowid)
  }

  updateProjectMasterRecord(id, updates = {}) {
    if (!this.ensureDb()) return null
    const allowed = {
      name: value => String(value || '').trim(),
      type: normalizeMasterType,
      description: value => String(value || ''),
      tags: value => JSON.stringify(Array.isArray(value) ? value : []),
      enabled: value => (value === false || value === 0 ? 0 : 1),
      templateNodes: value => JSON.stringify(normalizeTemplateNodes(value)),
      sortOrder: value => Number.isFinite(Number(value)) ? Number(value) : 0
    }
    const columnMap = {
      tags: 'tags_json',
      templateNodes: 'template_nodes_json',
      sortOrder: 'sort_order'
    }
    const fields = []
    const values = []

    for (const [key, value] of Object.entries(updates)) {
      if (!allowed[key]) continue
      const normalized = allowed[key](value)
      if (key === 'name' && !normalized) throw new Error('项目名称不能为空')
      if (key === 'name' && this.hasProjectMasterRecordName(normalized, id)) throw createProjectExistsError()
      fields.push(`${columnMap[key] || key} = ?`)
      values.push(normalized)
    }

    if (fields.length === 0) return this.getProjectMasterRecord(id)
    fields.push('updated_at = ?')
    values.push(Date.now(), id)
    this.db.prepare(`UPDATE project_master_records SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.getProjectMasterRecord(id)
  }

  deleteProjectMasterRecord(id) {
    if (!this.ensureDb()) return { success: false, error: 'Database not available' }
    this.db.prepare('DELETE FROM project_master_records WHERE id = ?').run(id)
    return { success: true }
  }
}

module.exports = {
  PROJECT_MASTER_DB_FILENAME,
  ProjectMasterDatabase,
  normalizeTemplateNodes,
  mapProjectMasterRecord
}
