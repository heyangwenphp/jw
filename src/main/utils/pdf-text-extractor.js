const fs = require('fs')
const path = require('path')

const DEFAULT_MAX_CHARS = 60000

let pdfjsPromise = null

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfjsPromise
}

function normalizeMaxChars(maxChars) {
  const value = Number(maxChars)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_CHARS
}

async function extractPdfText(filePath, options = {}) {
  const resolvedPath = path.resolve(String(filePath || ''))
  const maxChars = normalizeMaxChars(options.maxChars)

  if (!fs.existsSync(resolvedPath)) {
    return { error: 'File not found' }
  }

  const stats = fs.statSync(resolvedPath)
  if (!stats.isFile()) {
    return { error: 'Not a file' }
  }

  if (path.extname(resolvedPath).toLowerCase() !== '.pdf') {
    return { error: 'Only PDF reports are supported' }
  }

  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(fs.readFileSync(resolvedPath))
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useSystemFonts: true
  })
  const pdf = await loadingTask.promise
  const parts = []
  let length = 0
  let truncated = false

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map(item => String(item?.str || '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (!pageText) continue
      const section = `第 ${pageNumber} 页\n${pageText}`
      const nextLength = length + section.length + 2
      if (nextLength > maxChars) {
        const remaining = Math.max(0, maxChars - length)
        if (remaining > 0) {
          parts.push(section.slice(0, remaining))
        }
        truncated = true
        break
      }
      parts.push(section)
      length = nextLength
    }
  } finally {
    await loadingTask.destroy().catch(() => {})
  }

  return {
    type: 'text',
    name: path.basename(resolvedPath),
    filePath: resolvedPath,
    size: stats.size,
    pageCount: pdf.numPages,
    content: parts.join('\n\n'),
    truncated
  }
}

module.exports = {
  extractPdfText
}
