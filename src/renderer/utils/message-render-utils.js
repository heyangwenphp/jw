import { extractLatex, restoreLatex } from './latex-utils'
import { renderCodeBlockWithLines, normalizeLang } from './highlight-utils'

const TRAILING_SENTENCE_PUNCTUATION = /[。．，,；;：:！!？?]+$/
const UNMATCHED_TRAILING_BRACKETS = {
  '）': '（',
  ')': '(',
  '】': '【',
  ']': '[',
  '」': '「',
  '』': '『',
  '》': '《',
  '〉': '〈',
  '}': '{',
  '>': '<'
}

const LINK_PLACEHOLDER_PREFIX = '\x00LK'
const MARKDOWN_LINK_PLACEHOLDER_PREFIX = '\x00MLK'
const FILE_URI_PREFIX = 'file://'
const TOKEN_BOUNDARY = '(^|[\\s([{"\'`*:,，。；;：])'
const WINDOWS_MIDDLE_SEGMENT = `(?:[^\\s\\\\/\\n<>&"':*?]| (?=[^\\\\/\\n<>&"':*?]*[\\\\/]))+`
const WINDOWS_FINAL_SEGMENT = `(?:[^\\s\\\\/\\n<>&"':*?]| (?=[^\\\\/\\n<>&"':*?]*\\.[A-Za-z0-9]{1,10}(?:$|["'\`。．，,；;：:！!？?)}\\]】》〉])))+`

const DOCUMENT_FILE_KIND_BY_EXT = new Map([
  ['pdf', 'pdf'],
  ['doc', 'word'],
  ['docx', 'word'],
  ['rtf', 'word'],
  ['xls', 'spreadsheet'],
  ['xlsx', 'spreadsheet'],
  ['csv', 'spreadsheet'],
  ['tsv', 'spreadsheet'],
  ['ppt', 'presentation'],
  ['pptx', 'presentation'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['txt', 'text'],
  ['html', 'html'],
  ['htm', 'html']
])
const DOCUMENT_FILE_KIND_LABELS = {
  pdf: 'PDF',
  word: 'Word',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  markdown: 'Markdown',
  text: 'Text',
  html: 'HTML'
}

const URL_REGEX = /(https?:\/\/[^\s<>&"')\]\uFF08]+)/g
const FILE_URI_REGEX = /(file:\/\/[^\s<>&"')\]]+)/gi
const WINDOWS_ABSOLUTE_PATH_REGEX = new RegExp(
  `${TOKEN_BOUNDARY}([A-Za-z]:(?:\\\\|\\/(?!\\/))(?:${WINDOWS_MIDDLE_SEGMENT}[\\\\/])*${WINDOWS_FINAL_SEGMENT})`,
  'g'
)
const WINDOWS_MSYS_PATH_REGEX = new RegExp(
  `${TOKEN_BOUNDARY}(\\/[A-Za-z]\\/(?:${WINDOWS_MIDDLE_SEGMENT}\\/)*${WINDOWS_FINAL_SEGMENT})`,
  'g'
)
const WINDOWS_SHORT_DRIVE_PATH_REGEX = new RegExp(
  `${TOKEN_BOUNDARY}([A-Za-z][\\\\/](?!\\/)(?:workspace|users)[^\\s<>&"']*)`,
  'gi'
)
const UNIX_ABSOLUTE_PATH_REGEX = /(\/(?:home|usr|etc|tmp|var|opt|mnt|srv|root|Users|Library|Applications|Volumes)[^\n<>&"']*)/g
const RELATIVE_PATH_REGEX = /(\.\.?[/\\][^\n<>&"']*)/g
const HOME_PATH_REGEX = /(~\/[^\n<>&"']*)/g
const TRAILING_PATH_ANNOTATION = /^(.+\.[A-Za-z0-9]{1,10})([（(][^\\/.\n]*)$/

export const escapeHtml = (str = '') => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

const decodeBasicHtmlEntities = (value = '') => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'")
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')

const stripHtmlTags = (value = '') => String(value || '').replace(/<[^>]*>/g, '')

const escapeMarkdownLinkLabel = (value = '') => String(value || '').replace(/([\\[\]])/g, '\\$1')

const normalizeMarkdownLinkTarget = (value = '') => {
  const trimmed = String(value || '').trim()
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export const normalizeSafeHtmlAnchors = (text = '') => String(text || '').replace(
  /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
  (match, attrs, rawLabel) => {
    const hrefMatch = String(attrs || '').match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    const href = decodeBasicHtmlEntities(hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || '').trim()
    if (!/^https?:\/\//i.test(href)) return ''

    const label = decodeBasicHtmlEntities(stripHtmlTags(rawLabel)).trim() || href
    const safeHref = href.replace(/>/g, '%3E')
    return `[${escapeMarkdownLinkLabel(label)}](<${safeHref}>)`
  }
)

export const trimTrailingPathPunctuation = (value) => {
  if (!value) return value

  let trimmed = value.replace(TRAILING_SENTENCE_PUNCTUATION, '')
  const annotationMatch = trimmed.match(TRAILING_PATH_ANNOTATION)
  if (annotationMatch) {
    trimmed = annotationMatch[1]
  }

  while (trimmed) {
    const trailingChar = trimmed.at(-1)
    const openingChar = UNMATCHED_TRAILING_BRACKETS[trailingChar]
    if (!openingChar) break

    const openingCount = [...trimmed].filter(char => char === openingChar).length
    const closingCount = [...trimmed].filter(char => char === trailingChar).length
    if (closingCount > openingCount) {
      trimmed = trimmed.slice(0, -1)
      continue
    }
    break
  }

  return trimmed
}

const normalizeWindowsDrivePath = (rawPath) => {
  if (!rawPath) return rawPath

  let normalized = rawPath
  const msys = normalized.match(/^\/([a-zA-Z])\/(.*)/)
  if (msys) {
    normalized = `${msys[1].toUpperCase()}:/${msys[2]}`
  } else {
    const shortDrive = normalized.match(/^([a-zA-Z])[\\/](.*)/)
    if (shortDrive && /^(workspace|users)([\\/]|$)/i.test(shortDrive[2] || '')) {
      normalized = `${shortDrive[1].toUpperCase()}:/${shortDrive[2]}`
    } else if (/^[a-zA-Z]:/.test(normalized)) {
      normalized = normalized[0].toUpperCase() + normalized.slice(1)
    }
  }

  if (/^[A-Za-z]:[\\/]/.test(normalized)) {
    normalized = normalized.replace(/\//g, '\\')
  }

  return normalized
}

export const decodeFileUriToPath = (value, platform = 'win32') => {
  if (typeof value !== 'string' || !value.startsWith(FILE_URI_PREFIX)) return null

  try {
    const url = new URL(value)
    const pathname = decodeURIComponent(url.pathname || '')

    if (platform === 'win32') {
      if (/^\/[A-Za-z]:/.test(pathname)) {
        return pathname.slice(1).replace(/\//g, '\\')
      }
      if (url.host) {
        const normalizedPath = pathname ? pathname.replace(/\//g, '\\') : ''
        return `\\\\${url.host}${normalizedPath}`
      }
      return pathname ? pathname.replace(/\//g, '\\') : null
    }

    if (url.host) {
      return `//${url.host}${pathname || ''}`
    }

    return pathname || null
  } catch {
    return null
  }
}

export const normalizePathForDisplay = (rawPath, platform = 'win32') => {
  const cleanPath = trimTrailingPathPunctuation(rawPath)
  if (!cleanPath) return cleanPath

  const decodedFileUriPath = decodeFileUriToPath(cleanPath, platform)
  const displayPath = decodedFileUriPath || cleanPath

  if (platform === 'win32') {
    return normalizeWindowsDrivePath(displayPath)
  }

  return displayPath
}

const makeLinkToken = (type, rawValue, platform) => {
  const cleanValue = type === 'path' ? trimTrailingPathPunctuation(rawValue) : rawValue
  if (!cleanValue) return null

  const displayText = type === 'path'
    ? normalizePathForDisplay(cleanValue, platform)
    : cleanValue

  return {
    type,
    href: displayText,
    displayText,
    trailingText: type === 'path' ? rawValue.slice(cleanValue.length) : ''
  }
}

const getDocumentPathKind = (token) => {
  if (token?.type !== 'path') return ''
  const normalizedPath = String(token.href || token.displayText || '')
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
  const ext = normalizedPath.match(/\.([a-z0-9]{1,10})$/)?.[1]
  return DOCUMENT_FILE_KIND_BY_EXT.get(ext) || ''
}

export const normalizeLineBrokenUrls = (text = '') => String(text || '')
  .replace(/\b(https?):\s*\r?\n\s*\/\//gi, '$1://')
  .replace(/\b(https?)\s*\r?\n\s*\/\//gi, '$1://')
  .replace(/(https?:\/\/[^\s<>&"')\]\uFF08]+)(\uFF08[^\r\n]*?\uFF09)/g, '$1 $2')

const renderLinkToken = (token) => {
  const escapedHref = escapeHtml(token.href)
  const escapedDisplayText = escapeHtml(token.displayText)
  const trailing = escapeHtml(token.trailingText || '')
  const documentFileKind = getDocumentPathKind(token)
  const isFilePath = token?.type === 'path' && /\.[A-Za-z0-9]{1,10}$/.test(String(token.href || token.displayText || '').replace(/[?#].*$/, '').trim())
  if (documentFileKind || isFilePath) {
    const fileKind = documentFileKind || 'file'
    const escapedFileKind = escapeHtml(fileKind)
    const escapedFileKindLabel = escapeHtml(DOCUMENT_FILE_KIND_LABELS[fileKind] || 'File')
    const isPdfDocument = documentFileKind === 'pdf'
    const anchorTitle = `Preview ${escapedFileKindLabel}`
    const actions = [
      `<span class="clickable-link-group" data-file-kind="${escapedFileKind}">`,
      `<a class="clickable-link" data-link-type="${token.type}" data-file-kind="${escapedFileKind}" data-href="${escapedHref}" title="${anchorTitle}">${escapedDisplayText}</a>`
    ]
    if (isPdfDocument) {
      actions.push(`<button type="button" class="clickable-link-action clickable-link-preview" data-link-type="${token.type}" data-link-action="preview" data-file-kind="${escapedFileKind}" data-href="${escapedHref}" title="Preview ${escapedFileKindLabel}">&#39044;&#35272;</button>`)
    }
    actions.push(
      `<button type="button" class="clickable-link-action clickable-link-download" data-link-type="${token.type}" data-link-action="download" data-file-kind="${escapedFileKind}" data-href="${escapedHref}" title="Download ${escapedFileKindLabel}">&#19979;&#36733;</button>`,
      `</span>${trailing}`
    )
    return actions.join('')
  }
  return `<a class="clickable-link" data-link-type="${token.type}" data-href="${escapedHref}" title="单击预览 · Ctrl+单击打开">${escapedDisplayText}</a>${trailing}`
}

const replaceMarkdownLinksWithPlaceholders = (text, linkTokens, platform) => {
  return text.replace(/(^|[^!])\[([^\]\n]+)\]\((<[^>\n]+>|[^)\s]+)\)/g, (match, prefix, rawLabel, rawHref) => {
    const href = normalizeMarkdownLinkTarget(rawHref)
    const type = /^https?:\/\//i.test(href) ? 'url' : 'path'
    const token = makeLinkToken(type, href, platform)
    if (!token) return match

    token.displayText = rawLabel.replace(/\\([\[\]])/g, '$1')
    const placeholder = `${MARKDOWN_LINK_PLACEHOLDER_PREFIX}${linkTokens.length}\x00`
    linkTokens.push(token)
    return `${prefix}${placeholder}`
  })
}

const restoreMarkdownLinkTokens = (text, linkTokens) => {
  return text.replace(/\x00MLK(\d+)\x00/g, (_, index) => {
    const token = linkTokens[Number(index)]
    return token ? renderLinkToken(token) : ''
  })
}

const replaceWithPlaceholder = (text, regex, createToken, linkTokens, { withPrefix = false } = {}) => {
  return text.replace(regex, (...args) => {
    const match = args[0]
    const groups = args.slice(1, -2)
    const prefix = withPrefix ? groups[0] : ''
    const rawValue = withPrefix ? groups[1] : groups[0]
    const token = createToken(rawValue)
    if (!token) return match

    const placeholder = `${LINK_PLACEHOLDER_PREFIX}${linkTokens.length}\x00`
    linkTokens.push(token)
    return `${prefix}${placeholder}`
  })
}

const tokenizeLinks = (text, platform) => {
  const linkTokens = []
  let tokenized = text

  tokenized = replaceWithPlaceholder(tokenized, URL_REGEX, value => makeLinkToken('url', value, platform), linkTokens)
  tokenized = replaceWithPlaceholder(tokenized, FILE_URI_REGEX, value => makeLinkToken('path', value, platform), linkTokens)
  tokenized = replaceWithPlaceholder(tokenized, WINDOWS_ABSOLUTE_PATH_REGEX, value => makeLinkToken('path', value, platform), linkTokens, { withPrefix: true })
  tokenized = replaceWithPlaceholder(tokenized, WINDOWS_MSYS_PATH_REGEX, value => makeLinkToken('path', value, platform), linkTokens, { withPrefix: true })
  tokenized = replaceWithPlaceholder(tokenized, WINDOWS_SHORT_DRIVE_PATH_REGEX, value => makeLinkToken('path', value, platform), linkTokens, { withPrefix: true })
  tokenized = replaceWithPlaceholder(tokenized, UNIX_ABSOLUTE_PATH_REGEX, value => makeLinkToken('path', value, platform), linkTokens)
  tokenized = replaceWithPlaceholder(tokenized, RELATIVE_PATH_REGEX, value => makeLinkToken('path', value, platform), linkTokens)
  tokenized = replaceWithPlaceholder(tokenized, HOME_PATH_REGEX, value => makeLinkToken('path', value, platform), linkTokens)

  return { tokenized, linkTokens }
}

const restoreLinkTokens = (text, linkTokens) => {
  return text.replace(/\x00LK(\d+)\x00/g, (_, index) => {
    const token = linkTokens[Number(index)]
    return token ? renderLinkToken(token) : ''
  })
}

export const renderPlainTextWithLinks = (content, { platform = 'win32' } = {}) => {
  const { tokenized, linkTokens } = tokenizeLinks(normalizeLineBrokenUrls(content), platform)
  let text = escapeHtml(tokenized)
  text = text.replace(/\n/g, '<br>')
  return restoreLinkTokens(text, linkTokens)
}

const detectStandaloneLink = (value, platform) => {
  if (!value) return null
  if (/^https?:\/\//.test(value)) {
    return makeLinkToken('url', value, platform)
  }
  if (/^file:\/\//i.test(value)) {
    return makeLinkToken('path', value, platform)
  }
  if (
    /^[A-Za-z]:(?:\\|\/(?!\/)).+/.test(value) ||
    /^\/[A-Za-z]\/.+/.test(value) ||
    /^[A-Za-z][\\/](?:workspace|users)[^\s]*/i.test(value) ||
    /^\/(?:home|usr|etc|tmp|var|opt|mnt|srv|root|Users|Library|Applications|Volumes)\//.test(value) ||
    /^\.\.?[/\\]/.test(value) ||
    /^~\//.test(value)
  ) {
    return makeLinkToken('path', value, platform)
  }
  return null
}

export const renderMessageHtml = (content, { platform = 'win32' } = {}) => {
  let text = normalizeLineBrokenUrls(normalizeSafeHtmlAnchors(content))

  const codeBlocks = []
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push({ lang, code })
    return `\x00CB${codeBlocks.length - 1}\x00`
  })

  const inlineCodes = []
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    inlineCodes.push(code)
    return `\x00IC${inlineCodes.length - 1}\x00`
  })

  const { text: latexProcessed, blocks: latexBlocks } = extractLatex(text)
  text = latexProcessed

  const explicitLinkTokens = []
  text = replaceMarkdownLinksWithPlaceholders(text, explicitLinkTokens, platform)

  const { tokenized, linkTokens } = tokenizeLinks(text, platform)
  text = escapeHtml(tokenized)

  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>')
  text = text.replace(/\n/g, '<br>')

  text = restoreLatex(text, latexBlocks)
  text = restoreMarkdownLinkTokens(text, explicitLinkTokens)
  text = restoreLinkTokens(text, linkTokens)

  text = text.replace(/\x00CB(\d+)\x00/g, (_, index) => {
    const { lang, code } = codeBlocks[Number(index)]
    const trimmed = code.trim()
    if (!trimmed.includes('\n')) {
      const token = detectStandaloneLink(trimmed, platform)
      if (token) {
        return `<pre><code>${renderLinkToken(token)}</code></pre>`
      }
    }
    return renderCodeBlockWithLines(code, lang)
  })

  text = text.replace(/\x00IC(\d+)\x00/g, (_, index) => {
    const code = inlineCodes[Number(index)]
    const token = detectStandaloneLink(code, platform)
    if (token) {
      return `<code>${renderLinkToken(token)}</code>`
    }
    return `<code>${escapeHtml(code)}</code>`
  })

  return text.replace(/^(?:\s*<br\s*\/?>\s*)+/i, '')
}
