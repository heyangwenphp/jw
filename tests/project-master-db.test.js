import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { ProjectMasterDatabase } = require('../src/main/database/project-master-db.js')
const { SessionDatabase } = require('../src/main/session-database.js')

function createProjectMasterDatabase(prefix = 'jedi-project-master-') {
  const userDataPath = mkdtempSync(join(tmpdir(), prefix))
  const database = new ProjectMasterDatabase({ userDataPath })
  database.init()
  return { database, userDataPath }
}

describe('project master database', () => {
  it('stores project master records in a standalone project-master.db file', () => {
    const { database, userDataPath } = createProjectMasterDatabase()
    try {
      const master = database.createProjectMasterRecord({
        name: 'Carbon Neutrality',
        type: 'track',
        description: 'Batch imported project master data',
        tags: ['energy', 'carbon'],
        templateNodes: [
          { name: 'overview.md', nodeType: 'markdown', content: 'overview' },
          { name: 'notes', nodeType: 'folder' }
        ],
        sortOrder: 20
      })

      expect(existsSync(join(userDataPath, 'project-master.db'))).toBe(true)
      expect(master).toMatchObject({
        id: expect.any(Number),
        name: 'Carbon Neutrality',
        type: 'track',
        description: 'Batch imported project master data',
        tags: ['energy', 'carbon'],
        enabled: true,
        sortOrder: 20
      })
      expect(master.templateNodes.map(node => [node.name, node.nodeType])).toEqual([
        ['overview.md', 'markdown'],
        ['notes', 'folder']
      ])

      const [stored] = database.listProjectMasterRecords({ enabledOnly: true })
      expect(stored.name).toBe('Carbon Neutrality')
    } finally {
      database.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('migrates legacy project master records from sessions.db when the standalone db is empty', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-project-master-migrate-'))
    const legacy = new SessionDatabase({ userDataPath })
    legacy.init()
    try {
      legacy.db.prepare(`
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
      `).run()
      legacy.db.prepare(`
        INSERT INTO project_master_records (
          id, name, type, description, tags_json, enabled, template_nodes_json, sort_order, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        9,
        'Legacy Master',
        'company',
        'legacy row',
        JSON.stringify(['legacy']),
        1,
        JSON.stringify([{ name: 'legacy.md', nodeType: 'markdown', content: 'legacy' }]),
        30,
        1000,
        2000
      )
      legacy.close()

      const database = new ProjectMasterDatabase({ userDataPath })
      database.init()
      try {
        const [migrated] = database.listProjectMasterRecords()
        expect(migrated).toMatchObject({
          id: 9,
          name: 'Legacy Master',
          type: 'company',
          tags: ['legacy'],
          sortOrder: 30,
          createdAt: 1000,
          updatedAt: 2000
        })
      } finally {
        database.close()
      }
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
