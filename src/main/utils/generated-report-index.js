const {
  DAILY_LEAD_REPORT_MODE,
  DAILY_LEAD_REPORT_PROMPT,
  MONTHLY_REPORT_MODE,
  MONTHLY_REPORT_PROMPT,
  WEEKLY_REPORT_MODE,
  WEEKLY_REPORT_PROMPT
} = require('./report-prompts')
const VALID_MODES = new Set(['chat', 'clue', DAILY_LEAD_REPORT_MODE, WEEKLY_REPORT_MODE, MONTHLY_REPORT_MODE])

function stringifyValue(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseJson(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function normalizeMode(mode) {
  const normalized = stringifyValue(mode).trim()
  return VALID_MODES.has(normalized) ? normalized : 'chat'
}

function reportModeMatchesRequest(reportMode, requestedMode) {
  if (!requestedMode) return true
  if (requestedMode === 'chat') return reportMode === 'chat' || reportMode === 'clue'
  return reportMode === requestedMode
}

function getMessageFiles(message) {
  if (!message || typeof message !== 'object') return []
  if (Array.isArray(message.files) && message.files.length > 0) return message.files

  const parsedContent = parseJson(message.content)
  if (parsedContent && typeof parsedContent === 'object' && Array.isArray(parsedContent.files)) {
    return parsedContent.files
  }

  return []
}

function containsDailyLeadReportPrompt(value) {
  const text = stringifyValue(value).replace(/\s+/g, '')
  return text.includes(DAILY_LEAD_REPORT_PROMPT.replace(/\s+/g, ''))
}

function isDailyLeadReportConversation(conversation, messages = []) {
  if (conversation?.reportMode === DAILY_LEAD_REPORT_MODE) return true
  if (conversation?.source !== 'scheduled') return false

  const title = stringifyValue(conversation?.title)
  if (title.includes('线索报告')) return true

  return (Array.isArray(messages) ? messages : []).some(message => (
    containsDailyLeadReportPrompt(message?.content) ||
    containsDailyLeadReportPrompt(message?.input) ||
    containsDailyLeadReportPrompt(message?.output)
  ))
}

function classifyGeneratedReportMode(conversationOrMessages = [], maybeMessages) {
  const messages = Array.isArray(maybeMessages)
    ? maybeMessages
    : (Array.isArray(conversationOrMessages) ? conversationOrMessages : [])
  const conversation = Array.isArray(conversationOrMessages) ? {} : (conversationOrMessages || {})
  if (VALID_MODES.has(conversation?.reportMode)) return conversation.reportMode
  if (isDailyLeadReportConversation(conversation, messages)) return DAILY_LEAD_REPORT_MODE
  const firstUserMessage = (Array.isArray(messages) ? messages : []).find(message => message?.role === 'user')
  return getMessageFiles(firstUserMessage).length > 0 ? 'clue' : 'chat'
}

function getReportNameFromPath(filePath) {
  const basename = stringifyValue(filePath).split(/[\\/]/).filter(Boolean).pop() || ''
  return basename.replace(/\.(?:md|pdf)$/i, '').trim() || 'Report'
}

function isClueMarkdownFilePath(filePath) {
  const basename = stringifyValue(filePath).split(/[\\/]/).filter(Boolean).pop() || ''
  const name = basename.replace(/\.md$/i, '').trim()
  if (!name) return false
  return /^(?:线索|clue)(?:[\s_-]*\d+)?$/i.test(name)
}

function normalizeReportPath(filePath) {
  return stringifyValue(filePath).trim().replace(/\\\\/g, '\\')
}

function cleanTitle(value) {
  const title = stringifyValue(value)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim()

  if (!title) return ''
  if (/\.(?:md|pdf)$/i.test(title)) return getReportNameFromPath(title)
  if (title.length > 160) return ''
  if (/^[A-Za-z]:[\\/]/.test(title) || title.includes('/') || title.includes('\\')) return ''
  return title
}

function titleFromParsedValue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return extractReportTitleFromText(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const title = titleFromParsedValue(item)
      if (title) return title
    }
    return ''
  }
  if (typeof value !== 'object') return ''

  const titleKeys = [
    'report_title',
    'reportTitle',
    'report_name',
    'reportName',
    'title',
    '\u62a5\u544a\u6807\u9898',
    '\u62a5\u544a\u540d\u79f0',
    '\u6807\u9898'
  ]

  for (const key of titleKeys) {
    const title = cleanTitle(value[key])
    if (title) return title
  }

  for (const item of Object.values(value)) {
    const title = titleFromParsedValue(item)
    if (title) return title
  }

  return ''
}

function extractReportTitleFromText(value) {
  const text = stringifyValue(value)
  if (!text.trim()) return ''

  const parsed = parseJson(text)
  const parsedTitle = titleFromParsedValue(parsed)
  if (parsedTitle) return parsedTitle

  const patterns = [
    /(?:report_title|reportTitle|report_name|reportName|title)\s*[:=]\s*["']?([^"'\n\r}]{1,160})["']?/i,
    /(?:\u62a5\u544a\u6807\u9898|\u62a5\u544a\u540d\u79f0|\u6807\u9898)\s*[:\uff1a]\s*([^\n\r\uff0c\u3002\uff1b;]{1,160})/u,
    /^#\s+(.{1,160})$/m
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    const title = cleanTitle(match?.[1])
    if (title) return title
  }

  return ''
}

function collectMarkdownReportPathsFromString(value, target) {
  const text = stringifyValue(value)
  if (!text) return
  const trimmed = text.trim()
  const markdownPathEnd = '(?=$|[\\s"\'\\)\\]\\},;])'

  const markdownExtensionCount = (trimmed.match(/\.md/gi) || []).length
  if (
    markdownExtensionCount === 1 &&
    (/^[A-Za-z]:[\\/].+\.md$/i.test(trimmed) || /^\/.+\.md$/i.test(trimmed)) &&
    !/["'\r\n]/.test(trimmed)
  ) {
    target.push(normalizeReportPath(trimmed))
    return
  }

  const patterns = [
    { pattern: /["']([A-Za-z]:[\\/][^"'\r\n]+?\.md)["']/gi, group: 1 },
    { pattern: /["'](\/[^"'\r\n]+?\.md)["']/gi, group: 1 },
    { pattern: new RegExp(`[A-Za-z]:\\\\(?:[^<>:"|?*\\r\\n]+\\\\)*[^<>:"|?*\\r\\n]+\\.md${markdownPathEnd}`, 'gi'), group: 0 },
    { pattern: new RegExp(`[A-Za-z]:/(?:[^\\s\\0\\r\\n"'<>|?*]+/)*[^\\s\\0\\r\\n"'<>|?*]+\\.md${markdownPathEnd}`, 'gi'), group: 0 },
    { pattern: new RegExp(`(^|[\\s"'(])((?:/[^\\s\\0\\r\\n"'<>|?*]+)+\\.md)${markdownPathEnd}`, 'gi'), group: 2 }
  ]

  for (const { pattern, group } of patterns) {
    for (const match of text.matchAll(pattern)) {
      target.push(normalizeReportPath(match[group]).replace(/[\s"'\)\]\},;]+$/g, ''))
    }
  }
}

function collectMarkdownReportPathsDeep(value, target = []) {
  if (value === null || value === undefined) return target
  if (typeof value === 'string') {
    const parsed = parseJson(value)
    if (parsed !== null) {
      collectMarkdownReportPathsDeep(parsed, target)
      return target
    }
    collectMarkdownReportPathsFromString(value, target)
    return target
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMarkdownReportPathsDeep(item, target)
    return target
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectMarkdownReportPathsDeep(item, target)
  }
  return target
}

function getReportTimestamp(message, conversation) {
  const candidates = [
    message?.timestamp,
    conversation?.updated_at,
    conversation?.updatedAt,
    conversation?.created_at,
    conversation?.createdAt
  ]

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue
    const timestamp = Number(candidate)
    if (Number.isFinite(timestamp)) return timestamp
  }

  return 0
}

function makeHiddenReportKey(modeOrReport, filePath) {
  if (modeOrReport && typeof modeOrReport === 'object' && !Array.isArray(modeOrReport)) {
    return `${normalizeMode(modeOrReport.mode)}:${normalizeReportPath(modeOrReport.filePath)}`
  }

  return `${normalizeMode(modeOrReport)}:${normalizeReportPath(filePath)}`
}

function isMessagesLookup(value) {
  if (!value || typeof value !== 'object') return false
  if (value instanceof Map) return true
  if (Object.prototype.hasOwnProperty.call(value, 'mode') || Object.prototype.hasOwnProperty.call(value, 'hiddenKeys')) {
    return false
  }
  return Object.values(value).some(item => Array.isArray(item))
}

function getConversationLookupKeys(conversation) {
  return [
    conversation?.session_id,
    conversation?.sessionId,
    conversation?.id
  ].filter(value => value !== null && value !== undefined && value !== '')
}

function getMessagesForConversation(messagesByConversationId, conversation) {
  const keys = getConversationLookupKeys(conversation)

  if (messagesByConversationId instanceof Map) {
    for (const key of keys) {
      if (messagesByConversationId.has(key)) return messagesByConversationId.get(key) || []
      const stringKey = String(key)
      if (messagesByConversationId.has(stringKey)) return messagesByConversationId.get(stringKey) || []
    }
    return []
  }

  if (messagesByConversationId && typeof messagesByConversationId === 'object') {
    for (const key of keys) {
      const messages = messagesByConversationId[key] || messagesByConversationId[String(key)]
      if (Array.isArray(messages)) return messages
    }
  }

  return []
}

function normalizeConversationEntries(conversationsOrEntries, messagesByConversationId) {
  const source = Array.isArray(conversationsOrEntries) ? conversationsOrEntries : []
  if (!isMessagesLookup(messagesByConversationId)) return source

  return source.map(conversation => ({
    conversation,
    messages: getMessagesForConversation(messagesByConversationId, conversation)
  }))
}

function isAssistantMessage(message) {
  return message?.role === 'assistant'
}

function collectGeneratedReportsFromConversations(conversationsOrEntries, messagesByConversationIdOrOptions = {}, maybeOptions) {
  const options = isMessagesLookup(messagesByConversationIdOrOptions)
    ? (maybeOptions || {})
    : messagesByConversationIdOrOptions
  const conversationEntries = normalizeConversationEntries(conversationsOrEntries, messagesByConversationIdOrOptions)
  const hasModeFilter = options && Object.prototype.hasOwnProperty.call(options, 'mode') && options.mode !== undefined
  const requestedMode = hasModeFilter ? normalizeMode(options.mode) : null
  const hiddenKeys = new Set(Array.isArray(options.hiddenKeys) ? options.hiddenKeys : [])
  const pathExists = typeof options.pathExists === 'function' ? options.pathExists : null
  const byPath = new Map()

  for (const entry of Array.isArray(conversationEntries) ? conversationEntries : []) {
    const conversation = entry?.conversation || {}
    const messages = Array.isArray(entry?.messages) ? entry.messages : []
    const mode = classifyGeneratedReportMode(conversation, messages)

    if (!reportModeMatchesRequest(mode, requestedMode)) continue

    for (const message of messages) {
      if (!isAssistantMessage(message)) continue

      const markdownReportPaths = []
      collectMarkdownReportPathsDeep(message?.input, markdownReportPaths)
      collectMarkdownReportPathsDeep(message?.output, markdownReportPaths)
      collectMarkdownReportPathsDeep(message?.content, markdownReportPaths)

      if (markdownReportPaths.length === 0) continue

      const title = titleFromParsedValue(message?.output) || extractReportTitleFromText(message?.content)
      const timestamp = getReportTimestamp(message, conversation)

      for (const filePath of markdownReportPaths) {
        const normalizedPath = normalizeReportPath(filePath)
        if (isClueMarkdownFilePath(normalizedPath)) continue
        if (!normalizedPath || hiddenKeys.has(makeHiddenReportKey(mode, normalizedPath))) continue
        if (pathExists && !pathExists(normalizedPath)) continue

        const dedupeKey = `${mode}:${normalizedPath}`
        const previous = byPath.get(dedupeKey)
        if (previous && Number(previous.updatedAt || 0) > timestamp) continue

        byPath.set(dedupeKey, {
          id: `${mode}:${normalizedPath}`,
          name: title || getReportNameFromPath(normalizedPath),
          filePath: normalizedPath,
          sessionId: conversation.session_id || conversation.sessionId || conversation.id || null,
          conversationTitle: conversation.title || '',
          mode,
          format: 'markdown',
          extension: '.md',
          createdAt: timestamp,
          updatedAt: timestamp
        })
      }
    }
  }

  return [...byPath.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
}

module.exports = {
  classifyGeneratedReportMode,
  collectGeneratedReportsFromConversations,
  DAILY_LEAD_REPORT_MODE,
  DAILY_LEAD_REPORT_PROMPT,
  extractReportTitleFromText,
  getReportNameFromPath,
  isClueMarkdownFilePath,
  makeHiddenReportKey,
  MONTHLY_REPORT_MODE,
  MONTHLY_REPORT_PROMPT,
  WEEKLY_REPORT_PROMPT,
  WEEKLY_REPORT_MODE
}
