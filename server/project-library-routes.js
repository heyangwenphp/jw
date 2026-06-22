const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PROJECT_LIBRARY_ADMIN_PHONE = '15527109305'

function getProjectLibraryStorageRoot(sessionDatabase) {
  const userDataPath = sessionDatabase?._userDataPath || (sessionDatabase?.dbPath ? path.dirname(sessionDatabase.dbPath) : null)
  if (!userDataPath) throw new Error('Project library storage path unavailable')
  return path.join(userDataPath, 'project-library-files')
}

function sanitizeUploadFileName(name = 'upload') {
  const baseName = path.basename(String(name || 'upload')).trim() || 'upload'
  const sanitized = baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
  return sanitized || 'upload'
}

function buildStoredUploadPath({ sessionDatabase, workspaceId, fileName }) {
  const storageRoot = getProjectLibraryStorageRoot(sessionDatabase)
  const workspaceDir = path.join(storageRoot, String(workspaceId))
  fs.mkdirSync(workspaceDir, { recursive: true })

  const safeName = sanitizeUploadFileName(fileName)
  const ext = path.extname(safeName)
  const stem = path.basename(safeName, ext) || 'upload'
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  return {
    originalName: safeName,
    storedPath: path.join(workspaceDir, `${stem}-${suffix}${ext}`)
  }
}

function isMarkdownUpload({ name = '', mimeType = '' } = {}) {
  const normalizedName = String(name || '').toLowerCase()
  const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase()
  return normalizedName.endsWith('.md') ||
    normalizedName.endsWith('.markdown') ||
    normalizedMime === 'text/markdown'
}

function decodeMarkdownUpload(buffer) {
  return buffer.toString('utf8').replace(/^\uFEFF/, '')
}

function createAuthRequiredError() {
  const error = new Error('请先登录')
  error.code = 'AUTH_REQUIRED'
  return error
}

function createForbiddenError(message = '无权操作项目管理') {
  const error = new Error(message)
  error.code = 'AUTH_FORBIDDEN'
  return error
}

function isProjectLibraryAdmin(user) {
  return String(user?.phone || '').trim() === PROJECT_LIBRARY_ADMIN_PHONE
}

function requireCurrentUser(req, requireWebUser) {
  const user = requireWebUser(req)
  if (!user) throw createAuthRequiredError()
  return user
}

function requireProjectLibraryAdmin(req, requireWebUser) {
  const user = requireCurrentUser(req, requireWebUser)
  if (!isProjectLibraryAdmin(user)) throw createForbiddenError()
  return user
}

function parseWorkspaceId(req) {
  const id = Number(req.params?.id)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('项目工作区不存在')
  }
  return id
}

function sendProjectLibraryRouteError(res, err, sendWebAuthError) {
  if (err?.code === 'PROJECT_EXISTS') {
    return res.status(409).json({ success: false, code: err.code, error: err.message })
  }
  return sendWebAuthError(res, err)
}

function registerProjectLibraryRoutes({
  app,
  sessionDatabase,
  projectMasterDatabase,
  requireWebUser,
  sendWebAuthError
}) {
  app.get('/api/project-master-records', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      const enabledOnly = !isProjectLibraryAdmin(currentUser) || req.query?.all !== '1'
      res.json(projectMasterDatabase.listProjectMasterRecords({ enabledOnly }))
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.post('/api/project-master-records', (req, res) => {
    try {
      requireProjectLibraryAdmin(req, requireWebUser)
      res.json(projectMasterDatabase.createProjectMasterRecord(req.body || {}))
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.patch('/api/project-master-records/:id', (req, res) => {
    try {
      requireProjectLibraryAdmin(req, requireWebUser)
      res.json(projectMasterDatabase.updateProjectMasterRecord(Number(req.params.id), req.body || {}))
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.delete('/api/project-master-records/:id', (req, res) => {
    try {
      requireProjectLibraryAdmin(req, requireWebUser)
      const id = Number(req.params.id)
      if (sessionDatabase.countProjectLibraryWorkspacesByMasterRecord(id) > 0) {
        return res.status(400).json({ success: false, error: '璇ラ」鐩富鏁版嵁宸茶椤圭洰搴撲娇鐢紝涓嶈兘鍒犻櫎' })
      }
      const result = projectMasterDatabase.deleteProjectMasterRecord(id)
      res.status(result.success ? 200 : 400).json(result)
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.get('/api/project-library/workspaces', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      res.json(sessionDatabase.listProjectLibraryWorkspaces({
        userId: currentUser.id,
        isAdmin: isProjectLibraryAdmin(currentUser)
      }))
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.post('/api/project-library/workspaces', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      const masterRecordId = req.body?.masterRecordId
      const masterRecord = masterRecordId
        ? projectMasterDatabase.getProjectMasterRecord(Number(masterRecordId))
        : null
      const workspace = sessionDatabase.createProjectLibraryWorkspace({
        masterRecordId,
        masterRecord,
        userId: currentUser.id,
        name: req.body?.name,
        description: req.body?.description,
        type: req.body?.type
      })
      res.json(workspace)
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.get('/api/project-library/workspaces/:id', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      const workspace = sessionDatabase.getProjectLibraryWorkspace(parseWorkspaceId(req), {
        userId: currentUser.id,
        isAdmin: isProjectLibraryAdmin(currentUser)
      })
      if (!workspace) {
        return res.status(404).json({ success: false, error: '项目工作区不存在' })
      }
      res.json(workspace)
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.delete('/api/project-library/workspaces/:id', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      const result = sessionDatabase.deleteProjectLibraryWorkspace(parseWorkspaceId(req), {
        userId: currentUser.id,
        isAdmin: isProjectLibraryAdmin(currentUser)
      })
      res.status(result.success ? 200 : 404).json(result)
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.post('/api/project-library/workspaces/:id/items', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      const workspaceId = parseWorkspaceId(req)
      const workspace = sessionDatabase.getProjectLibraryWorkspace(workspaceId, {
        userId: currentUser.id,
        isAdmin: isProjectLibraryAdmin(currentUser)
      })
      if (!workspace) {
        return res.status(404).json({ success: false, error: '项目工作区不存在' })
      }
      res.json(sessionDatabase.createProjectLibraryItem({
        workspaceId,
        parentId: req.body?.parentId || null,
        name: req.body?.name,
        nodeType: req.body?.nodeType,
        content: req.body?.content || '',
        sortOrder: req.body?.sortOrder || 0
      }))
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.post('/api/project-library/workspaces/:id/uploads', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      const workspaceId = parseWorkspaceId(req)
      const workspace = sessionDatabase.getProjectLibraryWorkspace(workspaceId, {
        userId: currentUser.id,
        isAdmin: isProjectLibraryAdmin(currentUser)
      })
      if (!workspace) {
        return res.status(404).json({ success: false, error: '椤圭洰宸ヤ綔鍖轰笉瀛樺湪' })
      }

      const uploadName = req.body?.name || 'upload'
      const contentBase64 = String(req.body?.contentBase64 || '')
      if (!contentBase64) {
        return res.status(400).json({ success: false, error: 'Upload content is required' })
      }

      let fileBuffer
      try {
        fileBuffer = Buffer.from(contentBase64, 'base64')
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid upload content' })
      }
      if (fileBuffer.length === 0) {
        return res.status(400).json({ success: false, error: 'Upload content is empty' })
      }

      const originalName = sanitizeUploadFileName(uploadName)
      if (isMarkdownUpload({ name: originalName, mimeType: req.body?.mimeType })) {
        return res.json(sessionDatabase.createProjectLibraryItem({
          workspaceId,
          parentId: req.body?.parentId || null,
          name: originalName,
          nodeType: 'markdown',
          content: decodeMarkdownUpload(fileBuffer)
        }))
      }

      const { storedPath } = buildStoredUploadPath({
        sessionDatabase,
        workspaceId,
        fileName: originalName
      })
      fs.writeFileSync(storedPath, fileBuffer, { flag: 'wx' })

      res.json(sessionDatabase.createProjectLibraryItem({
        workspaceId,
        parentId: req.body?.parentId || null,
        name: originalName,
        nodeType: 'file',
        filePath: storedPath,
        mimeType: req.body?.mimeType || '',
        sizeBytes: Number.isFinite(Number(req.body?.sizeBytes)) ? Number(req.body.sizeBytes) : fileBuffer.length,
        originalName
      }))
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.patch('/api/project-library/items/:id', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      res.json(sessionDatabase.updateProjectLibraryItem(Number(req.params.id), req.body || {}, {
        userId: currentUser.id,
        isAdmin: isProjectLibraryAdmin(currentUser)
      }))
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.delete('/api/project-library/items/:id', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      const result = sessionDatabase.deleteProjectLibraryItem(Number(req.params.id), {
        userId: currentUser.id,
        isAdmin: isProjectLibraryAdmin(currentUser)
      })
      res.status(result.success ? 200 : 400).json(result)
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.post('/api/project-library/items/:id/agent-session', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      res.json(sessionDatabase.bindProjectLibraryItemAgentSession(Number(req.params.id), req.body?.sessionId || null, {
        userId: currentUser.id,
        isAdmin: isProjectLibraryAdmin(currentUser)
      }))
    } catch (err) {
      sendProjectLibraryRouteError(res, err, sendWebAuthError)
    }
  })

  app.post('/api/project-library/workspaces/:id/agent-session', (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, requireWebUser)
      const workspaceId = parseWorkspaceId(req)
      const workspace = sessionDatabase.getProjectLibraryWorkspace(workspaceId, {
        userId: currentUser.id,
        isAdmin: isProjectLibraryAdmin(currentUser)
      })
      if (!workspace) {
        return res.status(404).json({ success: false, error: '项目工作区不存在' })
      }
      res.json(sessionDatabase.bindProjectWorkspaceAgentSession(workspaceId, req.body?.sessionId || null))
    } catch (err) {
      sendWebAuthError(res, err)
    }
  })
}

module.exports = {
  PROJECT_LIBRARY_ADMIN_PHONE,
  isProjectLibraryAdmin,
  registerProjectLibraryRoutes
}
