#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const { io } = require('socket.io-client')
const { getReportModeConfig } = require('../src/main/utils/report-prompts')
const { buildReportPeriod } = require('../src/main/utils/report-periods')

const ROOT_DIR = path.resolve(__dirname, '..')
const DEFAULT_API_BASE = `http://127.0.0.1:${process.env.PORT || '3456'}`
const DEFAULT_REPORT_AUTH_PHONE = '15527109305'
const DEFAULT_REPORT_AUTH_PASSWORD = '123456'
const DEFAULT_REPORT_RETRIES = 2
const DEFAULT_REPORT_RETRY_DELAY_MS = 60_000
const REPORT_SKILL_ID = 'daily-investment-leads-report'
const CANONICAL_REPORT_MODELS = new Map([
  ['deepseek-v4-pro', 'DeepSeek-V4-Pro'],
  ['deepseek-v4-flash', 'DeepSeek-V4-Flash']
])

function normalizeReportModelName(model) {
  const value = typeof model === 'string' ? model.trim() : ''
  if (!value) return ''
  return CANONICAL_REPORT_MODELS.get(value.toLowerCase()) || value
}

function readOptionValue(argv, index, option) {
  const value = argv[index + 1]
  if (value === undefined || String(value).startsWith('--')) {
    throw new Error(`Missing ${option} value`)
  }
  return value
}

function parseArgs(argv) {
  const args = {
    apiBase: process.env.REPORT_API_BASE || process.env.LEAD_REPORT_API_BASE || process.env.JEDI_AGENT_BASE_URL || DEFAULT_API_BASE,
    cwd: process.env.REPORT_CWD || process.env.LEAD_REPORT_CWD || ROOT_DIR,
    dbPath: process.env.REPORT_DB_PATH || process.env.WECHAT_COLLECTOR_DB || '',
    mode: process.env.REPORT_MODE || process.env.LEAD_REPORT_MODE || 'lead-report',
    title: process.env.REPORT_TITLE || process.env.LEAD_REPORT_TITLE || '',
    prompt: process.env.REPORT_PROMPT || process.env.LEAD_REPORT_PROMPT || '',
    model: process.env.REPORT_MODEL || process.env.LEAD_REPORT_MODEL || '',
    providerId: process.env.REPORT_PROVIDER_ID || process.env.LEAD_REPORT_PROVIDER_ID || '',
    timeoutMs: Number(process.env.REPORT_TIMEOUT_MS || process.env.LEAD_REPORT_TIMEOUT_MS || 30_000),
    retries: Number(process.env.REPORT_RETRIES || process.env.LEAD_REPORT_RETRIES || DEFAULT_REPORT_RETRIES),
    retryDelayMs: Number(process.env.REPORT_RETRY_DELAY_MS || process.env.LEAD_REPORT_RETRY_DELAY_MS || DEFAULT_REPORT_RETRY_DELAY_MS),
    wait: process.env.REPORT_WAIT === '1' || process.env.LEAD_REPORT_WAIT === '1',
    triggeredBy: process.env.REPORT_TRIGGERED_BY || process.env.LEAD_REPORT_TRIGGERED_BY || '',
    now: process.env.REPORT_NOW || process.env.LEAD_REPORT_NOW || '',
    periodLabel: process.env.REPORT_PERIOD_LABEL || process.env.LEAD_REPORT_PERIOD_LABEL || '',
    fileName: process.env.REPORT_FILE_NAME || process.env.LEAD_REPORT_FILE_NAME || '',
    authPhone: process.env.REPORT_AUTH_PHONE || process.env.REPORT_PHONE || process.env.LEAD_REPORT_AUTH_PHONE || process.env.LEAD_REPORT_PHONE || DEFAULT_REPORT_AUTH_PHONE,
    authPassword: process.env.REPORT_AUTH_PASSWORD || process.env.REPORT_PASSWORD || process.env.LEAD_REPORT_AUTH_PASSWORD || process.env.LEAD_REPORT_PASSWORD || DEFAULT_REPORT_AUTH_PASSWORD
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--api-base') {
      args.apiBase = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--cwd') {
      args.cwd = path.resolve(ROOT_DIR, readOptionValue(argv, index, arg))
      index += 1
    } else if (arg === '--db') {
      args.dbPath = path.resolve(ROOT_DIR, readOptionValue(argv, index, arg))
      index += 1
    } else if (arg === '--mode') {
      args.mode = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--title') {
      args.title = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--prompt') {
      args.prompt = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--model') {
      args.model = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--provider-id') {
      args.providerId = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(readOptionValue(argv, index, arg))
      index += 1
    } else if (arg === '--retries') {
      args.retries = Number(readOptionValue(argv, index, arg))
      index += 1
    } else if (arg === '--retry-delay-ms') {
      args.retryDelayMs = Number(readOptionValue(argv, index, arg))
      index += 1
    } else if (arg === '--triggered-by') {
      args.triggeredBy = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--now') {
      args.now = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--period-label') {
      args.periodLabel = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--file-name') {
      args.fileName = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--auth-phone') {
      args.authPhone = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--auth-password') {
      args.authPassword = readOptionValue(argv, index, arg)
      index += 1
    }
    else if (arg === '--wait') {
      args.wait = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  const modeConfig = getReportModeConfig(args.mode)
  args.apiBase = String(args.apiBase || '').replace(/\/+$/, '')
  args.cwd = path.resolve(ROOT_DIR, args.cwd || ROOT_DIR)
  args.dbPath = path.resolve(ROOT_DIR, args.dbPath || path.join(args.cwd, 'wechat_765.sqlite'))
  const referenceDate = args.now ? new Date(args.now) : new Date()
  const period = buildReportPeriod(modeConfig.reportMode, referenceDate)
  const periodLabel = String(args.periodLabel || '').trim()
  const fileName = String(args.fileName || '').trim()
  if (periodLabel) {
    period.periodLabel = periodLabel
    period.title = `${modeConfig.title}(${periodLabel})`
    period.fileName = `${modeConfig.title}(${periodLabel}).md`
  }
  if (fileName) {
    period.fileName = fileName
  }
  args.title = String(args.title || period.title)
  args.prompt = String(args.prompt || modeConfig.prompt)
  args.model = normalizeReportModelName(args.model)
  args.triggeredBy = String(args.triggeredBy || modeConfig.triggeredBy)
  args.authPhone = String(args.authPhone || '').trim()
  args.authPassword = String(args.authPassword || '')
  args.period = period
  args.modeConfig = modeConfig

  if (!args.apiBase) throw new Error('Missing --api-base')
  if (!args.prompt.trim()) throw new Error('Missing report prompt')
  if ((args.authPhone && !args.authPassword) || (!args.authPhone && args.authPassword)) {
    throw new Error('Both --auth-phone and --auth-password are required for report auth')
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('Invalid --timeout-ms')
  }
  if (!Number.isInteger(args.retries) || args.retries < 0) {
    throw new Error('Invalid --retries')
  }
  if (!Number.isFinite(args.retryDelayMs) || args.retryDelayMs < 0) {
    throw new Error('Invalid --retry-delay-ms')
  }

  return args
}

function buildReportPrompt(args) {
  const period = args.period || buildReportPeriod(args.modeConfig.reportMode)
  const promptBody = [
    args.prompt,
    '',
    '执行上下文：',
    `- 报告输出目录：当前会话工作目录（${args.modeConfig.title} 独立文件夹）`,
    `- 推荐报告标题：${period.title}`,
    `- 推荐 Markdown 文件名：${period.fileName}`,
    '- 采集资料入口：系统已准备在当前会话上下文中。',
    '',
    '执行要求：',
    '- 请优先使用系统准备的采集资料，不要因为当前工作目录内缺少显式资料入口而改用纯公开搜索。',
    '- 采集资料中的 title、url、summary、keywords、confidence、team_name、sector、project、research_direction、technology、product、core_members 可直接作为第一轮筛选依据。',
    '- 候选生成顺序固定为：优先复用项目卡片缓存，其次用本地候选脚本补充近期线索，最后只对入选 Top 项目做少量公开补证。',
    '- 如当前项目存在 `scripts/query-investment-leads-report.js`，先用该脚本或等价结构化候选结果生成 Top 候选；不要先做开放式长时间检索。',
    '- 如果系统已提供候选 JSON 或结构化历史线索，你必须直接基于这些候选生成完整报告；不得再次检查本地线索库结构，不得读取原始全文字段，不得重新从头筛库。',
    '- 公开搜索只用于刷新 Top 项目的最新融资、官网、客户、工商或公开报道；最多执行 5 次公开搜索或网页抓取，达到上限后必须基于已取得证据成稿。',
    '- 不要启动并行子任务，不要进行开放式全网泛搜。',
    '- 首屏不得输出思考过程、执行计划、检索过程、状态话术或空报告骨架；必须直接输出最终报告正文的一部分，且标题后紧跟至少 1 个完整项目字段块。',
    '- 不得在对话、思考过程、报告正文或来源字段中输出内部线索源文件名、扩展名、表名、路径或存储类型；如必须泛称，只能写“本地线索库”或“本地资料”。',
    '- 不要为了等待全部线索核验完成才开始输出；先输出最高置信项目的完整字段块，后续再增量补齐其它项目。',
    '- 不要只输出报告骨架；请在本轮内完成线索核验和最终报告 Markdown 文件。',
    `- 只生成最终报告 Markdown 文件，文件名必须是 \`${period.fileName}\`，报告正文一级标题必须是 \`# ${period.title}\`。`,
    '- 报告正文不得输出生成日期、报告周期、采集总量、采集文章数量、采集量波动解释或任何概览类板块。',
    '- 如已存在同名 Markdown 文件，请直接覆盖该文件，不要生成带编号后缀的副本。',
    '- 不要生成 PDF、HTML、图片报告或任何中间转换文件；不要调用 Markdown 预览 PDF 渲染脚本、WeasyPrint、Pandoc、Puppeteer 或 Playwright 来导出报告。',
    '- 内部资料入口仅作为执行上下文；不得在标的内来源依据、来源名称、来源 URL、正文交付物或可见过程里披露内部文件名、扩展名、存储位置或检索细节。来源必须指向原始文章 URL 或公开网页 URL；若只是统计口径，请写“系统采集索引统计”。',
    '- Markdown 文件必须保存到当前会话工作目录，文件名使用推荐报告标题，扩展名 .md；保存动作必须静默，不要在对话中输出保存状态、文件路径、完成说明或对话式收尾。'
  ].join('\n')

  return `/${REPORT_SKILL_ID} ${promptBody}`
}

function getCookieHeaderFromResponse(response) {
  const cookies = typeof response.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : []
  const cookieValues = cookies.length > 0
    ? cookies
    : [response.headers?.get?.('set-cookie')].filter(Boolean)
  return cookieValues
    .map(cookie => String(cookie).split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

async function loginForCookie(apiBase, { phone, password }) {
  if (!phone && !password) return ''

  const fetchImpl = globalThis.fetch || require('undici').fetch
  const response = await fetchImpl(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password })
  })
  const result = await response.json().catch(() => ({ error: response.statusText }))
  if (!response.ok || result?.success === false) {
    throw new Error(result?.error || `Auth failed: HTTP ${response.status}`)
  }

  const cookieHeader = getCookieHeaderFromResponse(response)
  if (!cookieHeader) throw new Error('Auth succeeded but no session cookie was returned')
  return cookieHeader
}

async function httpPost(apiBase, route, body, options = {}) {
  const fetchImpl = globalThis.fetch || require('undici').fetch
  const headers = { 'Content-Type': 'application/json' }
  if (options.cookieHeader) headers.Cookie = options.cookieHeader
  const response = await fetchImpl(`${apiBase}${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(errorBody.error || `HTTP ${response.status}`)
  }
  return response.json()
}

async function httpGet(apiBase, route, options = {}) {
  const fetchImpl = globalThis.fetch || require('undici').fetch
  const headers = {}
  if (options.cookieHeader) headers.Cookie = options.cookieHeader
  const response = await fetchImpl(`${apiBase}${route}`, { headers })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(errorBody.error || `HTTP ${response.status}`)
  }
  return response.json()
}

function normalizeMarkdownContent(content) {
  return String(content || '').replace(/^\uFEFF/, '').trim()
}

function findMarkdownReportContent(messages = [], title = '') {
  const expectedTitle = String(title || '').trim()
  const assistantMessages = (Array.isArray(messages) ? messages : [])
    .filter(message => message?.role === 'assistant')
    .map(message => normalizeMarkdownContent(message.content))
    .filter(Boolean)

  if (expectedTitle) {
    const exact = assistantMessages.find(content => content.startsWith(`# ${expectedTitle}`))
    if (exact) return exact
  }

  return assistantMessages.find(content => /^#\s+\S/.test(content)) || ''
}

async function ensureMarkdownReportFile(args, session, cookieHeader) {
  const reportDir = session?.cwd || args.cwd
  const reportPath = path.resolve(reportDir, args.period.fileName)
  if (fs.existsSync(reportPath)) {
    return { filePath: reportPath, created: false }
  }

  const messages = await httpGet(args.apiBase, `/api/agent/sessions/${encodeURIComponent(session.id)}/messages`, { cookieHeader })
  const content = findMarkdownReportContent(messages, args.period.title)
  if (!content) {
    throw new Error(`Report finished but Markdown file was not created: ${reportPath}`)
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${content}\n`, 'utf8')
  return { filePath: reportPath, created: true }
}

function waitForSocketConnect(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out connecting to Jedi Agent socket'))
    }, timeoutMs)

    socket.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('connect_error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function emitSocket(socket, event, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Socket timeout: ${event}`))
    }, timeoutMs)

    socket.emit(event, payload, result => {
      clearTimeout(timer)
      if (result?.error) reject(new Error(result.error))
      else resolve(result || { success: true })
    })
  })
}

function waitForAgentResult(socket, sessionId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for report generation result'))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('agent:result', onResult)
      socket.off('agent:error', onError)
      socket.off('agent:cliError', onError)
    }

    const onResult = payload => {
      if (payload?.sessionId !== sessionId) return
      cleanup()
      resolve(payload)
    }
    const onError = payload => {
      if (payload?.sessionId !== sessionId) return
      cleanup()
      reject(new Error(payload.error || 'Report generation failed'))
    }

    socket.on('agent:result', onResult)
    socket.on('agent:error', onError)
    socket.on('agent:cliError', onError)
  })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function runReportTrigger(args, attempt) {
  const modeConfig = args.modeConfig
  const cookieHeader = await loginForCookie(args.apiBase, {
    phone: args.authPhone,
    password: args.authPassword
  })
  const session = await httpPost(args.apiBase, '/api/agent/sessions', {
    type: 'chat',
    title: args.title,
    cwd: args.cwd,
    source: 'scheduled',
    meta: {
      reportMode: modeConfig.reportMode,
      triggeredBy: args.triggeredBy
    }
  }, { cookieHeader })

  const sessionId = session?.id
  if (!sessionId) throw new Error('Failed to create report session')

  const socket = io(args.apiBase, {
    transports: ['websocket', 'polling'],
    reconnection: false,
    timeout: args.timeoutMs,
    extraHeaders: cookieHeader ? { Cookie: cookieHeader } : undefined
  })

  try {
    await waitForSocketConnect(socket, args.timeoutMs)
    await emitSocket(socket, 'agent:sendMessage', {
      sessionId,
      message: buildReportPrompt(args),
      model: args.model || null,
      providerId: args.providerId || ''
    }, args.timeoutMs)

    console.log(JSON.stringify({
      success: true,
      sessionId,
      mode: modeConfig.reportMode,
      title: args.title,
      prompt: buildReportPrompt(args),
      wait: args.wait,
      attempt
    }, null, 2))

    if (args.wait) {
      await waitForAgentResult(socket, sessionId, args.timeoutMs)
      const ensuredReport = await ensureMarkdownReportFile(args, session, cookieHeader)
      if (ensuredReport.created) {
        console.log(JSON.stringify({
          success: true,
          sessionId,
          mode: modeConfig.reportMode,
          filePath: ensuredReport.filePath,
          fallbackSaved: true
        }, null, 2))
      }
    }
  } finally {
    socket.disconnect()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const maxAttempts = args.retries + 1
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await runReportTrigger(args, attempt)
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts) break
      console.error(`Report trigger attempt ${attempt}/${maxAttempts} failed: ${error.message}`)
      if (args.retryDelayMs > 0) {
        await sleep(args.retryDelayMs)
      }
    }
  }

  throw lastError
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = {
  buildReportPrompt,
  findMarkdownReportContent,
  main,
  normalizeReportModelName,
  parseArgs
}
