const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const mammoth = require('mammoth')
const XLSX = require('xlsx')
const AdmZip = require('adm-zip')

const UPLOAD_DIR_NAME = 'uploaded_files'

const TEXT_FILE_EXTS = new Set([
  '.txt', '.md', '.markdown', '.js', '.jsx', '.ts', '.tsx', '.vue', '.json',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.py', '.pyw', '.c',
  '.cpp', '.cc', '.h', '.hpp', '.java', '.go', '.rs', '.rb', '.php', '.swift',
  '.kt', '.kts', '.scala', '.r', '.m', '.mm', '.sh', '.bash', '.zsh', '.fish',
  '.ps1', '.bat', '.cmd', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.cfg', '.properties', '.sql', '.log', '.csv', '.tsv', '.dockerfile',
  '.makefile', '.cmake', '.gradle', '.gitignore', '.gitattributes', '.env',
  '.lock', '.diff', '.patch', '.cjs', '.mjs'
])

const SERVER_UPLOAD_EXTS = new Set([
  ...TEXT_FILE_EXTS,
  '.docx',
  '.pdf',
  '.ppt',
  '.pptx',
  '.xlsx',
  '.xls'
])

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

function getExtension(name) {
  return path.extname(String(name || '')).toLowerCase()
}

function isTextUpload(name, mimeType = '') {
  if (String(mimeType || '').startsWith('text/')) return true
  return TEXT_FILE_EXTS.has(getExtension(name))
}

function isSupportedUploadAttachment(name, mimeType = '') {
  return isTextUpload(name, mimeType) || SERVER_UPLOAD_EXTS.has(getExtension(name))
}

function sanitizeUploadFileName(name) {
  const raw = String(name || 'upload').replace(/\\/g, '/')
  const baseName = path.posix.basename(raw).trim()
  const sanitized = baseName
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return sanitized || 'upload'
}

function normalizeTimestamp(value) {
  if (typeof value === 'string' && /^[0-9]{8}-[0-9]{6}$/.test(value)) {
    return value
  }
  return new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15)
}

function decodeUploadContent(payload) {
  const contentBase64 = String(payload?.contentBase64 || '')
  if (!contentBase64) {
    throw new Error('Missing upload content')
  }

  const buffer = Buffer.from(contentBase64, 'base64')
  if (buffer.length === 0) {
    throw new Error('Uploaded file is empty')
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Uploaded file too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`)
  }
  return buffer
}

async function extractPdfText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true
  })
  const pdf = await loadingTask.promise
  const pages = []

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const text = textContent.items
      .map(item => typeof item?.str === 'string' ? item.str : '')
      .filter(Boolean)
      .join(' ')
      .trim()
    if (text) pages.push(text)
  }

  if (typeof pdf.destroy === 'function') {
    await pdf.destroy()
  }
  return pages.join('\n\n')
}

async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer })
  return String(result?.value || '')
}

function extractWorkbookText(buffer, ext) {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const parts = []

  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const csv = XLSX.utils.sheet_to_csv(sheet).trim()
    if (csv) {
      parts.push(`Sheet: ${sheetName}\n${csv}`)
    }
  }

  if (parts.length === 0 && ext === '.xls') {
    return ''
  }
  return parts.join('\n\n')
}

function decodeXmlEntities(value = '') {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function normalizeExtractedLines(lines = []) {
  return lines
    .map(line => String(line || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function extractTextFromPptxXml(xml = '') {
  const matches = String(xml || '').matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)
  return normalizeExtractedLines([...matches].map(match => decodeXmlEntities(match[1])))
}

function extractPptxText(buffer) {
  const zip = new AdmZip(buffer)
  const slides = zip.getEntries()
    .filter(entry => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
    .sort((a, b) => {
      const left = Number(a.entryName.match(/slide(\d+)\.xml$/i)?.[1] || 0)
      const right = Number(b.entryName.match(/slide(\d+)\.xml$/i)?.[1] || 0)
      return left - right
    })

  const parts = []
  slides.forEach((entry, index) => {
    const lines = extractTextFromPptxXml(entry.getData().toString('utf8'))
    if (lines.length > 0) {
      parts.push(`Slide ${index + 1}\n${lines.join('\n')}`)
    }
  })
  return parts.join('\n\n')
}

function extractLegacyPptText(buffer) {
  const seen = new Set()
  const parts = []
  const addMatches = (text, pattern) => {
    for (const match of String(text || '').matchAll(pattern)) {
      const value = String(match[0] || '').replace(/\s+/g, ' ').trim()
      if (value.length >= 4 && !seen.has(value)) {
        seen.add(value)
        parts.push(value)
      }
    }
  }

  addMatches(buffer.toString('utf8'), /[\x20-\x7e]{4,}/g)
  addMatches(buffer.toString('utf16le'), /[\x20-\x7e]{4,}/g)
  return parts.join('\n')
}

async function extractUploadedAttachmentText({ buffer, name, mimeType }) {
  const ext = getExtension(name)
  let content = ''

  if (isTextUpload(name, mimeType)) {
    content = buffer.toString('utf8')
  } else if (ext === '.docx') {
    content = await extractDocxText(buffer)
  } else if (ext === '.pdf') {
    content = await extractPdfText(buffer)
  } else if (ext === '.pptx') {
    content = extractPptxText(buffer)
  } else if (ext === '.ppt') {
    content = extractLegacyPptText(buffer)
  } else if (ext === '.xlsx' || ext === '.xls') {
    content = extractWorkbookText(buffer, ext)
  } else {
    throw new Error('Unsupported upload file type')
  }

  content = String(content || '')
  if (!content.trim()) {
    throw new Error('Uploaded file does not contain readable text')
  }
  return content
}

async function saveAgentUploadFromPayload({ cwd, payload, timestamp, extractContent = true } = {}) {
  if (!cwd) throw new Error('No working directory')

  const originalName = String(payload?.name || 'upload')
  const mimeType = String(payload?.mimeType || payload?.type || '')
  const buffer = decodeUploadContent(payload)

  return saveAgentUploadFromBuffer({
    cwd,
    buffer,
    originalName,
    mimeType,
    timestamp,
    extractContent
  })
}

async function saveAgentUploadFromBuffer({ cwd, buffer, originalName = 'upload', mimeType = '', timestamp, extractContent = true } = {}) {
  if (!cwd) throw new Error('No working directory')
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Invalid upload content')
  }
  if (buffer.length === 0) {
    throw new Error('Uploaded file is empty')
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Uploaded file too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`)
  }

  const name = sanitizeUploadFileName(originalName)

  if (!isSupportedUploadAttachment(name, mimeType)) {
    throw new Error('Unsupported upload file type')
  }

  const uploadDir = path.join(cwd, UPLOAD_DIR_NAME)
  await fsp.mkdir(uploadDir, { recursive: true })

  const storedName = `${normalizeTimestamp(timestamp)}-${name}`
  const filePath = path.join(uploadDir, storedName)
  await fsp.writeFile(filePath, buffer)

  const relativePath = path.posix.join(UPLOAD_DIR_NAME, storedName)
  const result = {
    success: true,
    name,
    originalName,
    mimeType,
    sizeBytes: buffer.length,
    relativePath,
    filePath
  }

  if (extractContent) {
    result.content = await extractUploadedAttachmentText({ buffer, name, mimeType })
  }

  return result
}

async function saveAgentUploadFromPath({ cwd, sourcePath, originalName, mimeType = '', timestamp, extractContent = true } = {}) {
  if (!cwd) throw new Error('No working directory')
  if (!sourcePath || !path.isAbsolute(sourcePath)) {
    throw new Error('No local file path available for attachment')
  }

  const sourceStats = await fsp.stat(sourcePath)
  if (!sourceStats.isFile()) {
    throw new Error('Attachment path is not a file')
  }
  if (sourceStats.size === 0) {
    throw new Error('Uploaded file is empty')
  }
  if (sourceStats.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Uploaded file too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`)
  }

  const name = sanitizeUploadFileName(originalName || path.basename(sourcePath))
  if (!isSupportedUploadAttachment(name, mimeType)) {
    throw new Error('Unsupported upload file type')
  }

  const uploadDir = path.join(cwd, UPLOAD_DIR_NAME)
  await fsp.mkdir(uploadDir, { recursive: true })

  const storedName = `${normalizeTimestamp(timestamp)}-${name}`
  const filePath = path.join(uploadDir, storedName)
  await fsp.copyFile(sourcePath, filePath)

  const relativePath = path.posix.join(UPLOAD_DIR_NAME, storedName)
  const result = {
    success: true,
    name,
    originalName: String(originalName || name),
    mimeType,
    sizeBytes: sourceStats.size,
    relativePath,
    filePath
  }

  if (extractContent) {
    const buffer = await fsp.readFile(filePath)
    result.content = await extractUploadedAttachmentText({ buffer, name, mimeType })
  }

  return result
}

module.exports = {
  UPLOAD_DIR_NAME,
  isSupportedUploadAttachment,
  saveAgentUploadFromPayload,
  saveAgentUploadFromBuffer,
  saveAgentUploadFromPath,
  sanitizeUploadFileName,
  extractUploadedAttachmentText
}
