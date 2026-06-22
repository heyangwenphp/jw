const crypto = require('crypto')

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()[\]{}（）【】]/g, ' ')
    .replace(/[_\-–—/|,.;:，。；：、]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeFtsQuery(value) {
  return normalizeName(value)
    .split(' ')
    .filter(Boolean)
    .map(token => `"${token.replace(/"/g, '""')}"`)
    .join(' ')
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.filter(item => item !== null && item !== undefined).map(String)
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(item => item !== null && item !== undefined).map(String) : []
  } catch {
    return []
  }
}

function mergeJsonArrays(existingValue, nextValue) {
  const seen = new Set()
  const merged = []
  for (const value of [...parseJsonArray(existingValue), ...parseJsonArray(nextValue)]) {
    const key = normalizeName(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(value)
  }
  return merged
}

function serializeStableJson(value, omitUnsupported) {
  if (Array.isArray(value)) {
    return `[${value.map(item => {
      const serialized = serializeStableJson(item, false)
      return serialized === undefined ? 'null' : serialized
    }).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => {
      const serialized = serializeStableJson(value[key], true)
      return serialized === undefined ? undefined : `${JSON.stringify(key)}:${serialized}`
    }).filter(item => item !== undefined).join(',')}}`
  }
  const serialized = JSON.stringify(value)
  return serialized === undefined && !omitUnsupported ? 'null' : serialized
}

function stableJson(value) {
  return serializeStableJson(value, false)
}

function uniqueId(prefix, value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)
  return `${prefix}_${digest}`
}

module.exports = {
  normalizeName,
  normalizeFtsQuery,
  parseJsonArray,
  mergeJsonArrays,
  stableJson,
  uniqueId
}
