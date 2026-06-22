const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { ProjectMasterDatabase } = require('../database/project-master-db')

function isProjectLibraryAdmin(user) {
  return Boolean(user?.isAdmin)
}

function authErrorResponse(err) {
  if (err?.code === 'AUTH_FORBIDDEN') return { error: 'Access denied', code: 'AUTH_FORBIDDEN' }
  if (err?.code === 'AUTH_REQUIRED') return { error: '请先登录', code: 'AUTH_REQUIRED' }
  return { error: err?.message || 'Unknown error' }
}

function sanitizeUploadFileName(name = 'upload') {
  const baseName = path.basename(String(name || 'upload')).trim() || 'upload'
  return baseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
}

function getProjectLibraryStorageRoot(sessionDatabase) {
  const userDataPath = sessionDatabase?._userDataPath || (sessionDatabase?.dbPath ? path.dirname(sessionDatabase.dbPath) : null)
  return path.join(userDataPath || process.cwd(), 'project-library-files')
}

function buildStoredUploadPath({ sessionDatabase, workspaceId, fileName }) {
  const originalName = sanitizeUploadFileName(fileName)
  const ext = path.extname(originalName)
  const stem = path.basename(originalName, ext) || 'upload'
  const storedName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${stem}${ext}`
  const uploadDir = path.join(getProjectLibraryStorageRoot(sessionDatabase), String(workspaceId))
  fs.mkdirSync(uploadDir, { recursive: true })
  return {
    originalName,
    storedPath: path.join(uploadDir, storedName)
  }
}

function decodeBase64Content(contentBase64) {
  const encoded = String(contentBase64 || '')
  if (!encoded) {
    const error = new Error('Missing file content')
    error.code = 'VALIDATION_ERROR'
    throw error
  }
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length === 0) {
    const error = new Error('Empty file')
    error.code = 'VALIDATION_ERROR'
    throw error
  }
  return buffer
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

function setupProjectLibraryHandlers(ipcMain, sessionDatabase, authManager) {
  if (!sessionDatabase) {
    console.warn('[IPC] SessionDatabase not available, skipping project library handlers')
    return
  }

  const projectMasterDatabase = new ProjectMasterDatabase({
    userDataPath: sessionDatabase._userDataPath || (sessionDatabase.dbPath ? path.dirname(sessionDatabase.dbPath) : null)
  })

  const requireAuth = () => {
    if (!authManager?.requireCurrentUser) {
      const error = new Error('请先登录')
      error.code = 'AUTH_REQUIRED'
      throw error
    }
    return authManager.requireCurrentUser()
  }

  const accessFor = (currentUser) => ({
    userId: currentUser.id,
    isAdmin: isProjectLibraryAdmin(currentUser)
  })

  ipcMain.handle('projectLibrary:listMasterRecords', async (event, options = {}) => {
    try {
      const currentUser = requireAuth()
      const enabledOnly = !isProjectLibraryAdmin(currentUser) || options?.all !== true
      return projectMasterDatabase.listProjectMasterRecords({ enabledOnly })
    } catch (err) {
      console.error('[IPC] projectLibrary:listMasterRecords error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:createMasterRecord', async (event, payload = {}) => {
    try {
      requireAuth()
      return projectMasterDatabase.createProjectMasterRecord(payload || {})
    } catch (err) {
      console.error('[IPC] projectLibrary:createMasterRecord error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:updateMasterRecord', async (event, { id, updates } = {}) => {
    try {
      requireAuth()
      return projectMasterDatabase.updateProjectMasterRecord(Number(id), updates || {})
    } catch (err) {
      console.error('[IPC] projectLibrary:updateMasterRecord error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:deleteMasterRecord', async (event, id) => {
    try {
      requireAuth()
      const recordId = Number(id)
      if (sessionDatabase.countProjectLibraryWorkspacesByMasterRecord(recordId) > 0) {
        return { success: false, error: 'Project is already in use' }
      }
      return projectMasterDatabase.deleteProjectMasterRecord(recordId)
    } catch (err) {
      console.error('[IPC] projectLibrary:deleteMasterRecord error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:listWorkspaces', async () => {
    try {
      const currentUser = requireAuth()
      return sessionDatabase.listProjectLibraryWorkspaces(accessFor(currentUser))
    } catch (err) {
      console.error('[IPC] projectLibrary:listWorkspaces error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:getWorkspace', async (event, id) => {
    try {
      const currentUser = requireAuth()
      return sessionDatabase.getProjectLibraryWorkspace(Number(id), accessFor(currentUser))
    } catch (err) {
      console.error('[IPC] projectLibrary:getWorkspace error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:createWorkspace', async (event, payload = {}) => {
    try {
      const currentUser = requireAuth()
      const masterRecordId = payload?.masterRecordId
      const masterRecord = masterRecordId
        ? projectMasterDatabase.getProjectMasterRecord(Number(masterRecordId))
        : null
      return sessionDatabase.createProjectLibraryWorkspace({
        ...(payload || {}),
        masterRecord,
        userId: currentUser.id
      })
    } catch (err) {
      console.error('[IPC] projectLibrary:createWorkspace error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:deleteWorkspace', async (event, id) => {
    try {
      const currentUser = requireAuth()
      return sessionDatabase.deleteProjectLibraryWorkspace(Number(id), accessFor(currentUser))
    } catch (err) {
      console.error('[IPC] projectLibrary:deleteWorkspace error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:createItem', async (event, payload = {}) => {
    try {
      const currentUser = requireAuth()
      const access = accessFor(currentUser)
      sessionDatabase.getProjectLibraryWorkspace(Number(payload.workspaceId), access)
      return sessionDatabase.createProjectLibraryItem({
        workspaceId: Number(payload.workspaceId),
        parentId: payload.parentId ?? null,
        name: payload.name,
        nodeType: payload.nodeType,
        content: payload.content || '',
        filePath: payload.filePath || '',
        mimeType: payload.mimeType || '',
        sizeBytes: payload.sizeBytes || 0,
        originalName: payload.originalName || ''
      })
    } catch (err) {
      console.error('[IPC] projectLibrary:createItem error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:uploadFile', async (event, payload = {}) => {
    try {
      const currentUser = requireAuth()
      const access = accessFor(currentUser)
      const workspaceId = Number(payload.workspaceId)
      sessionDatabase.getProjectLibraryWorkspace(workspaceId, access)
      const fileBuffer = decodeBase64Content(payload.contentBase64)
      const originalName = sanitizeUploadFileName(payload.name || 'upload')
      if (isMarkdownUpload({ name: originalName, mimeType: payload.mimeType })) {
        return sessionDatabase.createProjectLibraryItem({
          workspaceId,
          parentId: payload.parentId ?? null,
          name: originalName,
          nodeType: 'markdown',
          content: decodeMarkdownUpload(fileBuffer)
        })
      }

      const { storedPath } = buildStoredUploadPath({
        sessionDatabase,
        workspaceId,
        fileName: originalName
      })
      fs.writeFileSync(storedPath, fileBuffer, { flag: 'wx' })
      return sessionDatabase.createProjectLibraryItem({
        workspaceId,
        parentId: payload.parentId ?? null,
        name: originalName,
        nodeType: 'file',
        content: '',
        filePath: storedPath,
        mimeType: payload.mimeType || '',
        sizeBytes: fileBuffer.length,
        originalName
      })
    } catch (err) {
      console.error('[IPC] projectLibrary:uploadFile error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:updateItem', async (event, { id, updates } = {}) => {
    try {
      const currentUser = requireAuth()
      return sessionDatabase.updateProjectLibraryItem(Number(id), updates || {}, accessFor(currentUser))
    } catch (err) {
      console.error('[IPC] projectLibrary:updateItem error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:deleteItem', async (event, id) => {
    try {
      const currentUser = requireAuth()
      return sessionDatabase.deleteProjectLibraryItem(Number(id), accessFor(currentUser))
    } catch (err) {
      console.error('[IPC] projectLibrary:deleteItem error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:bindWorkspaceAgentSession', async (event, { workspaceId, sessionId } = {}) => {
    try {
      const currentUser = requireAuth()
      sessionDatabase.getProjectLibraryWorkspace(Number(workspaceId), accessFor(currentUser))
      return sessionDatabase.bindProjectWorkspaceAgentSession(Number(workspaceId), sessionId)
    } catch (err) {
      console.error('[IPC] projectLibrary:bindWorkspaceAgentSession error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('projectLibrary:bindItemAgentSession', async (event, { itemId, sessionId } = {}) => {
    try {
      const currentUser = requireAuth()
      return sessionDatabase.bindProjectLibraryItemAgentSession(Number(itemId), sessionId, accessFor(currentUser))
    } catch (err) {
      console.error('[IPC] projectLibrary:bindItemAgentSession error:', err)
      return authErrorResponse(err)
    }
  })
}

module.exports = { setupProjectLibraryHandlers }
