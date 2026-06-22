import { renderMarkdownWithHighlight } from './highlight-utils'
import { escapeHtml, normalizeLineBrokenUrls, normalizeSafeHtmlAnchors, renderMessageHtml } from './message-render-utils'
import { sanitizeAgentVisibleText } from './agent-thinking-display'
import { isSourceReferenceLabel, isSourceReferenceLine, renderSourceReferenceIcons } from './source-reference-render-utils'
import { normalizeInlineReportFieldParagraphs } from './investment-report-format-utils'

const decodeHtmlAttr = (value = '') => {
  let normalized = String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  if (/%[0-9A-Fa-f]{2}/.test(normalized)) {
    try {
      normalized = decodeURI(normalized)
    } catch {}
  }
  return normalized
}

const getRenderedLinkType = (href = '') => {
  const decoded = decodeHtmlAttr(href)
  if (/^https?:\/\//i.test(decoded)) return 'url'
  return 'path'
}

const linkPdfPathLines = (content = '') => {
  const pdfPathLinePattern = /((?:PDF|pdf|\u62a5\u544a)[^\r\n]{0,30}(?:\u8def\u5f84|\u5730\u5740|\u6587\u4ef6)[\uff1a:\s]*)(?!\[)((?:[a-zA-Z]:[\\/]|\\\\)[^\r\n]+?\.pdf)/g
  const linkedInlinePaths = content.replace(pdfPathLinePattern, (_match, prefix, filePath) => {
    const safeTarget = filePath.replace(/>/g, '%3E')
    return `${prefix}[${filePath}](<${safeTarget}>)`
  })

  const standalonePdfPathPattern = /(^|\n)(?!\s*[-*]\s*\[)(\s*)((?:[a-zA-Z]:[\\/]|\\\\)[^\r\n]+?\.pdf)(?=\s*(?:\n|$))/g
  return linkedInlinePaths.replace(standalonePdfPathPattern, (_match, lineStart, indent, filePath) => {
    const safeTarget = filePath.replace(/>/g, '%3E')
    return `${lineStart}${indent}[${filePath}](<${safeTarget}>)`
  })
}

const renderFieldCard = (body = '', platform = 'win32') => {
  const rows = []
  const appendToLastRow = (line) => {
    if (rows.length === 0) {
      rows.push({ label: '', value: line })
      return
    }
    rows[rows.length - 1].value = [
      rows[rows.length - 1].value,
      line
    ].filter(Boolean).join('\n')
  }

  body.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) return

    const normalizedLine = line.replace(/^[-*]\s+/, '')
    const headingMatch = normalizedLine.match(/^\u3010([^\u3011]{1,80})\u3011$/)
    if (headingMatch) {
      rows.push({
        label: headingMatch[1].trim(),
        value: ''
      })
      return
    }

    if (
      rows.length > 0 &&
      /^[-*]\s+/.test(line) &&
      (!rows[rows.length - 1].value || /^[-*]\s+/m.test(rows[rows.length - 1].value))
    ) {
      appendToLastRow(line)
      return
    }

    if (
      rows.length > 0 &&
      isSourceReferenceLabel(rows[rows.length - 1].label) &&
      isSourceReferenceLine(normalizedLine)
    ) {
      appendToLastRow(line)
      return
    }

    const isLinkLine = /^<a\b/i.test(normalizedLine) ||
      /^\[[^\]]+\]\(/.test(normalizedLine) ||
      /^https?:\/\//i.test(normalizedLine)
    const match = isLinkLine ? null : normalizedLine.match(/^([^:\uff1a]{1,80})[:\uff1a]\s*(.*)$/)
    if (match) {
      rows.push({
        label: match[1].trim(),
        value: match[2].trim()
      })
      return
    }

    appendToLastRow(line)
  })

  if (rows.length === 0) return ''

  const rowHtml = rows.map((row) => `
    <div class="field-card-row">
      <div class="field-card-label">${escapeHtml(row.label)}</div>
      <div class="field-card-value">${isSourceReferenceLabel(row.label) ? (renderSourceReferenceIcons(row.value) || renderMessageHtml(row.value || '\u672a\u67e5\u5230', { platform })) : renderMessageHtml(row.value || '\u672a\u67e5\u5230', { platform })}</div>
    </div>
  `).join('')

  return `<div class="field-card">${rowHtml}</div>`
}

const renderMarkdownFieldCards = (content = '', platform = 'win32') => {
  const cards = []
  const markdown = content.replace(/(?:^|\n):::\s*field-card\s*\n([\s\S]*?)\n:::/g, (_match, body) => {
    const token = `JEDI_FIELD_CARD_${cards.length}_TOKEN`
    cards.push({
      token,
      html: renderFieldCard(body, platform)
    })
    return `\n\n${token}\n\n`
  })

  let html = renderMarkdownWithHighlight(linkPdfPathLines(markdown))
  cards.forEach(({ token, html: cardHtml }) => {
    html = html.split(`<p>${token}</p>`).join(cardHtml)
    html = html.split(token).join(cardHtml)
  })
  return html
}

const enhancePdfLinks = (html = '') => {
  return html.replace(/<a\s+href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi, (match, href, attrs, label) => {
    if (!/\.pdf(?:$|[?#])/i.test(decodeHtmlAttr(href))) return match
    if (/clickable-link-action|pdf-link-group/.test(match)) return match

    const escapedHref = escapeHtml(decodeHtmlAttr(href))
    const linkType = getRenderedLinkType(href)
    return `<span class="clickable-link-group pdf-link-group">
      <a href="${href}"${attrs} class="clickable-link" data-link-type="${linkType}" data-file-kind="pdf" data-href="${escapedHref}">${label}</a>
      <button type="button" class="clickable-link-action clickable-link-preview" data-link-type="${linkType}" data-file-kind="pdf" data-href="${escapedHref}" data-link-action="preview">&#39044;&#35272;</button>
      <button type="button" class="clickable-link-action clickable-link-download" data-link-type="${linkType}" data-file-kind="pdf" data-href="${escapedHref}" data-link-action="download">&#19979;&#36733;</button>
    </span>`
  })
}

export const renderAssistantMessageContent = (content = '', { platform = 'win32' } = {}) =>
  enhancePdfLinks(renderMarkdownFieldCards(normalizeInlineReportFieldParagraphs(normalizeLineBrokenUrls(normalizeSafeHtmlAnchors(sanitizeAgentVisibleText(content)))), platform))
