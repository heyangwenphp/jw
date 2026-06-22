const DAILY_LEAD_REPORT_MODE = 'lead-report'
const WEEKLY_REPORT_MODE = 'weekly-report'
const MONTHLY_REPORT_MODE = 'monthly-report'

const DAILY_LEAD_REPORT_PROMPT = '请根据前一天 00:00 至 23:59:59 期间的采集资料，按项目线索日报模板发现并核验清华系早期投资机会线索。优先复用项目卡片缓存，其次使用本地候选召回和已有结构化字段，筛选信号最强、清华系关联最明确、具备创业/成果转化/商业化早期迹象的高置信度早期投资信号。若已有候选 JSON 或结构化历史线索，直接基于候选生成完整报告，不要重新从头筛库。不要等待全部核验完成才开始输出；首屏直接输出报告正文中的最高置信项目完整字段块，再增量补齐后续项目。'
const WEEKLY_REPORT_PROMPT = '请根据上周六 00:00 至本周五 23:59:59 期间的采集资料，按项目线索周报模板筛选 1-2 个高置信度早期投资信号。优先复用项目卡片缓存，其次使用本地候选召回和已有结构化字段；若已有候选 JSON 或结构化历史线索，直接基于候选生成完整报告，不要重新从头筛库。仅围绕入选项目进行有限多源核验，重点核验清华系关联、主体身份、技术/产品方向、商业化迹象、融资或成果转化状态、来源 URL 与证据链强度。不要等待全部核验完成才开始输出；首屏直接输出报告正文中的最高置信项目完整字段块，再增量补齐后续内容。'
const MONTHLY_REPORT_PROMPT = '请根据上个月自然月的采集资料，按项目线索月报模板生成月度早期投资机会研判报告。报告内容需要包含：赛道热度变化、人才流动图谱、新涌现公众号清单，以及当月值得持续跟踪的清华系早期机会主体。请优先复用项目卡片缓存，其次使用本地候选召回和已有结构化字段；若已有候选 JSON 或结构化历史线索，直接基于候选生成完整报告，不要重新从头筛库。不要等待全部核验完成才开始输出，首屏直接输出报告正文中的最高置信项目完整字段块，再增量补齐后续内容。'

const REPORT_MODE_CONFIGS = {
  [DAILY_LEAD_REPORT_MODE]: {
    aliases: ['daily', 'daily-report', 'lead', 'lead-report'],
    reportMode: DAILY_LEAD_REPORT_MODE,
    title: '日报',
    prompt: DAILY_LEAD_REPORT_PROMPT,
    triggeredBy: 'daily-report-schedule'
  },
  [WEEKLY_REPORT_MODE]: {
    aliases: ['weekly', 'weekly-report'],
    reportMode: WEEKLY_REPORT_MODE,
    title: '周报',
    prompt: WEEKLY_REPORT_PROMPT,
    triggeredBy: 'weekly-report-schedule'
  },
  [MONTHLY_REPORT_MODE]: {
    aliases: ['monthly', 'monthly-report'],
    reportMode: MONTHLY_REPORT_MODE,
    title: '月报',
    prompt: MONTHLY_REPORT_PROMPT,
    triggeredBy: 'monthly-report-schedule'
  }
}

const REPORT_MODE_ALIASES = Object.values(REPORT_MODE_CONFIGS).reduce((aliases, config) => {
  for (const alias of config.aliases) aliases.set(alias, config.reportMode)
  return aliases
}, new Map())

function normalizeStandaloneReportMode(mode) {
  const normalized = String(mode || '').trim()
  if (!normalized) return DAILY_LEAD_REPORT_MODE
  return REPORT_MODE_ALIASES.get(normalized) || null
}

function getReportModeConfig(mode) {
  const reportMode = normalizeStandaloneReportMode(mode)
  if (!reportMode) {
    throw new Error(`Unsupported report mode: ${mode}`)
  }
  return REPORT_MODE_CONFIGS[reportMode]
}

module.exports = {
  DAILY_LEAD_REPORT_MODE,
  DAILY_LEAD_REPORT_PROMPT,
  MONTHLY_REPORT_MODE,
  MONTHLY_REPORT_PROMPT,
  REPORT_MODE_CONFIGS,
  WEEKLY_REPORT_MODE,
  WEEKLY_REPORT_PROMPT,
  getReportModeConfig,
  normalizeStandaloneReportMode
}
