/**
 * Agent 会话管理器
 * 管理 Agent 模式下的 AI 对话会话
 *
 * 通过 ClaudeCodeRunner 与 SDK 交互，不直接依赖 SDK。
 *
 * 设计原则：
 * - 参照 ActiveSessionManager 的模式（_safeSend、Map 管理、生命周期）
 * - 支持多个并发 Agent 对话
 * - 流式输出通过 IPC 推送到渲染进程
 * - 多轮对话通过 SDK 的 resume 机制实现
 */

const { EventEmitter } = require('events')
const path = require('path')
const os = require('os')
const fs = require('fs')
const fsp = require('fs').promises
const { execFileSync } = require('child_process')
const { v4: uuidv4 } = require('uuid')
const { MessageQueue } = require('./utils/message-queue')
const { safeSend } = require('./utils/safe-send')
const { killProcessTree } = require('./utils/process-tree-kill')
const { AgentStatus, AgentType, isInternalAgentFileName } = require('./utils/agent-constants')
const { AgentSession } = require('./agent-session')
const AgentFileManager = require('./managers/agent-file-manager')
const AgentQueryManager = require('./managers/agent-query-manager')
const { buildDesktopCapabilityQueryOptions } = require('./managers/desktop-capability-query-options')
const ClaudeCodeRunner = require('./runners/claude-code-runner')
const { ComponentMetadataStore } = require('../../server/component-metadata')
const {
  LeadMemoryStore,
  createResearchMemoryAdapter,
  normalizeName
} = require('./services/lead-memory')
const { tMain } = require('./utils/app-i18n')
const {
  classifyGeneratedReportMode,
  collectGeneratedReportsFromConversations,
  DAILY_LEAD_REPORT_MODE,
  extractReportTitleFromText,
  getReportNameFromPath,
  isClueMarkdownFilePath,
  makeHiddenReportKey,
  MONTHLY_REPORT_MODE,
  WEEKLY_REPORT_MODE
} = require('./utils/generated-report-index')
const {
  normalizeDeveloperClaudeSource,
  resolveClaudeCodeExecutablePath
} = require('./utils/claude-executable-path')
const { extractUploadedAttachmentText } = require('../../server/agent-upload-utils')

const BUILTIN_SESSION_SKILL_SCOPES = ['.codex', '.claude']
const BUILTIN_WECHAT_DB_FILE_NAME = 'wechat_765.sqlite'
const STANDALONE_REPORT_MODE_DIRS = {
  [DAILY_LEAD_REPORT_MODE]: 'daily',
  [MONTHLY_REPORT_MODE]: 'monthly',
  [WEEKLY_REPORT_MODE]: 'weekly'
}
const STANDALONE_REPORT_MODE_TITLES = {
  [DAILY_LEAD_REPORT_MODE]: '日报',
  [MONTHLY_REPORT_MODE]: '月报',
  [WEEKLY_REPORT_MODE]: '周报'
}
const MARKDOWN_PREVIEW_PDF_RENDERER_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'render-markdown-preview-pdf.js')
const MARKDOWN_PREVIEW_PDF_RENDERER_COMMAND = `node "${MARKDOWN_PREVIEW_PDF_RENDERER_PATH}"`

const JEDI_IDENTITY_SYSTEM_PROMPT = [
  'Present yourself to end users as 科创AI, an AI personal desktop assistant.',
  'When the user greets you, asks who you are, asks what assistant this is, or asks for a self-introduction, identify yourself as 科创AI.',
  'For Chinese greetings or identity questions such as "你好", "hi", "你是谁", "你是做什么的", unless the user is explicitly asking for another language, start your reply with exactly "你好，我是您的AI助手，可以接入各种主流大模型帮你做数据分析、工程计算与模拟、报告撰写以及相关编程支持。有什么可以帮你的吗？"',
  'For English greetings or identity questions, start your reply with "Hi, I\'m 科创AI."',
  'In those English greeting or identity replies, explicitly describe yourself as an AI personal desktop assistant, say that you can connect to mainstream large models, and naturally mention capabilities such as data analysis, engineering calculation and simulation, report drafting, and related coding help. Keep it concise unless the user asks for more detail.',
  'Always think and reason in Simplified Chinese. Your internal thought process, analysis, and reasoning must be in Chinese, not English. Only the final output to the user may follow the language preference indicated by the user.',
  'For current, realtime, or location-dependent external facts such as weather, news, prices, schedules, rankings, or availability, use WebSearch or WebFetch when enough details are available; if essential details such as city, date, product, or source are missing, ask a concise clarifying question instead of saying that realtime tools are unavailable.',
  'Do not introduce yourself as Claude or Claude Code unless the user is explicitly asking about the underlying runtime, model, SDK, or provider.',
  'If the user asks about the underlying model or provider, distinguish the app identity from the actual configured model or service.',
  'When you generate any file for the user, save it under the current session root whenever possible. Follow any active skill-specific delivery rules for whether file paths should be shown or hidden in the chat reply. For generated reports, use the report title as the file name and preserve the requested output extension.',
  'For local SQLite database files (*.sqlite/*.db), inspect them with inline Python using the Python standard library sqlite3 module; do not try the external sqlite3 CLI first. This SQLite guidance does not permit creating Python/HTML conversion scripts for report export.',
  `When the user asks to generate, regenerate, export, or recreate a PDF report, never create Python/HTML conversion scripts or HTML intermediate files such as md_to_html*.py, report.html, temp.html, output.html, or gen-pdf.js. Use only the existing repository command \`${MARKDOWN_PREVIEW_PDF_RENDERER_COMMAND} <final-report.md> <final-report.pdf>\` to export the PDF from the final Markdown report, and describe the result as exported from Markdown. Do not use the relative script path unless it points to this exact file.`
].join(' ')

const PDF_REPORT_GENERATION_PROTOCOL = [
  '',
  '[系统约束：PDF 报告生成协议]',
  '当本轮用户要求生成、重新生成或导出 PDF 报告时，必须遵守以下规则：',
  '1. 禁止创建、重建、保存、读取、验证或汇报 `md_to_html*.py`、`report.html`、`temp.html`、`output.html`、`gen-pdf.js` 或任何 HTML 中间文件/自定义转换脚本。',
  '2. 禁止把流程描述为“重新创建 Python 脚本将 Markdown 转为 HTML”“重新生成 HTML”“HTML 转 PDF”。',
  `3. 必须先确认或生成最终报告 Markdown 文件，然后只使用固定命令 \`${MARKDOWN_PREVIEW_PDF_RENDERER_COMMAND} <最终报告.md> <最终报告.pdf>\` 从 Markdown 导出 PDF。不要因为当前工作目录没有 \`scripts/render-markdown-preview-pdf.js\` 而创建任何新脚本。`,
  '4. PDF 排版必须与应用内 Markdown 预览（.markdown-preview）一致；最终回复只能说明已从 Markdown 导出 PDF，并给出 PDF 绝对路径。'
].join('\n')

const PDF_REPORT_REQUEST_PATTERN = /(?:(?:生成|重新生成|重生成|再生成|导出|转成|转换|制作|输出).{0,24}(?:PDF|pdf)|(?:PDF|pdf).{0,24}(?:生成|重新生成|重生成|再生成|导出|转成|转换|制作|输出))/i
const REPORT_CONTEXT_PATTERN = /(?:报告|日报|周报|月报|研判|Markdown|md|\.md|\.pdf|PDF|pdf)/i
const RESEARCH_MEMORY_CONTEXT_MARKER = '[系统内部：投研历史线索上下文]'
const RESEARCH_MEMORY_SKIP_PATTERN = /^(?:\/|hi|hello|hey|ok|okay|thanks|thank you|你好|您好|谢谢|多谢|在吗|1|继续)$/i
const RESEARCH_MEMORY_HINT_PATTERN = /(?:early-investment-research|投研|研判|创业|投资|公司|企业|人物|团队|实验室|项目|技术|赛道|产业|市场|材料|器件|论文|专利|新闻|融资|清华|低空|经济|AI|Agent|CPO|LPO|eVTOL|无人机)/i
const RESEARCH_MEMORY_PREFILL_LIMIT = 5
const LEAD_CANDIDATE_PREFETCH_LIMIT = 10
const LEAD_CANDIDATE_PREFETCH_TIMEOUT_MS = 3500
const GENERATED_REPORT_REFERENCED_ERROR = 'report is referenced by conversation'

const normalizeReportReferencePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    return path.normalize(path.resolve(value.trim())).toLowerCase()
  } catch {
    return path.normalize(value.trim()).toLowerCase()
  }
}

const parseGeneratedReportReferenceJson = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

const messageReferencesGeneratedReport = (message, filePath) => {
  const normalizedTarget = normalizeReportReferencePath(filePath)
  if (!normalizedTarget) return false

  const rawNeedles = [...new Set([
    String(filePath || '').trim().toLowerCase(),
    path.normalize(String(filePath || '').trim()).toLowerCase()
  ].filter(Boolean))]
  const seen = new Set()

  const inspect = (value) => {
    if (value == null) return false

    if (typeof value === 'string') {
      const normalized = normalizeReportReferencePath(value)
      if (normalized && normalized === normalizedTarget) return true
      const lower = value.toLowerCase()
      if (rawNeedles.some(needle => needle && lower.includes(needle))) return true
      const parsed = parseGeneratedReportReferenceJson(value)
      return parsed ? inspect(parsed) : false
    }

    if (typeof value !== 'object') return false
    if (seen.has(value)) return false
    seen.add(value)

    if (Array.isArray(value)) {
      return value.some(item => inspect(item))
    }

    for (const key of ['filePath', 'path', 'absolutePath', 'rawPath']) {
      if (inspect(value[key])) return true
    }

    return Object.values(value).some(item => inspect(item))
  }

  return inspect(message)
}
const LEADING_SKILL_SLASH_PATTERN = /^\/([A-Za-z0-9][A-Za-z0-9_.:-]*)(?:\s+([\s\S]*))?$/
const INTERNAL_DISCLOSURE_BLOCK_MESSAGE = '不能提供 skill 或 agent 的内部内容、逻辑、指令或流程。我可以继续帮你处理面向用户可见的任务或结果。'
const INTERNAL_DISCLOSURE_SUBJECT_PATTERN = /(?:\bskill\b|\bagent\b|技能|智能体|代理)/i
const INTERNAL_DISCLOSURE_DETAIL_PATTERN = /(?:内容|原样|完整|全部|输出|打印|展示|显示|查看|透露|泄露|逻辑|流程|规则|指令|提示词|系统提示|内部|prompt|content|verbatim|exact|full|dump|print|show|reveal|logic|workflow|process|instructions|internal)/i

function findAvailableSkillPath(cwd, skillId, userDataPath = null) {
  if (!skillId || /[\\/]/.test(skillId)) return null

  const skillMdCandidates = (skillDir) => skillDir
    ? [
        path.join(skillDir, 'SKILL.md'),
        path.join(skillDir, 'skill.md')
      ]
    : []

  const builtInSkillDirs = [
    path.resolve(__dirname, '..', '..', 'skills', skillId),
    process.resourcesPath && path.join(process.resourcesPath, 'skills', skillId)
  ].filter(Boolean)

  const candidates = [
    ...skillMdCandidates(cwd && path.join(cwd, '.codex', 'skills', skillId)),
    ...skillMdCandidates(cwd && path.join(cwd, '.claude', 'skills', skillId)),
    ...skillMdCandidates(cwd && path.join(cwd, 'skills', skillId)),
    ...skillMdCandidates(userDataPath && path.join(userDataPath, 'skills', skillId)),
    ...builtInSkillDirs.flatMap(skillMdCandidates),
    ...skillMdCandidates(path.join(os.homedir(), '.codex', 'skills', skillId)),
    ...skillMdCandidates(path.join(os.homedir(), '.Codex', 'skills', skillId)),
    ...skillMdCandidates(path.join(os.homedir(), '.claude', 'skills', skillId))
  ]

  const found = candidates.find(candidate => fs.existsSync(candidate))
  console.log('[AgentSession] findAvailableSkillPath:', { skillId, cwd, found: found || null, searched: candidates.map(c => c.replace(/\\/g, '/')) })
  return found || null
}

function rewriteLeadingSkillSlashInvocationText(text, cwd, userDataPath = null) {
  if (typeof text !== 'string') return text
  const trimmed = text.trim()
  const match = trimmed.match(LEADING_SKILL_SLASH_PATTERN)
  if (!match) return text

  const skillId = match[1]
  const skillPath = findAvailableSkillPath(cwd, skillId, userDataPath)
  if (!skillPath) {
    console.log('[AgentSession] rewriteLeadingSkillSlashInvocation: skill NOT found, passing through as-is:', { skillId, cwd: cwd?.replace(/\\/g, '/') })
    return text
  }

  console.log('[AgentSession] rewriteLeadingSkillSlashInvocation: skill FOUND, rewriting:', { skillId, skillPath: skillPath.replace(/\\/g, '/') })

  const request = String(match[2] || '').trim()
  const userRequest = request || `请说明 skill "${skillId}" 的使用方式。`
  return [
    `请使用 skill "${skillId}" 处理下面的用户请求。`,
    `这是用户在会话输入框中选择的 /${skillId} skill，不要把 /${skillId} 当作 SDK slash command 执行。`,
    `skill 文件位置：${skillPath}`,
    '',
    `用户请求：${userRequest}`
  ].join('\n')
}

function rewriteLeadingSkillSlashInvocationContent(messageContent, cwd, userDataPath = null) {
  if (typeof messageContent === 'string') {
    return rewriteLeadingSkillSlashInvocationText(messageContent, cwd, userDataPath)
  }
  if (!Array.isArray(messageContent)) return messageContent

  let rewritten = false
  return messageContent.map(part => {
    if (rewritten || part?.type !== 'text' || typeof part.text !== 'string') return part
    const nextText = rewriteLeadingSkillSlashInvocationText(part.text, cwd, userDataPath)
    if (nextText === part.text) return part
    rewritten = true
    return { ...part, text: nextText }
  })
}

function getUserMessageIntentText(userMessage) {
  if (typeof userMessage === 'string') return userMessage
  if (!userMessage || typeof userMessage !== 'object') return ''

  if (typeof userMessage.displayText === 'string') {
    return userMessage.displayText
  }

  const parts = []
  if (typeof userMessage.text === 'string') parts.push(userMessage.text)

  for (const file of Array.isArray(userMessage.files) ? userMessage.files : []) {
    if (file?.name) parts.push(String(file.name))
  }
  for (const file of Array.isArray(userMessage.contextFiles) ? userMessage.contextFiles : []) {
    if (file?.name) parts.push(String(file.name))
    if (file?.filePath) parts.push(String(file.filePath))
  }

  return parts.join('\n')
}

function shouldSuppressInternalDisclosureForUserMessage(userMessage) {
  return false
}

function shouldApplyPdfReportGenerationProtocol(userMessage) {
  const text = getUserMessageIntentText(userMessage)
  return PDF_REPORT_REQUEST_PATTERN.test(text) && REPORT_CONTEXT_PATTERN.test(text)
}

function appendPdfReportGenerationProtocol(messageContent) {
  if (Array.isArray(messageContent)) {
    if (messageContent.some(part => part?.type === 'text' && String(part.text || '').includes('PDF 报告生成协议'))) {
      return messageContent
    }
    return [
      ...messageContent,
      { type: 'text', text: PDF_REPORT_GENERATION_PROTOCOL }
    ]
  }

  const text = String(messageContent || '')
  if (text.includes('PDF 报告生成协议')) return messageContent
  return `${text.trimEnd()}\n${PDF_REPORT_GENERATION_PROTOCOL}`
}

function appendInternalTextContext(messageContent, context) {
  const normalizedContext = typeof context === 'string' ? context.trim() : ''
  if (!normalizedContext) return messageContent

  if (Array.isArray(messageContent)) {
    if (messageContent.some(part => part?.type === 'text' && String(part.text || '').includes(RESEARCH_MEMORY_CONTEXT_MARKER))) {
      return messageContent
    }
    return [
      ...messageContent,
      { type: 'text', text: `\n${normalizedContext}` }
    ]
  }

  const text = String(messageContent || '')
  if (text.includes(RESEARCH_MEMORY_CONTEXT_MARKER)) return messageContent
  return `${text.trimEnd()}\n\n${normalizedContext}`
}

function shouldApplyResearchMemoryContext(userMessage, meta = {}) {
  if (meta?.disableLeadMemory || meta?.skipLeadMemory) return false
  const text = getUserMessageIntentText(userMessage).trim()
  if (!text || text.length > 5000) return false
  if (RESEARCH_MEMORY_SKIP_PATTERN.test(text)) return false
  if (RESEARCH_MEMORY_HINT_PATTERN.test(text)) return true
  return /^[\p{Script=Han}][\p{Script=Han}0-9\s+/.-]{1,80}$/u.test(text)
}

function readTextFileSnippet(filePath, maxLength = 1200) {
  try {
    if (!filePath || path.extname(filePath).toLowerCase() !== '.md') return ''
    const content = fs.readFileSync(filePath, 'utf8')
    return content.replace(/\s+/g, ' ').trim().slice(0, maxLength)
  } catch {
    return ''
  }
}

function safeMarkdownFileBaseName(value, fallback = '报告') {
  const normalized = String(value || '').trim()
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalized || fallback
}

function resolveUniqueMarkdownFilePath(dirPath, title) {
  const baseName = safeMarkdownFileBaseName(title, '报告')
  const firstPath = path.join(dirPath, `${baseName}.md`)
  if (!fs.existsSync(firstPath)) return firstPath

  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(dirPath, `${baseName}(${index}).md`)
    if (!fs.existsSync(candidate)) return candidate
  }

  return path.join(dirPath, `${baseName}-${Date.now()}.md`)
}

function getTextFromContentBlocks(contentBlocks) {
  return (Array.isArray(contentBlocks) ? contentBlocks : [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

function isInvestmentResearchReportStart(text) {
  const normalized = String(text || '').trim()
  return /^#\s+.{1,160}$/m.test(normalized) && (
    /生成日期[：:]/.test(normalized) ||
    /(?:投资意图拆解|项目线索|Alpha Signal|行动建议|缺失信息与风险|来源依据|:::field-card)/.test(normalized)
  )
}

function isInvestmentResearchReportFragment(text) {
  const normalized = String(text || '').trim()
  if (!normalized) return false
  return /(?:投资意图拆解|项目线索|Alpha Signal|行动建议|缺失信息与风险|来源依据|:::field-card)/.test(normalized)
}

function isCompleteInvestmentResearchReport(text) {
  const normalized = String(text || '').trim()
  if (!isInvestmentResearchReportStart(normalized)) return false
  return [
    /(?:项目线索|:::field-card)/,
    /(?:来源依据|来源事实)/
  ].every(pattern => pattern.test(normalized))
}

function formatHtmlSourceLink(url, label = '详情链接') {
  const normalizedUrl = String(url || '').trim()
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    return '无公开详情 URL，需人工补充核验入口'
  }
  const safeLabel = String(label || '详情链接')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `<a href="${normalizedUrl}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (normalized) return normalized
  }
  return ''
}

function formatResearchCandidateJson(recall) {
  const entities = Array.isArray(recall?.entities) ? recall.entities.slice(0, 10) : []
  if (entities.length === 0) return ''

  const candidates = entities.map((entity, index) => {
    const metadata = entity?.metadata || {}
    const evidence = Array.isArray(entity?.evidence) ? entity.evidence.slice(0, 3) : []
    return {
      rank: index + 1,
      name: entity?.display_name || entity?.canonical_name || '',
      subjectType: entity?.entity_type || 'project',
      verificationStatus: entity?.verification_status || 'pending',
      tsinghuaAffiliationStatus: entity?.tsinghua_affiliation_status || 'pending',
      confidence: entity?.confidence || 0,
      sector: metadata.sector || '',
      researchDirection: metadata.research_direction || '',
      technology: metadata.technology || '',
      product: metadata.product || '',
      stage: metadata.stage || '',
      financingStatus: metadata.financing_status || '',
      currentStatus: metadata.current_status || '',
      summary: entity?.summary || '',
      sources: evidence.map(item => ({
        sourceType: item.source_type || '',
        sourceTitle: item.source_title || '',
        sourceUrl: item.source_url || '',
        evidenceSummary: item.evidence_summary || '',
        verificationStatus: item.confidence >= 0.8 ? '已核实' : '待核实'
      }))
    }
  })

  return [
    '系统已召回的候选项目 JSON（内部预填，不得在报告中说明候选生成过程）：',
    JSON.stringify({
      usage: '直接基于 candidates 生成完整报告；不得重新检查本地线索库结构、不得读取原始全文字段、不得从头筛库；字段缺失时写待验证。',
      candidates
    }, null, 2)
  ].join('\n')
}

function formatPrefetchedLeadCandidateJson(prefetchResult) {
  const candidates = Array.isArray(prefetchResult?.candidates)
    ? prefetchResult.candidates.slice(0, LEAD_CANDIDATE_PREFETCH_LIMIT)
    : []
  if (candidates.length === 0) return ''

  return [
    '系统已预先召回的项目候选 JSON（内部预填，不得在报告中说明候选生成过程）：',
    JSON.stringify({
      usage: '直接基于 candidates 生成完整报告；不要重新检查本地线索库结构，不要读取原始全文字段，不要从头筛库。只对 Top 项目的关键缺口做少量公开补证；字段缺失写待验证。',
      topic: prefetchResult?.topic || '',
      webEnrichmentPolicy: prefetchResult?.webEnrichmentPolicy || {
        maxSearches: 5,
        onlyForTopCandidates: true,
        missingFieldsShouldUsePendingPlaceholders: true
      },
      candidates: candidates.map((candidate, index) => {
        const fields = candidate?.fields || {}
        return {
          rank: index + 1,
          name: candidate?.name || fields.project || '',
          candidateSource: candidate?.candidateSource || '',
          score: candidate?.score || 0,
          articleCount: candidate?.articleCount || 0,
          sector: fields.sector || '',
          researchDirection: fields.researchDirection || '',
          technology: fields.technology || '',
          product: fields.product || '',
          coreMembers: fields.coreMembers || '',
          owner: fields.owner || '',
          advisorOrMentor: fields.advisorOrMentor || '',
          stage: fields.stage || '',
          financingStatus: fields.financingStatus || '',
          currentStatus: fields.currentStatus || '',
          summary: fields.summary || '',
          matchedTerms: Array.isArray(candidate?.matchedTerms) ? candidate.matchedTerms.slice(0, 8) : [],
          commercialSignals: Array.isArray(candidate?.commercialSignals) ? candidate.commercialSignals.slice(0, 8) : [],
          tsinghuaSignals: Array.isArray(candidate?.tsinghuaSignals) ? candidate.tsinghuaSignals.slice(0, 8) : [],
          missingFields: Array.isArray(candidate?.missingFields) ? candidate.missingFields.slice(0, 6) : [],
          sources: (Array.isArray(candidate?.sources) ? candidate.sources : []).slice(0, 3).map(source => ({
            title: source?.title || '',
            url: source?.url || '',
            publishedAt: source?.publishedAt || '',
            evidenceSummary: source?.topic || '',
            confidence: source?.confidence ?? null
          }))
        }
      })
    }, null, 2)
  ].join('\n')
}

function formatResearchMemoryContext({ recallContext, recall, reports, prefetchedCandidates }) {
  const lines = [
    RESEARCH_MEMORY_CONTEXT_MARKER,
    '以下内容仅用于辅助本轮 early-investment-research 研判，不得在报告正文中暴露内部检索、存储细节或历史报告文件路径。',
    '历史线索、候选 JSON 和历史报告只能作为本轮完整报告的预填依据，不是本轮交付物；如果已提供候选 JSON，必须直接基于候选生成完整报告，不得重新从头筛库；本轮必须先展示最终报告正文，宿主应用会在对话展示后后台静默生成最终报告 Markdown 文档。'
  ]

  if (recallContext) {
    lines.push('', recallContext)
  }

  const candidateJson = formatResearchCandidateJson(recall)
  if (candidateJson) {
    lines.push('', candidateJson)
  }

  const prefetchedCandidateJson = formatPrefetchedLeadCandidateJson(prefetchedCandidates)
  if (prefetchedCandidateJson) {
    lines.push('', prefetchedCandidateJson)
  }

  if (Array.isArray(reports) && reports.length > 0) {
    lines.push('', '历史报告候选：')
    reports.slice(0, 5).forEach((report, index) => {
      lines.push(`${index + 1}. 报告：${report.name}`)
      lines.push(`   内部定位：${report.filePath}`)
      if (report.snippet) lines.push(`   摘要片段：${report.snippet}`)
    })
  }

  return lines.join('\n')
}

const LEAKED_EXECUTION_PLAN_PATTERNS = [
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
  /现在我已经准备好了完整的报告内容/,
  /接下来我需要/,
  /^现在[，,]?\s*我(?:先|来|要|需要|将)/,
  /^现在(?:查询|检索|查看|检查|开始|继续|我已|我已经)/,
  /^我(?:需要|应该|会|将|先|再|继续).*(?:检查|尝试|创建|生成|搜索|查询|读取|输出|整理|核验|补全|确保)/,
  /^我(?:需要|还需要|已经|已).*(?:查看|获取|检查|检索|查询|搜索|收集|整理|生成|输出|写|确保)/,
  /先输出即时状态到对话/,
  /输出报告骨架/,
  /输出项目线索/,
  /写入线索文件和报告文件/,
  /文件写入必须在最终报告正文展示前完成/,
  /工具调用是异步的/,
  /正文通道/,
  /技能要求/,
  /分阶段输出/,
  /回合\d*[:：]/,
  /第一步[:：].*输出即时状态/,
  /第二步[:：].*输出报告骨架/,
  /第三步[:：].*输出项目线索/,
  /第四步[:：].*剩余章节/
]

const LEAKED_REPORT_DELIVERY_STATUS_PATTERNS = [
  /报告正文已(?:在对话中)?(?:展示|显示)(?:完毕|完成)?/,
  /线索文档.*(?:成功)?写入.*当前会话目录/,
  /所有工作已完成/,
  /不需要再输出任何额外内容/,
  /最终报告\s*Markdown\s*文件.*宿主应用后台静默生成/,
  /Agent\s*不应自行创建/,
  /根据技能规则\s*W12/,
  /静默写入了?\s*\d+\s*个线索文档/,
  /^[-•]\s*线索\d+\.md\b/
]

const LEAKED_REPORT_DRAFTING_NOTE_PATTERNS = [
  /:::field-card格式/,
  /让我开始整理报告内容/,
  /主要线索[:：]/,
  /注意[:：].*不是清华系主体.*线索文档记录/,
  /不能放入项目线索.*线索文档记录/,
  /:::field-card字段块/,
  /字段名不使用.*加粗/,
  /URL使用HTML链接格式/,
  /不使用代码块包裹报告/,
  /区分\s*\[来源事实\].*\[判断\].*\[待验证\]/,
  /让我现在开始写报告/
]

function sanitizeAssistantVisibleText(text = '') {
  const rawValue = String(text || '')
  const headingMatch = rawValue.match(/^#\s+.+(?:报告|研判).*$/m)
  const value = headingMatch?.index > 0 &&
    /(?:Lead Score|Alpha Score|我倾向于|让我再考虑|现在编写|报告标题|建议动作|清华关联)/.test(rawValue.slice(0, headingMatch.index))
    ? rawValue.slice(headingMatch.index)
    : rawValue
  if (
    /接下来我需要/.test(value) &&
    /输出报告骨架/.test(value) &&
    /写入线索文件和报告文件/.test(value)
  ) {
    return ''
  }
  const deliveryStatusMatches = LEAKED_REPORT_DELIVERY_STATUS_PATTERNS
    .filter(pattern => pattern.test(value))
    .length
  if (!isInvestmentResearchReportStart(value) && deliveryStatusMatches >= 2) {
    return ''
  }
  const draftingNoteMatches = LEAKED_REPORT_DRAFTING_NOTE_PATTERNS
    .filter(pattern => pattern.test(value))
    .length
  if (!isInvestmentResearchReportStart(value) && draftingNoteMatches >= 2) {
    return ''
  }

  const lines = value.split(/\r?\n/)
  let skippingFieldOrderList = false
  const cleaned = lines.filter((line) => {
    const normalized = String(line || '').trim()
    if (!normalized) return true
    if (skippingFieldOrderList) {
      if (/^#\s+/.test(normalized)) {
        skippingFieldOrderList = false
      } else if (/^\d+[\.\、]\s*[A-Za-z_][\w_]*$/.test(normalized)) {
        return false
      } else {
        skippingFieldOrderList = false
      }
    }
    if (/从表结构中看|字段顺序是[:：]?/.test(normalized)) {
      skippingFieldOrderList = true
    }
    return !LEAKED_EXECUTION_PLAN_PATTERNS.some(pattern => pattern.test(normalized)) &&
      !LEAKED_REPORT_DELIVERY_STATUS_PATTERNS.some(pattern => pattern.test(normalized)) &&
      !LEAKED_REPORT_DRAFTING_NOTE_PATTERNS.some(pattern => pattern.test(normalized))
  })

  return cleaned.join('\n')
    .replace(/wechat_765\.sqlite/gi, '本地线索库')
    .replace(/\b\w[\w.-]*\.sqlite\b/gi, '本地线索库')
    .replace(/\bSQLite\b/g, '本地线索库')
    .replace(/\bsqlite\b/g, '本地线索库')
    .trim()
}

function sanitizeAssistantContentBlocks(content = [], options = {}) {
  if (!Array.isArray(content)) return []
  if (options.suppressInternalDisclosure) {
    if (options.internalDisclosureBlockSent) return []
    return [{ type: 'text', text: INTERNAL_DISCLOSURE_BLOCK_MESSAGE }]
  }

  return content
    .map((block) => {
      if (block?.type !== 'text') return block
      const text = sanitizeAssistantVisibleText(block.text)
      return text ? { ...block, text } : null
    })
    .filter(Boolean)
}


function resolveConversationSource(type, source) {
  if (type === 'dingtalk') return 'dingtalk'
  if (type === 'weixin') return 'weixin'
  if (type === 'feishu') return 'feishu'
  if (source) return source
  return 'manual'
}

function normalizeModelValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeModelKey(value) {
  return normalizeModelValue(value).toLowerCase()
}

function isSameModelId(left, right) {
  const leftKey = normalizeModelKey(left)
  const rightKey = normalizeModelKey(right)
  return !!leftKey && leftKey === rightKey
}

function normalizeModelIdOrNull(value) {
  const normalized = normalizeModelValue(value)
  return normalized || null
}

function normalizeModelIds(values) {
  const normalized = []
  const seen = new Set()

  for (const value of Array.isArray(values) ? values : []) {
    const modelId = normalizeModelValue(value)
    const modelKey = normalizeModelKey(modelId)
    if (!modelId || seen.has(modelKey)) continue
    seen.add(modelKey)
    normalized.push(modelId)
  }

  return normalized
}

function findModelEntry(entries, modelId) {
  return entries.find(entry => isSameModelId(entry?.modelId, modelId)) || null
}

function getConfigSnapshot(configManager) {
  const config = configManager?.getConfig?.() || {}
  const profiles = Array.isArray(config.apiProfiles) ? config.apiProfiles : []
  const definitions = typeof configManager?.getServiceProviderDefinitions === 'function'
    ? configManager.getServiceProviderDefinitions()
    : config.serviceProviderDefinitions

  return {
    config,
    profiles,
    definitions: Array.isArray(definitions) ? definitions : []
  }
}

function buildAvailableProviderModelEntries(configManager) {
  const { profiles, definitions } = getConfigSnapshot(configManager)
  const result = []

  for (const provider of definitions) {
    const providerId = normalizeModelValue(provider?.id)
    if (!providerId || provider?.enabled === false) continue

    const providerProfiles = profiles.filter(profile => profile?.serviceProvider === providerId)
    if (!providerProfiles.length) continue

    const models = normalizeModelIds([
      ...(provider.defaultModels || []),
      ...providerProfiles.map(profile => profile?.selectedModelId)
    ])
    for (const modelId of models) {
      result.push({
        modelId,
        providerId,
        providerName: provider.name || providerId
      })
    }
  }

  return result
}

function resolveProfileForProviderModel(configManager, providerId, modelId, currentProfile = null) {
  const { profiles } = getConfigSnapshot(configManager)
  const normalizedProviderId = normalizeModelValue(providerId)
  const normalizedModelId = normalizeModelValue(modelId)

  if (currentProfile?.serviceProvider === normalizedProviderId) {
    return currentProfile
  }

  return profiles.find(profile =>
    profile?.serviceProvider === normalizedProviderId &&
    isSameModelId(profile?.selectedModelId, normalizedModelId)
  ) || profiles.find(profile => profile?.serviceProvider === normalizedProviderId) || currentProfile || null
}

function isClaudeCodeModelSelector(model) {
  const normalized = normalizeModelValue(model).toLowerCase()
  if (!normalized) return false
  if (['opus', 'sonnet', 'haiku'].includes(normalized)) return true
  return /^claude-(opus|sonnet|haiku)(?:-|$)/.test(normalized)
}

function resolveRequestedModel(_profile, _configManager, requestedModel) {
  const normalizedRequestedModel = normalizeModelValue(requestedModel)
  if (!normalizedRequestedModel) {
    return { queryModel: null, ignored: false, requestedModel: '' }
  }

  if (!isClaudeCodeModelSelector(normalizedRequestedModel)) {
    return {
      queryModel: null,
      ignored: true,
      requestedModel: normalizedRequestedModel
    }
  }

  return {
    queryModel: normalizedRequestedModel,
    ignored: false,
    requestedModel: normalizedRequestedModel
  }
}

function mergeSystemPrompts(...prompts) {
  const normalized = prompts
    .map(prompt => typeof prompt === 'string' ? prompt.trim() : '')
    .filter(Boolean)

  return normalized.length > 0 ? normalized.join(' ') : undefined
}

class AgentSessionManager extends EventEmitter {
  constructor(mainWindow, configManager) {
    super()
    this.mainWindow = mainWindow
    this.configManager = configManager

    // Agent 会话映射: sessionId -> AgentSession
    this.sessions = new Map()

    // Runner：封装 SDK 输入输出
    this.runner = new ClaudeCodeRunner()

    // 数据库引用（通过 setSessionDatabase 注入）
    this.sessionDatabase = null
    this.agentComponentCreator = null

    // 文件操作管理器（依赖注入）
    this.fileManager = new AgentFileManager(this)

    // Query 控制管理器（依赖注入）
    this.queryManager = new AgentQueryManager(this)
    this.componentMetadataStore = null
  }

  /**
   * 注入数据库实例
   */
  setSessionDatabase(db) {
    this.sessionDatabase = db

    // 启动时将之前未正常关闭的会话标记为 closed
    if (db) {
      try {
        db.closeAllActiveAgentConversations()
        console.log('[AgentSession] Marked all active conversations as closed on startup')
      } catch (err) {
        console.error('[AgentSession] Failed to close active conversations:', err)
      }
    }
  }

  setAgentComponentCreator(creator) {
    this.agentComponentCreator = typeof creator === 'function' ? creator : null
  }

  _assertCanAccessConversation(sessionId, currentUser) {
    if (!currentUser || !this.sessionDatabase?.canAccessAgentConversation) return true
    const allowed = this.sessionDatabase.canAccessAgentConversation(sessionId, {
      userId: currentUser.id,
      isAdmin: currentUser.isAdmin
    })
    if (!allowed) {
      const error = new Error('无权访问该会话')
      error.code = 'AUTH_FORBIDDEN'
      throw error
    }
    return true
  }

  /**
   * 安全地发送消息到渲染进程（委托给共享工具函数）
   */
  _safeSend(channel, data) {
    return safeSend(this.mainWindow, channel, data)
  }

  _getPersistedSessionModelId(sessionId) {
    if (!this.sessionDatabase?.getAgentConversation || !sessionId) {
      return null
    }

    try {
      const row = this.sessionDatabase.getAgentConversation(sessionId)
      return normalizeModelIdOrNull(row?.model_id)
    } catch (err) {
      console.warn('[AgentSession] Failed to load persisted model snapshot:', {
        sessionId,
        error: err.message
      })
      return null
    }
  }

  _resolveSessionModelId(session) {
    if (!session) return null
    const current = normalizeModelIdOrNull(session.modelId)
    if (current) return current

    const persisted = this._getPersistedSessionModelId(session.id)
    if (persisted) {
      session.modelId = persisted
    }
    return persisted
  }

  _resolveAvailableProfileModel(profile, requestedModel = null) {
    const entries = buildAvailableProviderModelEntries(this.configManager)
    const normalizedRequestedModel = normalizeModelValue(requestedModel)
    const profileModelId = normalizeModelValue(profile?.selectedModelId)

    const preferredEntry = normalizedRequestedModel
      ? findModelEntry(entries, normalizedRequestedModel)
      : null
    const profileEntry = profileModelId
      ? entries.find(entry =>
        isSameModelId(entry.modelId, profileModelId) &&
        entry.providerId === profile?.serviceProvider
      )
      : null
    const fallbackEntry = preferredEntry || profileEntry || entries[0] || null

    if (!fallbackEntry) {
      return {
        profile: profile || null,
        modelId: normalizeModelIdOrNull(normalizedRequestedModel || profileModelId)
      }
    }

    return {
      profile: resolveProfileForProviderModel(
        this.configManager,
        fallbackEntry.providerId,
        fallbackEntry.modelId,
        profile
      ),
      modelId: fallbackEntry.modelId
    }
  }

  _invalidateSdkResume(session, reason, details = {}) {
    if (!session) return

    const previousSdkSessionId = session.sdkSessionId || null
    session.skipNextResume = true
    session.sdkSessionId = null

    try {
      this.sessionDatabase?.updateAgentConversation?.(session.id, {
        sdkSessionId: null
      })
    } catch (err) {
      console.warn('[AgentSession] Failed to clear stale sdk_session_id:', {
        sessionId: session.id,
        error: err.message
      })
    }

    console.log('[AgentSession] Invalidated SDK resume:', {
      sessionId: session.id,
      previousSdkSessionId,
      reason,
      ...details
    })
  }

  _sdkSessionExistsInClaudeConfigDir(sdkSessionId, claudeConfigDir) {
    if (!sdkSessionId || !claudeConfigDir) return true

    const projectsDir = path.join(claudeConfigDir, 'projects')
    const targetFileName = `${sdkSessionId}.jsonl`

    if (!fs.existsSync(projectsDir)) {
      return false
    }

    const stack = [projectsDir]
    while (stack.length > 0) {
      const currentDir = stack.pop()
      let entries = []

      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true })
      } catch (err) {
        console.warn('[AgentSession] Failed to inspect Claude config dir for resume:', {
          sdkSessionId,
          claudeConfigDir,
          currentDir,
          error: err.message
        })
        return true
      }

      for (const entry of entries) {
        if (entry.isFile() && entry.name === targetFileName) {
          return true
        }
        if (entry.isDirectory()) {
          stack.push(path.join(currentDir, entry.name))
        }
      }
    }

    return false
  }

  _serializeSession(session) {
    const modelId = this._resolveSessionModelId(session)
    return {
      ...session.toJSON(),
      modelId
    }
  }

  /**
   * 为宿主侧交互生成一条 tool 消息并等待前端回执
   */
  _buildPermissionActions(suggestions = []) {
    const actions = [{
      key: 'allow_once',
      label: '本次允许',
      description: '仅允许这一次，不保存规则',
      updatedPermissions: [],
      decisionClassification: 'user_temporary'
    }]

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return actions
    }

    const order = ['session', 'projectSettings', 'userSettings', 'localSettings', 'cliArg']
    const labels = {
      session: ['本会话始终允许', '本次会话内不再询问'],
      projectSettings: ['项目内始终允许', '写入项目设置'],
      userSettings: ['全局始终允许', '写入用户设置'],
      localSettings: ['本地设置允许', '写入本地设置'],
      cliArg: ['按当前启动参数允许', '依赖 CLI 参数']
    }

    const grouped = new Map()
    for (const suggestion of suggestions) {
      const destination = suggestion?.destination || 'session'
      if (!grouped.has(destination)) grouped.set(destination, [])
      grouped.get(destination).push(suggestion)
    }

    for (const destination of order) {
      const group = grouped.get(destination)
      if (!group || group.length === 0) continue
      const [label, description] = labels[destination] || [`允许（${destination}）`, '应用 SDK 建议权限']
      actions.push({
        key: `allow_${destination}`,
        label,
        description,
        updatedPermissions: group,
        decisionClassification: 'user_permanent'
      })
    }

    return actions
  }

  async _requestInteraction(session, kind, payload = {}) {
    if (!session) {
      return {
        behavior: 'deny',
        message: 'Session not found'
      }
    }

    const interactionId = uuidv4()
    const messageId = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const toolName = payload.toolName || (kind === 'ask_user_question' ? 'AskUserQuestion' : 'PermissionRequest')
    const toolInput = {
      interactionId,
      kind,
      ...payload
    }

    const toolMessage = {
      id: messageId,
      role: 'tool',
      toolName,
      input: toolInput,
      output: null,
      timestamp: Date.now()
    }

    this._storeMessage(session, toolMessage)
    const interactionPromise = new Promise((resolve, reject) => {
      session.pendingInteractions.set(interactionId, {
        kind,
        payload,
        messageId,
        resolve,
        reject,
        createdAt: Date.now()
      })
    })

    const interaction = {
      interactionId,
      kind,
      messageId,
      ...payload
    }
    this._safeSend('agent:interactionRequest', {
      sessionId: session.id,
      interaction
    })
    this.emit('interactionRequest', {
      sessionId: session.id,
      interaction
    })

    return await interactionPromise
  }

  _updateInteractionMessage(session, interactionId, output) {
    if (!session) return
    const message = session.messages.find(msg => msg.role === 'tool' && msg.input?.interactionId === interactionId)
    if (message) {
      message.output = output
    }
  }

  resolveInteraction(sessionId, interactionId, response = {}) {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')

    const pending = session.pendingInteractions.get(interactionId)
    if (!pending) throw new Error('Interaction not found')

    const annotations = response.annotations && typeof response.annotations === 'object'
      ? response.annotations
      : undefined
    const output = {
      status: 'answered',
      answers: Array.isArray(response.answers) ? response.answers : [],
      ...(annotations ? { annotations } : {})
    }

    this._updateInteractionMessage(session, interactionId, output)

    if (this.sessionDatabase && session.dbConversationId) {
      try {
        this.sessionDatabase.updateAgentMessageToolOutput(pending.messageId, output)
      } catch (err) {
        console.error('[AgentSession] Failed to persist interaction output:', err)
      }
    }

    session.pendingInteractions.delete(interactionId)

    const questionList = Array.isArray(response.questions)
      ? response.questions
      : (Array.isArray(pending.payload?.questions) ? pending.payload.questions : [])
    const answerMap = Object.fromEntries(
      output.answers.map((item, index) => {
        const questionText = item?.question || questionList[index]?.question || `question_${index + 1}`
        const rawAnswer = item?.answer
        const value = Array.isArray(rawAnswer)
          ? rawAnswer.join(', ')
          : (rawAnswer == null ? '' : String(rawAnswer))
        return [questionText, value]
      })
    )

    const permissionResult = pending.kind === 'ask_user_question'
      ? {
          behavior: response.behavior || 'allow',
          updatedInput: {
            questions: questionList,
            answers: answerMap,
            answersStructured: output.answers,
            ...(annotations ? { annotations } : {})
          },
          updatedPermissions: Array.isArray(response.updatedPermissions) ? response.updatedPermissions : undefined,
          decisionClassification: response.decisionClassification || 'user_temporary'
        }
      : {
          behavior: response.behavior || 'allow',
          updatedInput: response.updatedInput || {},
          updatedPermissions: Array.isArray(response.updatedPermissions) ? response.updatedPermissions : undefined,
          decisionClassification: response.decisionClassification || (Array.isArray(response.updatedPermissions) && response.updatedPermissions.length > 0 ? 'user_permanent' : 'user_temporary')
        }

    pending.resolve(permissionResult)

    this._safeSend('agent:interactionResolved', {
      sessionId,
      interactionId,
      output
    })
    this.emit('interactionResolved', {
      sessionId,
      interactionId,
      output
    })

    return { success: true }
  }

  cancelInteraction(sessionId, interactionId, reason = 'User cancelled the question') {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')

    const pending = session.pendingInteractions.get(interactionId)
    if (!pending) throw new Error('Interaction not found')

    const output = {
      status: 'cancelled',
      reason
    }

    this._updateInteractionMessage(session, interactionId, output)

    if (this.sessionDatabase && session.dbConversationId) {
      try {
        this.sessionDatabase.updateAgentMessageToolOutput(pending.messageId, output)
      } catch (err) {
        console.error('[AgentSession] Failed to persist cancelled interaction:', err)
      }
    }

    session.pendingInteractions.delete(interactionId)
    pending.resolve({
      behavior: 'deny',
      message: reason
    })

    this._safeSend('agent:interactionResolved', {
      sessionId,
      interactionId,
      output
    })
    this.emit('interactionResolved', {
      sessionId,
      interactionId,
      output
    })

    return { success: true }
  }

  _cleanupPendingInteractions(session, reason = 'Session closed') {
    if (!session?.pendingInteractions?.size) return

    for (const [interactionId, pending] of session.pendingInteractions.entries()) {
      const output = {
        status: 'cancelled',
        reason
      }
      this._updateInteractionMessage(session, interactionId, output)
      pending.resolve({
        behavior: 'deny',
        message: reason
      })
      this._safeSend('agent:interactionResolved', {
        sessionId: session.id,
        interactionId,
        output
      })
    }

    session.pendingInteractions.clear()
  }

  /**
   * 获取输出基础目录
   */
  _getOutputBaseDir() {
    const config = this.configManager?.getConfig?.() || {}
    const customDir = config?.settings?.agent?.outputBaseDir
    if (customDir) {
      try {
        fs.mkdirSync(customDir, { recursive: true })
        return customDir
      } catch (err) {
        console.error('[AgentSession] Failed to create custom outputBaseDir, falling back:', err)
      }
    }
    return path.join(os.homedir(), 'jedi-web-agent-output')
  }

  _normalizeStandaloneReportMode(mode) {
    return Object.prototype.hasOwnProperty.call(STANDALONE_REPORT_MODE_DIRS, mode) ? mode : null
  }

  _isStandaloneReportCwd(cwd) {
    if (typeof cwd !== 'string' || !cwd.trim()) return false
    const normalized = path.normalize(cwd)
    const reportDirName = path.basename(path.dirname(normalized)).toLowerCase()
    const modeDirName = path.basename(normalized).toLowerCase()
    return reportDirName === 'reports' && Object.values(STANDALONE_REPORT_MODE_DIRS).includes(modeDirName)
  }

  _isStandaloneReportConversationLike(conversation) {
    if (!conversation || typeof conversation !== 'object') return false
    const reportMode = conversation.reportMode || conversation.report_mode || conversation.meta?.reportMode
    if (conversation.source === 'report-followup') return false
    return Boolean(
      this._normalizeStandaloneReportMode(reportMode) ||
      this._isStandaloneReportCwd(conversation.cwd)
    )
  }

  _isHiddenConversationHistorySource(conversation) {
    const source = conversation?.source || conversation?.meta?.source
    return source === 'aipin-data-processing'
  }

  _getStandaloneReportProjectDir(mode) {
    const normalizedMode = this._normalizeStandaloneReportMode(mode)
    if (!normalizedMode) return null
    const reportDir = path.join(this._getOutputBaseDir(), 'reports', STANDALONE_REPORT_MODE_DIRS[normalizedMode])
    fs.mkdirSync(reportDir, { recursive: true })
    return reportDir
  }

  _getLeadMemoryDbPath() {
    const configuredPath = this.configManager?.getConfig?.()?.settings?.agent?.leadMemoryDbPath
    if (typeof configuredPath === 'string' && configuredPath.trim()) {
      return path.resolve(configuredPath.trim())
    }

    const userDataPath = this.configManager?.userDataPath ||
      path.join(os.homedir(), '.config', 'jedi-web')
    return path.join(userDataPath, 'lead-memory.sqlite')
  }

  _getComponentMetadataStore() {
    if (this.componentMetadataStore) return this.componentMetadataStore
    const userDataPath = this.configManager?.userDataPath ||
      path.join(os.homedir(), '.config', 'jedi-web')
    this.componentMetadataStore = new ComponentMetadataStore(path.join(userDataPath, 'component-metadata.json'))
    return this.componentMetadataStore
  }

  _isBuiltInSkillEnabled(skillId) {
    try {
      return this._getComponentMetadataStore().isBuiltInSkillEnabled(skillId)
    } catch (err) {
      console.warn('[AgentSession] Failed to read built-in skill state:', {
        skillId,
        error: err.message
      })
      return true
    }
  }

  _buildPrefetchedLeadCandidateContext(rawQuery, session, meta = {}) {
    if (meta?.disableLeadCandidatePrefetch || meta?.skipLeadCandidatePrefetch) return null
    const agentSettings = this.configManager?.getConfig?.()?.settings?.agent || {}
    if (agentSettings.enableLeadCandidatePrefetch === false) return null

    const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'query-investment-leads-report.js')
    if (!fs.existsSync(scriptPath)) return null

    const args = [
      scriptPath,
      '--topic', rawQuery,
      '--memory-db', this._getLeadMemoryDbPath(),
      '--limit', String(LEAD_CANDIDATE_PREFETCH_LIMIT),
      '--candidate-limit', '50',
      '--compact',
      '--allow-missing-local'
    ]
    const dbPath = session?.cwd
      ? path.join(session.cwd, BUILTIN_WECHAT_DB_FILE_NAME)
      : this._resolveBuiltinWechatDbPath()
    if (dbPath && fs.existsSync(dbPath)) {
      args.push('--db', dbPath)
    }

    try {
      const output = execFileSync(process.execPath, args, {
        cwd: path.resolve(__dirname, '..', '..'),
        encoding: 'utf8',
        timeout: LEAD_CANDIDATE_PREFETCH_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      })
      const parsed = JSON.parse(output)
      return Array.isArray(parsed?.candidates) && parsed.candidates.length > 0 ? parsed : null
    } catch (err) {
      console.warn('[AgentSession] Lead candidate prefetch skipped:', err?.code || err?.message || 'unknown')
      return null
    }
  }

  _buildResearchMemoryContextForMessage(userMessage, session, meta = {}) {
    if (!shouldApplyResearchMemoryContext(userMessage, meta)) return ''

    const rawQuery = getUserMessageIntentText(userMessage).trim()
    if (!rawQuery) return ''

    let recallContext = ''
    let recallResult = null
    let store = null
    try {
      store = new LeadMemoryStore(this._getLeadMemoryDbPath())
      const memory = createResearchMemoryAdapter(store)
      const recall = memory.recallForResearch({
        input: rawQuery,
        mode: /^https?:\/\//i.test(rawQuery) ? 'entity_lookup' : 'mixed'
      })
      recallResult = recall
      const hasStructuredHits = recall.cacheHitLevel !== 'none' ||
        recall.entities.length > 0 ||
        recall.topics.length > 0
      if (hasStructuredHits) {
        recallContext = recall.context
      }
    } catch (err) {
      console.warn('[AgentSession] Failed to build structured lead memory context:', err.message)
    } finally {
      try { store?.close?.() } catch {}
    }

    const reports = this._findRelevantGeneratedReportsForResearchMemory(rawQuery, session)
    const prefetchedCandidates = this._buildPrefetchedLeadCandidateContext(rawQuery, session, meta)
    if (!recallContext && reports.length === 0 && !prefetchedCandidates) return ''

    this._prefillResearchMemoryMarkdownArtifacts(rawQuery, session, { recall: recallResult, reports })
    return formatResearchMemoryContext({ recallContext, recall: recallResult, reports, prefetchedCandidates })
  }

  _prefillResearchMemoryMarkdownArtifacts(rawQuery, session, { recall, reports } = {}) {
    if (!session?.cwd) return { generated: 0 }

    try {
      fs.mkdirSync(session.cwd, { recursive: true })
    } catch (err) {
      console.warn('[AgentSession] Failed to prepare research memory prefill directory:', err.message)
      return { generated: 0 }
    }

    const prefillDir = path.join(session.cwd, '.codex', 'research-prefill')
    try {
      fs.mkdirSync(prefillDir, { recursive: true })
    } catch (err) {
      console.warn('[AgentSession] Failed to prepare hidden research memory prefill directory:', err.message)
      return { generated: 0 }
    }

    let generated = 0
    let clueIndex = 1
    const entities = Array.isArray(recall?.entities) ? recall.entities.slice(0, RESEARCH_MEMORY_PREFILL_LIMIT) : []
    for (const entity of entities) {
      const filePath = path.join(prefillDir, `线索${clueIndex}.md`)
      generated += this._writeResearchMemoryMarkdownIfAbsent(filePath, this._buildStructuredLeadClueMarkdown(entity, clueIndex))
      clueIndex += 1
    }

    const remainingSlots = Math.max(0, RESEARCH_MEMORY_PREFILL_LIMIT - entities.length)
    const reportCandidates = Array.isArray(reports) ? reports.slice(0, remainingSlots || RESEARCH_MEMORY_PREFILL_LIMIT) : []
    for (const report of reportCandidates) {
      const filePath = path.join(prefillDir, `线索${clueIndex}.md`)
      generated += this._writeResearchMemoryMarkdownIfAbsent(filePath, this._buildHistoricalReportClueMarkdown(report, clueIndex))
      clueIndex += 1
    }

    const title = safeMarkdownFileBaseName(rawQuery || session.title || '投研报告')
    const reportPath = path.join(prefillDir, `${title}.md`)
    const historicalMarkdown = reportCandidates.find(report => path.extname(report?.filePath || '').toLowerCase() === '.md')
    if (historicalMarkdown?.filePath && fs.existsSync(historicalMarkdown.filePath)) {
      try {
        generated += this._writeResearchMemoryMarkdownIfAbsent(reportPath, fs.readFileSync(historicalMarkdown.filePath, 'utf8'))
      } catch (err) {
        console.warn('[AgentSession] Failed to copy historical research report prefill:', err.message)
      }
    } else if (entities.length > 0) {
      generated += this._writeResearchMemoryMarkdownIfAbsent(reportPath, this._buildStructuredLeadReportDraftMarkdown(rawQuery, entities))
    }

    return { generated }
  }

  _writeResearchMemoryMarkdownIfAbsent(filePath, content) {
    if (!filePath || fs.existsSync(filePath)) return 0
    fs.writeFileSync(filePath, String(content || '').trimEnd() + '\n', 'utf8')
    return 1
  }

  _buildStructuredLeadClueMarkdown(entity, index) {
    const metadata = entity?.metadata || {}
    const evidence = Array.isArray(entity?.evidence) ? entity.evidence[0] : null
    const project = firstNonEmpty(metadata.project, entity?.display_name, entity?.canonical_name, `历史线索${index}`)
    const sourceTitle = firstNonEmpty(evidence?.source_title, '结构化历史线索')
    const sourceFacts = firstNonEmpty(evidence?.evidence_summary, entity?.summary, `${project} 来自结构化历史线索，需核验最新公开来源。`)
    return [
      `# 线索${index}：${project}`,
      '',
      `线索名称：${project}`,
      `主体类型：${entity?.entity_type || 'project'}`,
      `清华系关联状态：${entity?.tsinghua_affiliation_status || 'pending'}`,
      `赛道：${firstNonEmpty(metadata.sector, '未查到')}`,
      `研究方向：${firstNonEmpty(metadata.research_direction, '未查到')}`,
      `技术：${firstNonEmpty(metadata.technology, '未查到')}`,
      `产品：${firstNonEmpty(metadata.product, '未查到')}`,
      `项目：${project}`,
      `来源事实：${sourceFacts}`,
      `详情 URL：${formatHtmlSourceLink(evidence?.source_url, sourceTitle)}`,
      '分析判断：历史结构化线索可作为本轮候选和字段预填依据；最终报告仍需核验来源有效性、阶段变化和新增公开信号。',
      '待验证事项：清华系关联、主体当前状态、产品化阶段、融资状态、客户/试点/合作信号是否已有更新。',
      '建议动作：supplement_search'
    ].join('\n')
  }

  _buildHistoricalReportClueMarkdown(report, index) {
    const name = firstNonEmpty(report?.name, `历史报告${index}`)
    const snippet = firstNonEmpty(report?.snippet, readTextFileSnippet(report?.filePath), '历史报告包含相关内容，需人工核验最新来源。')
    return [
      `# 线索${index}：${safeMarkdownFileBaseName(name, `历史报告${index}`).replace(/\.md$/i, '')}`,
      '',
      `线索名称：${name}`,
      '主体类型：历史报告',
      '清华系关联状态：待重新核验',
      '赛道：待从历史报告和本轮主题中确认',
      '研究方向：待从历史报告和本轮主题中确认',
      '技术：待从历史报告和本轮主题中确认',
      '产品：待从历史报告和本轮主题中确认',
      `项目：${snippet}`,
      `来源事实：${snippet}`,
      '详情 URL：无公开详情 URL，需人工补充核验入口',
      '分析判断：该历史报告可作为本轮快速起点，不应直接作为最终事实；应优先复核其中的项目线索、来源依据和阶段信息。',
      '待验证事项：历史报告中的主体是否仍与本轮主题相关、来源是否仍可访问、商业化/融资/产品状态是否变化。',
      '建议动作：supplement_search'
    ].join('\n')
  }

  _buildStructuredLeadReportDraftMarkdown(rawQuery, entities) {
    const title = safeMarkdownFileBaseName(rawQuery || '投研报告')
    const date = new Date().toLocaleDateString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    }).replace(/\//g, '年').replace(/年(\d+)年(\d+)$/, '年$1月$2日')
    const cards = entities.map((entity, index) => {
      const metadata = entity?.metadata || {}
      const evidence = Array.isArray(entity?.evidence) ? entity.evidence[0] : null
      const project = firstNonEmpty(metadata.project, entity?.display_name, entity?.canonical_name, `历史线索${index + 1}`)
      const targetLabel = `标的${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][index] || index + 1}`
      return [
        `## ${targetLabel}：${project}`,
        ':::field-card',
        `项目：${project}`,
        '关联人物：未查到',
        '核心成员：未查到',
        `团体名称：${firstNonEmpty(entity?.display_name, entity?.canonical_name, '未查到')}`,
        `主体类型：${entity?.entity_type || 'project'}`,
        `赛道：${firstNonEmpty(metadata.sector, '未查到')}`,
        `研究方向：${firstNonEmpty(metadata.research_direction, '未查到')}`,
        `产品：${firstNonEmpty(metadata.product, '未查到')}`,
        `清华系关联依据：${entity?.tsinghua_affiliation_status || 'pending'}`,
        '机构/实验室/公司：未查到',
        `技术：${firstNonEmpty(metadata.technology, '未查到')}`,
        `【来源事实】：${firstNonEmpty(evidence?.evidence_summary, entity?.summary, '结构化历史线索命中，需复核最新公开来源。')}`,
        `来源依据：S1｜来源类型：历史线索｜来源名称：${firstNonEmpty(evidence?.source_title, entity?.display_name, project)}｜支撑事实：${firstNonEmpty(evidence?.evidence_summary, entity?.summary, '结构化历史线索命中')}｜核实状态：待核实｜详情 URL：${formatHtmlSourceLink(evidence?.source_url, evidence?.source_title || '详情链接')}`,
        '【分析判断】：历史结构化字段可作为本轮报告草稿；最终版本需补充最新来源核验。',
        '【待验证】：当前状态、融资状态、产品化阶段和新增合作信号。',
        ':::'
      ].join('\n')
    }).join('\n\n')

    return [
      `# ${title}`,
      `生成日期：${date}`,
      '',
      '### 1. 投资意图拆解',
      `围绕“${title}”复用结构化历史线索进行快速预填；本草稿需在本轮研判中完成来源复核和字段更新。`,
      '',
      '### 2. 项目线索',
      cards,
      '',
      '### 3. Alpha Signal 分析',
      '待基于本轮核验补齐。',
      '',
      '### 4. 行动建议与工作流队列',
      '待基于本轮核验补齐。',
      '',
      '### 5. 缺失信息与风险',
      '需核验历史线索是否过期，以及来源依据、清华系关联、团队状态和商业化信号是否发生变化。'
    ].join('\n')
  }

  _findRelevantGeneratedReportsForResearchMemory(query, session) {
    const normalizedQuery = normalizeName(query)
    if (!normalizedQuery) return []

    const reportsByPath = new Map()
    const addReport = report => {
      if (!report?.filePath || reportsByPath.has(report.filePath)) return
      const name = report.name || path.basename(report.filePath)
      const snippet = report.snippet || readTextFileSnippet(report.filePath)
      const haystack = normalizeName([name, path.basename(report.filePath), snippet].join(' '))
      if (!haystack.includes(normalizedQuery)) return
      reportsByPath.set(report.filePath, {
        name,
        filePath: report.filePath,
        snippet,
        updatedAt: report.updatedAt || 0
      })
    }

    try {
      for (const report of this.listGeneratedReports({})) {
        addReport({
          ...report,
          name: report.name || path.basename(report.filePath)
        })
      }
    } catch (err) {
      console.warn('[AgentSession] Failed to match generated reports for lead memory:', err.message)
    }

    const outputBaseDir = this._getOutputBaseDir()
    for (const report of this._scanResearchMemoryReportFiles(outputBaseDir, session?.cwd)) {
      addReport(report)
    }

    return [...reportsByPath.values()]
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 5)
  }

  _scanResearchMemoryReportFiles(rootDir, currentSessionCwd) {
    const root = typeof rootDir === 'string' ? rootDir.trim() : ''
    if (!root || !fs.existsSync(root)) return []

    const currentRoot = currentSessionCwd ? path.resolve(currentSessionCwd) : ''
    const reports = []
    const stack = [{ dir: root, depth: 0 }]
    const ignoredDirs = new Set(['.git', '.claude', '.codex', 'node_modules'])
    const maxDepth = 6
    const maxEntries = 5000
    let visited = 0

    while (stack.length > 0 && visited < maxEntries) {
      const current = stack.pop()
      let entries = []
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (++visited > maxEntries) break
        const entryPath = path.join(current.dir, entry.name)
        if (entry.isDirectory()) {
          if (
            current.depth >= maxDepth ||
            ignoredDirs.has(entry.name) ||
            entry.name.startsWith('.') ||
            (currentRoot && path.resolve(entryPath) === currentRoot)
          ) {
            continue
          }
          stack.push({ dir: entryPath, depth: current.depth + 1 })
          continue
        }

        if (!entry.isFile()) continue
        const ext = path.extname(entry.name).toLowerCase()
        if (ext !== '.md' && ext !== '.pdf') continue

        try {
          const stats = fs.statSync(entryPath)
          reports.push({
            name: entry.name,
            filePath: entryPath,
            snippet: ext === '.md' ? readTextFileSnippet(entryPath) : '',
            updatedAt: stats.mtimeMs,
            createdAt: stats.birthtimeMs || stats.mtimeMs
          })
        } catch {
          // ignore files that disappear while scanning
        }
      }
    }

    return reports
  }

  /**
   * 为会话自动分配工作目录
   * @param {object} session
   * @param {string} [subDir='desktop'] 子目录命名空间，桌面端用 'desktop'，钉钉用 'dingtalk'
   */
  _assignCwd(session, subDir = 'desktop') {
    const baseDir = path.join(this._getOutputBaseDir(), subDir)
    const sessionDir = path.join(baseDir, `conv-${session.id.substring(0, 8)}`)
    try {
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true })
      }
    } catch (err) {
      console.error('[AgentSession] Failed to create output dir:', err)
    }
    return sessionDir
  }

  _resolveBuiltinWechatDbPath() {
    const candidates = []
    const configuredPath = this.configManager?.getConfig?.()?.settings?.agent?.wechatDbPath
    if (typeof configuredPath === 'string' && configuredPath.trim()) {
      candidates.push(path.resolve(configuredPath.trim()))
    }

    candidates.push(
      path.resolve(__dirname, '..', '..', BUILTIN_WECHAT_DB_FILE_NAME),
      path.resolve(process.cwd(), BUILTIN_WECHAT_DB_FILE_NAME)
    )

    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate
        }
      } catch {
        // Ignore inaccessible candidates and continue with the next known location.
      }
    }

    return null
  }

  _ensureBuiltinWechatDbAvailable(cwd) {
    if (!cwd) return

    const sourcePath = this._resolveBuiltinWechatDbPath()
    if (!sourcePath) return

    const targetPath = path.join(cwd, BUILTIN_WECHAT_DB_FILE_NAME)
    try {
      fs.mkdirSync(cwd, { recursive: true })
      if (path.resolve(sourcePath) === path.resolve(targetPath)) return
      if (fs.existsSync(targetPath)) return

      try {
        fs.linkSync(sourcePath, targetPath)
      } catch {
        fs.copyFileSync(sourcePath, targetPath)
      }
    } catch (err) {
      console.warn('[AgentSession] Failed to make built-in wechat sqlite database available:', {
        cwd,
        error: err.message
      })
    }
  }

  _installBuiltinSessionSkills(cwd) {
    if (!cwd) return

    for (const scope of BUILTIN_SESSION_SKILL_SCOPES) {
      const skillsDir = path.resolve(__dirname, '..', '..', scope, 'skills')
      if (!fs.existsSync(skillsDir)) {
        console.log('[AgentSession] _installBuiltinSessionSkills: skillsDir not found:', skillsDir.replace(/\\/g, '/'))
        continue
      }

      let entries
      try {
        entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      } catch (err) {
        console.warn('[AgentSession] _installBuiltinSessionSkills: readdir error:', skillsDir.replace(/\\/g, '/'), err.message)
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillId = entry.name
        const sourceDir = path.join(skillsDir, skillId)
        const skillMdPath = path.join(sourceDir, 'SKILL.md')
        if (!fs.existsSync(skillMdPath)) continue
        const targetDir = path.join(cwd, scope, 'skills', skillId)
        if (!this._isBuiltInSkillEnabled(skillId)) {
          if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true, force: true })
          }
          console.log('[AgentSession] _installBuiltinSessionSkills: skipped disabled skill:', { skillId, scope })
          continue
        }

        try {
          fs.mkdirSync(path.dirname(targetDir), { recursive: true })
          fs.cpSync(sourceDir, targetDir, { recursive: true, force: true, errorOnExist: false })
          console.log('[AgentSession] _installBuiltinSessionSkills: installed skill:', { skillId, scope, target: targetDir.replace(/\\/g, '/') })
        } catch (err) {
          console.warn('[AgentSession] Failed to install built-in session skill:', {
            cwd,
            scope,
            skillId,
            error: err.message
          })
        }
      }
    }

    this._ensureBuiltinWechatDbAvailable(cwd)
  }

  /**
   * 创建新会话
   */
  _ensureSessionCwd(session) {
    if (!session) return null

    if (!session.cwd) {
      session.cwd = this._assignCwd(session)
      session.cwdAuto = true
      this._installBuiltinSessionSkills(session.cwd)
      return session.cwd
    }

    try {
      fs.mkdirSync(session.cwd, { recursive: true })
      this._installBuiltinSessionSkills(session.cwd)
      return session.cwd
    } catch (err) {
      console.error('[AgentSession] Failed to ensure session cwd:', {
        sessionId: session.id,
        cwd: session.cwd,
        error: err.message
      })
      throw new Error(`Failed to create session working directory: ${session.cwd}`)
    }
  }

  create(options = {}) {
    // 获取 API Profile：优先使用调用方指定的
    let profile
    if (options.apiProfileId) {
      profile = this.configManager.getAPIProfile(options.apiProfileId) || this.configManager.getDefaultProfile()
    } else if (options.modelId) {
      // 如果指定了模型但没有指定 profile，根据模型找到对应的 provider，然后找该 provider 的 profile
      const modelId = options.modelId
      const definitions = this.configManager.getServiceProviderDefinitions() || []
      const provider = definitions.find(def =>
        def.defaultModels && def.defaultModels.some(defaultModel => isSameModelId(defaultModel, modelId))
      )
      console.log('[AgentSessionManager] create - modelId:', modelId, 'provider:', provider?.id, 'provider name:', provider?.name)
      if (provider) {
        // 找到使用该 provider 的 profile
        const profiles = this.configManager.getConfig().apiProfiles || []
        console.log('[AgentSessionManager] create - available profiles:', profiles.map(p => ({ id: p.id, name: p.name, serviceProvider: p.serviceProvider })))
        profile = profiles.find(p => p.serviceProvider === provider.id)
          || this.configManager.getDefaultProfile()
        console.log('[AgentSessionManager] create - selected profile:', profile?.name, 'serviceProvider:', profile?.serviceProvider)
      } else {
        console.log('[AgentSessionManager] create - provider not found, using default profile')
        profile = this.configManager.getDefaultProfile()
      }
    } else {
      profile = this.configManager.getDefaultProfile()
    }

    const resolvedProfileModel = this._resolveAvailableProfileModel(profile, options.modelId)
    profile = resolvedProfileModel.profile || profile
    const initialModelId = normalizeModelIdOrNull(resolvedProfileModel.modelId)
    const standaloneReportMode = this._normalizeStandaloneReportMode(options.meta?.reportMode || options.reportMode)
    const session = new AgentSession({
      type: options.type,
      title: options.title,
      cwd: standaloneReportMode ? this._getStandaloneReportProjectDir(standaloneReportMode) : options.cwd,
      apiProfileId: profile?.id || null,
      apiBaseUrl: profile?.baseUrl || null,
      source: resolveConversationSource(options.type, options.source),
      taskId: options.taskId || null,
      meta: options.meta || {}
    })
    session.modelId = initialModelId
    if (standaloneReportMode) {
      session.cwdAuto = true
      session.reportMode = standaloneReportMode
      session.reportFilePath = options.meta?.reportFilePath || options.reportFilePath || null
    }

    // 自动分配工作目录
    if (!session.cwd) {
      session.cwd = this._assignCwd(session, options.cwdSubDir)
    } else {
      this._ensureSessionCwd(session)
    }
    this._installBuiltinSessionSkills(session.cwd)

    this.sessions.set(session.id, session)

    // 写入数据库
    if (this.sessionDatabase) {
      try {
        const dbRecord = this.sessionDatabase.createAgentConversation({
          sessionId: session.id,
          type: session.type,
          title: session.title,
          cwd: session.cwd,
          cwdAuto: session.cwdAuto,
          apiProfileId: profile?.id || null,
          apiBaseUrl: profile?.baseUrl || null,
          modelId: session.modelId,
          source: session.source,
          taskId: session.taskId,
          userId: options.ownerUserId || null,
          reportMode: session.reportMode || session.meta?.reportMode || null,
          reportFilePath: session.reportFilePath || session.meta?.reportFilePath || null
        })
        session.dbConversationId = dbRecord.id
      } catch (err) {
        console.error('[AgentSession] Failed to create DB record:', err)
      }
    }

    console.log(`[AgentSession] Created session ${session.id}, type: ${session.type}, cwd: ${session.cwd}`)
    return this._serializeSession(session)
  }

  appendExternalUserMessage(sessionId, { content, source, senderNick, meta } = {}) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const text = String(content || '').trim()
    if (!text) {
      throw new Error('External message content is empty')
    }

    const message = {
      id: `msg-ext-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: text,
      timestamp: Date.now()
    }

    if (source) message.source = source
    if (senderNick) message.senderNick = senderNick
    if (meta && typeof meta === 'object') message.meta = meta

    this._storeMessage(session, message)
    session.messageCount++
    session.updatedAt = new Date()

    if (this.sessionDatabase) {
      try {
        this.sessionDatabase.updateAgentConversation(sessionId, {
          messageCount: session.messageCount
        })
      } catch (err) {
        console.error('[AgentSession] Failed to update external message metadata:', err)
      }
    }

    return message
  }

  _classifyProbeFailure(error) {
    const message = error?.message || String(error)

    if (/SDK 连接超时/.test(message)) {
      return { errorKind: 'TIMEOUT', canFallbackToHttp: false, message: `Claude Code 启动超时：${message}` }
    }

    if (/Failed to load SDK|ERR_MODULE_NOT_FOUND|Cannot find module/i.test(message)) {
      return { errorKind: 'SDK_UNAVAILABLE', canFallbackToHttp: true, message: `SDK 不可用：${message}` }
    }

    if (/spawn .* ENOENT|Failed to spawn Claude Code process|ENOENT/i.test(message)) {
      return { errorKind: 'CLI_UNAVAILABLE', canFallbackToHttp: true, message: `Claude Code CLI 不可用：${message}` }
    }

    return { errorKind: 'SDK_ERROR', canFallbackToHttp: false, message: `Claude Code 探测失败：${message}` }
  }

  async _cleanupProbeSession(session, tempDir) {
    if (session?.messageQueue) {
      try {
        session.messageQueue.end()
      } catch {}
      session.messageQueue = null
    }

    if (session?.queryGenerator) {
      try {
        killProcessTree(session.cliPid)
      } catch {}
      try {
        await session.queryGenerator.close()
      } catch {}
      session.queryGenerator = null
    }

    session.cliPid = null
    session._lastCliExitCode = null
    session._lastCliStderr = null

    if (tempDir) {
      try {
        await fsp.rm(tempDir, { recursive: true, force: true })
      } catch (err) {
        console.warn('[AgentSession] Failed to cleanup probe temp dir:', tempDir, err.message)
      }
    }
  }

  async probeConnection(apiConfig, { prompt = 'hi', maxTurns = 1, timeoutMs } = {}) {
    console.log('[AgentSession] ========== Starting probe connection test ==========' )
    const startTime = Date.now()
    const globalTimeout = this.configManager.getTimeout ? this.configManager.getTimeout() : {}
    const testTimeoutMs = timeoutMs || globalTimeout.test || 30000
    const testTimeoutSec = testTimeoutMs / 1000

    let tempDir = null
    const session = new AgentSession({
      type: AgentType.CHAT,
      title: tMain(this.configManager, 'app.probeSessionTitle'),
      cwd: null,
      apiProfileId: apiConfig?.id || null,
      apiBaseUrl: apiConfig?.baseUrl || null,
      meta: { probe: true }
    })

    try {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jedi-api-test-'))
      session.cwd = tempDir
      session.cwdAuto = false

      const env = this.runner.buildEnv(apiConfig, this.configManager)
      const messageQueue = new MessageQueue()
      session.messageQueue = messageQueue
      this._ensureSessionCwd(session)
      const developerClaudeSource = normalizeDeveloperClaudeSource(
        this.configManager?.getConfig?.()?.settings?.developerClaudeSource
      )
      const claudeCodeExecutablePath = resolveClaudeCodeExecutablePath({
        source: developerClaudeSource
      })
      if (!claudeCodeExecutablePath) {
        throw new Error('当前设置为“内置 Claude”，但未找到内置可执行文件')
      }

      const generator = await this.runner.createQuery(messageQueue, {
        cwd: tempDir,
        env,
        maxTurns,
        pathToClaudeCodeExecutable: claudeCodeExecutablePath
      }, session)
      session.queryGenerator = generator

      const sdkUserMessage = {
        type: 'user',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
        session_id: session.id
      }

      const probePromise = (async () => {
        let responseText = ''
        let sawInit = false

        messageQueue.push(sdkUserMessage)

        for await (const rawMsg of generator) {
          const msg = this.runner.normalizeMessage(rawMsg)

          if (msg.type === 'init') {
            sawInit = true
            session.sdkSessionId = msg.sdkSessionId
            continue
          }

          if (msg.type === 'assistant_message') {
            for (const block of msg.content || []) {
              if (block.type === 'text' && block.text) {
                responseText += block.text
              }
            }

            if (responseText.trim()) {
              return {
                success: true,
                message: `Claude Code 已连通，收到模型回复：${responseText}`,
                durationMs: Date.now() - startTime,
                errorKind: null,
                canFallbackToHttp: false
              }
            }
            continue
          }

          if (msg.type === 'result') {
            const durationMs = Date.now() - startTime
            if (msg.isError) {
              return {
                success: false,
                message: `模型请求被拒绝：${msg.result || 'Unknown error'}`,
                durationMs,
                errorKind: 'API_ERROR',
                canFallbackToHttp: false
              }
            }

            return {
              success: true,
              message: responseText ? `Claude Code 已连通，收到模型回复：${responseText}` : `Claude Code 已连通，请求完成：${msg.result || ''}`,
              durationMs,
              errorKind: null,
              canFallbackToHttp: false
            }
          }
        }

        const durationMs = Date.now() - startTime
        if (session._lastCliExitCode != null && session._lastCliExitCode !== 0) {
          return {
            success: false,
            message: session._lastCliStderr
              ? `Claude Code CLI 异常退出：${session._lastCliStderr}`
              : `Claude Code CLI 异常退出，退出码 ${session._lastCliExitCode}`,
            durationMs,
            errorKind: 'CLI_EXIT',
            canFallbackToHttp: false
          }
        }

        if (responseText) {
          return {
            success: true,
            message: responseText,
            durationMs,
            errorKind: null,
            canFallbackToHttp: false
          }
        }

        if (sawInit) {
          return {
            success: false,
            message: 'Claude Code 已启动，但未收到模型响应',
            durationMs,
            errorKind: 'NO_RESPONSE',
            canFallbackToHttp: false
          }
        }

        return {
          success: false,
          message: 'Claude Code 探测未拿到初始化结果或最终输出',
          durationMs,
          errorKind: 'NO_RESULT',
          canFallbackToHttp: false
        }
      })()

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`SDK 连接超时（${testTimeoutSec}秒无响应）`)), testTimeoutMs)
      })

      const result = await Promise.race([probePromise, timeoutPromise])
      console.log('[AgentSession] Probe result:', result.success ? 'SUCCESS' : 'FAILED')
      console.log('[AgentSession] ========== Probe connection test ended ==========' + '\n')
      return result
    } catch (error) {
      const durationMs = Date.now() - startTime
      const classified = this._classifyProbeFailure(error)
      console.error('[AgentSession] Probe failed:', classified.message)
      console.log('[AgentSession] ========== Probe connection test ended ==========' + '\n')
      return {
        success: false,
        message: classified.message,
        durationMs,
        errorKind: classified.errorKind,
        canFallbackToHttp: classified.canFallbackToHttp
      }
    } finally {
      await this._cleanupProbeSession(session, tempDir)
    }
  }

  /**
   * 从数据库恢复会话到内存（关闭后重新打开、重启后恢复）
   * @returns {Object|null} 恢复后的会话 JSON，或 null
   */
  reopen(sessionId, options = {}) {
    this._assertCanAccessConversation(sessionId, options.currentUser)
    let session = this.sessions.get(sessionId)

    if (!session) {
      // 不在内存中，从 DB 恢复
      if (!this.sessionDatabase) return null

      const row = this.sessionDatabase.getAgentConversation(sessionId)
      if (!row) return null

      session = new AgentSession({
        id: row.session_id,
        type: row.type,
        title: row.title || '',
        cwd: row.cwd,
        source: resolveConversationSource(row.type, row.source),
        taskId: row.task_id || null
      })

      // 恢复关键状态
      session.sdkSessionId = row.sdk_session_id || null
      session.cwdAuto = !!row.cwd_auto
      session.dbConversationId = row.id
      session.messageCount = row.message_count || 0
      session.totalCostUsd = row.total_cost_usd || 0
      session.createdAt = row.created_at ? new Date(row.created_at) : new Date()
      session.apiProfileId = row.api_profile_id || null
      session.apiBaseUrl = row.api_base_url || null
      session.modelId = normalizeModelIdOrNull(row.model_id)
      session.reportMode = row.report_mode || null
      session.reportFilePath = row.report_file_path || null

      // 放回内存 Map
      this.sessions.set(session.id, session)

      // 更新 DB 状态为 idle（重新激活）
      try {
        this.sessionDatabase.updateAgentConversation(sessionId, { status: AgentStatus.IDLE })
      } catch (err) {
        console.error('[AgentSession] Failed to update status on reopen:', err)
      }

      console.log(`[AgentSession] Reopened session ${sessionId} from DB (sdkSessionId: ${session.sdkSessionId || 'none'})`)
    }

    return session.toJSON()
  }

  _resolveUserAttachmentPath(session, file) {
    if (!file || typeof file !== 'object') {
      throw new Error('Invalid attachment')
    }

    const relativePath = typeof file.relativePath === 'string' ? file.relativePath.trim() : ''
    if (relativePath) {
      const resolved = this.fileManager.resolveFilePath(session.id, relativePath)
      if (resolved && fs.existsSync(resolved)) {
        return resolved
      }
    }

    const filePath = typeof file.filePath === 'string' ? file.filePath.trim() : ''
    if (!filePath) {
      return ''
    }
    if (path.isAbsolute(filePath)) {
      return filePath
    }
    if (!session.cwd) {
      return path.resolve(filePath)
    }

    const resolved = this.fileManager.resolveFilePath(session.id, filePath)
    if (!resolved) {
      throw new Error(`Attachment file not found: ${file.name || filePath}`)
    }
    return resolved
  }

  async _resolveUserAttachmentContent(session, file) {
    if (file && typeof file.content === 'string' && file.content.trim()) {
      return file.content
    }

    if (file && typeof file.contentBase64 === 'string' && file.contentBase64.trim()) {
      const buffer = Buffer.from(file.contentBase64, 'base64')
      return extractUploadedAttachmentText({
        buffer,
        name: file?.name || 'attachment',
        mimeType: file?.mimeType || file?.type || ''
      })
    }

    const filePath = this._resolveUserAttachmentPath(session, file)
    if (!filePath) {
      throw new Error(`Attachment has no readable file reference: ${file?.name || 'file'}`)
    }

    const buffer = await fsp.readFile(filePath)
    return extractUploadedAttachmentText({
      buffer,
      name: file?.name || path.basename(filePath),
      mimeType: file?.mimeType || file?.type || ''
    })
  }

  /**
   * 发送消息到 Agent 会话（Streaming Input 模式）
   *
   * 第一条消息：创建 MessageQueue + 持久 query + 后台输出循环
   * 后续消息：直接 push 到现有 MessageQueue
   */
  async sendMessage(sessionId, userMessage, { model, modelTier, maxTurns, meta, providerId, currentUser } = {}) {
    let session = this.sessions.get(sessionId)
    const requestedModel = model || modelTier

    // 内存中不存在，尝试自动恢复（兜底）
    if (!session) {
      this.reopen(sessionId)
      session = this.sessions.get(sessionId)
    }
    if (!session) {
      throw new Error(`Agent session ${sessionId} not found`)
    }
    if (currentUser) {
      this._assertCanAccessConversation(sessionId, currentUser)
      session.currentUser = currentUser
    }

    const hasActiveMessageQueue = !!(
      session.queryGenerator &&
      session.messageQueue &&
      !session.messageQueue.isDone
    )
    const shouldResetReportFollowupResume = !!(
      session.sdkSessionId &&
      !hasActiveMessageQueue &&
      this._isStandaloneReportConversationLike(session)
    )
    if (shouldResetReportFollowupResume) {
      this._invalidateSdkResume(session, 'report-followup-fresh-send', {
        reportMode: session.reportMode || session.meta?.reportMode || null,
        cwd: session.cwd || null
      })
    }

    console.log('[AgentSession] sendMessage entry:', {
      sessionId,
      requestedModel: requestedModel || null,
      status: session.status,
      hasQueryGenerator: !!session.queryGenerator,
      hasMessageQueue: !!session.messageQueue,
      hasActiveMessageQueue,
      messageQueueDone: session.messageQueue?.isDone ?? null,
      apiProfileId: session.apiProfileId || null,
      sdkSessionId: session.sdkSessionId || null
    })

    if (session.status === AgentStatus.STREAMING && session.queryGenerator && !hasActiveMessageQueue) {
      throw new Error(`Agent session ${sessionId} is already streaming`)
    }

    // 处理多模态消息（兼容旧格式）
    let messageContent
    let displayContent  // 用于存储到数据库的可读内容
    let imageData = null  // 图片数据（用于保存到数据库）
    let fileData = null   // 文件数据（用于保存到数据库）

    if (typeof userMessage === 'string') {
      // 兼容旧格式：纯文本
      messageContent = userMessage
      displayContent = userMessage
    } else if (userMessage && typeof userMessage === 'object') {
      // 新格式：{ text, displayText?, images: [{base64, mediaType}], files: [{name, content}], contextFiles? }
      const { text = '', images = [], files = [] } = userMessage
      const hasDisplayText = typeof userMessage.displayText === 'string'
      const displayText = hasDisplayText
        ? userMessage.displayText.trim()
        : ''
      const visibleText = hasDisplayText ? displayText : text
      const contextFiles = Array.isArray(userMessage.contextFiles)
        ? userMessage.contextFiles
          .filter(file => file && typeof file === 'object')
          .map(file => ({
            id: file.id || file.filePath || file.name,
            name: typeof file.name === 'string' ? file.name : '',
            filePath: typeof file.filePath === 'string' ? file.filePath : '',
            sizeText: typeof file.sizeText === 'string' ? file.sizeText : '',
            contextOnly: Boolean(file.contextOnly)
          }))
          .filter(file => file.name || file.filePath)
        : []
      const hasImages = images.length > 0
      const hasFiles = files.length > 0

      if (hasImages || hasFiles) {
        // 多模态消息：文本 + 图片 + 文件
        messageContent = []

        // 添加文本（如果有）
        if (text) {
          messageContent.push({ type: 'text', text })
        }

        // 添加图片
        for (const img of images) {
          messageContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.mediaType,
              data: img.base64
            }
          })
        }

        // 添加文本文件内容
        for (const file of files) {
          const fileHeader = `\n--- File: ${file.name} ---\n`
          const fileFooter = `\n--- End of ${file.name} ---\n`
          const fileContent = await this._resolveUserAttachmentContent(session, file)
          messageContent.push({
            type: 'text',
            text: fileHeader + fileContent + fileFooter
          })
        }

        // 存储到数据库的显示内容
        const parts = []
        if (visibleText) parts.push(visibleText)
        if (hasImages) parts.push(`[${images.length}张图片]`)
        if (hasFiles) parts.push(`[${files.length}个文件]`)
        displayContent = parts.join(' ') || '[附件]'

        // 保存图片数据到数据库
        if (hasImages) {
          imageData = images
          // 自动保存图片到会话目录
          if (session.cwd) {
            this._saveImagesToDir(session.cwd, imageData)
          }
        }

        // 保存文件数据到数据库
        if (hasFiles || contextFiles.length > 0) {
          fileData = [
            ...(hasFiles ? files : []),
            ...contextFiles
          ]
        }
      } else {
        // 只有文本
        messageContent = text
        displayContent = visibleText
        if (contextFiles.length > 0) {
          fileData = contextFiles
        }
      }
    } else {
      throw new Error('Invalid message format')
    }

    messageContent = rewriteLeadingSkillSlashInvocationContent(messageContent, session.cwd, this.configManager?.userDataPath)

    // 存储用户消息到历史（包含图片和文件数据）
    if (shouldApplyPdfReportGenerationProtocol(userMessage)) {
      messageContent = appendPdfReportGenerationProtocol(messageContent)
    }

    const researchMemoryContext = this._buildResearchMemoryContextForMessage(userMessage, session, meta)
    if (researchMemoryContext) {
      messageContent = appendInternalTextContext(messageContent, researchMemoryContext)
    }
    session.suppressInternalDisclosure = shouldSuppressInternalDisclosureForUserMessage(userMessage)
    session.internalDisclosureBlockSent = false

    const userMsgToStore = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: displayContent,  // 存储简化的可读内容
      timestamp: Date.now()
    }

    // 如果有图片，添加到消息对象
    if (imageData && imageData.length > 0) {
      userMsgToStore.images = imageData
    }

    // 如果有文件，添加到消息对象
    if (fileData && fileData.length > 0) {
      userMsgToStore.files = fileData
    }

    // 附加元数据（如钉钉来源信息）
    if (meta) {
      if (meta.source) userMsgToStore.source = meta.source
      if (meta.senderNick) userMsgToStore.senderNick = meta.senderNick
    }

    this._storeMessage(session, userMsgToStore)

    // 发出用户消息事件（DingTalkBridge 等旁路监听者自行决定是否处理）
    this.emit('userMessage', {
      sessionId: session.id,
      sessionType: session.type,
      content: displayContent,
      images: imageData || null,
      source: meta?.source || null
    })

    // 设置状态
    session.status = AgentStatus.STREAMING
    session.messageCount++
    session.updatedAt = new Date()

    // 通知前端状态变化
    this._safeSend('agent:statusChange', {
      sessionId: session.id,
      status: AgentStatus.STREAMING
    })

    // 构建 SDKUserMessage
    const sdkUserMessage = {
      type: 'user',
      message: { role: 'user', content: messageContent },
      parent_tool_use_id: null,
      session_id: session.sdkSessionId || session.id
    }
    console.log('[AgentSessionManager] sendMessage - sdkUserMessage:', {
      sessionId,
      messageContentType: typeof messageContent,
      isArray: Array.isArray(messageContent),
      contentLength: Array.isArray(messageContent)
        ? messageContent.length
        : typeof messageContent === 'string' ? messageContent.length : 0,
      contentPreview: Array.isArray(messageContent)
        ? messageContent.map(c => ({ type: c.type, textLength: c.text?.length, textPreview: c.text?.substring(0, 50) }))
        : String(messageContent).substring(0, 100)
    })

    // 已有持久 query → 直接 push 消息
    if (session.queryGenerator && session.messageQueue && !session.messageQueue.isDone) {
      console.log('[AgentSession] sendMessage path: existing queue', {
        sessionId,
        requestedModel: requestedModel || null,
        apiProfileId: session.apiProfileId || null,
        sdkSessionId: session.sdkSessionId || null
      })

      // push 前确保模型与当前 provider 兼容；若不兼容则杀旧 CLI 走新建路径
      if (requestedModel) {
        const currentProfile = session.apiProfileId
          ? this.configManager.getAPIProfile(session.apiProfileId) || this.configManager.getDefaultProfile()
          : this.configManager.getDefaultProfile()

        // 尝试直接通过 providerId 查找（更可靠），回退到反向查找
        let switched = false
        let resolvedProfile = currentProfile
        const normalizedModel = normalizeModelValue(requestedModel)
        let resolvedModelId = normalizedModel || null

        if (providerId && currentProfile.serviceProvider !== providerId) {
          const config = this.configManager.getConfig()
          const allProfiles = config?.apiProfiles
          // 同 provider 多 profile 时，优先匹配 selectedModelId 相符的，再回退到第一个
          const targetProfile = allProfiles?.find(p =>
            p.serviceProvider === providerId && isSameModelId(p.selectedModelId, normalizedModel)
          ) || allProfiles?.find(p => p.serviceProvider === providerId)
          if (targetProfile && targetProfile.id !== currentProfile.id) {
            resolvedProfile = targetProfile
            switched = true
            if (isSameModelId(targetProfile.selectedModelId, normalizedModel)) {
              resolvedModelId = normalizeModelValue(targetProfile.selectedModelId)
            }
          }
        }
        if (!switched) {
          const result = this._resolveProfileForModel(currentProfile, normalizedModel)
          resolvedProfile = result.profile
          switched = result.switched
          resolvedModelId = result.modelId || resolvedModelId
        }

        if (switched) {
          const previousProfileId = currentProfile?.id || null
          const previousModelId = this._resolveSessionModelId(session)
          console.log('[AgentSession] sendMessage auto-switching profile before push:', {
            sessionId,
            requestedModel,
            fromProfile: previousProfileId,
            toProfile: resolvedProfile.id
          })
          // 杀旧 CLI，更新 session profile，走新建 query 路径
          session.messageQueue.end()
          session.messageQueue = null
          try { killProcessTree(session.cliPid) } catch {}
          try { session.queryGenerator.close() } catch {}
          session.queryGenerator = null
          session.cliPid = null
          session.apiProfileId = resolvedProfile.id
          session.apiBaseUrl = resolvedProfile.baseUrl || null
          session.modelId = normalizeModelIdOrNull(resolvedModelId)
          this._invalidateSdkResume(session, 'profile-auto-switched-before-send', {
            previousProfileId,
            nextProfileId: resolvedProfile.id,
            previousModelId,
            nextModelId: session.modelId
          })
          this.sessionDatabase?.updateAgentConversation?.(sessionId, {
            apiProfileId: resolvedProfile.id,
            apiBaseUrl: resolvedProfile.baseUrl || null
          })
          this.sessionDatabase?.updateAgentConversationModel?.(sessionId, resolvedModelId)
          session.status = AgentStatus.IDLE
          this._safeSend('agent:statusChange', { sessionId, status: AgentStatus.IDLE })
          // 继续执行到下方"创建新的持久 query"路径
        } else {
          const resolvedRequest = resolveRequestedModel(currentProfile, this.configManager, requestedModel)
          if (resolvedRequest.queryModel) {
            try {
              await session.queryGenerator.setModel(resolvedRequest.queryModel)
              console.log('[AgentSession] setModel before push succeeded:', {
                sessionId,
                requestedModel: resolvedRequest.requestedModel,
                queryModel: resolvedRequest.queryModel,
                apiProfileId: currentProfile?.id || null
              })
            } catch (e) {
              console.warn('[AgentSession] setModel before push failed:', {
                sessionId,
                requestedModel: requestedModel || null,
                error: e.message
              })
            }
          }
          console.log('[AgentSession] Pushing message to existing queue:', {
            sessionId,
            requestedModel: requestedModel || null,
            sdkSessionId: session.sdkSessionId || null
          })
          session.messageQueue.push(sdkUserMessage)
          return
        }
      } else {
        console.log('[AgentSession] Pushing message to existing queue:', {
          sessionId,
          requestedModel: requestedModel || null,
          sdkSessionId: session.sdkSessionId || null
        })
        session.messageQueue.push(sdkUserMessage)
        return
      }
    }

    // 首次消息（或 CLI 进程已退出）→ 创建新的持久 query
    console.log('[AgentSession] sendMessage path: create query', {
      sessionId,
      requestedModel: requestedModel || null,
      hasQueryGenerator: !!session.queryGenerator,
      hasMessageQueue: !!session.messageQueue,
      messageQueueDone: session.messageQueue?.isDone ?? null,
      sdkSessionId: session.sdkSessionId || null
    })
    console.log(`[AgentSessionManager] Creating new streaming query for session ${sessionId} (title: ${session.title})`)

    try {
      // 使用会话创建时绑定的 profile，fallback 到默认
      let sessionProfile = session.apiProfileId
        ? this.configManager.getAPIProfile(session.apiProfileId) || this.configManager.getDefaultProfile()
        : this.configManager.getDefaultProfile()

      if (requestedModel) {
        const resolvedProfileRequest = this._resolveProfileForRequest(sessionProfile, requestedModel, providerId)
        const nextSessionProfile = resolvedProfileRequest.profile || sessionProfile
        const nextRequestedModel = resolvedProfileRequest.modelId || requestedModel
        if (resolvedProfileRequest.switched && nextSessionProfile?.id) {
          const previousProfileId = session.apiProfileId || sessionProfile?.id || null
          const previousModelId = this._resolveSessionModelId(session)
          sessionProfile = nextSessionProfile
          session.apiProfileId = sessionProfile.id
          session.apiBaseUrl = sessionProfile.baseUrl || null
          session.modelId = normalizeModelIdOrNull(nextRequestedModel)
          this._invalidateSdkResume(session, 'profile-auto-switched-before-create-query', {
            previousProfileId,
            nextProfileId: sessionProfile.id,
            previousModelId,
            nextModelId: session.modelId
          })
          this.sessionDatabase?.updateAgentConversation?.(sessionId, {
            apiProfileId: sessionProfile.id,
            apiBaseUrl: sessionProfile.baseUrl || null
          })
          this.sessionDatabase?.updateAgentConversationModel?.(sessionId, nextRequestedModel)
        } else {
          sessionProfile = nextSessionProfile
          if (nextRequestedModel) {
            session.modelId = normalizeModelIdOrNull(nextRequestedModel)
          }
        }
      }

      const env = this.runner.buildEnv(sessionProfile, this.configManager)

      // 创建 MessageQueue
      const messageQueue = new MessageQueue()
      session.messageQueue = messageQueue

      // 构建 runner query 选项
      const config = this.configManager.getConfig()
      const globalPermissionMode = config?.settings?.agent?.permissionMode || 'bypassPermissions'
      const queryOptions = {
        cwd: this._ensureSessionCwd(session),
        env,
        permissionMode: globalPermissionMode,
        tools: { type: 'preset', preset: 'claude_code' },
        onToolPermissionRequest: async ({ toolName, input, toolUseID, title, description, displayName, blockedPath, decisionReason, suggestions }) => {
          if (toolName === 'AskUserQuestion') {
            return this._requestInteraction(session, 'ask_user_question', {
              toolName,
              toolUseID,
              title,
              description,
              displayName,
              questions: input?.questions || []
            })
          }

      const actions = this._buildPermissionActions(suggestions)
      console.log('[AgentSession] Permission interaction request:', {
        sessionId: session.id,
        toolName,
        title,
        description,
        blockedPath,
        suggestionCount: Array.isArray(suggestions) ? suggestions.length : 0,
        suggestions,
        actionKeys: actions.map(item => item.key)
      })

      return this._requestInteraction(session, 'permission_request', {
        toolName,
        toolUseID,
        title,
        description,
        displayName,
        blockedPath,
        decisionReason,
        suggestions,
        actions,
        input
      })
        }
      }

      let appendSystemPrompt = session.source === 'scheduled'
        ? undefined
        : JEDI_IDENTITY_SYSTEM_PROMPT

      try {
        const desktopCapabilityOptions = await buildDesktopCapabilityQueryOptions({
          scheduledTaskService: this.scheduledTaskService,
          weixinNotifyService: this.weixinNotifyService,
          feishuBridge: this.feishuBridge,
          agentComponentCreator: this.agentComponentCreator,
          currentUser: currentUser || session.currentUser || null,
          session
        })
        if (desktopCapabilityOptions?.mcpServers) {
          queryOptions.mcpServers = desktopCapabilityOptions.mcpServers
        }
        if (desktopCapabilityOptions?.appendSystemPrompt) {
          appendSystemPrompt = mergeSystemPrompts(
            appendSystemPrompt,
            desktopCapabilityOptions.appendSystemPrompt
          )
        }
        if (desktopCapabilityOptions?.allowedTools?.length) {
          queryOptions.allowedTools = desktopCapabilityOptions.allowedTools
        }
        if (desktopCapabilityOptions?.disallowedTools?.length) {
          queryOptions.disallowedTools = desktopCapabilityOptions.disallowedTools
        }
      } catch (err) {
        console.warn('[AgentSession] Failed to build desktop capability query options:', err)
      }

      if (appendSystemPrompt) {
        queryOptions.appendSystemPrompt = appendSystemPrompt
      }

      // 优先使用本轮请求模型；没有显式请求时，用会话持久化模型覆盖 profile/Claude 本地默认值。
      // 这样恢复旧会话、/compact 或桥接入口不会落回 Claude Code 自己记录的 model。
      let resolvedRequest = null
      const effectiveRequestedModel = this._resolveSessionModelId(session) || normalizeModelValue(requestedModel)
      if (effectiveRequestedModel) {
        resolvedRequest = resolveRequestedModel(sessionProfile, this.configManager, effectiveRequestedModel)
        if (queryOptions.env && typeof queryOptions.env === 'object' && resolvedRequest.requestedModel) {
          queryOptions.env.ANTHROPIC_MODEL = resolvedRequest.requestedModel
        }
        if (resolvedRequest.queryModel) {
          queryOptions.model = resolvedRequest.queryModel
        }
      }

      if (maxTurns) {
        queryOptions.maxTurns = maxTurns
      }

      const developerClaudeSource = normalizeDeveloperClaudeSource(
        this.configManager?.getConfig?.()?.settings?.developerClaudeSource
      )
      const claudeCodeExecutablePath = resolveClaudeCodeExecutablePath({
        source: developerClaudeSource
      })
      if (!claudeCodeExecutablePath) {
        throw new Error('当前设置为“内置 Claude”，但未找到内置可执行文件')
      }
      queryOptions.pathToClaudeCodeExecutable = claudeCodeExecutablePath

      // resume：恢复历史对话上下文（应用重启、会话重新打开等场景必需）
      // Windows 上旧 Claude Code 会话可能保留上一次 provider/model 状态；如果模型或
      // profile 在 CLI 不活跃时发生变化，下一次启动先不复用旧 sdkSessionId。
      if (session.sdkSessionId && !session.skipNextResume) {
        const claudeConfigDir = queryOptions.env?.CLAUDE_CONFIG_DIR || null
        if (claudeConfigDir && !this._sdkSessionExistsInClaudeConfigDir(session.sdkSessionId, claudeConfigDir)) {
          this._invalidateSdkResume(session, 'missing-sdk-session-file', {
            sdkSessionId: session.sdkSessionId,
            claudeConfigDir
          })
        } else {
          queryOptions.resume = session.sdkSessionId
        }
      } else if (session.sdkSessionId && session.skipNextResume) {
        console.log('[AgentSession] Skipping SDK resume after inactive model/profile change:', {
          sessionId,
          sdkSessionId: session.sdkSessionId,
          requestedModel: requestedModel || null,
          apiProfileId: session.apiProfileId || null
        })
      }

      console.log('[AgentSession] createQuery config:', {
        sessionId,
        apiProfileId: sessionProfile?.id || null,
        profileName: sessionProfile?.name || null,
        profileBaseUrl: sessionProfile?.baseUrl || null,
        claudeCodeExecutablePath,
        requestedModel: requestedModel || null,
        queryModel: queryOptions.model || null,
        resume: queryOptions.resume || null,
        envBaseUrl: env.ANTHROPIC_BASE_URL || env.ANTHROPIC_API_URL || null,
        envModel: env.ANTHROPIC_MODEL || null
      })

      // 通过 Runner 创建持久 query（AsyncIterable 模式）
      const generator = await this.runner.createQuery(messageQueue, queryOptions, session)
      session.queryGenerator = generator

      // push 第一条消息
      messageQueue.push(sdkUserMessage)

      // 启动后台输出循环
      session.outputLoopPromise = this._runOutputLoop(session)

    } catch (error) {
      console.error(`[AgentSession] Failed to create streaming query for session ${sessionId}:`, error)
      session.status = AgentStatus.ERROR
      session.queryGenerator = null
      session.messageQueue = null

      this._safeSend('agent:error', {
        sessionId: session.id,
        error: error.message || 'Failed to start session'
      })
      this._safeSend('agent:statusChange', {
        sessionId: session.id,
        status: session.status
      })
    }
  }

  /**
   * 后台输出循环 — 持续遍历 SDK 输出消息
   * 生成器正常结束 = CLI 进程退出
   */
  async _runOutputLoop(session) {
    try {
      for await (const msg of session.queryGenerator) {
        await this._processMessage(session, msg)
      }

      // 生成器正常结束（CLI 进程退出）
      console.log(`[AgentSession] Output loop ended normally for session ${session.id}`)
      session.status = AgentStatus.IDLE

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`[AgentSession] Output loop aborted for session ${session.id}`)
        session.status = AgentStatus.IDLE
      } else {
        console.error(`[AgentSession] Output loop error for session ${session.id}:`, error)
        session.status = AgentStatus.ERROR

        this._safeSend('agent:error', {
          sessionId: session.id,
          error: error.message || 'Session error'
        })
        // 主进程内部事件（DingTalkBridge 监听）
        this.emit('agentError', session.id, error.message || 'Session error')

      }
    } finally {
      this._cleanupPendingInteractions(session, 'Session closed')
      // 清理引用
      session.queryGenerator = null
      session.messageQueue = null
      session.outputLoopPromise = null

      // CLI 进程异常退出时通知前端；即使 stderr 为空，也要把退出码透出给 UI。
      if (session._lastCliExitCode != null && session._lastCliExitCode !== 0) {
        this._safeSend('agent:cliError', {
          sessionId: session.id,
          exitCode: session._lastCliExitCode,
          stderr: session._lastCliStderr
        })
      }
      const cliExitWasError = session.status === AgentStatus.ERROR
        || (session._lastCliExitCode != null && session._lastCliExitCode !== 0)
      const sessionStatus = cliExitWasError ? AgentStatus.ERROR : session.status

      session.cliPid = null
      session._lastCliExitCode = null
      session._lastCliStderr = null

      if (session.preserveSessionOnQueryExit) {
        session.preserveSessionOnQueryExit = false
        this._safeSend('agent:statusChange', {
          sessionId: session.id,
          status: sessionStatus,
          activeSessionEnded: true
        })
        return
      }

      // 结束当前激活连接：从内存 Map 中移除会话。
      // 注意：异常退出不应被视为“用户主动关闭会话”，因此不在这里写 closed。
      const sessionId = session.id
      this.sessions.delete(sessionId)
      console.log(`[AgentSessionManager] Session ${sessionId} removed from memory after CLI exit`)

      this._safeSend('agent:statusChange', {
        sessionId: session.id,
        status: sessionStatus,
        cliExited: true,
        cliExitWasError
      })
    }
  }

  /**
   * 存储消息到会话历史（内存 + DB）
   */
  _storeMessage(session, msg) {
    session.messages.push(msg)

    // 写入数据库
    if (this.sessionDatabase && session.dbConversationId) {
      try {
        let contentToSave = msg.content

        // 如果消息包含图片、文件或元数据（钉钉来源），将 content 合并为对象保存
        const hasMeta = msg.source || msg.senderNick
        if ((msg.images && msg.images.length > 0) || (msg.files && msg.files.length > 0) || hasMeta) {
          contentToSave = {
            text: msg.content || '',
            ...(msg.images?.length > 0 && { images: msg.images }),
            ...(msg.files?.length > 0 && { files: msg.files }),
            ...(msg.source && { source: msg.source }),
            ...(msg.senderNick && { senderNick: msg.senderNick })
          }
        }

        // 序列化 content（如果是对象/数组，转为 JSON 字符串）
        if (contentToSave && typeof contentToSave === 'object') {
          contentToSave = JSON.stringify(contentToSave)
        }

        this.sessionDatabase.insertAgentMessage(session.dbConversationId, {
          msgId: msg.id,
          role: msg.role,
          content: contentToSave || null,
          toolName: msg.toolName || null,
          toolInput: msg.input || null,
          toolOutput: msg.output || null,
          thinking: msg.thinking || null,
          timestamp: msg.timestamp
        })
      } catch (err) {
        console.error('[AgentSession] Failed to insert message to DB:', err)
      }
    }
  }

  _rememberAssistantReportMarkdown(session, text) {
    const normalized = String(text || '').trim()
    if (!session || !normalized) return

    if (isInvestmentResearchReportStart(normalized)) {
      session.pendingAssistantReportMarkdown = normalized
      return
    }

    if (session.pendingAssistantReportMarkdown && isInvestmentResearchReportFragment(normalized)) {
      session.pendingAssistantReportMarkdown = [
        session.pendingAssistantReportMarkdown,
        normalized
      ].join('\n\n').trim()
    }
  }

  _autoSavePendingAssistantReportMarkdown(session) {
    const markdown = String(session?.pendingAssistantReportMarkdown || '').trim()
    if (!markdown || !session?.cwd || !isCompleteInvestmentResearchReport(markdown)) return null

    try {
      fs.mkdirSync(session.cwd, { recursive: true })
      const content = `${markdown.trimEnd()}\n`
      const title = extractReportTitleFromText(markdown) || session.title || '报告'
      const baseName = safeMarkdownFileBaseName(title, '报告')
      const firstPath = path.join(session.cwd, `${baseName}.md`)
      const shouldOverwrite = this._isStandaloneReportConversationLike(session)

      if (fs.existsSync(firstPath)) {
        try {
          if (fs.readFileSync(firstPath, 'utf8') === content) {
            session.pendingAssistantReportMarkdown = ''
            return firstPath
          }
        } catch {}
      }

      const filePath = shouldOverwrite ? firstPath : resolveUniqueMarkdownFilePath(session.cwd, title)
      fs.writeFileSync(filePath, content, 'utf8')
      session.pendingAssistantReportMarkdown = ''
      return filePath
    } catch (err) {
      console.warn('[AgentSession] Failed to auto-save assistant report markdown:', err.message)
      return null
    }
  }

  _findPendingToolMessage(session, parentToolUseId = null) {
    if (!session?.messages?.length) return null

    if (parentToolUseId) {
      const matched = [...session.messages]
        .reverse()
        .find(msg => msg.role === 'tool' && msg.toolUseId === parentToolUseId)
      if (matched) return matched
    }

    return [...session.messages]
      .reverse()
      .find(msg => msg.role === 'tool' && !msg.output)
  }

  _normalizeToolResultPayload(msg) {
    const contentBlocks = Array.isArray(msg.content) ? msg.content : []
    const toolResultBlock = contentBlocks.find(block => block?.type === 'tool_result') || null
    const rawResult = msg.toolUseResult && typeof msg.toolUseResult === 'object'
      ? msg.toolUseResult
      : null

    const resultContent = Array.isArray(rawResult?.content)
      ? rawResult.content
      : Array.isArray(toolResultBlock?.content)
        ? toolResultBlock.content
        : []
    const structuredContent = rawResult?.structuredContent || toolResultBlock?.structured_content || null
    const isError = Boolean(rawResult?.isError ?? toolResultBlock?.is_error)

    if (resultContent.length === 0 && !structuredContent && !isError) {
      return null
    }

    return {
      type: 'tool_result',
      parentToolUseId: msg.parentToolUseId || toolResultBlock?.tool_use_id || null,
      content: resultContent,
      structuredContent,
      isError
    }
  }

  /**
   * 处理单条 Runner 标准消息
   * Runner.normalizeMessage() 已将 SDK 原始格式转为内部标准格式
   */
  async _processMessage(session, rawMsg) {
    const msg = this.runner.normalizeMessage(rawMsg)

    switch (msg.type) {
      case 'init':
        session.sdkSessionId = msg.sdkSessionId
        session.skipNextResume = false
        this._safeSend('agent:init', {
          sessionId: session.id,
          sdkSessionId: msg.sdkSessionId,
          tools: msg.tools,
          model: msg.model,
          slashCommands: msg.slashCommands
        })
        if (this.sessionDatabase) {
          try {
            this.sessionDatabase.updateAgentConversation(session.id, {
              sdkSessionId: msg.sdkSessionId
            })
          } catch (err) {
            console.error('[AgentSession] Failed to update sdk_session_id:', err)
          }
        }
        break

      case 'compact_done':
        console.log(`[AgentSession] Compact completed for session ${session.id}, pre_tokens=${msg.preTokens}, trigger=${msg.trigger}`)
        this._safeSend('agent:compacted', {
          sessionId: session.id,
          preTokens: msg.preTokens,
          trigger: msg.trigger
        })
        break

      case 'system_status':
        this._safeSend('agent:systemStatus', {
          sessionId: session.id,
          status: msg.status
        })
        break

      case 'assistant_message': {
        const shouldBlockInternalDisclosure = Boolean(session.suppressInternalDisclosure)
        const sanitizedContent = sanitizeAssistantContentBlocks(msg.content, {
          suppressInternalDisclosure: shouldBlockInternalDisclosure,
          internalDisclosureBlockSent: Boolean(session.internalDisclosureBlockSent)
        })
        if (shouldBlockInternalDisclosure && sanitizedContent.length > 0) {
          session.internalDisclosureBlockSent = true
        }
        const assistantData = {
          type: 'assistant',
          content: sanitizedContent,
          uuid: msg.uuid,
          sessionId: msg.sdkSessionId
        }
        if (sanitizedContent.length > 0) {
          this._safeSend('agent:message', {
            sessionId: session.id,
            message: assistantData
          })
          this.emit('agentMessage', session.id, assistantData)
        }
        // 主进程内部事件（DingTalkBridge 监听）
        if (msg.usage) {
          this._safeSend('agent:usage', {
            sessionId: session.id,
            usage: msg.usage
          })
        }
        let thinkingText = ''
        for (const block of sanitizedContent) {
          if (block.type === 'thinking') {
            thinkingText += block.thinking || ''
          }
        }
        const fallbackThinkingText = session.pendingThinkingText || ''
        const persistedThinkingText = thinkingText || fallbackThinkingText
        let storedTextMessage = false
        for (const block of sanitizedContent) {
          if (block.type === 'text') {
            const text = typeof block.text === 'string' ? block.text : ''
            if (!text.trim() && !persistedThinkingText.trim()) continue
            this._storeMessage(session, {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'assistant',
              content: text,
              thinking: persistedThinkingText || undefined,
              timestamp: Date.now()
            })
            storedTextMessage = true
          } else if (block.type === 'tool_use') {
            if (block.name === 'AskUserQuestion') continue
            this._storeMessage(session, {
              id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              role: 'tool',
              toolName: block.name,
              toolUseId: block.id || block.tool_use_id || block.toolUseID || null,
              input: block.input,
              output: null,
              timestamp: Date.now()
            })
          }
        }
        if (!storedTextMessage && persistedThinkingText.trim()) {
          this._storeMessage(session, {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: '',
            thinking: persistedThinkingText,
            timestamp: Date.now()
          })
        }
        if (persistedThinkingText) {
          session.pendingThinkingText = ''
        }
        this._rememberAssistantReportMarkdown(session, getTextFromContentBlocks(sanitizedContent))
        if (shouldBlockInternalDisclosure) session.pendingThinkingText = ''
        break
      }

      case 'user_message': {
        const toolResult = this._normalizeToolResultPayload(msg)
        if (!toolResult) break

        const targetMessage = this._findPendingToolMessage(session, toolResult.parentToolUseId)
        if (!targetMessage) {
          console.warn('[AgentSession] Received tool result without matching tool message:', toolResult.parentToolUseId)
          break
        }

        targetMessage.output = toolResult

        if (this.sessionDatabase && session.dbConversationId) {
          try {
            this.sessionDatabase.updateAgentMessageToolOutput(targetMessage.id, toolResult)
          } catch (err) {
            console.error('[AgentSession] Failed to persist tool result:', err)
          }
        }

        this._safeSend('agent:message', {
          sessionId: session.id,
          message: {
            type: 'tool_result',
            parentToolUseId: toolResult.parentToolUseId,
            toolUseId: targetMessage.toolUseId || null,
            toolResult
          }
        })
        break
      }

      case 'stream_event':
        if (session.suppressInternalDisclosure) {
          session.pendingThinkingText = ''
          break
        }
        if (msg.event?.type === 'content_block_start' && msg.event?.content_block?.type === 'thinking') {
          session.pendingThinkingText = [
            session.pendingThinkingText || '',
            msg.event.content_block.thinking || ''
          ].filter(Boolean).join('')
        }
        if (msg.event?.type === 'content_block_delta' && msg.event?.delta?.type === 'thinking_delta') {
          session.pendingThinkingText = [
            session.pendingThinkingText || '',
            msg.event.delta.thinking || ''
          ].filter(Boolean).join('')
        }
        this._safeSend('agent:stream', {
          sessionId: session.id,
          event: msg.event
        })
        break

      case 'result':
        if (session.suppressInternalDisclosure) {
          session.pendingThinkingText = ''
          session.suppressInternalDisclosure = false
          session.internalDisclosureBlockSent = false
        }
        if (session.pendingThinkingText?.trim()) {
          this._storeMessage(session, {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            content: '',
            thinking: session.pendingThinkingText,
            timestamp: Date.now()
          })
          session.pendingThinkingText = ''
        }
        this._autoSavePendingAssistantReportMarkdown(session)
        session.totalCostUsd += msg.totalCostUsd || 0
        session.status = AgentStatus.IDLE
        this._safeSend('agent:result', {
          sessionId: session.id,
          result: {
            subtype: msg.subtype,
            isError: msg.isError,
            result: msg.result,
            totalCostUsd: msg.totalCostUsd,
            numTurns: msg.numTurns,
            durationMs: msg.durationMs,
            usage: msg.usage,
            modelUsage: msg.modelUsage
          }
        })
        this._safeSend('agent:statusChange', {
          sessionId: session.id,
          status: AgentStatus.IDLE
        })
        // 主进程内部事件（DingTalkBridge 监听）
        this.emit('agentResult', session.id)
        if (this.sessionDatabase) {
          try {
            this.sessionDatabase.updateAgentConversation(session.id, {
              totalCostUsd: session.totalCostUsd,
              messageCount: session.messageCount
            })
            session.updatedAt = new Date()
          } catch (err) {
            console.error('[AgentSession] Failed to update result stats:', err)
          }
        }
        break

      case 'tool_progress':
        this._safeSend('agent:toolProgress', {
          sessionId: session.id,
          toolUseId: msg.toolUseId,
          toolName: msg.toolName,
          elapsedSeconds: msg.elapsedSeconds
        })
        break

      default:
        this._safeSend('agent:otherMessage', {
          sessionId: session.id,
          message: rawMsg
        })
    }
  }

  /**
   * 取消当前生成（使用 interrupt，不杀 CLI 进程）
   */
  async cancel(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // Streaming input 模式：使用 interrupt() 中断当前生成
    if (session.queryGenerator) {
      try {
        await session.queryGenerator.interrupt()
        console.log(`[AgentSession] Interrupted session ${sessionId}`)
      } catch (e) {
        console.warn(`[AgentSession] interrupt() failed for ${sessionId}, falling back to close:`, e.message)
        // fallback: close() 杀掉 CLI 进程
        killProcessTree(session.cliPid)
        try { session.queryGenerator.close() } catch {}
        session.queryGenerator = null
        session.cliPid = null
        if (session.messageQueue) {
          session.messageQueue.end()
          session.messageQueue = null
        }
      }
    }

    session.status = AgentStatus.IDLE

    this._safeSend('agent:statusChange', {
      sessionId: session.id,
      status: AgentStatus.IDLE
    })
  }

  /**
   * Switch API profile and discard stale SDK resume state.
   */
  async switchApiProfile(sessionId, newProfileId) {
    let session = this.sessions.get(sessionId)
    if (!session) {
      this.reopen(sessionId)
      session = this.sessions.get(sessionId)
    }
    if (!session) throw new Error('Session not found')

    const profile = this.configManager.getAPIProfile(newProfileId)
    if (!profile) throw new Error('API Profile not found: ' + newProfileId)
    const previousProfileId = session.apiProfileId || null
    const previousModelId = this._resolveSessionModelId(session)

    // 终止当前 CLI 进程（若有）
    if (session.messageQueue) {
      session.messageQueue.end()
      session.messageQueue = null
    }
    if (session.queryGenerator) {
      session.preserveSessionOnQueryExit = true
      try { killProcessTree(session.cliPid) } catch {}
      try { session.queryGenerator.close() } catch {}
      session.queryGenerator = null
      session.cliPid = null
    }

    // 更新 apiProfileId（内存 + DB）
    session.apiProfileId = newProfileId
    session.apiBaseUrl = profile.baseUrl || null
    session.modelId = normalizeModelIdOrNull(profile.selectedModelId)
    if (previousProfileId !== newProfileId || previousModelId !== session.modelId) {
      this._invalidateSdkResume(session, 'api-profile-switched', {
        previousProfileId,
        nextProfileId: newProfileId,
        previousModelId,
        nextModelId: session.modelId
      })
    }
    console.log('[AgentSession] switchApiProfile:', {
      sessionId,
      newProfileId,
      profileName: profile.name || null,
      profileBaseUrl: profile.baseUrl || null,
      modelId: session.modelId,
      sdkSessionId: session.sdkSessionId || null
    })
    this.sessionDatabase.updateAgentConversation(sessionId, {
      apiProfileId: newProfileId,
      apiBaseUrl: profile.baseUrl || null
    })
    this.sessionDatabase.updateAgentConversationModel(sessionId, session.modelId)

    session.status = AgentStatus.IDLE
    this._safeSend('agent:statusChange', { sessionId, status: AgentStatus.IDLE })
    return {
      success: true,
      apiProfileId: session.apiProfileId,
      apiBaseUrl: session.apiBaseUrl,
      modelId: session.modelId
    }
  }

  /**
   * 清空并重建会话：新建 fresh session 并切换过去，旧会话保留历史但退出当前上下文
   * @param {string} sessionId - 旧会话 ID
   * @param {object} overrides - 可选覆盖参数 { type, title, cwd, cwdSubDir }
   * @returns {object} 新会话的 JSON 表示
   */
  async clearAndRecreate(sessionId, overrides = {}, options = {}) {
    this._assertCanAccessConversation(sessionId, options.currentUser)
    const oldSession = this.sessions.get(sessionId)
    if (!oldSession) {
      throw new Error(`Agent session ${sessionId} not found`)
    }

    // 继承必要配置
    const newType = overrides.type || oldSession.type
    const newTitle = overrides.title !== undefined ? overrides.title : '' // 新会话默认空标题，由首条消息触发自动命名
    const newCwd = overrides.cwd || oldSession.cwd
    const newApiProfileId = oldSession.apiProfileId
    const newModelId = this._resolveSessionModelId(oldSession)

    // 软关闭旧会话（保留历史）
    await this.close(sessionId, options)

    // 创建全新会话（新 session.id，新 DB 记录）
    const newSession = this.create({
      type: newType,
      title: newTitle,
      cwd: newCwd,
      apiProfileId: newApiProfileId,
      modelId: newModelId,
      ownerUserId: options.currentUser?.id || overrides.ownerUserId || null,
      cwdSubDir: overrides.cwdSubDir
    })

    console.log(`[AgentSession] Cleared and recreated session: ${sessionId} -> ${newSession.id}`)
    return newSession
  }

  /**
   * 关闭会话（终止持久 CLI 进程 + DB 标记 closed + 内存移除）
   */
  async close(sessionId, options = {}) {
    this._assertCanAccessConversation(sessionId, options.currentUser)
    const session = this.sessions.get(sessionId)
    if (!session) return

    this._cleanupPendingInteractions(session, 'Session closed')

    // 结束 MessageQueue（让 SDK 的 for-await 正常退出）
    if (session.messageQueue) {
      session.messageQueue.end()
      session.messageQueue = null
    }

    // 关闭 generator（杀 CLI 进程）
    if (session.queryGenerator) {
      killProcessTree(session.cliPid)
      try { session.queryGenerator.close() } catch {}
      session.queryGenerator = null
      session.cliPid = null
    }

    // 等待输出循环结束，避免后续引用已清理的资源
    if (session.outputLoopPromise) {
      try {
        await Promise.race([
          session.outputLoopPromise,
          new Promise(resolve => setTimeout(resolve, 3000))  // 最多等 3 秒
        ])
      } catch {}
      session.outputLoopPromise = null
    }

    // DB 软关闭
    if (this.sessionDatabase) {
      try {
        this.sessionDatabase.closeAgentConversation(sessionId)
      } catch (err) {
        console.error('[AgentSession] Failed to close in DB:', err)
      }
    }

    // 从内存 Map 移除
    this.sessions.delete(sessionId)
    console.log(`[AgentSession] Closed session ${sessionId}`)
  }

  /**
   * 关闭所有会话（异步，逐个等待）
   */
  async closeAll() {
    for (const sessionId of [...this.sessions.keys()]) {
      await this.close(sessionId)
    }
  }

  /**
   * 同步关闭所有会话（用于 closed / will-quit 等无法 await 的事件）
   * 直接杀 CLI 进程 + DB 软关闭 + 清内存，不等待 outputLoopPromise
   */
  closeAllSync() {
    const count = this.sessions.size
    if (count === 0) return
    for (const [sessionId, session] of this.sessions) {
      this._cleanupPendingInteractions(session, 'Session closed')
      // 异常关闭 MessageQueue（清空缓冲区 + 结束）
      if (session.messageQueue) {
        session.messageQueue.abort()
        session.messageQueue = null
      }
      // 同步 close generator（杀 CLI 进程）
      killProcessTree(session.cliPid)
      if (session.queryGenerator) {
        try {
          session.queryGenerator.close()
        } catch (e) {
          console.warn(`[AgentSession] close() failed for ${sessionId}:`, e.message)
        }
        session.queryGenerator = null
      }
      session.cliPid = null
      // DB 软关闭（better-sqlite3 是同步的）
      if (this.sessionDatabase) {
        try { this.sessionDatabase.closeAgentConversation(sessionId) } catch {}
      }
      // 清理内存引用
      session.outputLoopPromise = null
      this.emit('agentInterrupted', sessionId, { reason: 'host-cleanup' })
    }
    this.sessions.clear()
    console.log(`[AgentSession] ${count} session(s) closed synchronously`)
  }

  /**
   * 通知前端所有 Agent 会话已关闭
   * macOS: 窗口重建后调用，让前端刷新 Agent 会话列表并重置状态
   */
  notifyAllSessionsClosed() {
    this._safeSend('agent:allSessionsClosed', {})
  }

  /**
   * 获取会话
   */
  get(sessionId, options = {}) {
    this._assertCanAccessConversation(sessionId, options.currentUser)
    const session = this.sessions.get(sessionId)
    return session ? this._serializeSession(session) : null
  }

  /**
   * 通过 SDK 启用/禁用 MCP 服务器（等效于 /mcp enable|disable，立即生效）
   * @param {string} sessionId - Agent 会话 ID
   * @param {string} name - MCP 服务器名称
   * @param {boolean} enabled - true=启用，false=禁用
   */
  async toggleMcp(sessionId, name, enabled) {
    const session = this.sessions.get(sessionId)
    if (!session?.queryGenerator) {
      return { success: false, error: '当前会话无活跃连接，无法切换 MCP 状态' }
    }
    try {
      await session.queryGenerator.toggleMcpServer(name, enabled)
      console.log(`[AgentSession] toggleMcp: ${name} enabled=${enabled} for session ${sessionId}`)
      return { success: true }
    } catch (err) {
      console.error(`[AgentSession] toggleMcp error:`, err)
      return { success: false, error: err.message }
    }
  }

  /**
   * 获取所有会话列表（合并内存活跃 + DB 历史，去重）
   */
  list(options = {}) {
    const currentUser = options.currentUser || null
    // 1. 内存中的活跃会话
    const activeIds = new Set()
    const result = []

    for (const session of this.sessions.values()) {
      if (currentUser && !this.sessionDatabase?.canAccessAgentConversation?.(session.id, {
        userId: currentUser.id,
        isAdmin: currentUser.isAdmin
      })) {
        continue
      }
      if (this._isHiddenConversationHistorySource(session)) continue
      if (!this._isStandaloneReportConversationLike(session)) {
        result.push(this._serializeSession(session))
        activeIds.add(session.id)
      }
    }

    // 2. 从 DB 加载历史会话（排除 notebook 类型）
    if (this.sessionDatabase) {
      try {
        const dbConversations = currentUser && this.sessionDatabase.listAgentConversationsForUser
          ? this.sessionDatabase.listAgentConversationsForUser({
              userId: currentUser.id,
              isAdmin: currentUser.isAdmin,
              limit: 100
            })
          : this.sessionDatabase.listAllAgentConversations({ limit: 100 })
        for (const row of dbConversations) {
          if (this._isHiddenConversationHistorySource(row)) continue
          if (this._isStandaloneReportConversationLike(row)) continue // 报告入口独立展示，不进入左侧历史
          if (activeIds.has(row.session_id)) continue  // 去重
          result.push({
            id: row.session_id,
            type: row.type,
            status: row.status,
            sdkSessionId: row.sdk_session_id,
            title: row.title || '',
            cwd: row.cwd,
            cwdAuto: !!row.cwd_auto,
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
            updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
            messageCount: row.message_count || 0,
            totalCostUsd: row.total_cost_usd || 0,
            apiProfileId: row.api_profile_id || null,
            apiBaseUrl: row.api_base_url || null,
            modelId: normalizeModelIdOrNull(row.model_id),
            source: resolveConversationSource(row.type, row.source),
            taskId: row.task_id || null,
            reportMode: row.report_mode || null,
            reportFilePath: row.report_file_path || null
          })
        }
      } catch (err) {
        console.error('[AgentSession] Failed to load DB conversations:', err)
      }
    }

    // 按 updatedAt 降序排序（最近访问/活跃的在前）
    result.sort((a, b) => {
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return tb - ta
    })

    return result
  }

  /**
   * 重命名会话（同步内存 + DB + 通知前端）
   */
  rename(sessionId, newTitle, options = {}) {
    this._assertCanAccessConversation(sessionId, options.currentUser)
    const session = this.sessions.get(sessionId)
    if (!session) {
      // 尝试只更新 DB（历史会话可能不在内存中）
      if (this.sessionDatabase) {
        this.sessionDatabase.updateAgentConversationTitle(sessionId, newTitle)
      }
      this._safeSend('agent:renamed', { sessionId, title: newTitle })
      return { id: sessionId, title: newTitle }
    }

    // 更新内存
    session.title = newTitle

    // 更新 DB
    if (this.sessionDatabase) {
      try {
        this.sessionDatabase.updateAgentConversationTitle(sessionId, newTitle)
      } catch (err) {
        console.error('[AgentSession] Failed to update title in DB:', err)
      }
    }

    // 通知前端
    this._safeSend('agent:renamed', { sessionId, title: newTitle })

    console.log(`[AgentSession] Renamed session ${sessionId} to: ${newTitle}`)
    return session.toJSON()
  }

  /**
   * 获取会话消息历史（DB 优先，确保历史完整；内存兜底）
   *
   * 注意：_storeMessage 同步写入内存和 DB，DB 始终完整。
   * 若采用"内存优先"，当 sendMessage 在 loadMessages() 之前被调用时（如钉钉恢复场景），
   * session.messages 仅含当前新消息，导致历史无法渲染。
   */
  getMessages(sessionId, options = {}) {
    this._assertCanAccessConversation(sessionId, options.currentUser)
    const session = this.sessions.get(sessionId)

    // 1. DB 优先查询（DB 始终包含完整历史 + 当前消息）
    if (this.sessionDatabase) {
      try {
        const conv = this.sessionDatabase.getAgentConversation(sessionId)
        if (!conv) return session ? session.messages : []

        const dbMessages = this.sessionDatabase.getAgentMessagesByConversationId(conv.id)
        if (dbMessages.length === 0) return session ? session.messages : []

        // 转换 snake_case → camelCase
        const messages = dbMessages.map(row => {
          // 反序列化 content（如果是 JSON 字符串，解析为对象/数组）
          let content = row.content || undefined
          let images = undefined
          let files = undefined
          let source = undefined
          let senderNick = undefined

          if (content && typeof content === 'string') {
            // 检测是否为 JSON 字符串（以 { 或 [ 开头）
            const trimmed = content.trim()
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              try {
                const parsed = JSON.parse(content)
                // 如果是扩展消息格式 { text, images?, files?, source?, senderNick? }
                if (parsed && typeof parsed === 'object' && ('images' in parsed || 'files' in parsed || 'source' in parsed)) {
                  content = parsed.text || ''
                  images = parsed.images
                  files = parsed.files
                  source = parsed.source
                  senderNick = parsed.senderNick
                } else {
                  content = parsed
                }
              } catch {
                // 解析失败，保持原字符串
              }
            }
          }

          const message = {
            id: row.msg_id,
            role: row.role,
            content,
            toolName: row.tool_name || undefined,
            input: row.tool_input ? (() => { try { return JSON.parse(row.tool_input) } catch { return undefined } })() : undefined,
            output: row.tool_output ? (() => { try { return JSON.parse(row.tool_output) } catch { return undefined } })() : undefined,
            thinking: row.thinking || undefined,
            timestamp: row.timestamp
          }

          // 如果有图片，添加到消息对象
          if (images && images.length > 0) {
            message.images = images
          }
          // 如果有文件，添加到消息对象
          if (files && files.length > 0) {
            message.files = files
          }
          // 恢复钉钉来源元数据
          if (source) message.source = source
          if (senderNick) message.senderNick = senderNick

          return message
        })

        // 如果 session 在内存，把 DB 消息回填到内存（后续新消息会追加）
        if (session) {
          session.messages = messages
        }

        return messages
      } catch (err) {
        console.error('[AgentSession] Failed to load messages from DB:', err)
      }
    }

    // 2. 兜底：DB 不可用或出错时，返回内存中的消息
    return session ? session.messages : []
  }

  /**
   * 物理删除对话（终止 CLI + 内存 + DB）
   */
  async deleteConversation(sessionId, options = {}) {
    this._assertCanAccessConversation(sessionId, options.currentUser)
    let persistedConversation = null
    if (this.sessionDatabase?.getAgentConversation) {
      try {
        persistedConversation = this.sessionDatabase.getAgentConversation(sessionId)
      } catch (err) {
        console.warn('[AgentSession] Failed to load conversation before delete:', {
          sessionId,
          error: err.message
        })
      }
    }

    // 从内存移除（如果存在）
    const session = this.sessions.get(sessionId)
    if (session) {
      this._rememberConversationStandaloneReport(session)
    } else {
      this._rememberConversationStandaloneReport(persistedConversation)
    }

    if (session) {
      // 终止持久 CLI 进程
      if (session.messageQueue) {
        session.messageQueue.end()
      }
      killProcessTree(session.cliPid)
      if (session.queryGenerator) {
        try { session.queryGenerator.close() } catch {}
      }
      session.cliPid = null

      // 等待输出循环结束，避免 finally 块发送 stale 事件
      if (session.outputLoopPromise) {
        try {
          await Promise.race([
            session.outputLoopPromise,
            new Promise(resolve => setTimeout(resolve, 3000))
          ])
        } catch {}
      }

      this.sessions.delete(sessionId)
    }

    // 从 DB 删除
    if (this.sessionDatabase) {
      try {
        this.sessionDatabase.deleteAgentConversation(sessionId)
      } catch (err) {
        console.error('[AgentSession] Failed to delete from DB:', err)
      }
    }

    console.log(`[AgentSession] Deleted session ${sessionId}`)
    this.emit('agentDeleted', sessionId)
    return { success: true }
  }

  /**
   * 压缩会话上下文
   * Streaming input 模式：直接 push /compact 消息到现有 queue
   * 无持久会话时：通过 sendMessage 发送（会创建新 query）
   */
  async compactConversation(sessionId) {
    let session = this.sessions.get(sessionId)

    if (!session) {
      this.reopen(sessionId)
      session = this.sessions.get(sessionId)
    }
    if (!session) {
      throw new Error(`Agent session ${sessionId} not found`)
    }
    if (session.status === AgentStatus.STREAMING) {
      throw new Error('Session is currently streaming')
    }

    // 有持久 query → 直接 push /compact 命令
    if (session.queryGenerator && session.messageQueue && !session.messageQueue.isDone) {
      session.status = AgentStatus.STREAMING
      this._safeSend('agent:statusChange', {
        sessionId: session.id,
        status: AgentStatus.STREAMING
      })

      console.log(`[AgentSession] Pushing /compact to messageQueue for session ${sessionId}`)
      session.messageQueue.push({
        type: 'user',
        message: { role: 'user', content: '/compact' },
        parent_tool_use_id: null,
        session_id: session.sdkSessionId || session.id
      })
      return
    }

    // 无持久 query（CLI 已退出）→ 通过 sendMessage 发送
    if (!session.sdkSessionId) {
      throw new Error('No active SDK session to compact')
    }
    await this.sendMessage(sessionId, '/compact', { maxTurns: 1 })
  }

  /**
   * 获取输出目录路径
   */
  getOutputDir(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    return session.cwd
  }

  /**
   * 列出输出文件
   */
  listOutputFiles(sessionId) {
    const session = this.sessions.get(sessionId)
    let cwd = session?.cwd || null

    if (!cwd && this.sessionDatabase?.getAgentConversation) {
      try {
        const persisted = this.sessionDatabase.getAgentConversation(sessionId)
        cwd = persisted?.cwd || null
      } catch (err) {
        console.warn('[AgentSession] Failed to load persisted output dir:', {
          sessionId,
          error: err.message
        })
      }
    }

    if (!cwd) return []

    try {
      if (!fs.existsSync(cwd)) return []
      const entries = fs.readdirSync(cwd, { withFileTypes: true })
      return entries
        .filter(entry => !isInternalAgentFileName(entry.name))
        .map(entry => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
          path: path.join(cwd, entry.name)
        }))
    } catch (err) {
      console.error('[AgentSession] Failed to list output files:', err)
      return []
    }
  }

  // ============= 文件操作委托（委托给 fileManager） =============

  /**
   * 解析文件完整路径（供外部打开使用）
   */
  _getHiddenGeneratedReportKeys() {
    const keys = this.configManager?.getConfig?.()?.settings?.hiddenGeneratedReportKeys
    return Array.isArray(keys)
      ? [...new Set(keys.filter(key => typeof key === 'string' && key.trim()))]
      : []
  }

  _saveHiddenGeneratedReportKeys(keys) {
    const config = this.configManager?.getConfig?.() || {}
    const nextSettings = {
      ...(config.settings || {}),
      hiddenGeneratedReportKeys: [...new Set(Array.isArray(keys) ? keys : [])]
    }

    if (typeof this.configManager?.updateConfig === 'function') {
      this.configManager.updateConfig({ settings: nextSettings })
    }
  }

  _getStandaloneGeneratedReportIndex() {
    const entries = this.configManager?.getConfig?.()?.settings?.standaloneGeneratedReportIndex
    return Array.isArray(entries)
      ? entries
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => ({
          mode: this._normalizeStandaloneReportMode(entry.mode),
          filePath: typeof entry.filePath === 'string' ? entry.filePath.trim() : '',
          updatedAt: Number(entry.updatedAt || 0)
        }))
        .filter(entry => entry.mode && entry.filePath)
      : []
  }

  _saveStandaloneGeneratedReportIndex(entries) {
    const config = this.configManager?.getConfig?.() || {}
    const nextSettings = {
      ...(config.settings || {}),
      standaloneGeneratedReportIndex: Array.isArray(entries) ? entries : []
    }

    if (typeof this.configManager?.updateConfig === 'function') {
      this.configManager.updateConfig({ settings: nextSettings })
    }
  }

  _rememberStandaloneGeneratedReport(mode, filePath) {
    const normalizedMode = this._normalizeStandaloneReportMode(mode)
    const normalizedPath = typeof filePath === 'string' ? filePath.trim() : ''
    if (!normalizedMode || !normalizedPath || !this._generatedReportPathExists(normalizedPath)) return false

    const entries = this._getStandaloneGeneratedReportIndex()
    const key = `${normalizedMode}:${normalizedPath}`
    const nextEntry = {
      mode: normalizedMode,
      filePath: normalizedPath,
      updatedAt: Date.now()
    }
    const nextEntries = [
      nextEntry,
      ...entries.filter(entry => `${entry.mode}:${entry.filePath}` !== key)
    ]
    this._saveStandaloneGeneratedReportIndex(nextEntries)
    return true
  }

  _rememberConversationStandaloneReport(conversation) {
    if (!conversation || typeof conversation !== 'object') return false
    const mode = this._normalizeStandaloneReportMode(
      conversation.reportMode ||
      conversation.report_mode ||
      conversation.meta?.reportMode
    )
    const filePath = conversation.reportFilePath ||
      conversation.report_file_path ||
      conversation.filePath ||
      conversation.file_path ||
      conversation.meta?.reportFilePath
    return this._rememberStandaloneGeneratedReport(mode, filePath)
  }

  _generatedReportPathExists(filePath) {
    try {
      return typeof filePath === 'string' && filePath.trim() && fs.existsSync(filePath)
    } catch {
      return false
    }
  }

  _scanGeneratedReportFiles(cwd) {
    const root = typeof cwd === 'string' ? cwd.trim() : ''
    if (!root || !fs.existsSync(root)) return []

    const reports = []
    const stack = [{ dir: root, depth: 0 }]
    const ignoredDirs = new Set(['.git', '.claude', '.codex', 'node_modules'])
    const maxDepth = 5
    const maxEntries = 5000
    let visited = 0

    while (stack.length > 0 && visited < maxEntries) {
      const current = stack.pop()
      let entries = []
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (++visited > maxEntries) break
        if (entry.isDirectory()) {
          if (current.depth >= maxDepth || ignoredDirs.has(entry.name) || entry.name.startsWith('.')) continue
          stack.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 })
          continue
        }

        if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue
        if (isClueMarkdownFilePath(entry.name)) continue
        const filePath = path.join(current.dir, entry.name)
        try {
          const stats = fs.statSync(filePath)
          reports.push({
            filePath,
            format: 'markdown',
            extension: '.md',
            updatedAt: stats.mtimeMs,
            createdAt: stats.birthtimeMs || stats.mtimeMs
          })
        } catch {
          // ignore files that disappear while scanning
        }
      }
    }

    return reports
  }

  _collectGeneratedReportsFromSessionRoots(conversations, messagesByConversationId, { mode, hiddenKeys } = {}) {
    const requestedMode = mode === 'chat' || mode === 'clue' || mode === DAILY_LEAD_REPORT_MODE || mode === WEEKLY_REPORT_MODE || mode === MONTHLY_REPORT_MODE ? mode : null
    const hidden = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : [])
    const reports = []

    for (const conversation of Array.isArray(conversations) ? conversations : []) {
      const lookupKeys = [
        conversation?.id,
        conversation?.session_id,
        conversation?.sessionId
      ].filter(value => value !== null && value !== undefined && value !== '')
      const messages = lookupKeys
        .map(key => messagesByConversationId.get(key) || messagesByConversationId.get(String(key)))
        .find(value => Array.isArray(value)) || []
      const reportMode = classifyGeneratedReportMode(conversation, messages)
      if (requestedMode === 'chat') {
        if (reportMode !== 'chat' && reportMode !== 'clue') continue
      } else if (requestedMode && reportMode !== requestedMode) {
        continue
      }

      for (const report of this._scanGeneratedReportFiles(conversation?.cwd)) {
        const key = makeHiddenReportKey(reportMode, report.filePath)
        if (hidden.has(key)) continue
        reports.push({
          id: `${reportMode}:${report.filePath}`,
          name: getReportNameFromPath(report.filePath),
          filePath: report.filePath,
          sessionId: conversation.session_id || conversation.sessionId || conversation.id || null,
          conversationTitle: conversation.title || '',
          mode: reportMode,
          format: 'markdown',
          extension: '.md',
          createdAt: report.createdAt,
          updatedAt: report.updatedAt
        })
      }
    }

    return reports
  }

  _collectStandaloneGeneratedReportsFromProjectFolder(mode, hiddenKeys = []) {
    const normalizedMode = this._normalizeStandaloneReportMode(mode)
    if (!normalizedMode) return []
    const hidden = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : [])
    const projectDir = this._getStandaloneReportProjectDir(normalizedMode)
    return this._scanGeneratedReportFiles(projectDir)
      .filter(report => !hidden.has(makeHiddenReportKey(normalizedMode, report.filePath)))
      .map(report => ({
        id: `${normalizedMode}:${report.filePath}`,
        name: getReportNameFromPath(report.filePath),
        filePath: report.filePath,
        sessionId: null,
        conversationTitle: STANDALONE_REPORT_MODE_TITLES[normalizedMode] || '',
        mode: normalizedMode,
        format: 'markdown',
        extension: '.md',
        createdAt: report.createdAt,
        updatedAt: report.updatedAt
      }))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  }

  _collectStandaloneGeneratedReportsFromIndex(mode, hiddenKeys = []) {
    const normalizedMode = this._normalizeStandaloneReportMode(mode)
    if (!normalizedMode) return []
    const hidden = new Set(Array.isArray(hiddenKeys) ? hiddenKeys : [])

    return this._getStandaloneGeneratedReportIndex()
      .filter(entry => entry.mode === normalizedMode)
      .filter(entry => !hidden.has(makeHiddenReportKey(normalizedMode, entry.filePath)))
      .filter(entry => this._generatedReportPathExists(entry.filePath))
      .map(entry => {
        let stats = null
        try {
          stats = fs.statSync(entry.filePath)
        } catch {}
        return {
          id: `${normalizedMode}:${entry.filePath}`,
          name: getReportNameFromPath(entry.filePath),
          filePath: entry.filePath,
          sessionId: null,
          conversationTitle: STANDALONE_REPORT_MODE_TITLES[normalizedMode] || '',
          mode: normalizedMode,
          format: 'markdown',
          extension: '.md',
          createdAt: stats?.birthtimeMs || stats?.ctimeMs || entry.updatedAt || 0,
          updatedAt: stats?.mtimeMs || entry.updatedAt || 0
        }
      })
  }

  _mergeGeneratedReports(reports) {
    const byPath = new Map()
    for (const report of Array.isArray(reports) ? reports : []) {
      if (!report?.mode || !report?.filePath) continue
      const key = `${report.mode}:${report.filePath}`
      const previous = byPath.get(key)
      if (!previous || Number(report.updatedAt || 0) >= Number(previous.updatedAt || 0)) {
        byPath.set(key, {
          ...previous,
          ...report,
          id: report.id || key
        })
      }
    }
    return [...byPath.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  }

  listGeneratedReports({ mode } = {}) {
    const hiddenKeys = this._getHiddenGeneratedReportKeys()
    if (this._normalizeStandaloneReportMode(mode)) {
      return this._mergeGeneratedReports([
        ...this._collectStandaloneGeneratedReportsFromProjectFolder(mode, hiddenKeys),
        ...this._collectStandaloneGeneratedReportsFromIndex(mode, hiddenKeys)
      ])
    }

    const database = this.sessionDatabase
    if (
      !database ||
      typeof database.listAllAgentConversations !== 'function' ||
      typeof database.getAgentMessagesByConversationId !== 'function'
    ) {
      return []
    }

    let conversations = []
    try {
      conversations = database.listAllAgentConversations({ limit: 1000 }) || []
    } catch (err) {
      console.warn('[AgentSession] Failed to list generated report conversations:', err.message)
      return []
    }

    const messagesByConversationId = new Map()
    for (const conversation of conversations) {
      const lookupKeys = [
        conversation?.id,
        conversation?.session_id,
        conversation?.sessionId
      ].filter(value => value !== null && value !== undefined && value !== '')

      if (lookupKeys.length === 0) continue

      try {
        const messages = database.getAgentMessagesByConversationId(lookupKeys[0]) || []
        for (const key of lookupKeys) {
          messagesByConversationId.set(key, messages)
          messagesByConversationId.set(String(key), messages)
        }
      } catch (err) {
        console.warn('[AgentSession] Failed to load generated report messages:', {
          conversationId: lookupKeys[0],
          error: err.message
        })
      }
    }

    const messageReports = collectGeneratedReportsFromConversations(conversations, messagesByConversationId, {
      mode,
      hiddenKeys,
      pathExists: filePath => this._generatedReportPathExists(filePath)
    })
    const rootReports = this._collectGeneratedReportsFromSessionRoots(conversations, messagesByConversationId, {
      mode,
      hiddenKeys
    })
    return this._mergeGeneratedReports([...rootReports, ...messageReports])
  }

  _isGeneratedReportReferenced(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) return false

    const scanMessages = (messages) => (
      Array.isArray(messages) &&
      messages.some(message => messageReferencesGeneratedReport(message, filePath))
    )

    for (const session of this.sessions?.values?.() || []) {
      if (scanMessages(session?.messages)) return true
    }

    const database = this.sessionDatabase
    if (
      !database ||
      typeof database.listAllAgentConversations !== 'function' ||
      typeof database.getAgentMessagesByConversationId !== 'function'
    ) {
      return false
    }

    let conversations = []
    try {
      conversations = database.listAllAgentConversations({ limit: 5000 }) || []
    } catch (err) {
      console.warn('[AgentSession] Failed to list conversations for report reference check:', err.message)
      return false
    }

    for (const conversation of conversations) {
      const lookupKeys = [
        conversation?.id,
        conversation?.session_id,
        conversation?.sessionId
      ].filter(key => key != null && key !== '')
      const uniqueLookupKeys = [...new Set(lookupKeys)]

      for (const lookupKey of uniqueLookupKeys) {
        try {
          if (scanMessages(database.getAgentMessagesByConversationId(lookupKey) || [])) {
            return true
          }
        } catch (err) {
          console.warn('[AgentSession] Failed to inspect report references:', {
            conversationId: lookupKey,
            error: err.message
          })
        }
      }
    }

    return false
  }

  hideGeneratedReport({ mode, filePath } = {}) {
    if (mode !== 'chat' && mode !== 'clue' && mode !== DAILY_LEAD_REPORT_MODE && mode !== WEEKLY_REPORT_MODE && mode !== MONTHLY_REPORT_MODE) {
      return { success: false, error: 'mode is required' }
    }

    if (typeof filePath !== 'string' || !filePath.trim()) {
      return { success: false, error: 'filePath is required' }
    }

    if (this._isGeneratedReportReferenced(filePath)) {
      return { success: false, error: GENERATED_REPORT_REFERENCED_ERROR }
    }

    const key = makeHiddenReportKey(mode, filePath)
    const keys = this._getHiddenGeneratedReportKeys()
    if (!keys.includes(key)) {
      keys.push(key)
      this._saveHiddenGeneratedReportKeys(keys)
    }

    return { success: true }
  }

  resolveFilePath(sessionId, relativePath) {
    return this.fileManager.resolveFilePath(sessionId, relativePath)
  }

  /**
   * 列出目录内容
   */
  async listDir(sessionId, relativePath = '', showHidden = false) {
    return this.fileManager.listDir(sessionId, relativePath, showHidden)
  }

  /**
   * 读取文件内容用于预览
   */
  async readFile(sessionId, relativePath) {
    return this.fileManager.readFile(sessionId, relativePath)
  }

  /**
   * 保存文件内容
   */
  async saveFile(sessionId, relativePath, content) {
    return this.fileManager.saveFile(sessionId, relativePath, content)
  }

  /**
   * 创建文件或文件夹
   */
  async createFile(sessionId, parentPath, name, isDirectory) {
    return this.fileManager.createFile(sessionId, parentPath, name, isDirectory)
  }

  /**
   * 重命名文件或文件夹
   */
  async renameFile(sessionId, oldPath, newName) {
    return this.fileManager.renameFile(sessionId, oldPath, newName)
  }

  /**
   * 删除文件或文件夹
   */
  async deleteFile(sessionId, relativePath) {
    return this.fileManager.deleteFile(sessionId, relativePath)
  }

  /**
   * 搜索文件
   */
  async searchFiles(sessionId, keyword, showHidden = false) {
    return this.fileManager.searchFiles(sessionId, keyword, showHidden)
  }

  // ============= Query 控制委托（委托给 queryManager） =============

  /**
   * 根据模型名查找对应的 profile。若当前 profile 的提供商不支持该模型，
   * 自动切换到支持该模型的 profile。
   */
  _resolveProfileForRequest(currentProfile, requestedModel, providerId) {
    if (!currentProfile) return { profile: currentProfile, switched: false }

    let resolvedProfile = currentProfile
    let switched = false
    const normalizedModel = normalizeModelValue(requestedModel)

    if (providerId && currentProfile.serviceProvider !== providerId) {
      const config = this.configManager.getConfig()
      const profiles = Array.isArray(config?.apiProfiles) ? config.apiProfiles : []
      const targetProfile = profiles.find(profile =>
        profile.serviceProvider === providerId && isSameModelId(profile.selectedModelId, normalizedModel)
      ) || profiles.find(profile => profile.serviceProvider === providerId)

      if (targetProfile && targetProfile.id !== currentProfile.id) {
        resolvedProfile = targetProfile
        switched = true
      } else if (!targetProfile) {
        console.warn('[AgentSession] No API profile found for requested provider:', {
          providerId,
          modelId: normalizedModel || null,
          currentProfile: currentProfile.id
        })
      }
    }

    let resolvedModelId = normalizedModel || null
    if (!switched && normalizedModel) {
      const result = this._resolveProfileForModel(currentProfile, normalizedModel)
      resolvedProfile = result.profile
      switched = result.switched
      resolvedModelId = result.modelId || resolvedModelId
    }

    if (isSameModelId(resolvedProfile?.selectedModelId, normalizedModel)) {
      resolvedModelId = normalizeModelValue(resolvedProfile.selectedModelId)
    }

    return { profile: resolvedProfile, switched, modelId: resolvedModelId }
  }

  _resolveProfileForModel(currentProfile, modelId) {
    if (!modelId || !currentProfile) return { profile: currentProfile, switched: false, modelId: null }

    const config = this.configManager.getConfig()
    const definitions = config?.serviceProviderDefinitions
    const profiles = config?.apiProfiles

    if (!definitions || !profiles) return { profile: currentProfile, switched: false, modelId: normalizeModelIdOrNull(modelId) }

    const normalizedModelId = normalizeModelValue(modelId)
    if (!normalizedModelId) return { profile: currentProfile, switched: false, modelId: null }

    // 1. 检查当前 profile 的提供商是否直接包含该模型
    if (currentProfile.serviceProvider) {
      const currentProvider = definitions.find(
        def => def.enabled !== false && def.id === currentProfile.serviceProvider
      )
      if (currentProvider && Array.isArray(currentProvider.defaultModels)) {
        const currentModels = currentProvider.defaultModels.map(m => normalizeModelValue(m)).filter(Boolean)
        const currentModel = currentModels.find(m => isSameModelId(m, normalizedModelId))
        if (currentModel) {
          return { profile: currentProfile, switched: false, modelId: currentModel }
        }
      }
    }

    // 2. 查找支持该模型的提供商
    const targetProvider = definitions.find(def => {
      if (def.enabled === false || !Array.isArray(def.defaultModels)) return false
      const models = def.defaultModels.map(m => normalizeModelValue(m)).filter(Boolean)
      return models.some(m => isSameModelId(m, normalizedModelId))
    })

    // 3. 查找支持该模型的 profile（优先按 provider，再按 selectedModelId 回退）
    if (targetProvider) {
      if (targetProvider.id === currentProfile.serviceProvider) {
        // 当前 provider 已支持该模型，但还需检查是否有其他同 provider 的 profile
        // 其 selectedModelId 恰好匹配目标模型（同 provider 多接入点场景）
        const sameProviderModelMatch = profiles.find(p =>
          p.id !== currentProfile.id &&
          p.serviceProvider === targetProvider.id &&
          isSameModelId(p.selectedModelId, normalizedModelId)
        )
        if (sameProviderModelMatch) {
          console.log('[AgentSession] Auto-switching profile within same provider by selectedModelId:', {
            modelId: normalizedModelId,
            fromProfile: currentProfile.id,
            toProfile: sameProviderModelMatch.id,
            toProvider: sameProviderModelMatch.serviceProvider
          })
          return {
            profile: sameProviderModelMatch,
            switched: true,
            modelId: normalizeModelValue(sameProviderModelMatch.selectedModelId)
              || targetProvider.defaultModels.find(m => isSameModelId(m, normalizedModelId))
              || normalizedModelId
          }
        }
        // 无需切换 profile
        return {
          profile: currentProfile,
          switched: false,
          modelId: targetProvider.defaultModels.find(m => isSameModelId(m, normalizedModelId)) || normalizedModelId
        }
      }

      const matchingProfile = profiles.find(p => p.serviceProvider === targetProvider.id)
      if (matchingProfile && matchingProfile.id !== currentProfile.id) {
        console.log('[AgentSession] Auto-switching profile for model:', {
          modelId: normalizedModelId,
          fromProfile: currentProfile.id,
          fromProvider: currentProfile.serviceProvider,
          toProfile: matchingProfile.id,
          toProvider: matchingProfile.serviceProvider
        })
        return {
          profile: matchingProfile,
          switched: true,
          modelId: normalizeModelValue(matchingProfile.selectedModelId)
            || targetProvider.defaultModels.find(m => isSameModelId(m, normalizedModelId))
            || normalizedModelId
        }
      }
    }

    // 回退：模型不在任何内置 provider 的 defaultModels 中时，
    // 查找 selectedModelId 恰好匹配该模型的其他 profile（覆盖同 provider 多接入点场景）
    const modelMatchProfile = profiles.find(p =>
      p.id !== currentProfile.id && isSameModelId(p.selectedModelId, normalizedModelId)
    )
    if (modelMatchProfile) {
      console.log('[AgentSession] Auto-switching profile by selectedModelId match:', {
        modelId: normalizedModelId,
        fromProfile: currentProfile.id,
        toProfile: modelMatchProfile.id,
        toProvider: modelMatchProfile.serviceProvider
      })
      return {
        profile: modelMatchProfile,
        switched: true,
        modelId: normalizeModelValue(modelMatchProfile.selectedModelId) || normalizedModelId
      }
    }

    if (targetProvider) {
      console.warn('[AgentSession] No profile found for model provider:', {
        modelId: normalizedModelId,
        targetProvider: targetProvider.id,
        currentProfile: currentProfile.id
      })
    } else {
      console.warn('[AgentSession] No provider or profile found for model:', {
        modelId: normalizedModelId,
        currentProfile: currentProfile.id
      })
    }
    return { profile: currentProfile, switched: false, modelId: normalizedModelId || null }
  }

  async setModel(sessionId, model, providerId) {
    const session = this.sessions.get(sessionId)
    let profile = session?.apiProfileId
      ? this.configManager.getAPIProfile(session.apiProfileId) || this.configManager.getDefaultProfile()
      : this.configManager.getDefaultProfile()
    const normalizedRequestedModel = normalizeModelValue(model)
    const previousModelId = session ? this._resolveSessionModelId(session) : this._getPersistedSessionModelId(sessionId)
    const previousProfileId = session?.apiProfileId || profile?.id || null

    if (!normalizedRequestedModel) {
      console.log('[AgentSession] setModel request:', {
        sessionId,
        requestedModel: null,
        resolvedModel: null,
        hasSession: !!session,
        hasQueryGenerator: !!session?.queryGenerator,
        apiProfileId: session?.apiProfileId || profile?.id || null
      })
      if (session) {
        session.modelId = null
        if (!session.queryGenerator && session.sdkSessionId && previousModelId) {
          this._invalidateSdkResume(session, 'model-cleared-while-inactive', {
            previousModelId,
            nextModelId: null,
            previousProfileId,
            nextProfileId: previousProfileId
          })
        }
      }
      this.sessionDatabase?.updateAgentConversationModel?.(sessionId, null)
      if (!session?.queryGenerator) {
        console.log('[AgentSession] setModel persisted without active query:', {
          sessionId,
          resolvedModel: null
        })
        return { success: true, persistedOnly: true }
      }
      const result = await this.queryManager.setModel(sessionId, undefined)
      return result
    }

    // 自动匹配模型对应的 profile（若当前 profile 提供商不支持该模型）
    let profileSwitched = false
    let resolvedSetModelId = normalizedRequestedModel || null
    if (providerId && profile.serviceProvider !== providerId) {
      // 优先使用前端传入的 providerId 直接查找匹配的 profile
      const config = this.configManager.getConfig()
      const profiles = config?.apiProfiles
      if (profiles) {
        // 同 provider 多 profile 时，优先匹配 selectedModelId 相符的，再回退到第一个
        const targetProfile = profiles.find(p =>
          p.serviceProvider === providerId && isSameModelId(p.selectedModelId, normalizedRequestedModel)
        ) || profiles.find(p => p.serviceProvider === providerId)
        if (targetProfile && targetProfile.id !== profile.id) {
          console.log('[AgentSession] Auto-switching profile by providerId:', {
            modelId: normalizedRequestedModel,
            providerId,
            fromProfile: profile.id,
            fromProvider: profile.serviceProvider,
            toProfile: targetProfile.id,
            toProvider: targetProfile.serviceProvider
          })
          profile = targetProfile
          profileSwitched = true
          if (isSameModelId(targetProfile.selectedModelId, normalizedRequestedModel)) {
            resolvedSetModelId = normalizeModelValue(targetProfile.selectedModelId)
          }
        } else if (!targetProfile) {
          // 前端传了 providerId 但没有匹配的 API profile，返回明确错误
          console.warn('[AgentSession] No API profile found for provider:', {
            providerId,
            modelId: normalizedRequestedModel,
            currentProfile: profile.id
          })
          return {
            success: false,
            error: `No API profile configured for provider "${providerId}". Please add an API profile for this provider in Settings.`
          }
        }
      }
    }
    if (!profileSwitched) {
      const resolved = this._resolveProfileForModel(profile, normalizedRequestedModel)
      profile = resolved.profile
      profileSwitched = resolved.switched
      resolvedSetModelId = resolved.modelId || resolvedSetModelId
    }

    const resolvedRequest = resolveRequestedModel(profile, this.configManager, normalizedRequestedModel)
    console.log('[AgentSession] setModel request:', {
      sessionId,
      requestedModel: normalizedRequestedModel,
      resolvedModel: resolvedRequest.queryModel || null,
      ignored: resolvedRequest.ignored,
      hasSession: !!session,
      hasQueryGenerator: !!session?.queryGenerator,
      apiProfileId: session?.apiProfileId || profile?.id || null,
      profileSwitched
    })

    try {
      const nextModelId = normalizeModelIdOrNull(resolvedSetModelId || resolvedRequest.requestedModel)
      const nextProfileId = profile?.id || null
      if (session) {
        const modelChanged = previousModelId !== nextModelId
        const profileChanged = previousProfileId !== nextProfileId
        session.modelId = nextModelId
        if (profileSwitched) {
          session.apiProfileId = profile.id
          session.apiBaseUrl = profile.baseUrl || null
        }
        if (!session.queryGenerator && session.sdkSessionId && (modelChanged || profileChanged)) {
          this._invalidateSdkResume(session, 'model-or-profile-changed-while-inactive', {
            previousModelId,
            nextModelId,
            previousProfileId,
            nextProfileId,
            modelChanged,
            profileChanged
          })
        }
      }
      if (profileSwitched) {
        this.sessionDatabase?.updateAgentConversation?.(sessionId, {
          apiProfileId: profile.id,
          apiBaseUrl: profile.baseUrl || null
        })
      }
      this.sessionDatabase?.updateAgentConversationModel?.(sessionId, nextModelId)

      // 若 profile 切换且 CLI 正在运行，需要杀掉旧 CLI（旧进程持有旧 provider 的凭证）
      // 下一次发消息时会用新 profile 凭证创建新 CLI
      if (profileSwitched && session?.queryGenerator) {
        if (session.messageQueue) {
          session.messageQueue.end()
          session.messageQueue = null
        }
        session.preserveSessionOnQueryExit = true
        try { killProcessTree(session.cliPid) } catch {}
        try { session.queryGenerator.close() } catch {}
        session.queryGenerator = null
        session.cliPid = null
        this._invalidateSdkResume(session, 'profile-switched-while-query-active', {
          previousProfileId,
          nextProfileId: profile.id,
          previousModelId,
          nextModelId
        })
        session.status = AgentStatus.IDLE
        this._safeSend('agent:statusChange', { sessionId, status: AgentStatus.IDLE })
        console.log('[AgentSession] setModel killed old CLI for profile switch:', {
          sessionId,
          newProfileId: profile.id,
          newModelId: nextModelId
        })
        return {
          success: true,
          persistedOnly: true,
          profileSwitched: true,
          newProfileId: profile.id,
          newModelId: nextModelId
        }
      }

      if (!session?.queryGenerator) {
        console.log('[AgentSession] setModel persisted without active query:', {
          sessionId,
          resolvedModel: nextModelId,
          profileSwitched
        })
        return {
          success: true,
          persistedOnly: true,
          ...(profileSwitched && { profileSwitched: true, newProfileId: profile.id, newModelId: nextModelId })
        }
      }
      if (!resolvedRequest.queryModel) {
        console.log('[AgentSession] setModel persisted provider model without active CLI switch:', {
          sessionId,
          requestedModel: nextModelId,
          profileSwitched
        })
        return {
          success: true,
          persistedOnly: true,
          ...(profileSwitched && { profileSwitched: true, newProfileId: profile.id, newModelId: nextModelId })
        }
      }
      const result = await this.queryManager.setModel(sessionId, resolvedRequest.queryModel)
      console.log('[AgentSession] setModel request applied:', {
        sessionId,
        resolvedModel: resolvedRequest.queryModel || null,
        profileSwitched
      })
      return {
        ...result,
        ...(profileSwitched && { profileSwitched: true, newProfileId: profile.id, newModelId: nextModelId })
      }
    } catch (error) {
      console.warn('[AgentSession] setModel request failed:', {
        sessionId,
        requestedModel: normalizedRequestedModel,
        resolvedModel: resolvedRequest.queryModel || null,
        error: error.message
      })
      throw error
    }
  }

  async getSupportedModels(sessionId) {
    return this.queryManager.getSupportedModels(sessionId)
  }

  async getSupportedCommands(sessionId) {
    return this.queryManager.getSupportedCommands(sessionId)
  }

  async getAccountInfo(sessionId) {
    return this.queryManager.getAccountInfo(sessionId)
  }

  async getMcpServerStatus(sessionId) {
    return this.queryManager.getMcpServerStatus(sessionId)
  }

  async getInitResult(sessionId) {
    return this.queryManager.getInitResult(sessionId)
  }

  _saveImagesToDir(cwd, images) {
    try {
      const imagesDir = path.join(cwd, 'chat_paste_images')
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true })
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      for (let i = 0; i < images.length; i++) {
        const img = images[i]
        const ext = this._getImageExt(img.mediaType)
        const suffix = images.length > 1 ? `-${i + 1}` : ''
        const fileName = `${timestamp}${suffix}.${ext}`
        const filePath = path.join(imagesDir, fileName)
        fs.writeFileSync(filePath, Buffer.from(img.base64, 'base64'))
        console.log(`[Agent] Image saved: ${filePath}`)
      }
    } catch (e) {
      console.warn('[Agent] Failed to save images:', e.message)
    }
  }

  _getImageExt(mediaType) {
    const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
    return map[mediaType] || 'png'
  }
}

module.exports = {
  AgentSessionManager,
  AgentStatus,
  AgentType
}
