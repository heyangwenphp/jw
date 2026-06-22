const fsp = require('fs').promises
const path = require('path')
const {
  AipinDataStore,
  parseAipinDataReference
} = require('./aipin-data-store')

const DEFAULT_PROCESSOR_CONFIG = {
  maxItemsPerTask: 100,
  requiredFieldRetryAttempts: 3,
  structuredResultWaitMs: 600000,
  structuredResultPollMs: 500
}

async function loadAipinSourceEnvelope({ sourceFile, dataStore }) {
  const ref = parseAipinDataReference(sourceFile)
  if (ref?.type === 'batch') {
    const envelope = dataStore.getBatchEnvelope(ref.id)
    if (!envelope) throw new Error(`AipinData SQLite batch not found: ${ref.id}`)
    return envelope
  }
  if (ref?.type === 'item') {
    const envelope = dataStore.getItemEnvelope(ref.id)
    if (!envelope) throw new Error(`AipinData SQLite item not found: ${ref.id}`)
    return envelope
  }

  throw new Error(`Unsupported AipinData source reference: ${sourceFile}`)
}

function makeDedupeKey(item) {
  return `id:${item?.id === undefined || item?.id === null ? '' : String(item.id).trim()}`
}

function isMinimalShape(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false
  const keys = Object.keys(item)
  return keys.length <= 6 && ['id', 'scheme_id', 'platform_name', 'news_title', 'news_uuid', 'push_time'].every(key => key in item)
}

function prepareAipinInput(envelope, task, config = {}) {
  if (!Array.isArray(envelope?.data)) {
    throw new Error('Invalid AipinData source envelope: data must be an array')
  }
  const mergedConfig = { ...DEFAULT_PROCESSOR_CONFIG, ...config }
  const seen = new Set()
  const data = []
  let duplicateCount = 0
  let minimalShapeCount = 0
  const missingFields = {}

  for (const rawItem of envelope.data) {
    const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem : {}
    const key = makeDedupeKey(item)
    if (seen.has(key)) {
      duplicateCount += 1
      continue
    }
    seen.add(key)
    if (isMinimalShape(item)) minimalShapeCount += 1
    for (const field of ['id', 'news_title', 'news_uuid', 'push_time']) {
      if (!item[field]) missingFields[field] = (missingFields[field] || 0) + 1
    }
    data.push(item)
    if (data.length >= mergedConfig.maxItemsPerTask) break
  }

  const summary = {
    taskId: task.taskId,
    requestId: task.requestId,
    sourceFile: task.sourceFile,
    skillId: task.skillId,
    originalCount: envelope.data.length,
    inputCount: data.length,
    duplicateCount,
    minimalShapeCount,
    missingFields,
    generatedAt: new Date().toISOString()
  }

  return {
    input: {
      requestId: task.requestId,
      taskId: task.taskId,
      data
    },
    summary
  }
}

function buildSkillPrompt(task) {
  return `/${task.skillId}
请处理 AipinData 推送过来的美的舆情预警候选数据。
数据文件：aipin-input.json
数据摘要：aipin-input-summary.json

处理目标：
1. 读取 data 数组。
2. 按 midea-yq-alert 的规则逐条判断是否需要报送。
3. 识别重复链接、重复投诉、同话题传播链和需要人工复核的边界情况。
4. 对需要报送的内容生成客户要求的等级、单位、归属、内容标签、摘要、AI总结和AI研判。
5. 对不报送或暂不重复报送的内容说明原因。
6. 如果数据字段不足，请标记为信息不足，不要编造。

请把结构化处理结果写入当前工作目录的 aipin-result.json，必须是 JSON，格式如下：
{
  "items": [
    {
      "id": "原始数据 id（数字），用于系统精确回填，必须逐条填写且与输入一致",
      "summary": "摘要",
      "fullLabel": "完整标签，例如：【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】",
      "complaintNo": "投诉编号，没有则为空字符串",
      "aiSummary": "AI总结",
      "aiJudgement": "AI研判",
      "pushFlag": "推送标识，只能填：推送、不推送、重复"
    }
  ]
}
字段名必须保留为 id、summary、fullLabel、complaintNo、aiSummary、aiJudgement、pushFlag，便于系统回填监控列表。
id 必须使用 aipin-input.json 中原始数据的 id；系统只按 id 回填，不使用 news_uuid、newsUuid、itemId、requestId 或 itemIndex 兜底。
其中 summary、fullLabel、aiSummary、aiJudgement、pushFlag 必须逐条填写，不能留空；不推送或重复也必须填写完整标签、AI 总结、AI 研判，并把 pushFlag 填为 不推送 或 重复。`
}

function buildSkillRetryPrompt(task, validationError, attempt, maxAttempts) {
  return `/${task.skillId}
上一次 AipinData 处理结果没有通过字段校验，请重新读取 aipin-input.json，并覆盖写入当前工作目录的 aipin-result.json。

这是第 ${attempt}/${maxAttempts} 次处理尝试。
校验错误：
${validationError?.message || validationError || '字段为空'}

要求：
1. items 数组必须覆盖 aipin-input.json 中的每一条 data。
2. 每条必须填写原始 id、summary、fullLabel、aiSummary、aiJudgement、pushFlag。
3. pushFlag 只能填：推送、不推送、重复。
4. 不推送或重复也必须填写 AI 总结和 AI 研判，说明原因。
5. 系统只按原始 id 回填，不使用 news_uuid、newsUuid、itemId、requestId 或 itemIndex 兜底。`
}
async function pathExists(filePath) {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

async function ensureSkillAvailableInSession({ cwd, skillId, userDataPath, projectRoot = path.resolve(__dirname, '..') }) {
  if (!cwd || !skillId || /[\\/]/.test(skillId)) return null

  const targetDir = path.join(cwd, '.codex', 'skills', skillId)
  if (await pathExists(path.join(targetDir, 'SKILL.md'))) {
    return targetDir
  }

  const sourceCandidates = [
    path.join(userDataPath || '', 'skills', skillId),
    path.join(projectRoot, 'skills', skillId),
    path.join(projectRoot, '.codex', 'skills', skillId),
    path.join(projectRoot, '.claude', 'skills', skillId)
  ].filter(Boolean)

  for (const sourceDir of sourceCandidates) {
    if (!(await pathExists(path.join(sourceDir, 'SKILL.md')))) continue
    await fsp.mkdir(path.dirname(targetDir), { recursive: true })
    await fsp.cp(sourceDir, targetDir, { recursive: true, force: true })
    return targetDir
  }

  return null
}

async function readStructuredResultIfExists(sessionCwd) {
  const resultPath = path.join(sessionCwd, 'aipin-result.json')
  try {
    return parseAipinResultContent(await fsp.readFile(resultPath, 'utf-8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    return {
      parseError: err.message,
      file: resultPath
    }
  }
}

function normalizeLooseJsonStringValue(value) {
  let normalized = String(value || '').trim()
  if (normalized.endsWith(',')) normalized = normalized.slice(0, -1).trim()
  if (normalized.startsWith('"')) normalized = normalized.slice(1)
  if (normalized.endsWith('"')) normalized = normalized.slice(0, -1)
  return normalized
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .trim()
}

function parseLooseScalar(value) {
  const normalized = normalizeLooseJsonStringValue(value)
  if (!normalized) return ''
  if (normalized === 'null') return null
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized)
  if (normalized === '[' || normalized === '{') return ''
  return normalized
}

function parseLooseAipinResult(content) {
  const items = []
  let current = null
  for (const line of String(content || '').split(/\r?\n/)) {
    if (/^\s*\{\s*$/.test(line)) {
      current = {}
      continue
    }

    if (current && /^\s*\}\s*,?\s*$/.test(line)) {
      if (Object.keys(current).length) items.push(current)
      current = null
      continue
    }

    if (!current) continue
    const match = line.match(/^\s*"([^"]+)"\s*:\s*(.*)\s*$/)
    if (!match) continue
    current[match[1]] = parseLooseScalar(match[2])
  }
  return items.length ? { items } : null
}

function parseAipinResultContent(content) {
  try {
    return JSON.parse(content)
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err
    const looseResult = parseLooseAipinResult(content)
    if (looseResult) return looseResult
    throw err
  }
}

const PROCESSED_FIELD_ALIASES = {
  summary: ['summary', 'digest', 'news_digest', 'reportSummary', 'report_summary', 'mideaSummary', 'midea_summary', '摘要'],
  fullLabel: ['fullLabel', 'full_label', 'completeLabel', 'complete_label', 'fullTags', 'full_tags', 'completeTags', 'complete_tags', '完整标签', '标签'],
  complaintNo: ['complaintNo', 'complaint_no', 'complaintId', 'complaint_id', 'complaintNumber', 'complaint_number', 'caseNo', 'case_no', 'workOrderNo', 'work_order_no', '投诉编号'],
  aiSummary: ['aiSummary', 'ai_summary', 'aiConclusion', 'ai_conclusion', 'AI总结', 'ai总结'],
  aiJudgement: ['aiJudgement', 'ai_judgement', 'aiJudgment', 'ai_judgment', 'aiAnalysis', 'ai_analysis', 'AI研判', 'ai研判'],
  pushFlag: ['pushFlag', 'push_flag', 'pushStatus', 'push_status', 'reportStatus', 'report_status', '推送标识', '是否推送', '推送状态', '报送状态']
}

function normalizeScalar(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function normalizeMideaPushFlag(value) {
  const normalized = normalizeScalar(value)
  if (!normalized) return ''
  if (normalized === '有推送' || normalized === '推送' || normalized === '已推送' || normalized === '报送' || normalized === '已报送' || normalized === '需要报送') return '推送'
  if (normalized === '不推送' || normalized === '未推送' || normalized === '不报送' || normalized === '无需报送' || normalized === '不需要报送') return '不推送'
  if (normalized === '重复' || normalized === '重复推送' || normalized === '重复报送') return '重复'
  if (normalized.includes('重复')) return '重复'
  if (normalized.includes('不推送') || normalized.includes('不报送') || normalized.includes('无需报送') || normalized.includes('不需要报送')) return '不推送'
  if (normalized.includes('有推送') || normalized.includes('已推送') || normalized.includes('报送') || normalized.includes('推送')) return '推送'
  return normalized
}

function aliasedValue(source, aliases) {
  if (!source || typeof source !== 'object') return ''
  for (const alias of aliases) {
    const value = normalizeScalar(source[alias])
    if (value) return value
  }
  return ''
}

function extractProcessedFields(source) {
  const fields = {}
  for (const [key, aliases] of Object.entries(PROCESSED_FIELD_ALIASES)) {
    fields[key] = aliasedValue(source, aliases)
  }
  fields.pushFlag = normalizeMideaPushFlag(fields.pushFlag)
  return fields
}

function getResultItems(result) {
  if (!result) return []
  if (Array.isArray(result)) return result
  for (const key of ['items', 'data', 'results', 'records']) {
    if (Array.isArray(result[key])) return result[key]
  }
  return [result]
}

function pickTargetItem({ candidate, items }) {
  if (!items.length) return null

  const candidateId = candidate?.id
  if (candidateId !== undefined && candidateId !== null && candidateId !== '') {
    const normalizedCandidateId = String(candidateId).trim()
    const item = items.find(row => String(row.articleId).trim() === normalizedCandidateId || String(row.data?.id).trim() === normalizedCandidateId)
    if (item) return item
  }
  return null
}

function pickResultCandidateForRow({ row, rows, resultItems }) {
  if (!row || !resultItems.length) return null
  for (const candidate of resultItems) {
    const target = pickTargetItem({ candidate, items: rows })
    if (target?.itemId === row.itemId) return candidate
  }
  return null
}

function updateStoreWithStructuredResult({ dataStore, task, structuredResult }) {
  if (!dataStore) return
  const ref = parseAipinDataReference(task.sourceFile)
  const rows = ref?.type === 'item'
    ? [dataStore.getItem(ref.id)].filter(Boolean)
    : dataStore.getItemsForRequest(task.requestId)
  const resultItems = getResultItems(structuredResult)
  rows.forEach((row, index) => {
    const candidate = pickResultCandidateForRow({
      row,
      rows,
      resultItems
    })
    dataStore.updateProcessedFields({
      itemId: row.itemId,
      fields: extractProcessedFields(candidate || {}),
      task,
      status: 'completed'
    })
  })
}

function validateStructuredResultForStore({ dataStore, task, structuredResult }) {
  const ref = parseAipinDataReference(task.sourceFile)
  const rows = ref?.type === 'item'
    ? [dataStore.getItem(ref.id)].filter(Boolean)
    : dataStore.getItemsForRequest(task.requestId)
  if (!structuredResult) {
    throw new Error('AipinData skill did not write aipin-result.json')
  }
  if (structuredResult.parseError) {
    throw new Error(`AipinData skill result JSON parse failed: ${structuredResult.parseError}`)
  }
  const resultItems = getResultItems(structuredResult)
  if (!resultItems.length) {
    throw new Error('AipinData skill result has no items')
  }

  const requiredFields = [
    ['summary', '摘要'],
    ['fullLabel', '完整标签'],
    ['aiSummary', 'AI总结'],
    ['aiJudgement', 'AI研判'],
    ['pushFlag', '推送标识']
  ]
  const errors = []
  rows.forEach((row, index) => {
    const candidate = pickResultCandidateForRow({
      row,
      rows,
      resultItems
    })
    if (!candidate) {
      errors.push(`${row.itemId || index}: 缺少处理结果`)
      return
    }
    const fields = extractProcessedFields(candidate)
    for (const [key, label] of requiredFields) {
      if (!normalizeScalar(fields[key])) errors.push(`${row.itemId || index}: ${label}为空`)
    }
  })

  if (errors.length) {
    throw new Error(`AipinData skill result missing required fields: ${errors.join('; ')}`)
  }
}

async function readOutputStructuredResult(outputDir) {
  if (!outputDir) return null
  try {
    return parseAipinResultContent(await fsp.readFile(path.join(outputDir, 'aipin-result.json'), 'utf-8'))
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return null
    throw err
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeWaitNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function normalizeAttemptCount(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

async function waitForStructuredResult(sessionCwd, { timeoutMs = DEFAULT_PROCESSOR_CONFIG.structuredResultWaitMs, intervalMs = DEFAULT_PROCESSOR_CONFIG.structuredResultPollMs } = {}) {
  const normalizedTimeoutMs = normalizeWaitNumber(timeoutMs, DEFAULT_PROCESSOR_CONFIG.structuredResultWaitMs)
  const normalizedIntervalMs = Math.max(1, normalizeWaitNumber(intervalMs, DEFAULT_PROCESSOR_CONFIG.structuredResultPollMs))
  const deadline = Date.now() + normalizedTimeoutMs
  while (true) {
    const result = await readStructuredResultIfExists(sessionCwd)
    if (result) return result
    if (Date.now() >= deadline) return null
    await sleep(Math.min(normalizedIntervalMs, Math.max(1, deadline - Date.now())))
  }
}

async function removeStructuredResultIfExists(sessionCwd) {
  try {
    await fsp.unlink(path.join(sessionCwd, 'aipin-result.json'))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}

async function closeAipinAgentSession(agentSessionManager, sessionId) {
  if (!sessionId || typeof agentSessionManager?.close !== 'function') return
  try {
    await agentSessionManager.close(sessionId)
  } catch (err) {
    console.warn('[AipinData] Failed to close agent session after processing:', err)
  }
}

async function processAipinTask({ task, userDataPath, agentSessionManager, queue, config = {}, currentUser = null, now = () => new Date(), aipinDataStore = null, feishuPusher = null }) {
  const dataStore = aipinDataStore || new AipinDataStore({ userDataPath, now: () => now().toISOString() })
  const shouldCloseStore = !aipinDataStore
  let session = null
  try {
    if (!task?.skillId) throw new Error('Aipin processing task skillId is required')
    dataStore.markTaskStatus({ requestId: task.requestId, task, status: 'processing' })
    const envelope = await loadAipinSourceEnvelope({ sourceFile: task.sourceFile, dataStore })
    const prepared = prepareAipinInput(envelope, task, config)
    prepared.summary.generatedAt = now().toISOString()

    session = agentSessionManager.create({
      type: 'chat',
      title: `AipinData处理-${task.requestId}`,
      source: 'aipin-data-processing',
      cwdSubDir: 'aipin-data',
      ownerUserId: currentUser?.id || null,
      meta: {
        aipinTaskId: task.taskId,
        requestId: task.requestId,
        skillId: task.skillId
      }
    })
    if (!session?.id || !session?.cwd) {
      throw new Error('Agent session creation did not return id and cwd')
    }

    await fsp.mkdir(session.cwd, { recursive: true })
    await ensureSkillAvailableInSession({
      cwd: session.cwd,
      skillId: task.skillId,
      userDataPath
    })
    await fsp.writeFile(path.join(session.cwd, 'aipin-input.json'), JSON.stringify(prepared.input, null, 2), 'utf-8')
    await fsp.writeFile(path.join(session.cwd, 'aipin-input-summary.json'), JSON.stringify(prepared.summary, null, 2), 'utf-8')

    const messageOptions = {
      meta: {
        aipinTaskId: task.taskId,
        requestId: task.requestId,
        skillId: task.skillId
      },
      currentUser
    }

    await agentSessionManager.sendMessage(session.id, buildSkillPrompt(task), messageOptions)

    const resultDir = path.join(userDataPath, 'aipin-processed', String(task.createdAt || now().toISOString()).slice(0, 10), task.taskId)
    await fsp.mkdir(resultDir, { recursive: true })
    const maxAttempts = normalizeAttemptCount(config.requiredFieldRetryAttempts, DEFAULT_PROCESSOR_CONFIG.requiredFieldRetryAttempts)
    const waitOptions = {
      timeoutMs: normalizeWaitNumber(config.structuredResultWaitMs, DEFAULT_PROCESSOR_CONFIG.structuredResultWaitMs),
      intervalMs: normalizeWaitNumber(config.structuredResultPollMs, DEFAULT_PROCESSOR_CONFIG.structuredResultPollMs)
    }
    let structuredResult = null
    let validationError = null
    let attemptsUsed = 0
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsUsed = attempt
      structuredResult = await waitForStructuredResult(session.cwd, waitOptions)
      try {
        validateStructuredResultForStore({
          dataStore,
          task,
          structuredResult
        })
        validationError = null
        break
      } catch (err) {
        validationError = err
        if (attempt >= maxAttempts) break
        await removeStructuredResultIfExists(session.cwd)
        await agentSessionManager.sendMessage(
          session.id,
          buildSkillRetryPrompt(task, err, attempt + 1, maxAttempts),
          messageOptions
        )
      }
    }
    const resultFile = path.join(resultDir, 'result.json')
    await fsp.writeFile(resultFile, JSON.stringify({
      taskId: task.taskId,
      requestId: task.requestId,
      sessionId: session.id,
      outputDir: session.cwd,
      completedAt: now().toISOString(),
      structuredResult,
      requiredFieldAttempts: attemptsUsed,
      validationError: validationError?.message || null
    }, null, 2), 'utf-8')

    if (validationError) {
      validationError.resultFile = resultFile
      throw validationError
    }

    const queuedCompletedTask = await queue.completeTask(task.taskId, {
      sessionId: session.id,
      outputDir: session.cwd,
      resultFile
    })
    const completedTask = { ...task, ...queuedCompletedTask }
    dataStore.markTaskStatus({ requestId: task.requestId, task: completedTask, status: 'completed' })
    const resultForStore = structuredResult || await readOutputStructuredResult(session.cwd)
    updateStoreWithStructuredResult({
      dataStore,
      task: completedTask,
      structuredResult: resultForStore
    })
    if (feishuPusher && typeof feishuPusher.pushPending === 'function') {
      try {
        await feishuPusher.pushPending({ requestId: task.requestId })
      } catch (err) {
        console.warn('[AipinData] Auto push failed after processing:', err)
      }
    }
    return completedTask
  } catch (err) {
    if (dataStore && task?.requestId) {
      dataStore.markTaskStatus({
        requestId: task.requestId,
        task: err?.resultFile ? { ...task, resultFile: err.resultFile } : task,
        status: 'failed',
        error: err?.message || String(err)
      })
    }
    if (queue?.failTask && task?.taskId) {
      return queue.failTask(task.taskId, err)
    }
    throw err
  } finally {
    await closeAipinAgentSession(agentSessionManager, session?.id)
    if (shouldCloseStore) dataStore.close()
  }
}

module.exports = {
  buildSkillPrompt,
  ensureSkillAvailableInSession,
  prepareAipinInput,
  processAipinTask
}
