import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { SessionDatabase } = require('../src/main/session-database.js')
const { ProjectMasterDatabase } = require('../src/main/database/project-master-db.js')
const Database = require('better-sqlite3')

function createDatabases(prefix = 'jedi-project-library-') {
  const userDataPath = mkdtempSync(join(tmpdir(), prefix))
  const sessionDatabase = new SessionDatabase({ userDataPath })
  const projectMasterDatabase = new ProjectMasterDatabase({ userDataPath })
  sessionDatabase.init()
  projectMasterDatabase.init()
  return { sessionDatabase, projectMasterDatabase, userDataPath }
}

function closeDatabases({ sessionDatabase, projectMasterDatabase, userDataPath }) {
  projectMasterDatabase.close()
  sessionDatabase.close()
  rmSync(userDataPath, { recursive: true, force: true })
}

describe('project library database operations', () => {
  it('creates a workspace from an externally loaded project master record', () => {
    const ctx = createDatabases()
    try {
      const { sessionDatabase, projectMasterDatabase } = ctx
      const user = sessionDatabase.createUser({
        phone: '15500000001',
        passwordHash: 'hash',
        passwordSalt: 'salt'
      })
      const master = projectMasterDatabase.createProjectMasterRecord({
        name: 'Carbon Neutrality',
        type: 'track',
        description: 'Project master description',
        templateNodes: [
          { name: 'overview.md', nodeType: 'markdown', content: 'overview' },
          { name: 'meetings', nodeType: 'folder' }
        ]
      })

      const workspace = sessionDatabase.createProjectLibraryWorkspace({
        masterRecordId: master.id,
        masterRecord: master,
        userId: user.id,
        description: 'Workspace description'
      })

      expect(workspace).toMatchObject({
        masterRecordId: master.id,
        name: 'Carbon Neutrality',
        type: 'track',
        description: 'Workspace description',
        agentSessionId: null
      })
      expect(workspace.items.map(item => [item.name, item.nodeType, item.content])).toEqual([
        ['overview.md', 'markdown', 'overview'],
        ['meetings', 'folder', '']
      ])
    } finally {
      closeDatabases(ctx)
    }
  })

  it('requires service-layer master data when masterRecordId is provided', () => {
    const ctx = createDatabases()
    try {
      const { sessionDatabase } = ctx
      const user = sessionDatabase.createUser({
        phone: '15500000002',
        passwordHash: 'hash',
        passwordSalt: 'salt'
      })

      expect(() => sessionDatabase.createProjectLibraryWorkspace({
        masterRecordId: 999,
        userId: user.id
      })).toThrow()
    } finally {
      closeDatabases(ctx)
    }
  })

  it('creates custom workspaces with the default template tree', () => {
    const ctx = createDatabases()
    try {
      const { sessionDatabase } = ctx
      const user = sessionDatabase.createUser({
        phone: '15500000003',
        passwordHash: 'hash',
        passwordSalt: 'salt'
      })

      const workspace = sessionDatabase.createProjectLibraryWorkspace({
        userId: user.id,
        name: 'Custom Workspace',
        description: 'Custom description',
        type: 'custom'
      })

      expect(workspace).toMatchObject({
        masterRecordId: null,
        name: 'Custom Workspace',
        type: 'custom',
        description: 'Custom description'
      })
      expect(workspace.items).toHaveLength(5)
      expect(workspace.items.map(item => item.nodeType)).toEqual([
        'markdown',
        'markdown',
        'folder',
        'folder',
        'folder'
      ])
    } finally {
      closeDatabases(ctx)
    }
  })

  it('lists workspaces with their project tree items', () => {
    const ctx = createDatabases()
    try {
      const { sessionDatabase } = ctx
      const user = sessionDatabase.createUser({
        phone: '15500000008',
        passwordHash: 'hash',
        passwordSalt: 'salt'
      })

      const firstWorkspace = sessionDatabase.createProjectLibraryWorkspace({
        userId: user.id,
        name: 'First Workspace',
        type: 'custom'
      })
      const secondWorkspace = sessionDatabase.createProjectLibraryWorkspace({
        userId: user.id,
        name: 'Second Workspace',
        type: 'custom'
      })
      const folder = sessionDatabase.createProjectLibraryItem({
        workspaceId: secondWorkspace.id,
        name: 'Due Diligence',
        nodeType: 'folder'
      })
      sessionDatabase.createProjectLibraryItem({
        workspaceId: secondWorkspace.id,
        parentId: folder.id,
        name: 'memo.md',
        nodeType: 'markdown',
        content: 'memo'
      })

      const workspaces = sessionDatabase.listProjectLibraryWorkspaces({ userId: user.id })
      const listedFirst = workspaces.find(workspace => workspace.id === firstWorkspace.id)
      const listedSecond = workspaces.find(workspace => workspace.id === secondWorkspace.id)

      expect(listedFirst.items.map(item => item.name)).toContain('notes.md')
      expect(listedSecond.items.map(item => [item.name, item.parentId || null])).toContainEqual(['Due Diligence', null])
      expect(listedSecond.items.map(item => [item.name, item.parentId || null])).toContainEqual(['memo.md', folder.id])
    } finally {
      closeDatabases(ctx)
    }
  })

  it('stores uploaded original files as project library file nodes', () => {
    const ctx = createDatabases()
    try {
      const { sessionDatabase } = ctx
      const user = sessionDatabase.createUser({
        phone: '15500000009',
        passwordHash: 'hash',
        passwordSalt: 'salt'
      })
      const workspace = sessionDatabase.createProjectLibraryWorkspace({
        userId: user.id,
        name: 'File Assets',
        type: 'custom'
      })
      const folder = sessionDatabase.createProjectLibraryItem({
        workspaceId: workspace.id,
        name: 'Uploads',
        nodeType: 'folder'
      })

      const fileItem = sessionDatabase.createProjectLibraryItem({
        workspaceId: workspace.id,
        parentId: folder.id,
        name: 'deck.pdf',
        nodeType: 'file',
        filePath: 'C:\\project-library-files\\deck.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        originalName: 'deck.pdf',
        content: 'ignored binary content'
      })

      expect(fileItem).toMatchObject({
        name: 'deck.pdf',
        nodeType: 'file',
        content: '',
        filePath: 'C:\\project-library-files\\deck.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234,
        originalName: 'deck.pdf'
      })

      const loaded = sessionDatabase.getProjectLibraryWorkspace(workspace.id, { userId: user.id })
      expect(loaded.items.find(item => item.id === fileItem.id)).toMatchObject({
        nodeType: 'file',
        filePath: 'C:\\project-library-files\\deck.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1234
      })

      const listed = sessionDatabase.listProjectLibraryWorkspaces({ userId: user.id })
      expect(listed[0].items.find(item => item.id === fileItem.id)).toMatchObject({
        nodeType: 'file',
        originalName: 'deck.pdf'
      })
    } finally {
      closeDatabases(ctx)
    }
  })

  it('prevents duplicate workspace names for the same user only', () => {
    const ctx = createDatabases()
    try {
      const { sessionDatabase } = ctx
      const firstUser = sessionDatabase.createUser({
        phone: '15500000004',
        passwordHash: 'hash',
        passwordSalt: 'salt'
      })
      const secondUser = sessionDatabase.createUser({
        phone: '15500000005',
        passwordHash: 'hash',
        passwordSalt: 'salt'
      })

      sessionDatabase.createProjectLibraryWorkspace({
        userId: firstUser.id,
        name: 'Shared Name'
      })

      expect(() => sessionDatabase.createProjectLibraryWorkspace({
        userId: firstUser.id,
        name: ' Shared Name '
      })).toThrow()

      const secondWorkspace = sessionDatabase.createProjectLibraryWorkspace({
        userId: secondUser.id,
        name: 'Shared Name'
      })
      expect(secondWorkspace.name).toBe('Shared Name')
    } finally {
      closeDatabases(ctx)
    }
  })

  it('supports tree item CRUD and independent agent session bindings', () => {
    const ctx = createDatabases()
    try {
      const { sessionDatabase } = ctx
      const user = sessionDatabase.createUser({
        phone: '15500000006',
        passwordHash: 'hash',
        passwordSalt: 'salt'
      })
      const workspace = sessionDatabase.createProjectLibraryWorkspace({
        userId: user.id,
        name: 'Tree Ops'
      })
      const folder = sessionDatabase.createProjectLibraryItem({
        workspaceId: workspace.id,
        name: 'Folder A',
        nodeType: 'folder'
      })
      const file = sessionDatabase.createProjectLibraryItem({
        workspaceId: workspace.id,
        parentId: folder.id,
        name: 'Note.md',
        nodeType: 'markdown',
        content: 'note'
      })

      expect(() => sessionDatabase.createProjectLibraryItem({
        workspaceId: workspace.id,
        parentId: file.id,
        name: 'Nested.md',
        nodeType: 'markdown'
      })).toThrow()

      const root = sessionDatabase.bindProjectWorkspaceAgentSession(workspace.id, 'root-session')
      const boundFolder = sessionDatabase.bindProjectLibraryItemAgentSession(folder.id, 'folder-session', { userId: user.id })
      const renamed = sessionDatabase.updateProjectLibraryItem(file.id, { name: 'Renamed.md' }, { userId: user.id })

      expect(root.agentSessionId).toBe('root-session')
      expect(boundFolder.agentSessionId).toBe('folder-session')
      expect(renamed.name).toBe('Renamed.md')
      expect(sessionDatabase.deleteProjectLibraryItem(folder.id, { userId: user.id }).success).toBe(false)
      expect(sessionDatabase.deleteProjectLibraryItem(file.id, { userId: user.id }).success).toBe(true)
      expect(sessionDatabase.deleteProjectLibraryItem(folder.id, { userId: user.id }).success).toBe(true)
    } finally {
      closeDatabases(ctx)
    }
  })

  it('migrates legacy workspace foreign keys to soft project master references', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-project-library-fk-migrate-'))
    const dbPath = join(userDataPath, 'sessions.db')
    const legacy = new Database(dbPath)
    try {
      legacy.exec(`
        CREATE TABLE project_master_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL
        );
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          last_login_at INTEGER
        );
        CREATE TABLE project_library_workspaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          master_record_id INTEGER,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'custom',
          description TEXT DEFAULT '',
          created_by_user_id INTEGER,
          agent_session_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (master_record_id) REFERENCES project_master_records(id) ON DELETE SET NULL,
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT INTO project_master_records (id, name) VALUES (7, 'Legacy Master');
        INSERT INTO users (id, phone, password_hash, password_salt, created_at) VALUES (3, '15500000007', 'h', 's', 1000);
        INSERT INTO project_library_workspaces (
          id, master_record_id, name, type, description, created_by_user_id, agent_session_id, created_at, updated_at
        )
        VALUES (11, 7, 'Legacy Workspace', 'track', 'legacy', 3, NULL, 1000, 2000);
      `)
    } finally {
      legacy.close()
    }

    const sessionDatabase = new SessionDatabase({ userDataPath })
    try {
      sessionDatabase.init()
      const tableSql = sessionDatabase.db.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'project_library_workspaces'
      `).get().sql
      const workspace = sessionDatabase.db.prepare('SELECT * FROM project_library_workspaces WHERE id = 11').get()

      expect(tableSql).not.toContain('REFERENCES project_master_records')
      expect(workspace).toMatchObject({
        master_record_id: 7,
        name: 'Legacy Workspace',
        type: 'track',
        description: 'legacy'
      })
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
