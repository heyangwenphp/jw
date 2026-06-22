import mammoth from 'mammoth'

const TEXT_FILE_EXTS = new Set([
  'txt', 'md', 'markdown', 'js', 'jsx', 'ts', 'tsx', 'vue', 'json', 'html', 'htm',
  'css', 'scss', 'sass', 'less', 'py', 'pyw', 'c', 'cpp', 'cc', 'h', 'hpp', 'java',
  'go', 'rs', 'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'r', 'm', 'mm', 'sh', 'bash',
  'zsh', 'fish', 'ps1', 'bat', 'cmd', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf',
  'cfg', 'properties', 'sql', 'log', 'csv', 'tsv', 'dockerfile', 'makefile', 'cmake',
  'gradle', 'gitignore', 'gitattributes', 'env', 'lock', 'diff', 'patch',
  'cjs', 'mjs'
])

const DOCX_FILE_EXTS = new Set(['docx'])
const SPREADSHEET_FILE_EXTS = new Set(['xlsx', 'xls'])
const SERVER_UPLOAD_FILE_EXTS = new Set(['pdf', 'ppt', 'pptx', 'xlsx', 'xls'])

export const ATTACHMENT_FILE_SIZE_LIMIT_MB = 20
export const TEXT_FILE_SIZE_LIMIT_MB = ATTACHMENT_FILE_SIZE_LIMIT_MB
export const DOCX_FILE_SIZE_LIMIT_MB = ATTACHMENT_FILE_SIZE_LIMIT_MB
export const PDF_FILE_SIZE_LIMIT_MB = ATTACHMENT_FILE_SIZE_LIMIT_MB
export const PRESENTATION_FILE_SIZE_LIMIT_MB = ATTACHMENT_FILE_SIZE_LIMIT_MB
export const SPREADSHEET_FILE_SIZE_LIMIT_MB = ATTACHMENT_FILE_SIZE_LIMIT_MB

export function getFileExtension(file) {
  const name = typeof file === 'string' ? file : file?.name
  return String(name || '').split('.').pop().toLowerCase()
}

export function isDocxFile(file) {
  return DOCX_FILE_EXTS.has(getFileExtension(file))
}

export function isSpreadsheetFile(file) {
  return SPREADSHEET_FILE_EXTS.has(getFileExtension(file))
}

export function isSupportedAttachmentFile(file) {
  if (file?.type && file.type.startsWith('text/')) return true
  const ext = getFileExtension(file)
  return TEXT_FILE_EXTS.has(ext) || DOCX_FILE_EXTS.has(ext) || SPREADSHEET_FILE_EXTS.has(ext)
}

export function isServerUploadAttachmentFile(file) {
  if (isSupportedAttachmentFile(file)) return true
  return SERVER_UPLOAD_FILE_EXTS.has(getFileExtension(file))
}

export function getAttachmentFileSizeLimitMb(file) {
  return isDocxFile(file) ? DOCX_FILE_SIZE_LIMIT_MB : TEXT_FILE_SIZE_LIMIT_MB
}

export function getServerUploadAttachmentFileSizeLimitMb(file) {
  const ext = getFileExtension(file)
  if (ext === 'pdf') return PDF_FILE_SIZE_LIMIT_MB
  if (ext === 'ppt' || ext === 'pptx') return PRESENTATION_FILE_SIZE_LIMIT_MB
  if (ext === 'xlsx' || ext === 'xls') return SPREADSHEET_FILE_SIZE_LIMIT_MB
  return getAttachmentFileSizeLimitMb(file)
}

export function readPlainTextFile(file) {
  if (typeof file?.text === 'function') {
    return file.text().then(value => String(value || ''))
  }

  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader is not available'))
      return
    }

    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function readArrayBufferFile(file) {
  if (typeof file?.arrayBuffer === 'function') {
    return file.arrayBuffer()
  }

  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader is not available'))
      return
    }

    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

export async function readDocxFile(file, parser = mammoth) {
  if (!parser || typeof parser.extractRawText !== 'function') {
    throw new Error('DOCX parser is not available')
  }

  const arrayBuffer = await readArrayBufferFile(file)
  const result = await parser.extractRawText({ arrayBuffer })
  const content = String(result?.value || '')

  if (!content.trim()) {
    throw new Error('DOCX file does not contain readable text')
  }

  return content
}

export async function readSpreadsheetFile(file, parser) {
  const workbookParser = parser || await import('xlsx')
  const XLSX = workbookParser?.default?.read ? workbookParser.default : workbookParser
  if (!XLSX || typeof XLSX.read !== 'function' || !XLSX.utils?.sheet_to_csv) {
    throw new Error('Spreadsheet parser is not available')
  }

  const arrayBuffer = await readArrayBufferFile(file)
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const parts = []

  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets?.[sheetName]
    if (!sheet) continue
    const csv = XLSX.utils.sheet_to_csv(sheet).trim()
    if (csv) {
      parts.push(`Sheet: ${sheetName}\n${csv}`)
    }
  }

  const content = parts.join('\n\n')
  if (!content.trim()) {
    throw new Error('Spreadsheet file does not contain readable text')
  }

  return content
}

export function readAttachmentFileContent(file) {
  if (isDocxFile(file)) {
    return readDocxFile(file)
  }
  if (isSpreadsheetFile(file)) {
    return readSpreadsheetFile(file)
  }

  return readPlainTextFile(file)
}
