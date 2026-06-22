/**
 * Project file tree and preview IPC handlers.
 */

const path = require('path')
const fs = require('fs')
const fsp = require('fs').promises
const mammoth = require('mammoth')
const XLSX = require('xlsx')
const {
  HIDDEN_DIRS,
  HIDDEN_DIR_SUFFIXES,
  HIDDEN_FILES,
  isInternalAgentFileName,
  TEXT_EXTS,
  TEXT_FILENAMES,
  IMAGE_EXTS,
  LANG_MAP,
  VIDEO_EXTS,
  AUDIO_EXTS,
  MAX_TEXT_SIZE,
  MAX_IMG_SIZE,
  MAX_VIDEO_SIZE,
  MAX_AUDIO_SIZE,
  MIME_MAP,
  VIDEO_MIME_MAP,
  AUDIO_MIME_MAP
} = require('../utils/agent-constants')

function safePath(rootPath, relativePath = '') {
  if (!rootPath || typeof rootPath !== 'string') {
    throw new Error('No project root')
  }

  const resolvedRoot = path.resolve(rootPath)
  const target = path.resolve(resolvedRoot, relativePath || '')
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Path traversal detected')
  }
  return target
}

function isHiddenEntry(dirent) {
  if (dirent.name.startsWith('.')) return true
  if (dirent.isDirectory() && (
    HIDDEN_DIRS.has(dirent.name) ||
    HIDDEN_DIR_SUFFIXES.some(suffix => dirent.name.endsWith(suffix))
  )) return true
  return !dirent.isDirectory() && HIDDEN_FILES.has(dirent.name)
}

async function listProjectDir({ rootPath, relativePath = '', showHidden = false } = {}) {
  try {
    const targetDir = safePath(rootPath, relativePath)
    const stat = await fsp.stat(targetDir).catch(() => null)
    if (!stat?.isDirectory()) return { entries: [], cwd: path.resolve(rootPath || '') }

    const dirents = await fsp.readdir(targetDir, { withFileTypes: true })
    const entries = await Promise.all(dirents.map(async (dirent) => {
      if (isInternalAgentFileName(dirent.name)) return null
      if (!showHidden && isHiddenEntry(dirent)) return null

      const entryRelPath = relativePath ? path.join(relativePath, dirent.name) : dirent.name
      let size = 0
      let mtime = null
      try {
        const stats = await fsp.stat(path.join(targetDir, dirent.name))
        size = stats.size
        mtime = stats.mtime.toISOString()
      } catch {}

      return {
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        size,
        mtime,
        relativePath: entryRelPath
      }
    }))

    return {
      cwd: path.resolve(rootPath),
      entries: entries
        .filter(Boolean)
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
    }
  } catch (err) {
    console.error('[ProjectFiles] listDir error:', err.message)
    return { entries: [], cwd: rootPath ? path.resolve(rootPath) : null, error: 'Failed to load directory' }
  }
}

async function readProjectFile({ rootPath, relativePath } = {}) {
  try {
    const filePath = safePath(rootPath, relativePath)
    const stat = await fsp.stat(filePath).catch(() => null)
    if (!stat) return { error: 'File not found' }
    if (stat.isDirectory()) return { error: 'Is a directory' }

    const ext = path.extname(filePath).toLowerCase()
    const name = path.basename(filePath)
    const base = { name, size: stat.size, mtime: stat.mtime.toISOString(), ext, filePath }

    if (ext === '.svg') {
      if (stat.size > MAX_IMG_SIZE) return { ...base, type: 'image', tooLarge: true }
      const content = await fsp.readFile(filePath, 'utf-8')
      return { ...base, type: 'image', content: `data:image/svg+xml;base64,${Buffer.from(content).toString('base64')}` }
    }

    if (ext === '.html' || ext === '.htm') {
      if (stat.size > MAX_TEXT_SIZE) return { ...base, type: 'html', tooLarge: true }
      const content = await fsp.readFile(filePath, 'utf-8')
      return { ...base, type: 'html', content }
    }

    if (ext === '.pdf') return { ...base, type: 'pdf' }
    if (ext === '.docx') return { ...base, type: 'word' }
    if (['.doc', '.xlsx', '.xls'].includes(ext)) return { ...base, type: 'office' }

    if (TEXT_EXTS.has(ext) || TEXT_FILENAMES.has(name) || (name.startsWith('.') && !ext)) {
      if (stat.size > MAX_TEXT_SIZE) {
        return { ...base, type: 'text', tooLarge: true, language: LANG_MAP[ext] || 'text' }
      }
      const content = await fsp.readFile(filePath, 'utf-8')
      return { ...base, type: 'text', content, language: LANG_MAP[ext] || 'text' }
    }

    if (IMAGE_EXTS.has(ext)) {
      if (stat.size > MAX_IMG_SIZE) return { ...base, type: 'image', tooLarge: true }
      const buf = await fsp.readFile(filePath)
      return { ...base, type: 'image', content: `data:${MIME_MAP[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}` }
    }

    if (VIDEO_EXTS.has(ext)) {
      if (stat.size > MAX_VIDEO_SIZE) return { ...base, type: 'video', tooLarge: true }
      const buf = await fsp.readFile(filePath)
      return { ...base, type: 'video', content: `data:${VIDEO_MIME_MAP[ext] || 'video/mp4'};base64,${buf.toString('base64')}` }
    }

    if (AUDIO_EXTS.has(ext)) {
      if (stat.size > MAX_AUDIO_SIZE) return { ...base, type: 'audio', tooLarge: true }
      const buf = await fsp.readFile(filePath)
      return { ...base, type: 'audio', content: `data:${AUDIO_MIME_MAP[ext] || 'audio/mpeg'};base64,${buf.toString('base64')}` }
    }

    return { ...base, type: 'binary' }
  } catch (err) {
    console.error('[ProjectFiles] readFile error:', err.message)
    return { error: 'Failed to read file' }
  }
}

async function readOfficeFile({ filePath, ext } = {}) {
  try {
    if (!filePath || typeof filePath !== 'string') return { error: 'Invalid file path' }
    const normalizedExt = String(ext || path.extname(filePath)).replace(/^\./, '').toLowerCase()
    const stats = await fsp.stat(filePath).catch(() => null)
    if (!stats?.isFile()) return { error: 'File not found' }

    if (normalizedExt === 'docx') {
      const result = await mammoth.convertToHtml({ path: filePath })
      return { type: 'word', content: result.value || '' }
    }

    if (normalizedExt === 'doc') {
      return { type: 'unsupported', error: '.doc 格式暂不支持预览，请使用 .docx 格式' }
    }

    if (normalizedExt === 'xlsx' || normalizedExt === 'xls') {
      const workbook = XLSX.readFile(filePath, { cellDates: true })
      const sheetsData = {}
      for (const sheetName of workbook.SheetNames) {
        sheetsData[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 })
      }
      return {
        type: 'excel',
        content: JSON.stringify(sheetsData),
        meta: { sheetNames: workbook.SheetNames }
      }
    }

    return { type: 'unsupported', error: 'Unsupported Office file' }
  } catch (err) {
    console.error('[ProjectFiles] readOfficeFile error:', err.message)
    return { error: err.message || 'Failed to read Office file' }
  }
}

async function saveProjectFile({ rootPath, relativePath, content } = {}) {
  try {
    const filePath = safePath(rootPath, relativePath)
    const stat = await fsp.stat(filePath).catch(() => null)
    if (!stat?.isFile()) return { error: 'File not found' }
    await fsp.writeFile(filePath, content, 'utf-8')
    return { success: true }
  } catch (err) {
    console.error('[ProjectFiles] saveFile error:', err.message)
    return { error: 'Failed to save file' }
  }
}

async function createProjectFile({ rootPath, parentPath = '', name, isDirectory = false } = {}) {
  try {
    const parentDir = safePath(rootPath, parentPath)
    const targetPath = path.join(parentDir, name || '')
    safePath(rootPath, path.relative(path.resolve(rootPath), targetPath))

    if (isDirectory) {
      await fsp.mkdir(targetPath, { recursive: false })
    } else {
      await fsp.writeFile(targetPath, '', { encoding: 'utf-8', flag: 'wx' })
    }
    return { success: true }
  } catch (err) {
    console.error('[ProjectFiles] createFile error:', err.message)
    if (err.code === 'EEXIST') return { error: 'File or folder already exists' }
    return { error: 'Failed to create: ' + err.message }
  }
}

async function renameProjectFile({ rootPath, oldPath, newName } = {}) {
  try {
    const oldFullPath = safePath(rootPath, oldPath)
    const newFullPath = path.join(path.dirname(oldFullPath), newName || '')
    safePath(rootPath, path.relative(path.resolve(rootPath), newFullPath))

    const oldStat = await fsp.stat(oldFullPath).catch(() => null)
    if (!oldStat) return { error: 'File or folder not found' }
    const targetStat = await fsp.stat(newFullPath).catch(() => null)
    if (targetStat) return { error: 'Target name already exists' }

    await fsp.rename(oldFullPath, newFullPath)
    return { success: true }
  } catch (err) {
    console.error('[ProjectFiles] renameFile error:', err.message)
    return { error: 'Failed to rename: ' + err.message }
  }
}

async function deleteProjectFile({ rootPath, path: relativePath } = {}) {
  try {
    const targetPath = safePath(rootPath, relativePath)
    const stat = await fsp.stat(targetPath).catch(() => null)
    if (!stat) return { error: 'File or folder not found' }

    if (stat.isDirectory()) {
      await fsp.rm(targetPath, { recursive: true, force: true })
    } else {
      await fsp.unlink(targetPath)
    }
    return { success: true }
  } catch (err) {
    console.error('[ProjectFiles] deleteFile error:', err.message)
    return { error: 'Failed to delete: ' + err.message }
  }
}

async function searchProjectFiles({ rootPath, keyword, showHidden = false } = {}) {
  if (!keyword || !keyword.trim()) return { results: [] }

  const lowerKeyword = keyword.trim().toLowerCase()
  const results = []
  const maxResults = 100
  const maxDepth = 10

  const walk = async (dir, relativePath, depth) => {
    if (depth > maxDepth || results.length >= maxResults) return

    const dirents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const dirent of dirents) {
      if (results.length >= maxResults) return
      if (isInternalAgentFileName(dirent.name)) continue
      if (!showHidden && isHiddenEntry(dirent)) continue

      const entryRelPath = relativePath ? path.join(relativePath, dirent.name) : dirent.name
      if (dirent.name.toLowerCase().includes(lowerKeyword)) {
        const stats = await fsp.stat(path.join(dir, dirent.name)).catch(() => null)
        results.push({
          name: dirent.name,
          relativePath: entryRelPath,
          isDirectory: dirent.isDirectory(),
          size: stats?.size || 0
        })
      }

      if (dirent.isDirectory()) {
        await walk(path.join(dir, dirent.name), entryRelPath, depth + 1)
      }
    }
  }

  try {
    await walk(safePath(rootPath), '', 0)
  } catch (err) {
    console.error('[ProjectFiles] searchFiles error:', err.message)
  }

  results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { results }
}

function setupProjectFilesHandlers(ipcMain) {
  ipcMain.handle('project:listDir', (event, payload) => listProjectDir(payload))
  ipcMain.handle('project:readFile', (event, payload) => readProjectFile(payload))
  ipcMain.handle('project:readOfficeFile', (event, payload) => readOfficeFile(payload))
  ipcMain.handle('project:saveFile', (event, payload) => saveProjectFile(payload))
  ipcMain.handle('project:createFile', (event, payload) => createProjectFile(payload))
  ipcMain.handle('project:renameFile', (event, payload) => renameProjectFile(payload))
  ipcMain.handle('project:deleteFile', (event, payload) => deleteProjectFile(payload))
  ipcMain.handle('project:searchFiles', (event, payload) => searchProjectFiles(payload))
}

module.exports = {
  setupProjectFilesHandlers,
  listProjectDir,
  readProjectFile,
  readOfficeFile
}
