const KNOWN_ABSOLUTE_PATH_ROOTS = new Set([
  '/Applications',
  '/Library',
  '/System',
  '/Users',
  '/Volumes',
  '/bin',
  '/etc',
  '/opt',
  '/private',
  '/sbin',
  '/tmp',
  '/usr',
  '/var'
])

export function getLeadingSlashInputKind(text) {
  if (typeof text !== 'string') return 'plain'

  const value = text.trim()
  if (!value.startsWith('/')) return 'plain'
  if (isLikelyAbsolutePathInput(value)) return 'absolute-path'

  return 'slash-command'
}

export function isLikelyAbsolutePathInput(text) {
  if (typeof text !== 'string') return false

  const value = text.trim()
  if (!value.startsWith('/')) return false
  if (value === '/') return false

  if (KNOWN_ABSOLUTE_PATH_ROOTS.has(value)) return true

  const secondSlashIndex = value.indexOf('/', 1)
  if (secondSlashIndex === -1) return false

  const rootSegment = value.slice(0, secondSlashIndex)
  return KNOWN_ABSOLUTE_PATH_ROOTS.has(rootSegment)
}

export function shouldOpenSlashPanel({ text, slashCommandsSupported }) {
  if (!slashCommandsSupported || typeof text !== 'string') return false
  if (getLeadingSlashInputKind(text) !== 'slash-command') return false
  if (text.includes(' ')) return false

  return true
}

export function shouldBlockAsUnavailableSlash({ text, slashUnavailable }) {
  if (!slashUnavailable || typeof text !== 'string') return false
  if (getLeadingSlashInputKind(text) !== 'slash-command') return false

  return true
}

function isTokenBoundary(char) {
  return !char || /\s/.test(char)
}

function getTokenBounds(text, cursor) {
  const value = typeof text === 'string' ? text : ''
  const safeCursor = Math.max(0, Math.min(Number(cursor) || 0, value.length))
  let start = safeCursor
  let end = safeCursor

  while (start > 0 && !/\s/.test(value[start - 1])) {
    start -= 1
  }

  while (end < value.length && !/\s/.test(value[end])) {
    end += 1
  }

  return { start, end, token: value.slice(start, end) }
}

export function getCapabilityTriggerAtCursor({ text, cursor }) {
  if (typeof text !== 'string') return null

  const { start, end, token } = getTokenBounds(text, cursor)
  if (!token || token.length < 1) return null
  if (!isTokenBoundary(text[start - 1])) return null

  const marker = token[0]
  if (marker !== '@' && marker !== '/') return null
  if (marker === '/' && isLikelyAbsolutePathInput(token)) return null

  return {
    type: marker === '@' ? 'agent' : 'skill',
    marker,
    query: token.slice(1),
    start,
    end
  }
}

export function filterCapabilityItems(items, trigger) {
  if (!Array.isArray(items) || !trigger?.type) return []

  const query = typeof trigger.query === 'string'
    ? trigger.query.trim().toLowerCase()
    : ''

  return items
    .filter(item => item?.type === trigger.type)
    .filter(item => {
      if (!query) return true
      const haystack = [
        item.id,
        item.name,
        item.description
      ].map(value => String(value || '').toLowerCase())
      return haystack.some(value => value.includes(query))
    })
}

export function replaceCapabilityTrigger({ text, trigger, value }) {
  const source = typeof text === 'string' ? text : ''
  const replacement = typeof value === 'string' ? value : ''
  const start = Math.max(0, Math.min(trigger?.start ?? source.length, source.length))
  const end = Math.max(start, Math.min(trigger?.end ?? start, source.length))
  const before = source.slice(0, start)
  const after = source.slice(end)
  const needsSpaceAfter = after.length > 0 && !/^\s/.test(after)
  const insertText = `${replacement}${needsSpaceAfter ? ' ' : ''}`
  return {
    text: `${before}${insertText}${after}`,
    cursor: before.length + insertText.length
  }
}

export function removeCapabilityTrigger({ text, trigger }) {
  const source = typeof text === 'string' ? text : ''
  const start = Math.max(0, Math.min(trigger?.start ?? source.length, source.length))
  const end = Math.max(start, Math.min(trigger?.end ?? start, source.length))
  const before = source.slice(0, start).replace(/[ \t]+$/, '')
  const after = source.slice(end).replace(/^[ \t]+/, '')
  const joiner = before && after ? ' ' : ''

  return {
    text: `${before}${joiner}${after}`,
    cursor: before.length + joiner.length
  }
}

export function capabilityTokenFor(item) {
  if (!item?.id) return null
  const type = item.type === 'agent' ? 'agent' : 'skill'
  const token = {
    type,
    marker: type === 'agent' ? '@' : '/',
    id: item.id
  }
  if (item.name) token.name = item.name
  if (item.description) token.description = item.description
  return token
}

export function addSelectedCapabilityToken(tokens, item) {
  const nextToken = capabilityTokenFor(item)
  if (!nextToken) return Array.isArray(tokens) ? [...tokens] : []

  const existing = Array.isArray(tokens) ? tokens : []
  if (existing.some(token => token?.type === nextToken.type && token?.id === nextToken.id)) {
    return existing.map(token => capabilityTokenFor(token)).filter(Boolean)
  }

  return [...existing.map(token => capabilityTokenFor(token)).filter(Boolean), nextToken]
}

export function buildCapabilityMessageText(text, tokens) {
  const body = typeof text === 'string' ? text.trim() : ''
  const prefix = Array.isArray(tokens)
    ? tokens
      .map(token => capabilityTokenFor(token))
      .filter(Boolean)
      .map(token => `${token.marker}${token.id}`)
      .join(' ')
    : ''

  if (!prefix) return body
  return body ? `${prefix} ${body}` : prefix
}

export function extractCapabilityTokens(text) {
  if (typeof text !== 'string') return []

  const tokens = []
  const pattern = /(^|\s)([@/])([A-Za-z0-9_.:-]+)/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const marker = match[2]
    const id = match[3]
    if (marker === '/' && isLikelyAbsolutePathInput(`/${id}`)) continue
    tokens.push({
      type: marker === '@' ? 'agent' : 'skill',
      marker,
      id,
      token: `${marker}${id}`
    })
  }
  return tokens
}

export function isLeadingCapabilitySkillInvocation({ text, selectedTokens, capabilities } = {}) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value) return false

  return extractCapabilityTokens(value).some(token => {
    if (token.type !== 'skill' || !value.startsWith(token.token)) return false

    const selected = Array.isArray(selectedTokens) && selectedTokens.some(selectedToken => {
      const normalized = capabilityTokenFor(selectedToken)
      return normalized?.type === 'skill' && normalized.id === token.id
    })
    if (selected) return true

    return Array.isArray(capabilities) && capabilities.some(cap =>
      cap?.type === 'skill' && cap.id === token.id
    )
  })
}
