const SOURCE_SEPARATOR = '｜'

export const decodeBasicHtmlEntities = (value = '') => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'")
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')

export const escapeHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#x27;')

const stripHtmlTags = (value = '') => String(value || '').replace(/<[^>]*>/g, '')

const extractUrl = (value = '') => {
  const text = String(value || '')
  const htmlHref = text.match(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
  const markdownHref = text.match(/\]\((?:<([^>\n]+)>|([^)]+))\)/)
  const plainHref = text.match(/https?:\/\/[^\s<>"')\]]+/i)
  return decodeBasicHtmlEntities(htmlHref?.[1] || htmlHref?.[2] || htmlHref?.[3] || markdownHref?.[1] || markdownHref?.[2] || plainHref?.[0] || '')
    .trim()
    .replace(/>$/, '')
}

export const isSourceReferenceLine = (line = '') => /^S\d+\s*｜/.test(String(line || '').trim())

const parseSourceLine = (line = '') => {
  const trimmed = String(line || '').trim()
  if (!isSourceReferenceLine(trimmed)) return null

  const source = { index: trimmed.match(/^S\d+/)?.[0] || '' }
  trimmed.split(SOURCE_SEPARATOR).forEach(part => {
    const segment = part.trim()
    const match = segment.match(/^([^:：]{1,40})[:：]\s*([\s\S]*)$/)
    if (!match) return
    source[match[1].trim()] = match[2].trim()
  })

  const rawUrl = source['详情 URL'] || source['详情URL'] || source.URL || source.url || ''
  source.url = extractUrl(rawUrl)
  source.name = stripHtmlTags(source['来源名称'] || source.index || '来源')
  source.type = source['来源类型'] || ''
  source.fact = source['支撑事实'] || ''
  source.status = source['核实状态'] || ''
  return source
}

export const isSourceReferenceLabel = (label = '') => /^(来源依据|来源|信息来源)$/.test(String(label || '').trim())

export const renderSourceReferenceIcons = (value = '') => {
  const sources = String(value || '')
    .split(/\r?\n/)
    .map(parseSourceLine)
    .filter(Boolean)

  if (sources.length === 0) return ''

  return sources.map((source, index) => {
    const tooltip = [
      source.type && `来源类型：${source.type}`,
      source.name && `来源名称：${source.name}`,
      source.fact && `支撑事实：${source.fact}`,
      source.status && `核实状态：${source.status}`
    ].filter(Boolean).join('\n')
    const label = source.name || `来源 ${index + 1}`
    const title = escapeHtml(tooltip || label)
    const ariaLabel = escapeHtml(`查看来源：${label}`)
    const href = escapeHtml(source.url)
    const safeLabel = escapeHtml(label)
    const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l2.1-2.1a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1 0l-2.1 2.1a5 5 0 0 0 7.1 7.1l1.2-1.2"/></svg>'

    if (!source.url) {
      return `<span class="source-reference-chip source-reference-chip-disabled" title="${title}" aria-label="${ariaLabel}"><span class="source-reference-name">${safeLabel}</span><span class="source-reference-link source-reference-link-disabled">${icon}</span></span>`
    }

    return `<a class="source-reference-chip clickable-link" href="${href}" target="_blank" rel="noopener noreferrer" data-link-type="url" data-href="${href}" title="${title}" aria-label="${ariaLabel}"><span class="source-reference-name">${safeLabel}</span><span class="source-reference-link">${icon}</span></a>`
  }).join('')
}
