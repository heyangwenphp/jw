/**
 * Project Database Operations Mixin
 *
 * 项目相关的数据库操作方法
 */

const { encodePath } = require('../utils/path-utils')

/**
 * 将 Project 操作方法混入到目标类
 * @param {Function} BaseClass - 基类
 * @returns {Function} - 扩展后的类
 */
function withProjectOperations(BaseClass) {
  return class extends BaseClass {
    // ========================================
    // Project Operations
    // ========================================

    /**
     * Get or create a project (用于同步服务，source='sync')
     * 注意：使用 encoded_path 进行匹配，避免 decodePath 的 '-' 分隔符歧义
     * projectPath 参数来自 decodePath，可能不准确，但仍存储用于显示
     */
    getOrCreateProject(projectPath, encodedPath, name) {
      if (!this.ensureDb()) return null
      // 使用 encoded_path 查找，避免路径中包含 '-' 导致的歧义
      const existing = this.db.prepare(
        'SELECT * FROM projects WHERE encoded_path = ?'
      ).get(encodedPath)

      if (existing) {
        return existing
      }

      // 同步导入的项目，source='sync'
      // 注意：projectPath 可能因 decodePath 歧义而不准确
      const result = this.db.prepare(
        "INSERT INTO projects (path, encoded_path, name, source) VALUES (?, ?, ?, 'sync')"
      ).run(projectPath, encodedPath, name)

      return {
        id: result.lastInsertRowid,
        path: projectPath,
        encoded_path: encodedPath,
        name,
        source: 'sync'
      }
    }

    /**
     * Get all projects (excluding hidden by default)
     * @param {boolean} includeHidden - 是否包含隐藏项目
     * @param {boolean} userOnly - 是否只返回用户添加的项目（主面板用）
     */
    getAllProjects(includeHidden = false, userOnly = true) {
      if (!this.ensureDb()) return []
      const conditions = []

      if (!includeHidden) {
        conditions.push("p.is_hidden = 0")
      }

      if (userOnly) {
        conditions.push("p.source = 'user'")
      }

      let sql = `
        SELECT p.*,
               COUNT(DISTINCT s.id) as session_count,
               MAX(s.last_message_at) as last_activity
        FROM projects p
        LEFT JOIN sessions s ON p.id = s.project_id
      `

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ')
      }

      sql += `
        GROUP BY p.id
        ORDER BY p.is_pinned DESC, p.last_opened_at DESC NULLS LAST
      `
      return this.db.prepare(sql).all()
    }

    /**
     * Get hidden projects
     */
    getHiddenProjects() {
      if (!this.ensureDb()) return []
      return this.db.prepare(`
        SELECT p.*,
               COUNT(DISTINCT s.id) as session_count
        FROM projects p
        LEFT JOIN sessions s ON p.id = s.project_id
        WHERE p.is_hidden = 1
        GROUP BY p.id
        ORDER BY p.name ASC
      `).all()
    }

    /**
     * Get project by ID
     */
    getProjectById(projectId) {
      if (!this.ensureDb()) return null
      return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
    }

    /**
     * Get project by path
     * 使用 encoded_path 匹配，避免 decodePath 的 '-' 分隔符歧义问题
     */
    getProjectByPath(projectPath) {
      if (!this.ensureDb()) return null
      const encoded = encodePath(projectPath)
      return this.db.prepare('SELECT * FROM projects WHERE encoded_path = ?').get(encoded)
    }

    /**
     * Create a new project
     * @param {Object} projectData - 项目数据
     * @param {string} projectData.source - 来源: 'user' (用户添加) 或 'sync' (同步导入)
     */
    createProject(projectData) {
      if (!this.ensureDb()) return null
      const {
        path: projectPath,
        name,
        description = '',
        icon = '📁',
        color = '#1890ff',
        api_profile_id = null,
        source = 'user'  // 默认为用户添加
      } = projectData

      // 使用 Claude CLI 的目录命名格式作为 encoded_path（与同步导入一致）
      const encoded = encodePath(projectPath)

      const now = Date.now()
      const result = this.db.prepare(`
        INSERT INTO projects (path, encoded_path, name, description, icon, color, api_profile_id, source, created_at, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(projectPath, encoded, name, description, icon, color, api_profile_id, source, now, now, now)

      return {
        id: result.lastInsertRowid,
        path: projectPath,
        encoded_path: encoded,
        name,
        description,
        icon,
        color,
        api_profile_id,
        source,
        is_pinned: 0,
        is_hidden: 0,
        created_at: now,
        updated_at: now,
        last_opened_at: now
      }
    }

    /**
     * Update project
     */
    updateProject(projectId, updates) {
      if (!this.ensureDb()) return null
      // path 可更新：用于修正 decodePath 解码错误的路径
      const allowedFields = ['path', 'name', 'description', 'icon', 'color', 'api_profile_id', 'is_pinned', 'is_hidden', 'last_opened_at', 'source']
      const fields = []
      const values = []

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          fields.push(`${key} = ?`)
          values.push(value)
        }
      }

      if (fields.length === 0) return null

      fields.push('updated_at = ?')
      values.push(Date.now())
      values.push(projectId)

      this.db.prepare(
        `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`
      ).run(...values)

      return this.getProjectById(projectId)
    }

    /**
     * Delete project (and optionally its sessions)
     */
    deleteProject(projectId, deleteSessions = false) {
      if (!this.ensureDb()) return { success: false, error: 'Database not available' }
      if (deleteSessions) {
        // CASCADE will handle sessions and messages
        this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
      } else {
        // Just remove the project, keep sessions orphaned (they won't show anyway)
        this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
      }
      return { success: true }
    }

    /**
     * Toggle project pinned status
     */
    toggleProjectPinned(projectId) {
      if (!this.ensureDb()) return null
      const project = this.getProjectById(projectId)
      if (!project) return null

      const newStatus = project.is_pinned ? 0 : 1
      this.updateProject(projectId, { is_pinned: newStatus })
      return { ...project, is_pinned: newStatus }
    }

    /**
     * Hide project (remove from panel)
     */
    hideProject(projectId) {
      if (!this.ensureDb()) return null
      return this.updateProject(projectId, { is_hidden: 1 })
    }

    /**
     * Unhide project (restore to panel)
     */
    unhideProject(projectId) {
      if (!this.ensureDb()) return null
      return this.updateProject(projectId, { is_hidden: 0 })
    }

    /**
     * Update project's last_opened_at timestamp
     */
    touchProject(projectId) {
      if (!this.ensureDb()) return
      const now = Date.now()
      this.db.prepare(
        'UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?'
      ).run(now, now, projectId)
    }

    /**
     * Duplicate project config
     */
    duplicateProject(projectId, newPath, newName) {
      if (!this.ensureDb()) return null
      const source = this.getProjectById(projectId)
      if (!source) return null

      return this.createProject({
        path: newPath,
        name: newName || `${source.name} (副本)`,
        description: source.description,
        icon: source.icon,
        color: source.color,
        api_profile_id: source.api_profile_id
      })
    }
  }
}

module.exports = { withProjectOperations }
