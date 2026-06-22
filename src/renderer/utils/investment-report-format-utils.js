const INLINE_REPORT_FIELD_LABELS = [
  '项目名称',
  '一句话简介',
  '标签',
  '综合评分',
  '线索',
  '为什么主流程可能低估',
  '为什么主流可能低估',
  '为什么不是噪声',
  '最小验证动作',
  '是否需要人工背书',
  '动作类型',
  '目标',
  '描述',
  '预计工作量',
  '是否阻塞',
  '关联线索',
  '缺失信息',
  '优先级',
  '建议动作'
]

const REPORT_HEADER_FIELD_LABELS = ['项目名称', '一句话简介', '标签', '综合评分']

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const INLINE_REPORT_FIELD_PATTERN = new RegExp(`(^|[\\s,，;；。])(?:\\*\\*)?(${INLINE_REPORT_FIELD_LABELS.map(escapeRegExp).join('|')})(?:\\*\\*)?[:：]\\s*`, 'g')
const REPORT_HEADER_FIELD_PATTERN = new RegExp(`^(?:[-*]\\s+)?(?:\\*\\*)?(?:${REPORT_HEADER_FIELD_LABELS.map(escapeRegExp).join('|')})(?:\\*\\*)?[:：]`)

const splitInlineReportFieldLine = (line = '') => {
  const matches = []
  String(line || '').replace(INLINE_REPORT_FIELD_PATTERN, (match, prefix, label, offset) => {
    matches.push({
      index: offset + String(prefix || '').length,
      label
    })
    return match
  })

  for (let index = matches.length - 1; index > 0; index -= 1) {
    if (matches[index].label === '优先级' && matches[index - 1].label === '综合评分') {
      matches.splice(index, 1)
    }
  }

  if (matches.length < 2) return line

  const segments = []
  if (matches[0].index > 0) {
    segments.push(line.slice(0, matches[0].index).trim())
  }
  matches.forEach((match, index) => {
    segments.push(line.slice(match.index, matches[index + 1]?.index ?? line.length).trim())
  })

  return segments.filter(Boolean).join('  \n')
}

const isReportHeaderFieldLine = (line = '') => REPORT_HEADER_FIELD_PATTERN.test(String(line || '').trim())

const appendMarkdownHardBreak = (line = '') => {
  const value = String(line || '').replace(/\s+$/, '')
  return /(?: {2}|\\)$/.test(value) ? value : `${value}  `
}

export const normalizeInlineReportFieldParagraphs = (content = '') => {
  const lines = String(content || '').split(/\r?\n/)
  return lines.map((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || /^#{1,6}\s+/.test(trimmed) || /^JEDI_[A-Z_]+_\d+_TOKEN$/.test(trimmed)) {
      return line
    }

    const splitLine = splitInlineReportFieldLine(trimmed)
    if (splitLine === trimmed) {
      const nextLine = lines[index + 1] || ''
      if (isReportHeaderFieldLine(trimmed) && isReportHeaderFieldLine(nextLine)) {
        return appendMarkdownHardBreak(line)
      }
      return line
    }

    const leadingWhitespace = line.match(/^\s*/)?.[0] || ''
    return `${leadingWhitespace}${splitLine}`
  }).join('\n')
}
