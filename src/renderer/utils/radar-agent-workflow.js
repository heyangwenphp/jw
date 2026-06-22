function normalizeText(value) {
  return typeof value === 'string' ? value : String(value || '')
}

function buildReportContextFile(filePath) {
  return {
    id: filePath,
    name: basename(filePath) || getReportNameFromPath(filePath),
    filePath,
    sizeText: 'PDF',
    contextOnly: true
  }
}

export function appendActiveReportContext(message, reportFilePath, options = {}) {
  const filePath = normalizeText(reportFilePath).trim()
  if (!filePath) return message

  const reportText = normalizeText(options.reportText).trim()
  const reportTextSection = reportText
    ? `\n\n已提取的报告文本（优先依据以下内容回答，不要使用 Read 工具读取 PDF）：\n${reportText}${options.reportTextTruncated ? '\n\n[报告文本已截断，请基于已提供内容回答。]' : ''}`
    : '\n\n当前没有可用的报告文本摘取结果。不要使用 Read 工具读取 PDF；如果无法根据既有对话内容回答，请说明需要重新生成可读文本。'
  const context = `\u5f53\u524d\u9884\u89c8\u62a5\u544a\u6587\u4ef6\u5730\u5740\uff1a${filePath}\n\u8bf7\u5c06\u8be5\u62a5\u544a\u4f5c\u4e3a\u672c\u8f6e\u5bf9\u8bdd\u4e0a\u4e0b\u6587\u3002${reportTextSection}`
  const shouldHideFromUser = options?.hideFromUser === true

  if (message && typeof message === 'object') {
    const text = normalizeText(message.text).trim()
    const nextMessage = {
      ...message,
      text: text ? `${text}\n\n${context}` : context
    }

    if (!shouldHideFromUser) return nextMessage

    const existingContextFiles = Array.isArray(message.contextFiles) ? message.contextFiles : []
    const contextFile = buildReportContextFile(filePath)
    return {
      ...nextMessage,
      displayText: typeof message.displayText === 'string'
        ? message.displayText
        : text,
      contextFiles: [
        ...existingContextFiles.filter(file => file?.filePath !== filePath),
        contextFile
      ]
    }
  }

  const text = normalizeText(message).trim()
  const outgoingText = text ? `${text}\n\n${context}` : context

  if (!shouldHideFromUser) return outgoingText

  return {
    text: outgoingText,
    displayText: text,
    contextFiles: [buildReportContextFile(filePath)]
  }
}

function isPdfPath(filePath) {
  return normalizeText(filePath).trim().toLowerCase().endsWith('.pdf')
}

function basename(filePath) {
  return normalizeText(filePath).split(/[\\/]/).filter(Boolean).pop() || ''
}

export function getReportNameFromPath(filePath) {
  const name = basename(filePath).replace(/\.pdf$/i, '').trim()
  return name || 'Report'
}

function sanitizeReportTitle(value) {
  const title = normalizeText(value)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim()

  if (!title || title.length > 120) return ''
  if (/^[A-Za-z]:[\\/]/.test(title) || title.includes('/') || title.includes('\\')) return ''
  if (/\.pdf$/i.test(title)) return getReportNameFromPath(title)
  return title
}

export function extractReportTitleFromText(value) {
  const text = normalizeText(value)
  if (!text.trim()) return ''

  const patterns = [
    /"report_title"\s*:\s*"([^"]{1,120})"/i,
    /"reportTitle"\s*:\s*"([^"]{1,120})"/i,
    /"report_name"\s*:\s*"([^"]{1,120})"/i,
    /"reportName"\s*:\s*"([^"]{1,120})"/i,
    /"title"\s*:\s*"([^"]{1,120})"/i,
    /(?:\u62a5\u544a\u6807\u9898|\u62a5\u544a\u540d\u79f0|\u6807\u9898)\s*[:\uff1a]\s*([^\n\r\uff0c\u3002]{1,120})/u,
    /^#\s+(.{1,120})$/m
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    const title = sanitizeReportTitle(match?.[1])
    if (title) return title
  }

  return ''
}

export function resolveReportNameForGeneratedReport(filePath, reportTextOrOptions = '') {
  const explicitTitle = typeof reportTextOrOptions === 'object'
    ? reportTextOrOptions.reportTitle
    : extractReportTitleFromText(reportTextOrOptions)
  return sanitizeReportTitle(explicitTitle) || getReportNameFromPath(filePath)
}

export function collectReportItemsFromFilePaths(filePaths, sessionId, options = {}) {
  const seen = new Set()
  const now = new Date().toISOString()
  const reportTitle = sanitizeReportTitle(options.reportTitle)
  const titlesByPath = options.reportTitlesByPath || {}

  return (Array.isArray(filePaths) ? filePaths : [])
    .map(filePath => normalizeText(filePath).trim())
    .filter(filePath => filePath && isPdfPath(filePath))
    .filter(filePath => {
      if (seen.has(filePath)) return false
      seen.add(filePath)
      return true
    })
    .map(filePath => ({
      id: filePath,
      name: resolveReportNameForGeneratedReport(filePath, {
        reportTitle: titlesByPath[filePath] || reportTitle
      }),
      filePath,
      sessionId: sessionId || null,
      createdAt: now,
      updatedAt: now
    }))
}

export function upsertReportItems(currentReports, nextReports) {
  const ordered = []
  const byPath = new Map()

  for (const report of Array.isArray(currentReports) ? currentReports : []) {
    if (!report?.filePath) continue
    byPath.set(report.filePath, report)
    ordered.push(report.filePath)
  }

  for (const report of Array.isArray(nextReports) ? nextReports : []) {
    if (!report?.filePath) continue
    if (!byPath.has(report.filePath)) {
      ordered.push(report.filePath)
    }
    byPath.set(report.filePath, {
      ...byPath.get(report.filePath),
      ...report,
      id: report.id || report.filePath
    })
  }

  const uniqueOrder = [...new Set(ordered)]
  return uniqueOrder
    .map(filePath => byPath.get(filePath))
    .filter(Boolean)
}

export function filterDismissedReportItems(currentReports, dismissedPaths = []) {
  const dismissed = new Set(
    (Array.isArray(dismissedPaths) ? dismissedPaths : [])
      .map(path => normalizeText(path).trim())
      .filter(Boolean)
  )

  if (dismissed.size === 0) {
    return Array.isArray(currentReports) ? currentReports : []
  }

  return (Array.isArray(currentReports) ? currentReports : [])
    .filter(report => {
      const id = normalizeText(report?.id).trim()
      const filePath = normalizeText(report?.filePath).trim()
      return !dismissed.has(id) && !dismissed.has(filePath)
    })
}

export function removeReportItem(currentReports, idOrPath) {
  return (Array.isArray(currentReports) ? currentReports : [])
    .filter(report => report?.id !== idOrPath && report?.filePath !== idOrPath)
}
