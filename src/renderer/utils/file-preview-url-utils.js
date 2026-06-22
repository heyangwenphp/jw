export function appendPdfInitialView(url, initialView = '') {
  const view = String(initialView || '').trim().replace(/^#/, '')
  if (!url || !view) return url
  return url.includes('#') ? `${url}&${view}` : `${url}#${view}`
}

export function buildSessionRawFileUrl(preview = {}) {
  const { sessionId, relativePath } = preview || {}
  if (!sessionId || !relativePath) return ''
  return `/api/agent/sessions/${encodeURIComponent(sessionId)}/files/raw?relativePath=${encodeURIComponent(relativePath)}`
}

export function buildSessionStaticFileUrl(preview = {}) {
  const { sessionId, relativePath } = preview || {}
  if (!sessionId || !relativePath) return ''
  const staticPath = String(relativePath)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')
  return `/api/agent/sessions/${encodeURIComponent(sessionId)}/static/${staticPath}`
}

export function buildAbsoluteRawFileUrl(preview = {}) {
  const filePath = preview?.filePath || preview?.path
  if (!filePath) return ''
  const query = new URLSearchParams({ filePath })
  if (preview?.sessionId) query.set('sessionId', preview.sessionId)
  return `/api/files/absolute/raw?${query.toString()}`
}

export function buildWebRawFileUrl(preview = {}) {
  if (preview?.url) return preview.url
  if (preview?.sessionId && preview?.relativePath) {
    return buildSessionRawFileUrl(preview)
  }
  return buildAbsoluteRawFileUrl(preview)
}

export function appendDownloadParam(url = '') {
  if (!url) return ''

  const hashIndex = url.indexOf('#')
  const baseUrl = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : ''

  if (/[?&]download=/.test(baseUrl)) return url

  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}download=1${hash}`
}

export function buildFileDownloadUrl(preview = {}) {
  return appendDownloadParam(buildWebRawFileUrl(preview))
}

export function buildSessionFileDownloadUrl(sessionId, relativePath) {
  return buildFileDownloadUrl({ sessionId, relativePath })
}

export function downloadFileFromUrl(url, filename = '') {
  if (!url || typeof document === 'undefined') return false

  const link = document.createElement('a')
  link.href = url
  if (filename) link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  return true
}

export function pathToFileUrl(filePath) {
  if (!filePath) return ''
  if (/^[A-Za-z]:[\\/]/.test(filePath)) {
    const drive = filePath.slice(0, 2)
    const rest = filePath
      .slice(2)
      .replace(/\\/g, '/')
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('/')
    return `file:///${drive}${rest}`
  }

  return `file://${filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment, index) => (index === 0 ? segment : encodeURIComponent(segment)))
    .join('/')}`
}

export function buildFilePreviewUrl(preview = {}, { isWeb = false, pdfInitialView = '' } = {}) {
  if (preview?.type === 'url') return preview.url || ''

  if (isWeb && preview?.type === 'html' && preview?.sessionId && preview?.relativePath) {
    return buildSessionStaticFileUrl(preview)
  }

  const url = isWeb
    ? buildWebRawFileUrl(preview)
    : (preview?.url || pathToFileUrl(preview?.filePath || preview?.path))

  return preview?.type === 'pdf' ? appendPdfInitialView(url, pdfInitialView) : url
}
