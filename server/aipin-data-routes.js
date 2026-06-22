const crypto = require('crypto')
const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')
const {
  AipinDataStore,
  dataReferenceForItem,
  isAipinDataReference
} = require('./aipin-data-store')

const MIDEA_YQ_ALERT_SKILL_ID = 'midea-yq-alert'

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatDateParts(date) {
  return {
    day: `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    compact: `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`,
    time: `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}`
  }
}

function getAipinDataStore(userDataPath) {
  return new AipinDataStore({ userDataPath })
}

function extractAipinPayloadItems(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data?.data)) return payload.data.data
  return null
}

async function storeAipinDataPayload({ userDataPath, payload, now = () => new Date(), randomHex = () => crypto.randomBytes(4).toString('hex') }) {
  const items = extractAipinPayloadItems(payload)
  if (!Array.isArray(items)) {
    const error = new Error('Invalid AipinData payload: request body must be an array or data.data array')
    error.statusCode = 400
    throw error
  }

  const receivedAtDate = now()
  const receivedAt = receivedAtDate.toISOString()
  const { compact, time } = formatDateParts(receivedAtDate)
  const requestId = `aipin_${compact}_${time}_${randomHex()}`

  const store = getAipinDataStore(userDataPath)
  const stored = store.storePayload({
    requestId,
    receivedAt,
    items
  })
  store.close()

  return {
    success: true,
    requestId,
    receivedCount: items.length,
    storedCount: stored.storedCount,
    duplicateCount: stored.duplicateCount,
    storedFile: stored.storedFile,
    storage: 'sqlite'
  }
}

function assertRouteDependencies({ app, userDataPath }) {
  if (!app || typeof app.post !== 'function') {
    throw new Error('Express app is required')
  }
  if (!userDataPath) {
    throw new Error('userDataPath is required')
  }
  fs.mkdirSync(userDataPath, { recursive: true })
}

function attachTaskResult(storeResult, task) {
  if (!task) return storeResult
  return {
    ...storeResult,
    taskId: task.taskId,
    taskStatus: task.status,
    skillId: task.skillId
  }
}

function registerAipinDataPushRoutes({ app, userDataPath, processingQueue, processNextTask, now, randomHex }) {
  assertRouteDependencies({ app, userDataPath })

  app.post('/api/aipin-data/push', async (req, res) => {
    try {
      const result = await storeAipinDataPayload({
        userDataPath,
        payload: req.body || {},
        now,
        randomHex
      })
      const task = processingQueue && result.storedCount > 0
        ? await processingQueue.createTask({
          requestId: result.requestId,
          sourceFile: result.storedFile,
          receivedCount: result.storedCount
        })
        : null
      if (task) {
        const store = getAipinDataStore(userDataPath)
        store.markTaskLinked({ requestId: result.requestId, task })
        store.close()
      }
      if (task && typeof processNextTask === 'function' && typeof processingQueue.getConfig === 'function') {
        const config = await processingQueue.getConfig()
        if (config.enabled !== false && config.autoProcess) {
          Promise.resolve()
            .then(() => processNextTask(task.taskId))
            .catch(err => console.error('[AipinData] Auto processing failed:', err))
        }
      }
      res.json(attachTaskResult(result, task))
    } catch (err) {
      const statusCode = err?.statusCode || 500
      res.status(statusCode).json({
        success: false,
        error: err.message || 'Failed to store AipinData payload'
      })
    }
  })
}

function registerAipinDataRoutes(options) {
  registerAipinDataPushRoutes(options)
}

function sendRouteError(res, err, fallbackMessage = 'AipinData request failed') {
  const statusCode = err?.statusCode || (err?.code === 'AUTH_FORBIDDEN' ? 403 : (err?.code === 'AUTH_REQUIRED' ? 401 : 500))
  res.status(statusCode).json({
    success: false,
    error: err.message || fallbackMessage
  })
}

function resolveStoredFilePath(userDataPath, storedFile) {
  if (isAipinDataReference(storedFile)) {
    const err = new Error('AipinData record is stored in SQLite, not a filesystem path')
    err.statusCode = 400
    throw err
  }
  const normalized = String(storedFile || '').replace(/\\/g, '/')
  const absolutePath = path.resolve(userDataPath, normalized)
  const root = path.resolve(userDataPath)
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    const err = new Error('Invalid AipinData stored file path')
    err.statusCode = 400
    throw err
  }
  return absolutePath
}

function mergePushTask(row, task = null) {
  if (!task) return row
  return {
    ...row,
    taskId: task.taskId || row.taskId || null,
    skillId: task.skillId || row.skillId || null,
    status: task.status || row.status || 'received',
    createdAt: task.createdAt || row.createdAt || null,
    startedAt: task.startedAt || row.startedAt || null,
    finishedAt: task.finishedAt || row.finishedAt || null,
    sessionId: task.sessionId || row.sessionId || null,
    outputDir: task.outputDir || row.outputDir || null,
    resultFile: task.resultFile || row.resultFile || null,
    error: task.error || row.error || null
  }
}

function isAipinItemRequestId(requestId) {
  return String(requestId || '').includes('__item_')
}

const MIDEA_PROCESSED_FIELD_ALIASES = {
  summary: ['summary', 'digest', 'news_digest', 'reportSummary', 'report_summary', 'mideaSummary', 'midea_summary', '摘要'],
  fullLabel: ['fullLabel', 'full_label', 'completeLabel', 'complete_label', 'fullTags', 'full_tags', 'completeTags', 'complete_tags', '完整标签', '标签'],
  complaintNo: ['complaintNo', 'complaint_no', 'complaintId', 'complaint_id', 'complaintNumber', 'complaint_number', 'complaintCode', 'complaint_code', 'caseNo', 'case_no', 'workOrderNo', 'work_order_no', '投诉编号'],
  aiSummary: ['aiSummary', 'ai_summary', 'aiConclusion', 'ai_conclusion', 'AI总结', 'ai总结'],
  aiJudgement: ['aiJudgement', 'ai_judgement', 'aiJudgment', 'ai_judgment', 'aiAnalysis', 'ai_analysis', 'AI研判', 'ai研判'],
  pushFlag: ['pushFlag', 'push_flag', 'pushStatus', 'push_status', 'sendFlag', 'send_flag', 'reportFlag', 'report_flag', 'reportStatus', 'report_status', '推送标识', '是否推送', '推送状态', '报送标识', '报送状态']
}

const MIDEA_PROCESSED_CONTAINER_KEYS = [
  'processedFields',
  'mideaYq',
  'midea_yq',
  'midea',
  'result',
  'analysis',
  'output'
]

function normalizeScalar(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function findAliasedValue(source, aliases, depth = 0) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || depth > 3) return ''

  for (const key of aliases) {
    const value = normalizeScalar(source[key])
    if (value) return value
  }

  for (const key of MIDEA_PROCESSED_CONTAINER_KEYS) {
    const value = findAliasedValue(source[key], aliases, depth + 1)
    if (value) return value
  }

  for (const value of Object.values(source)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const nested = findAliasedValue(value, aliases, depth + 1)
    if (nested) return nested
  }

  return ''
}

function extractMideaProcessedFields(source) {
  const fields = {}
  for (const [targetKey, aliases] of Object.entries(MIDEA_PROCESSED_FIELD_ALIASES)) {
    fields[targetKey] = findAliasedValue(source, aliases)
  }
  fields.pushFlag = normalizeMideaPushFlag(fields.pushFlag) || inferMideaPushFlag(fields)
  return fields
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

function inferMideaPushFlag(fields) {
  const text = [fields.aiJudgement, fields.aiSummary, fields.summary].filter(Boolean).join('\n')
  if (!text) return ''
  if (text.includes('重复')) return '重复'
  if (text.includes('不推送') || text.includes('不报送') || text.includes('无需报送') || text.includes('不需要报送')) return '不推送'
  if (text.includes('有推送') || text.includes('已推送') || text.includes('报送') || text.includes('推送')) return '推送'
  return ''
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

function resolveResultFilePath(userDataPath, resultFile) {
  if (!resultFile) return null
  if (path.isAbsolute(resultFile)) return resultFile
  return resolveStoredFilePath(userDataPath, resultFile)
}

async function readResultJson(userDataPath, resultFile, cache) {
  const resultPath = resolveResultFilePath(userDataPath, resultFile)
  if (!resultPath) return null
  if (cache.has(resultPath)) return cache.get(resultPath)
  try {
    const parsed = parseAipinResultContent(await fsp.readFile(resultPath, 'utf-8'))
    cache.set(resultPath, parsed)
    return parsed
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) {
      cache.set(resultPath, null)
      return null
    }
    throw err
  }
}

function getResultItemCandidates(result) {
  if (!result) return []
  if (Array.isArray(result)) return result
  for (const key of ['items', 'data', 'results', 'outputs', 'records', 'alerts']) {
    if (Array.isArray(result[key])) return result[key]
  }
  for (const key of ['structuredResult', 'result', 'output']) {
    if (result[key] && result[key] !== result) {
      const nested = getResultItemCandidates(result[key])
      if (nested.length) return nested
    }
  }
  return [result]
}

function scoreResultCandidate(candidate, { item, itemIndex, itemId }) {
  if (!candidate || typeof candidate !== 'object') return 0
  let score = 0
  if (candidate.itemId === itemId || candidate.requestId === itemId) score += 10
  if (Number(candidate.itemIndex) === itemIndex || Number(candidate.index) === itemIndex) score += 5
  const candidateNewsUuid = candidate.news_uuid || candidate.newsUuid
  const itemNewsUuid = item?.news_uuid || item?.newsUuid
  if (candidateNewsUuid && itemNewsUuid && candidateNewsUuid === itemNewsUuid) score += 6
  return score
}

function pickResultCandidate(result, { item, itemIndex, itemId }) {
  const candidates = getResultItemCandidates(result)
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]

  let best = null
  let bestScore = 0
  for (const candidate of candidates) {
    const score = scoreResultCandidate(candidate, { item, itemIndex, itemId })
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }

  if (best) return best
  return candidates[itemIndex] || null
}

async function readOutputStructuredResult(outputDir, cache) {
  if (!outputDir) return null
  const resultPath = path.join(outputDir, 'aipin-result.json')
  if (cache.has(resultPath)) return cache.get(resultPath)
  try {
    const parsed = parseAipinResultContent(await fsp.readFile(resultPath, 'utf-8'))
    cache.set(resultPath, parsed)
    return parsed
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) {
      cache.set(resultPath, null)
      return null
    }
    throw err
  }
}

async function resolveMideaProcessedFields({ userDataPath, item, itemIndex, itemId, task, resultCache }) {
  const fromData = extractMideaProcessedFields(item || {})
  if (!task?.resultFile && !task?.outputDir) return fromData

  const result = await readResultJson(userDataPath, task.resultFile, resultCache)
  const structuredResult = result?.structuredResult || await readOutputStructuredResult(task.outputDir, resultCache)
  const resultSource = structuredResult || result
  const matched = pickResultCandidate(resultSource, { item, itemIndex, itemId })
  return {
    ...fromData,
    ...Object.fromEntries(
      Object.entries(extractMideaProcessedFields(matched || {})).filter(([, value]) => value)
    )
  }
}

function toPositiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function paginateRows(rows, { page = 1, pageSize = 20 } = {}) {
  const normalizedPage = toPositiveInteger(page, 1)
  const normalizedPageSize = Math.min(toPositiveInteger(pageSize, 20), 100)
  const start = (normalizedPage - 1) * normalizedPageSize
  return {
    rows: rows.slice(start, start + normalizedPageSize),
    total: rows.length,
    page: normalizedPage,
    pageSize: normalizedPageSize
  }
}

function summarizeAipinAdminItems(rows) {
  const summary = {
    total: rows.length,
    pending: 0,
    processing: 0,
    pushed: 0,
    processFailed: 0,
    pushFailed: 0
  }
  for (const row of rows) {
    if (row.status === 'received' || row.status === 'pending') summary.pending += 1
    if (row.status === 'processing') summary.processing += 1
    if (row.status === 'failed') summary.processFailed += 1
    if (row.pushStatus === 'success') summary.pushed += 1
    if (row.pushStatus === 'failed') summary.pushFailed += 1
  }
  return summary
}

async function listAipinAdminPushes({ userDataPath, processingQueue, status, limit, page = 1, pageSize = 20 }) {
  const normalizedLimit = limit ? toPositiveInteger(limit, 100) : null
  const normalizedPageSize = normalizedLimit || toPositiveInteger(pageSize, 20)
  const store = getAipinDataStore(userDataPath)
  const sqliteRows = store.listBatches()
  store.close()
  const tasks = await processingQueue.listTasks({ limit: Math.max(normalizedLimit || (toPositiveInteger(page, 1) * normalizedPageSize), 1000) })

  const taskByRequestId = new Map(tasks.map(task => [task.requestId, task]))
  const rows = sqliteRows
    .map(row => mergePushTask(row, taskByRequestId.get(row.requestId) || null))
    .filter(row => !status || row.status === status)
    .sort((a, b) => String(b.receivedAt || b.createdAt || '').localeCompare(String(a.receivedAt || a.createdAt || '')))

  if (normalizedLimit) {
    return {
      pushes: rows.slice(0, normalizedLimit),
      total: rows.length,
      page: 1,
      pageSize: normalizedLimit
    }
  }

  const pagination = paginateRows(rows, { page, pageSize })
  return {
    pushes: pagination.rows,
    total: pagination.total,
    page: pagination.page,
    pageSize: pagination.pageSize
  }
}

async function getAipinAdminPushDetail({ userDataPath, processingQueue, requestId }) {
  const store = getAipinDataStore(userDataPath)
  const envelope = store.getBatchEnvelope(requestId)
  store.close()
  if (envelope) {
    const row = await findAipinAdminPushRow({ userDataPath, processingQueue, requestId })
    return {
      requestId: envelope.requestId,
      receivedAt: envelope.receivedAt,
      receivedCount: envelope.receivedCount,
      storedFile: row.storedFile,
      data: envelope.data,
      task: {
        taskId: row.taskId,
        skillId: row.skillId,
        status: row.status,
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        sessionId: row.sessionId,
        outputDir: row.outputDir,
        resultFile: row.resultFile,
        error: row.error
      }
    }
  }

  const err = new Error('AipinData push record not found')
  err.statusCode = 404
  throw err
}

async function findAipinAdminPushRow({ userDataPath, processingQueue, requestId }) {
  const { pushes } = await listAipinAdminPushes({ userDataPath, processingQueue, limit: 10000 })
  const row = pushes.find(item => item.requestId === requestId)
  if (!row) {
    const err = new Error('AipinData push record not found')
    err.statusCode = 404
    throw err
  }
  return row
}

async function prepareAipinAdminPushForProcess({ userDataPath, processingQueue, requestId }) {
  const row = await findAipinAdminPushRow({ userDataPath, processingQueue, requestId })

  if (row.taskId) {
    if (typeof processingQueue.prepareTaskForManualProcess === 'function') {
      return processingQueue.prepareTaskForManualProcess(row.taskId, { skillId: MIDEA_YQ_ALERT_SKILL_ID })
    }
    if (row.status === 'failed' && typeof processingQueue.retryTask === 'function') {
      return processingQueue.retryTask(row.taskId)
    }
    return row
  }

  if (typeof processingQueue.createTask !== 'function') {
    const err = new Error('AipinData processing task creator is not available')
    err.statusCode = 503
    throw err
  }

  const task = await processingQueue.createTask({
    requestId: row.requestId,
    sourceFile: row.storedFile,
    receivedCount: row.receivedCount
  })
  const store = getAipinDataStore(userDataPath)
  store.markTaskLinked({ requestId: row.requestId, task })
  store.close()
  return task
}

async function listAipinAdminItems({ userDataPath, processingQueue, status, pushStatus, pushFlag, publishStart, publishEnd, page = 1, pageSize = 20 }) {
  const store = getAipinDataStore(userDataPath)
  try {
    return store.listItemsPage({ status, pushStatus, pushFlag, publishStart, publishEnd, page, pageSize })
  } finally {
    store.close()
  }
}

async function findAipinAdminItem({ userDataPath, processingQueue, itemId }) {
  const store = getAipinDataStore(userDataPath)
  const row = store.getItem(itemId)
  store.close()
  if (!row) {
    const err = new Error('AipinData item record not found')
    err.statusCode = 404
    throw err
  }
  return row
}

async function getAipinAdminItemDetail({ userDataPath, itemId }) {
  return findAipinAdminItem({ userDataPath, itemId })
}

async function storeSingleAipinItemEnvelope({ userDataPath, item }) {
  return dataReferenceForItem(item.itemId)
}

function persistMideaProcessedFieldsForPush({ userDataPath, item }) {
  if (!item?.itemId) return
  const store = getAipinDataStore(userDataPath)
  try {
    store.updateProcessedFields({
      itemId: item.itemId,
      fields: {
        summary: item.summary || item.optimizedSummary || '',
        fullLabel: item.fullLabel || '',
        complaintNo: item.complaintNo || '',
        aiSummary: item.aiSummary || '',
        aiJudgement: item.aiJudgement || item.aiJudgment || '',
        pushFlag: item.pushFlag || ''
      },
      status: 'completed'
    })
  } finally {
    store.close()
  }
}

async function prepareAipinAdminItemForProcess({ userDataPath, processingQueue, itemId }) {
  const item = await findAipinAdminItem({ userDataPath, processingQueue, itemId })
  const hasItemTask = item.taskId && item.taskRequestId === item.itemId

  if (hasItemTask) {
    if (typeof processingQueue.prepareTaskForManualProcess === 'function') {
      return processingQueue.prepareTaskForManualProcess(item.taskId, { skillId: MIDEA_YQ_ALERT_SKILL_ID })
    }
    if (item.status === 'failed' && typeof processingQueue.retryTask === 'function') {
      return processingQueue.retryTask(item.taskId)
    }
    return item
  }

  if (typeof processingQueue.createTask !== 'function') {
    const err = new Error('AipinData processing task creator is not available')
    err.statusCode = 503
    throw err
  }

  const sourceFile = await storeSingleAipinItemEnvelope({ userDataPath, item })
  const task = await processingQueue.createTask({
    requestId: item.itemId,
    sourceFile,
    receivedCount: 1,
    skillId: MIDEA_YQ_ALERT_SKILL_ID
  })
  const store = getAipinDataStore(userDataPath)
  store.markTaskLinked({ requestId: item.itemId, task })
  store.close()
  return task
}

function registerAipinDataAdminRoutes({ app, userDataPath, processingQueue, processNextTask, feishuPusher, requireAdmin }) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('Express app with get/post is required')
  }
  if (!userDataPath) {
    throw new Error('userDataPath is required')
  }
  if (!processingQueue) {
    throw new Error('processingQueue is required')
  }
  if (typeof requireAdmin !== 'function') {
    throw new Error('requireAdmin is required')
  }

  const handleAdminRoute = handler => async (req, res) => {
    try {
      requireAdmin(req)
      res.json(await handler(req))
    } catch (err) {
      sendRouteError(res, err)
    }
  }

  app.get('/api/aipin-data/admin/pushes', handleAdminRoute(async req => {
    const result = await listAipinAdminPushes({
      userDataPath,
      processingQueue,
      status: req.query?.status,
      page: req.query?.page ? Number(req.query.page) : 1,
      pageSize: req.query?.pageSize ? Number(req.query.pageSize) : 20,
      limit: req.query?.limit ? Number(req.query.limit) : null
    })
    return {
      success: true,
      ...result
    }
  }))

  app.get('/api/aipin-data/admin/items', handleAdminRoute(async req => {
    const result = await listAipinAdminItems({
      userDataPath,
      processingQueue,
      status: req.query?.status,
      pushStatus: req.query?.pushStatus,
      pushFlag: req.query?.pushFlag,
      publishStart: req.query?.publishStart,
      publishEnd: req.query?.publishEnd,
      page: req.query?.page ? Number(req.query.page) : 1,
      pageSize: req.query?.pageSize ? Number(req.query.pageSize) : 20
    })
    return {
      success: true,
      ...result
    }
  }))

  app.get('/api/aipin-data/admin/items/:itemId', handleAdminRoute(async req => ({
    success: true,
    item: await getAipinAdminItemDetail({
      userDataPath,
      itemId: req.params.itemId
    })
  })))

  app.get('/api/aipin-data/admin/pushes/:requestId', handleAdminRoute(async req => ({
    success: true,
    push: await getAipinAdminPushDetail({
      userDataPath,
      processingQueue,
      requestId: req.params.requestId
    })
  })))

  app.post('/api/aipin-data/admin/tasks/:taskId/retry', handleAdminRoute(async req => ({
    success: true,
    task: await processingQueue.retryTask(req.params.taskId)
  })))

  app.post('/api/aipin-data/admin/tasks/:taskId/process', handleAdminRoute(async req => {
    if (typeof processNextTask !== 'function') {
      const err = new Error('AipinData processor is not available')
      err.statusCode = 503
      throw err
    }

    if (typeof processingQueue.prepareTaskForManualProcess === 'function') {
      await processingQueue.prepareTaskForManualProcess(req.params.taskId, { skillId: MIDEA_YQ_ALERT_SKILL_ID })
    } else {
      await processingQueue.retryTask(req.params.taskId)
    }
    const task = await processNextTask(req.params.taskId, req)
    if (!task) {
      const err = new Error('AipinData processing task not found')
      err.statusCode = 404
      throw err
    }
    return { success: true, task }
  }))

  app.post('/api/aipin-data/admin/pushes/:requestId/process', handleAdminRoute(async req => {
    if (typeof processNextTask !== 'function') {
      const err = new Error('AipinData processor is not available')
      err.statusCode = 503
      throw err
    }

    const preparedTask = await prepareAipinAdminPushForProcess({
      userDataPath,
      processingQueue,
      requestId: req.params.requestId
    })
    const task = await processNextTask(preparedTask.taskId, req)
    if (!task) {
      const err = new Error('AipinData processing task not found')
      err.statusCode = 404
      throw err
    }
    return { success: true, task }
  }))

  app.post('/api/aipin-data/admin/items/:itemId/process', handleAdminRoute(async req => {
    if (typeof processNextTask !== 'function') {
      const err = new Error('AipinData processor is not available')
      err.statusCode = 503
      throw err
    }

    const preparedTask = await prepareAipinAdminItemForProcess({
      userDataPath,
      processingQueue,
      itemId: req.params.itemId
    })
    const task = await processNextTask(preparedTask.taskId, req)
    if (!task) {
      const err = new Error('AipinData processing task not found')
      err.statusCode = 404
      throw err
    }
    const store = getAipinDataStore(userDataPath)
    try {
      store.markTaskStatus({
        requestId: req.params.itemId,
        task,
        status: task.status || 'completed',
        error: task.error || null
      })
    } finally {
      store.close()
    }
    const item = await findAipinAdminItem({
      userDataPath,
      processingQueue,
      itemId: req.params.itemId
    })
    return { success: true, task, item }
  }))

  app.post('/api/aipin-data/admin/items/:itemId/push', handleAdminRoute(async req => {
    if (!feishuPusher || typeof feishuPusher.pushPending !== 'function') {
      const err = new Error('Midea Feishu pusher is not available')
      err.statusCode = 503
      throw err
    }

    const item = await findAipinAdminItem({
      userDataPath,
      processingQueue,
      itemId: req.params.itemId
    })
    if (item.status !== 'completed') {
      const err = new Error('Only completed Midea monitor items can be pushed')
      err.statusCode = 409
      throw err
    }
    if (item.pushStatus === 'success') {
      const err = new Error('Midea monitor item has already been pushed successfully')
      err.statusCode = 409
      throw err
    }

    persistMideaProcessedFieldsForPush({ userDataPath, item })
    const push = await feishuPusher.pushPending({ requestId: req.params.itemId, limit: 1 })
    const updatedItem = await findAipinAdminItem({
      userDataPath,
      processingQueue,
      itemId: req.params.itemId
    })
    return { success: push.success, push, item: updatedItem }
  }))
}

function registerAipinDataTaskRoutes({ app, processingQueue, processNextTask }) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') {
    throw new Error('Express app with get/post is required')
  }
  if (!processingQueue) {
    throw new Error('processingQueue is required')
  }

  app.get('/api/aipin-data/tasks', async (req, res) => {
    try {
      const tasks = await processingQueue.listTasks({
        status: req.query?.status,
        limit: req.query?.limit ? Number(req.query.limit) : 100
      })
      res.json({ success: true, tasks })
    } catch (err) {
      sendRouteError(res, err, 'Failed to list AipinData processing tasks')
    }
  })

  app.get('/api/aipin-data/tasks/:taskId', async (req, res) => {
    try {
      const task = await processingQueue.getTask(req.params.taskId)
      if (!task) {
        res.status(404).json({ success: false, error: 'AipinData processing task not found' })
        return
      }
      res.json({ success: true, task })
    } catch (err) {
      sendRouteError(res, err, 'Failed to load AipinData processing task')
    }
  })

  app.post('/api/aipin-data/tasks/process', async (req, res) => {
    try {
      const task = await processNextTask(req.body?.taskId || null, req)
      if (!task) {
        res.status(404).json({ success: false, error: 'No pending AipinData processing task found' })
        return
      }
      res.json({ success: true, task })
    } catch (err) {
      sendRouteError(res, err, 'Failed to process AipinData task')
    }
  })

  app.post('/api/aipin-data/tasks/:taskId/retry', async (req, res) => {
    try {
      const task = await processingQueue.retryTask(req.params.taskId)
      res.json({ success: true, task })
    } catch (err) {
      sendRouteError(res, err, 'Failed to retry AipinData processing task')
    }
  })
}

module.exports = {
  registerAipinDataRoutes,
  registerAipinDataPushRoutes,
  registerAipinDataAdminRoutes,
  registerAipinDataTaskRoutes,
  storeAipinDataPayload,
  listAipinAdminPushes,
  listAipinAdminItems,
  getAipinAdminPushDetail
}
