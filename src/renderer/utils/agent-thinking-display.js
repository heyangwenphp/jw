const hiddenResearchPattern = new RegExp([
  ['Source', 'Material Discovery'].join('-'),
  ['Tsinghua', 'Affiliated Discovery'].join('-')
].join('|'), 'i')

const NOISY_LINE_PATTERNS = [
  hiddenResearchPattern,
  /wechat_765\.sqlite/i,
  /\b\w[\w.-]*\.sqlite\b/i,
  /\bSQLite\b/i,
  /\bsqlite\b/i,
  /\bwechat_articles\b/i,
  /本地数据库.*(?:找到|检索|查询|读取|开始)/,
  /本地线索库.*(?:找到|检索|查询|读取|开始)/,
  /本地(?:清华)?公号库.*(?:检索|查询|读取|候选池)/,
  /本地库.*(?:检索|查询|读取|候选池)/,
  /(?:开始|正在|继续).*(?:本地数据库|本地线索库|本地库|本地(?:清华)?公号库).*(?:检索|查询|读取)/,
  /(?:数据库|线索库).*已找到/,
  /按照技能要求.*(?:检索|生成|输出|报告|候选池)/,
  /技能要求.*(?:检索|生成|输出|报告|候选池)/,
  /表结构.*(?:确认|检查|读取|完毕)/,
  /我看到问题了.*(?:查询|字段|错位|topic)/i,
  /(?:查询|导出).*字段.*错位/,
  /字段索引.*(?:问题|有问题|错位)/,
  /重新验证数据库字段顺序/,
  /从表结构中看/,
  /字段顺序是[:：]?/,
  /Topic字段.*(?:置信度|数值|topic名称)/i,
  /字段.*显示的是.*置信度/,
  /真正的\s*topic\s*名称/i,
  /(?:结构化字段|字段).*(?:为空|缺失|不完整)/,
  /\bcontent_text\b/i,
  /\bllm_extraction_json\b/i,
  /\banalysis_json\b/i,
  /\bsignal_record_json\b/i,
  /(?:查看|读取|获取|检查).*(?:关键文章|文章).*(?:详细内容|正文|字段)/,
  /(?:扩大搜索|联网验证|网络验证|公开搜索|targeted web searches)/i,
  /(?:发现了|找到|已有|收集到).*(?:有潜力|足够|项目数据|项目线索|本地项目数据)/,
  /(?:继续|进一步|深入).*(?:获取|查看|检索|查询|搜索|补充)/,
  /(?:还需要|需要).*(?:获取|查看|补充|检查|联网验证|搜索)/,
  /现在(?:查询|检索|查看|检查|开始|我已收集|我已经收集)/,
  /默认采用.*混合研究模式/,
  /混合研究模式/,
  /\bTaskOutput\b/i,
  /\btool_(use|result)\b/i,
  /\bcontent_block_(start|delta|stop)\b/i,
  /\bpuppeteer\b/i,
  /\bweasyprint\b/i,
  /\bprintToPDF\b/i,
  /\bchrome(?:\.exe)?\b/i,
  /\bnode\s+-v\b/i,
  /\bnpm\s+list\b/i,
  /\bwhere\s+chrome\b/i,
  /\bBash\b.*(?:检查|执行|运行|命令)/i,
  /\b(?:report|temp|output)\.html\b/i,
  /\bgen-pdf\.js\b/i,
  /\bmd_to_html[\w-]*\.py\b/i,
  /render-markdown-preview-pdf\.js.*(?:不存在|not\s+found|cannot\s+find|找不到)|(?:不存在|not\s+found|cannot\s+find|找不到).*render-markdown-preview-pdf\.js/i,
  /(?:这个|该|上述|固定命令中的)?脚本.*(?:当前目录|工作目录).*(?:不存在|找不到)|(?:当前目录|工作目录).*(?:不存在|找不到).*(?:这个|该|上述|固定命令中的)?脚本/i,
  /(?:重新创建|创建|编写).*(?:Python\s*)?脚本.*(?:Markdown|md).*(?:HTML|html)|(?:Markdown|md).*(?:HTML|html).*(?:重新创建|创建|编写).*(?:Python\s*)?脚本/i,
  /(?:HTML|html).*(?:重新生成|生成|验证|完成).*(?:PDF|pdf)|(?:PDF|pdf).*(?:HTML|html).*(?:重新生成|生成|验证|完成)/i,
  /(?:让我|我来|现在|接下来).*(?:验证|确认|检查).*(?:PDF|pdf).*(?:正确生成|是否生成|文件)/,
  /^生成文件[:：]?$/,
  /^Generated files[:：]?$/i
]

const GENERIC_THINKING_STATUS_LINE_PATTERNS = [
  /^正在整理项目线索[.。…]*$/,
  /^正在处理请求[.。…]*$/,
  /^正在检索并核验公开来源[.。…]*$/,
  /^正在核验清华系关联[.。…]*$/,
  /^正在整理报告正文[.。…]*$/
]

const EXECUTION_PLAN_LINE_PATTERNS = [
  /^The user wants\b/i,
  /^The user asked\b/i,
  /^The user is asking\b/i,
  /^I need to\b/i,
  /^I should\b/i,
  /^I will\b/i,
  /^I['’]?ll\b/i,
  /^Let me\b/i,
  /^Now I\b/i,
  /^Next[,]?\s+I\b/i,
  /^First[,]?\s+I\b/i,
  /^Good[,]?\s+/i,
  /^I(?:'|’)m seeing\b/i,
  /^I(?:'|’)ve (?:now )?(?:identified|found|gathered)\b/i,
  /^From the data\b/i,
  /^Key leads\b/i,
  /^This query\b/i,
  /^The output shows\b/i,
  /^Now I have\b/i,
  /^Let me (?:also )?(?:search|read|check|query|continue|focus|finalize|write|do)\b/i,
  /^Now let me\b/i,
  /^Actually\b/i,
  /^Wait\b/i,
  /^All of these\b/i,
  /^OriginFlow\b.*\bLead\b/i,
  /^贝塔无限\b.*\bLead\b/i,
  /^量坤科技\b.*\bLead\b/i,
  /^未磁科技\b.*\bLead\b/i,
  /^橡木果\b.*\bLead\b/i,
  /^赛富乐斯\b.*\bLead\b/i,
  /^手亿科技\b.*\bLead\b/i,
  /^万格智元\b.*\bLead\b/i,
  /^confirm_then_meet[:：]/i,
  /^meet[:：]/i,
  /^track[:：]/i,
  /^benchmark[:：]/i,
  /^Lead Score[:：]/i,
  /^清华关联[:：]/,
  /^报告标题[:：]/,
  /^三个项目[:：]/,
  /^评分[:：]/,
  /^建议动作[:：]\s*$/,
  /^现在编写\s*Markdown\s*报告[。.!！]*$/i,
  /^现在我有足够信息写报告了[。.!！]*$/,
  /^从搜索结果看[，,]?.*/,
  /^不过为了更好的质量[，,]?.*/,
  /^我倾向于.*/,
  /^让我再考虑一下[:：]?.*/,
  /^对于.+我需要更谨慎[。.!！]*$/,
  /^这几点足以建立清华关联[。.!！]*$/,
  /^按照排序规则[:：]?.*/,
  /^排序[:：]?.*/,
  /^Here(?:'|’)s my final ordering/i,
  /^Date is\b/i,
  /^主体类型[:：].*(?:优先|排序|order|Lead Score|建议动作)/i,
  /All are .*type.*sort/i,
  /sort(?:ing)? by .*Lead Score/i,
  /Lead Score.*(?:排序|sort|priority|优先)/i,
  /^第[一二三四五六七八九十\d]+步[:：].*(?:核验|检查|检索|查询|整理|输出|生成|排除|补充)/,
  /^\d+[\.\、]\s*(?:即时状态|报告骨架|项目线索|线索文档|剩余章节|写入|输出)[:：]/,
  /^(?:先|再)(?:核验|整理|检查|检索|查询|输出|生成|补充)/,
  /^(?:\u73b0\u5728)?(?:\u6211)?(?:\u4e3a[\u60a8\u4f60]|\u5c06\u4e3a[\u60a8\u4f60])?\u751f\u6210\s*PDF\s*\u62a5\u544a[。.!！]*$/,
  /^现在[，,]?\s*我需要.*(?:PDF|检查|尝试|创建|生成)/,
  /^现在[，,]?\s*我(?:先|来|要|需要|将)/,
  /^现在(?:查询|检索|查看|检查|开始|继续|我已|我已经)/,
  /^让我(?:先|再|继续)?.*(?:检查|尝试|创建|生成|搜索|执行|输出)/,
  /^让我(?:进一步|现在|继续)?.*(?:查看|获取|检查|检索|查询|搜索|整理|生成|输出|写)/,
  /^我(?:需要|应该|会|将|先|再|继续).*(?:检查|尝试|创建|生成|搜索|查询|读取|输出|整理|核验|补全|确保)/,
  /^我(?:需要|还需要|已经|已).*(?:查看|获取|检查|检索|查询|搜索|收集|整理|生成|输出|写|确保)/,
  /^接下来(?:我)?(?:需要|会|将|先|再)?.*(?:检查|尝试|创建|生成|搜索|查询|读取|输出|整理|核验|补全)/,
  /^我可以(?:用|先|尝试|创建|检查)/,
  /^实际上[，,]?\s*我也可以/,
  /^首先[，,]?\s*(?:写|创建|检查|执行)/,
  /^然后(?:检查|尝试|创建|执行|生成)/,
  /^好的[，,]?\s*我现在开始输出/,
  /检查环境中是否有可用的\s*PDF\s*生成工具/,
  /最简单的方法可能是/,
  /由于当前环境的限制/,
  /我将为您展示完整的投研报告/,
  /然后尝试生成\s*PDF/,
  /现在我需要尝试生成\s*PDF/,
  /报告正文.*(?:展示|输出).*(?:完毕|完成).*(?:检查|确认|尝试|生成).*(?:PDF|pdf)/,
  /(?:检查|确认).*(?:PDF|pdf).*(?:生成|转换|导出)?.*(?:工具|依赖|环境).*(?:安装|可用|成功)/,
  /(?:检查|确认).*(?:工具|依赖|环境).*(?:安装|可用|成功).*(?:PDF|pdf)/,
  /(?:尝试|准备|开始).*(?:生成|导出|转换).*(?:PDF|pdf)/
]

const REPORT_MARKER_PATTERNS = [
  /^#\s+.+(?:报告|研判)/m,
  /^#{1,3}\s*\d+[\.\、]\s*(?:投资意图拆解|项目线索|Alpha Signal|行动建议|缺失信息)/m,
  /:::field-card\b/,
  /(?:主体类型|名称|赛道|研究方向|机构\/实验室|【来源事实】|来源依据)[:：]/
]

const COMPACT_THINKING_MAX_LINES = 10

const trimEmptyEdges = (lines = []) => {
  let start = 0
  let end = lines.length
  while (start < end && !String(lines[start] || '').trim()) start += 1
  while (end > start && !String(lines[end - 1] || '').trim()) end -= 1
  return lines.slice(start, end)
}

const stripPreReportDraftPrelude = (text = '') => {
  const value = String(text || '')
  const headingMatch = value.match(/^#\s+.+(?:报告|研判).*$/m)
  if (!headingMatch || !headingMatch.index) return value

  const prelude = value.slice(0, headingMatch.index)
  if (!/(?:Lead Score|Alpha Score|我倾向于|让我再考虑|现在编写|报告标题|建议动作|清华关联)/.test(prelude)) {
    return value
  }

  return value.slice(headingMatch.index)
}

const isNoisyLine = (line = '') => {
  const normalized = String(line || '').trim()
  if (!normalized) return false
  return NOISY_LINE_PATTERNS.some(pattern => pattern.test(normalized))
}

const isExecutionPlanLine = (line = '') => {
  const normalized = String(line || '').trim()
  if (!normalized) return false
  if (/项目名称[:：].*一句话简介[:：].*标签[:：].*综合评分[:：]/.test(normalized)) return false
  return EXECUTION_PLAN_LINE_PATTERNS.some(pattern => pattern.test(normalized))
}

const isGenericThinkingStatusLine = (line = '') => {
  const normalized = String(line || '').trim()
  if (!normalized) return false
  return GENERIC_THINKING_STATUS_LINE_PATTERNS.some(pattern => pattern.test(normalized))
}

const isLikelyReportText = (text = '') => {
  const value = String(text || '')
  return REPORT_MARKER_PATTERNS.some(pattern => pattern.test(value))
}

const findFirstReportIndex = (text = '') => {
  const value = String(text || '')
  const indexes = REPORT_MARKER_PATTERNS
    .map((pattern) => {
      const match = value.match(pattern)
      return match?.index ?? -1
    })
    .filter(index => index >= 0)

  return indexes.length > 0 ? Math.min(...indexes) : -1
}

const findReportStartIndex = (text = '') => {
  const markerIndex = findFirstReportIndex(text)
  if (markerIndex < 0) return -1

  const prefix = String(text || '').slice(0, markerIndex)
  const headingMatch = [...prefix.matchAll(/^#\s+.+$/gm)].pop()
  return headingMatch?.index ?? markerIndex
}

export const sanitizeAgentVisibleText = (text = '') => {
  const lines = stripPreReportDraftPrelude(text).split(/\r?\n/)
  const cleaned = []
  let skippingFieldOrderList = false

  for (const line of lines) {
    const normalized = String(line || '').trim()
    if (skippingFieldOrderList) {
      if (!normalized) {
        skippingFieldOrderList = false
        continue
      }
      if (/^#\s+/.test(normalized)) {
        skippingFieldOrderList = false
      } else if (/^\d+[\.\、]\s*[A-Za-z_][\w_]*$/.test(normalized)) {
        continue
      } else {
        skippingFieldOrderList = false
      }
    }
    if (/从表结构中看|字段顺序是[:：]?/.test(normalized)) {
      skippingFieldOrderList = true
    }
    if (isNoisyLine(line) || isExecutionPlanLine(line)) continue
    cleaned.push(line
      .replace(/wechat_765\.sqlite/gi, '本地线索库')
      .replace(/\b\w[\w.-]*\.sqlite\b/gi, '本地线索库')
      .replace(/\bSQLite\b/g, '本地线索库')
      .replace(/\bsqlite\b/g, '本地线索库'))
  }

  return trimEmptyEdges(cleaned).join('\n')
}

export const sanitizeThinkingText = (text = '') => {
  const lines = sanitizeAgentVisibleText(text).split(/\r?\n/)
  return trimEmptyEdges(lines.filter(line => !isGenericThinkingStatusLine(line))).join('\n')
}

export const extractVisibleReportFromThinking = (text = '') => {
  const sanitized = sanitizeThinkingText(text)
  const startIndex = findFirstReportIndex(sanitized)
  if (startIndex < 0) return ''

  const candidate = sanitized.slice(startIndex)
  const lines = candidate.split(/\r?\n/)
  const kept = []

  for (const line of lines) {
    if (kept.length > 0 && isExecutionPlanLine(line)) break
    if (isNoisyLine(line)) continue
    kept.push(line)
  }

  const reportText = trimEmptyEdges(kept).join('\n')
  return isLikelyReportText(reportText) ? reportText : ''
}

export const summarizeThinkingStatus = (text = '') => {
  const value = sanitizeThinkingText(text)
  if (!value) return ''
  if (extractVisibleReportFromThinking(value)) return ''
  if (/报告|研判|项目线索|来源依据|投资意图|Alpha Signal|技能要求/.test(value)) return ''
  if (/PDF|pdf|导出|生成报告|文件路径/.test(value)) return ''
  if (/清华|校友|实验室|课题组|关联|背景|核验/.test(value)) return ''
  if (/卡片|团队|主体|项目|企业|个人/.test(value)) return ''
  if (/检索|搜索|公开来源|来源|URL|网页|论文|专利|新闻/.test(value)) return '正在检索并核验公开来源...'
  return ''
}

export const compactThinkingText = (text = '') => {
  const sanitized = sanitizeThinkingText(text)
  if (!sanitized) return ''

  const promotedReport = extractVisibleReportFromThinking(sanitized)
  const thinkingOnly = promotedReport
    ? sanitized.slice(0, findReportStartIndex(sanitized))
    : sanitized
  const thinkingText = trimEmptyEdges(thinkingOnly.split(/\r?\n/)).join('\n')
  if (!thinkingText) return ''

  const lines = trimEmptyEdges(thinkingText.split(/\r?\n/))
  const isVerbose = lines.length > COMPACT_THINKING_MAX_LINES
  if (!isVerbose) return thinkingText

  const clipped = lines.slice(0, COMPACT_THINKING_MAX_LINES).join('\n')
  return `${clipped}\n...`
}
