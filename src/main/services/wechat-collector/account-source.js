const XLSX = require('xlsx')

function compact(value) {
  return String(value == null ? '' : value).trim()
}

function normalizeAccountRow(row, rowNumber = null) {
  return {
    rowNumber,
    name: compact(row['公众号名字']),
    description: compact(row['公众号介绍']),
    type: compact(row['类型']),
    wechatId: compact(row['微信号']),
    fakeid: compact(row.fakeid),
    tier: compact(row['最终口径']),
    raw: { ...row }
  }
}

function addCandidate(candidates, kind, value) {
  const normalized = compact(value)
  if (!normalized) return
  if (candidates.some(candidate => candidate.value === normalized)) return
  candidates.push({ kind, value: normalized })
}

function buildAccountCandidates(account, options = {}) {
  const includeFallbacks = options.includeFallbacks !== false
  const candidates = []
  addCandidate(candidates, 'wechat_id', account.wechatId)
  if (includeFallbacks) {
    addCandidate(candidates, 'fakeid', account.fakeid)
    addCandidate(candidates, 'display_name', account.name)
  }
  return candidates
}

function loadAccountSource(filePath, options = {}) {
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) throw new Error(`Account source has no worksheets: ${filePath}`)

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '' })
  return rows.map((row, index) => {
    const account = normalizeAccountRow(row, index + 1)
    return {
      ...account,
      candidates: buildAccountCandidates(account, options)
    }
  })
}

module.exports = {
  compact,
  normalizeAccountRow,
  buildAccountCandidates,
  loadAccountSource
}
