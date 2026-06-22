import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { SessionDatabase } = require('../src/main/session-database.js')
const { ProjectMasterDatabase } = require('../src/main/database/project-master-db.js')

function createApp() {
  const routes = new Map()
  const app = {}
  for (const method of ['get', 'post', 'patch', 'delete']) {
    app[method] = (path, handler) => routes.set(`${method.toUpperCase()} ${path}`, handler)
  }
  return { app, routes }
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    }
  }
}

async function invoke(routes, method, path, { user, body = {}, params = {}, query = {} } = {}) {
  const handler = routes.get(`${method} ${path}`)
  expect(handler).toEqual(expect.any(Function))
  const res = createResponse()
  await handler({ body, params, query, user }, res)
  return res
}

function createHarness() {
  const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-project-library-api-'))
  const sessionDatabase = new SessionDatabase({ userDataPath })
  const projectMasterDatabase = new ProjectMasterDatabase({ userDataPath })
  sessionDatabase.init()
  projectMasterDatabase.init()
  const closeSessionDatabase = sessionDatabase.close.bind(sessionDatabase)
  sessionDatabase.close = () => {
    projectMasterDatabase.close()
    closeSessionDatabase()
  }
  const { app, routes } = createApp()
  const { registerProjectLibraryRoutes } = require('../server/project-library-routes.js')
  registerProjectLibraryRoutes({
    app,
    sessionDatabase,
    projectMasterDatabase,
    requireWebUser: req => req.user,
    sendWebAuthError: (res, err) => res.status(err?.code === 'AUTH_REQUIRED' ? 401 : 403).json({ success: false, error: err.message })
  })
  return { sessionDatabase, routes, userDataPath }
}

describe('project library web API routes', () => {
  it('lets only the admin phone manage project master records', async () => {
    const { sessionDatabase, routes, userDataPath } = createHarness()
    try {
      const normalUser = sessionDatabase.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })
      const adminUser = sessionDatabase.createUser({ phone: '15527109305', passwordHash: 'h2', passwordSalt: 's2' })

      const forbidden = await invoke(routes, 'POST', '/api/project-master-records', {
        user: normalUser,
        body: { name: '碳中和', type: 'track' }
      })
      expect(forbidden.statusCode).toBe(403)

      const created = await invoke(routes, 'POST', '/api/project-master-records', {
        user: adminUser,
        body: {
          name: '碳中和',
          type: 'track',
          templateNodes: [
            { name: '项目概况.md', nodeType: 'markdown' },
            { name: '公告', nodeType: 'folder' }
          ]
        }
      })
      expect(created.statusCode).toBe(200)
      expect(created.body).toMatchObject({
        name: '碳中和',
        type: 'track',
        enabled: true
      })

      const listed = await invoke(routes, 'GET', '/api/project-master-records', { user: normalUser })
      expect(listed.body.map(record => record.name)).toEqual(['碳中和'])
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('creates project workspaces as roots and allows creating items inside them', async () => {
    const { sessionDatabase, routes, userDataPath } = createHarness()
    try {
      const user = sessionDatabase.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })
      const admin = sessionDatabase.createUser({ phone: '15527109305', passwordHash: 'h2', passwordSalt: 's2' })
      const masterRes = await invoke(routes, 'POST', '/api/project-master-records', {
        user: admin,
        body: {
          name: '碳中和',
          type: 'track',
          templateNodes: [{ name: '项目概况.md', nodeType: 'markdown', content: '项目概况' }]
        }
      })

      const workspaceRes = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: {
          masterRecordId: masterRes.body.id,
          description: '弹窗编辑后的项目夹描述'
        }
      })
      expect(workspaceRes.statusCode).toBe(200)
      expect(workspaceRes.body).toMatchObject({
        name: '碳中和',
        description: '弹窗编辑后的项目夹描述',
        agentSessionId: null
      })
      expect(workspaceRes.body.items.map(item => item.name)).toEqual(['项目概况.md'])

      const itemRes = await invoke(routes, 'POST', '/api/project-library/workspaces/:id/items', {
        user,
        params: { id: workspaceRes.body.id },
        body: { name: '访谈纪要', nodeType: 'folder' }
      })
      expect(itemRes.statusCode).toBe(200)
      expect(itemRes.body).toMatchObject({
        workspaceId: workspaceRes.body.id,
        name: '访谈纪要',
        nodeType: 'folder'
      })

      const loaded = await invoke(routes, 'GET', '/api/project-library/workspaces/:id', {
        user,
        params: { id: workspaceRes.body.id }
      })
      expect(loaded.body.items.map(item => item.name)).toEqual(['项目概况.md', '访谈纪要'])
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('creates a custom project workspace from the create project dialog payload', async () => {
    const { sessionDatabase, routes, userDataPath } = createHarness()
    try {
      const user = sessionDatabase.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })

      const workspaceRes = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: {
          name: '自定义项目',
          description: '自定义项目描述',
          type: 'custom'
        }
      })

      expect(workspaceRes.statusCode).toBe(200)
      expect(workspaceRes.body).toMatchObject({
        masterRecordId: null,
        name: '自定义项目',
        type: 'custom',
        description: '自定义项目描述'
      })
      expect(workspaceRes.body.items.map(item => item.name)).toEqual([
        '项目概况.md',
        'notes.md',
        '纪要',
        '公告',
        '其他'
      ])
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('uploads original files into a project library folder', async () => {
    const { sessionDatabase, routes, userDataPath } = createHarness()
    try {
      const user = sessionDatabase.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })
      const workspaceRes = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: { name: 'Upload Project', type: 'custom' }
      })
      const folderRes = await invoke(routes, 'POST', '/api/project-library/workspaces/:id/items', {
        user,
        params: { id: workspaceRes.body.id },
        body: { name: 'Source Files', nodeType: 'folder' }
      })

      const uploadRes = await invoke(routes, 'POST', '/api/project-library/workspaces/:id/uploads', {
        user,
        params: { id: workspaceRes.body.id },
        body: {
          parentId: folderRes.body.id,
          name: 'deck.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 7,
          contentBase64: Buffer.from('PDFDATA').toString('base64')
        }
      })

      expect(uploadRes.statusCode).toBe(200)
      expect(uploadRes.body).toMatchObject({
        workspaceId: workspaceRes.body.id,
        parentId: folderRes.body.id,
        name: 'deck.pdf',
        nodeType: 'file',
        mimeType: 'application/pdf',
        sizeBytes: 7,
        originalName: 'deck.pdf'
      })
      expect(uploadRes.body.filePath).toContain('project-library-files')
      expect(existsSync(uploadRes.body.filePath)).toBe(true)
      expect(readFileSync(uploadRes.body.filePath, 'utf-8')).toBe('PDFDATA')

      const loaded = await invoke(routes, 'GET', '/api/project-library/workspaces/:id', {
        user,
        params: { id: workspaceRes.body.id }
      })
      expect(loaded.body.items.find(item => item.id === uploadRes.body.id)).toMatchObject({
        nodeType: 'file',
        filePath: uploadRes.body.filePath
      })
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('uploads markdown files as previewable project markdown items', async () => {
    const { sessionDatabase, routes, userDataPath } = createHarness()
    try {
      const user = sessionDatabase.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })
      const workspaceRes = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: { name: 'Markdown Upload Project', type: 'custom' }
      })
      const folderRes = await invoke(routes, 'POST', '/api/project-library/workspaces/:id/items', {
        user,
        params: { id: workspaceRes.body.id },
        body: { name: 'Source Files', nodeType: 'folder' }
      })
      const markdownContent = '# Design\n\nMarkdown upload should open in preview.'

      const uploadRes = await invoke(routes, 'POST', '/api/project-library/workspaces/:id/uploads', {
        user,
        params: { id: workspaceRes.body.id },
        body: {
          parentId: folderRes.body.id,
          name: 'AI-agent-design.md',
          mimeType: 'text/markdown',
          sizeBytes: Buffer.byteLength(markdownContent),
          contentBase64: Buffer.from(markdownContent).toString('base64')
        }
      })

      expect(uploadRes.statusCode).toBe(200)
      expect(uploadRes.body).toMatchObject({
        workspaceId: workspaceRes.body.id,
        parentId: folderRes.body.id,
        name: 'AI-agent-design.md',
        nodeType: 'markdown',
        content: markdownContent,
        filePath: ''
      })

      const loaded = await invoke(routes, 'GET', '/api/project-library/workspaces/:id', {
        user,
        params: { id: workspaceRes.body.id }
      })
      expect(loaded.body.items.find(item => item.id === uploadRes.body.id)).toMatchObject({
        nodeType: 'markdown',
        content: markdownContent
      })
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('returns conflict when creating duplicate project library workspaces or master records', async () => {
    const { sessionDatabase, routes, userDataPath } = createHarness()
    try {
      const user = sessionDatabase.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })
      const admin = sessionDatabase.createUser({ phone: '15527109305', passwordHash: 'h2', passwordSalt: 's2' })

      const master = await invoke(routes, 'POST', '/api/project-master-records', {
        user: admin,
        body: { name: '碳中和', type: 'track' }
      })
      expect(master.statusCode).toBe(200)

      const duplicateMaster = await invoke(routes, 'POST', '/api/project-master-records', {
        user: admin,
        body: { name: ' 碳中和 ', type: 'topic' }
      })
      expect(duplicateMaster.statusCode).toBe(409)
      expect(duplicateMaster.body.error).toBe('项目已存在')

      const otherMaster = await invoke(routes, 'POST', '/api/project-master-records', {
        user: admin,
        body: { name: '光电伏', type: 'company' }
      })
      const duplicateRename = await invoke(routes, 'PATCH', '/api/project-master-records/:id', {
        user: admin,
        params: { id: otherMaster.body.id },
        body: { name: '碳中和' }
      })
      expect(duplicateRename.statusCode).toBe(409)
      expect(duplicateRename.body.error).toBe('项目已存在')

      const workspace = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: { name: '碳中和', type: 'custom' }
      })
      expect(workspace.statusCode).toBe(200)

      const duplicateWorkspace = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: { name: ' 碳中和 ', type: 'custom' }
      })
      expect(duplicateWorkspace.statusCode).toBe(409)
      expect(duplicateWorkspace.body.error).toBe('项目已存在')

      const masterWorkspace = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: { masterRecordId: master.body.id, name: '碳中和' }
      })
      expect(masterWorkspace.statusCode).toBe(409)

      const tamperedMasterWorkspace = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: { masterRecordId: master.body.id, name: '被篡改的项目名' }
      })
      expect(tamperedMasterWorkspace.statusCode).toBe(409)
      expect(tamperedMasterWorkspace.body.error).toBe('项目已存在')
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('renames and deletes project tree items through web routes', async () => {
    const { sessionDatabase, routes, userDataPath } = createHarness()
    try {
      const user = sessionDatabase.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })
      const workspaceRes = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: { name: 'Tree Ops', type: 'custom' }
      })
      const folderRes = await invoke(routes, 'POST', '/api/project-library/workspaces/:id/items', {
        user,
        params: { id: workspaceRes.body.id },
        body: { name: 'Folder A', nodeType: 'folder' }
      })
      const fileRes = await invoke(routes, 'POST', '/api/project-library/workspaces/:id/items', {
        user,
        params: { id: workspaceRes.body.id },
        body: { parentId: folderRes.body.id, name: 'Note.md', nodeType: 'markdown' }
      })

      const renamed = await invoke(routes, 'PATCH', '/api/project-library/items/:id', {
        user,
        params: { id: fileRes.body.id },
        body: { name: 'Renamed.md' }
      })
      expect(renamed.statusCode).toBe(200)
      expect(renamed.body.name).toBe('Renamed.md')

      const nonEmptyDelete = await invoke(routes, 'DELETE', '/api/project-library/items/:id', {
        user,
        params: { id: folderRes.body.id }
      })
      expect(nonEmptyDelete.statusCode).toBe(400)
      expect(nonEmptyDelete.body.error).toBe('请先删除文件夹内的内容')

      const fileDelete = await invoke(routes, 'DELETE', '/api/project-library/items/:id', {
        user,
        params: { id: fileRes.body.id }
      })
      expect(fileDelete.statusCode).toBe(200)
      expect(fileDelete.body.success).toBe(true)
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('binds an agent session to a project library item through web routes', async () => {
    const { sessionDatabase, routes, userDataPath } = createHarness()
    try {
      const user = sessionDatabase.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })
      const workspaceRes = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: { name: 'Scoped Sessions', type: 'custom' }
      })
      const itemRes = await invoke(routes, 'POST', '/api/project-library/workspaces/:id/items', {
        user,
        params: { id: workspaceRes.body.id },
        body: { name: 'Folder A', nodeType: 'folder' }
      })

      const bound = await invoke(routes, 'POST', '/api/project-library/items/:id/agent-session', {
        user,
        params: { id: itemRes.body.id },
        body: { sessionId: 'item-session-1' }
      })

      expect(bound.statusCode).toBe(200)
      expect(bound.body).toMatchObject({
        id: itemRes.body.id,
        agentSessionId: 'item-session-1'
      })
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('deletes project workspaces through web routes', async () => {
    const { sessionDatabase, routes, userDataPath } = createHarness()
    try {
      const user = sessionDatabase.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })
      const workspaceRes = await invoke(routes, 'POST', '/api/project-library/workspaces', {
        user,
        body: { name: '待删除项目', type: 'custom' }
      })

      const deleteRes = await invoke(routes, 'DELETE', '/api/project-library/workspaces/:id', {
        user,
        params: { id: workspaceRes.body.id }
      })
      expect(deleteRes.statusCode).toBe(200)
      expect(deleteRes.body.success).toBe(true)

      const loaded = await invoke(routes, 'GET', '/api/project-library/workspaces/:id', {
        user,
        params: { id: workspaceRes.body.id }
      })
      expect(loaded.statusCode).toBe(404)

      const listed = await invoke(routes, 'GET', '/api/project-library/workspaces', { user })
      expect(listed.body).toEqual([])
    } finally {
      sessionDatabase.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
