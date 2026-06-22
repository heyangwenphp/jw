const fs = require('fs')
const path = require('path')

const Database = require('better-sqlite3')

const AIPIN_DATA_DB_FILE = 'aipin-data.sqlite'
const AIPIN_BATCH_REF_PREFIX = 'aipin-sqlite:batch:'
const AIPIN_ITEM_REF_PREFIX = 'aipin-sqlite:item:'

const AIPIN_DATA_FIELDS = [
  ['scheme_id', 'INTEGER'],
  ['platform_name', 'TEXT'],
  ['news_title', 'TEXT'],
  ['manual_digest', 'TEXT'],
  ['news_origin_url', 'TEXT'],
  ['media_name', 'TEXT'],
  ['media_id', 'INTEGER'],
  ['news_posttime', 'TEXT'],
  ['news_uuid', 'TEXT'],
  ['platform', 'TEXT'],
  ['news_hit_keywords', 'TEXT'],
  ['media_organization', 'TEXT'],
  ['news_url', 'TEXT'],
  ['media_label', 'TEXT'],
  ['push_time', 'TEXT'],
  ['id', 'TEXT'],
  ['news_first_tag', 'TEXT'],
  ['news_first_label', 'TEXT'],
  ['news_second_tag', 'TEXT'],
  ['news_second_label', 'TEXT'],
  ['news_third_tag', 'TEXT'],
  ['news_third_label', 'TEXT'],
  ['news_four_tag', 'TEXT'],
  ['news_four_label', 'TEXT'],
  ['news_five_tag', 'TEXT'],
  ['news_five_label', 'TEXT'],
  ['first_label', 'INTEGER'],
  ['news_emotion', 'TEXT'],
  ['media_followers_count', 'INTEGER'],
  ['news_reposts_count', 'INTEGER'],
  ['news_colloct_count', 'INTEGER'],
  ['news_comment_count', 'INTEGER'],
  ['news_read_count', 'INTEGER'],
  ['news_like_count', 'INTEGER'],
  ['news_keywords', 'TEXT'],
  ['news_content', 'TEXT'],
  ['custom_media_level', 'TEXT'],
  ['news_is_origin', 'INTEGER'],
  ['is_read', 'INTEGER'],
  ['is_reply', 'INTEGER'],
  ['business_tag', 'TEXT']
]

const AIPIN_DATA_FIELD_NAMES = AIPIN_DATA_FIELDS.map(([name]) => name)

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

function dataReferenceForBatch(requestId) {
  return `${AIPIN_BATCH_REF_PREFIX}${requestId}`
}

function dataReferenceForItem(itemId) {
  return `${AIPIN_ITEM_REF_PREFIX}${itemId}`
}

function parseAipinDataReference(value) {
  const source = String(value || '')
  if (source.startsWith(AIPIN_BATCH_REF_PREFIX)) {
    return { type: 'batch', id: source.slice(AIPIN_BATCH_REF_PREFIX.length) }
  }
  if (source.startsWith(AIPIN_ITEM_REF_PREFIX)) {
    return { type: 'item', id: source.slice(AIPIN_ITEM_REF_PREFIX.length) }
  }
  return null
}

function isAipinDataReference(value) {
  return !!parseAipinDataReference(value)
}

function toJsonText(value) {
  if (value === undefined || value === null) return null
  return JSON.stringify(value)
}

function parseJsonText(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeColumnValue(value) {
  if (value === undefined || value === null) return null
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

function normalizeOriginalDataId(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function legacyNumericDataId(value) {
  const normalized = normalizeOriginalDataId(value)
  if (!normalized) return ''
  const number = Number(normalized)
  return Number.isInteger(number) && String(number) === normalized ? `${normalized}.0` : normalized
}

function boolToInt(value) {
  return value ? 1 : 0
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function normalizePublishTime(value) {
  const normalized = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/)
  return match ? `${match[1]} ${match[2]}` : ''
}

function addToPublishTime(value, { days = 0, minutes = 0 } = {}) {
  const normalized = normalizePublishTime(value)
  if (!normalized) return ''
  const date = normalized.length === 10
    ? new Date(`${normalized}T00:00:00.000Z`)
    : new Date(`${normalized.replace(' ', 'T')}:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  if (days) date.setUTCDate(date.getUTCDate() + days)
  if (minutes) date.setUTCMinutes(date.getUTCMinutes() + minutes)
  if (normalized.length === 10 && minutes === 0) {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
  }
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`
}

function exclusivePublishEnd(value) {
  const normalized = normalizePublishTime(value)
  if (!normalized) return ''
  if (normalized.length === 10) {
    return addToPublishTime(normalized, { days: 1 })
  }
  return addToPublishTime(normalized, { minutes: 1 })
}

function rowToData(row) {
  const raw = parseJsonText(row.raw_json, {})
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
}

function normalizePushFlagForView(pushFlag) {
  const normalized = String(pushFlag || '').trim()
  if (normalized === '推送' || normalized === '有推送' || normalized === '已推送') return '是'
  if (normalized === '重复' || normalized === '重复推送' || normalized === '重复报送') return '重复'
  if (normalized === '不推送' || normalized === '不报送' || normalized === '无需报送') return '否'
  return normalized || '否'
}

function buildPushViewRecord({ row, data, pushRequest }) {
  const requestRecord = pushRequest && typeof pushRequest === 'object' ? pushRequest.record : null
  const articleId = data?.id
  const record = {
    push_flag: normalizePushFlagForView(row.push_flag),
    full_label: row.full_label || '',
    news_digest: row.optimized_summary || data.news_digest || data.summary || data.manual_digest || '',
    complaint_no: row.complaint_no || '',
    ai_summary: row.ai_summary || '',
    ai_judgment: row.ai_judgment || '',
    article_id: articleId === null || articleId === undefined ? '' : String(articleId)
  }
  if (requestRecord && typeof requestRecord === 'object' && !Array.isArray(requestRecord)) {
    return {
      ...record,
      push_flag: requestRecord.push_flag ?? record.push_flag,
      full_label: requestRecord.full_label ?? record.full_label,
      news_digest: requestRecord.news_digest ?? record.news_digest,
      complaint_no: requestRecord.complaint_no ?? record.complaint_no,
      ai_summary: requestRecord.ai_summary ?? record.ai_summary,
      ai_judgment: requestRecord.ai_judgment ?? record.ai_judgment,
      article_id: requestRecord.article_id ?? record.article_id
    }
  }
  return record
}

function rowToAdminPush(row) {
  const isCompleted = (row.process_status || 'received') === 'completed'
  return {
    requestId: row.request_id,
    receivedAt: row.received_at,
    receivedCount: row.received_count || 0,
    storedFile: row.source_ref || dataReferenceForBatch(row.request_id),
    taskId: row.task_id || null,
    skillId: row.skill_id || null,
    status: row.process_status || 'received',
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    sessionId: row.session_id || null,
    outputDir: row.output_dir || null,
    resultFile: row.result_file || null,
    error: row.process_error || null,
    pushStatus: isCompleted ? (row.push_status || 'pending') : '',
    pushError: isCompleted ? (row.push_error || null) : null,
    pushRequest: parseJsonText(row.push_request_json, null),
    pushResponse: parseJsonText(row.push_response_json, null),
    pushedAt: row.pushed_at || null
  }
}

function rowToAdminItem(row) {
  const data = rowToData(row)
  const isCompleted = (row.process_status || 'received') === 'completed'
  const pushRequest = parseJsonText(row.push_request_json, null)
  return {
    itemId: row.item_id,
    requestId: row.request_id,
    itemIndex: row.item_index,
    receivedAt: row.received_at,
    storedFile: dataReferenceForItem(row.item_id),
    newsUuid: row.news_uuid || data.newsUuid || null,
    newsTitle: row.news_title || data.newsTitle || data.title || '',
    platformName: row.platform_name || data.platformName || '',
    pushTime: row.push_time || data.pushTime || null,
    newsPosttime: row.news_posttime || data.newsPosttime || null,
    newsEmotion: row.news_emotion || data.newsEmotion || data.emotion || '',
    article_id: data.id === null || data.id === undefined ? '' : String(data.id),
    articleId: data.id === null || data.id === undefined ? '' : String(data.id),
    data,
    taskId: row.task_id || null,
    taskRequestId: row.task_request_id || null,
    skillId: row.skill_id || null,
    status: row.process_status || 'received',
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    sessionId: row.session_id || null,
    outputDir: row.output_dir || null,
    resultFile: row.result_file || null,
    error: row.process_error || null,
    summary: row.optimized_summary || '',
    optimizedSummary: row.optimized_summary || '',
    complaintNo: row.complaint_no || '',
    aiSummary: row.ai_summary || '',
    aiJudgement: row.ai_judgment || '',
    aiJudgment: row.ai_judgment || '',
    pushFlag: row.push_flag || '',
    fullLabel: row.full_label || '',
    isProcessed: !!row.is_processed,
    pushStatus: isCompleted ? (row.push_status || 'pending') : '',
    pushError: isCompleted ? (row.push_error || null) : null,
    push: buildPushViewRecord({ row, data, pushRequest }),
    pushRequest,
    pushResponse: parseJsonText(row.push_response_json, null),
    pushedAt: row.pushed_at || null,
    pushAttempts: row.push_attempts || 0
  }
}

function rowToAdminListItem(row) {
  const isCompleted = (row.process_status || 'received') === 'completed'
  const data = rowToData(row)
  const pushRequest = parseJsonText(row.push_request_json, null)
  return {
    itemId: row.item_id,
    requestId: row.request_id,
    itemIndex: row.item_index,
    receivedAt: row.received_at,
    storedFile: dataReferenceForItem(row.item_id),
    newsUuid: row.news_uuid || null,
    newsTitle: row.news_title || '',
    platformName: row.platform_name || '',
    pushTime: row.push_time || null,
    newsPosttime: row.news_posttime || null,
    newsEmotion: row.news_emotion || '',
    article_id: data.id === null || data.id === undefined ? '' : String(data.id),
    articleId: data.id === null || data.id === undefined ? '' : String(data.id),
    taskId: row.task_id || null,
    taskRequestId: row.task_request_id || null,
    skillId: row.skill_id || null,
    status: row.process_status || 'received',
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    sessionId: row.session_id || null,
    outputDir: row.output_dir || null,
    resultFile: row.result_file || null,
    error: row.process_error || null,
    summary: row.optimized_summary || '',
    optimizedSummary: row.optimized_summary || '',
    complaintNo: row.complaint_no || '',
    aiSummary: row.ai_summary || '',
    aiJudgement: row.ai_judgment || '',
    aiJudgment: row.ai_judgment || '',
    pushFlag: row.push_flag || '',
    fullLabel: row.full_label || '',
    isProcessed: !!row.is_processed,
    pushStatus: isCompleted ? (row.push_status || 'pending') : '',
    pushError: isCompleted ? (row.push_error || null) : null,
    push: buildPushViewRecord({ row, data, pushRequest }),
    pushedAt: row.pushed_at || null,
    pushAttempts: row.push_attempts || 0
  }
}

class AipinDataStore {
  constructor({ userDataPath, dbPath = null, now = () => new Date().toISOString() }) {
    if (!userDataPath && !dbPath) throw new Error('userDataPath or dbPath is required')
    this.userDataPath = userDataPath || path.dirname(dbPath)
    this.dbPath = dbPath || path.join(userDataPath, AIPIN_DATA_DB_FILE)
    this.now = now
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 5000')
    this.ensureSchema()
  }

  close() {
    this.db.close()
  }

  ensureSchema() {
    const dataColumns = AIPIN_DATA_FIELDS.map(([name, type]) => `${quoteIdentifier(name)} ${type}`).join(',\n        ')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS aipin_data_batches (
        request_id TEXT PRIMARY KEY,
        received_at TEXT NOT NULL,
        received_count INTEGER NOT NULL DEFAULT 0,
        source_ref TEXT,
        task_id TEXT,
        skill_id TEXT,
        process_status TEXT NOT NULL DEFAULT 'received',
        process_error TEXT,
        started_at TEXT,
        finished_at TEXT,
        session_id TEXT,
        output_dir TEXT,
        result_file TEXT,
        push_status TEXT NOT NULL DEFAULT 'pending',
        push_error TEXT,
        pushed_at TEXT,
        push_request_json TEXT,
        push_response_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS aipin_data_items (
        item_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        item_index INTEGER NOT NULL,
        received_at TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        ${dataColumns},
        optimized_summary TEXT,
        push_flag TEXT,
        full_label TEXT,
        complaint_no TEXT,
        ai_summary TEXT,
        ai_judgment TEXT,
        is_processed INTEGER NOT NULL DEFAULT 0,
        process_status TEXT NOT NULL DEFAULT 'received',
        process_error TEXT,
        processed_at TEXT,
        task_id TEXT,
        task_request_id TEXT,
        skill_id TEXT,
        started_at TEXT,
        finished_at TEXT,
        session_id TEXT,
        output_dir TEXT,
        result_file TEXT,
        push_status TEXT NOT NULL DEFAULT 'pending',
        pushed_at TEXT,
        push_attempts INTEGER NOT NULL DEFAULT 0,
        push_request_json TEXT,
        push_response_json TEXT,
        push_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (request_id) REFERENCES aipin_data_batches(request_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_aipin_items_request_id ON aipin_data_items(request_id);
      CREATE INDEX IF NOT EXISTS idx_aipin_items_process_status ON aipin_data_items(process_status);
      CREATE INDEX IF NOT EXISTS idx_aipin_items_push_status ON aipin_data_items(push_status);
      CREATE INDEX IF NOT EXISTS idx_aipin_items_received_at ON aipin_data_items(received_at);
      CREATE INDEX IF NOT EXISTS idx_aipin_items_news_posttime ON aipin_data_items(news_posttime);
      CREATE INDEX IF NOT EXISTS idx_aipin_items_push_flag ON aipin_data_items(push_flag);
      CREATE INDEX IF NOT EXISTS idx_aipin_items_process_received ON aipin_data_items(process_status, received_at);
      CREATE INDEX IF NOT EXISTS idx_aipin_items_news_uuid ON aipin_data_items(news_uuid);
    `)
    this.ensureColumn('aipin_data_batches', 'push_request_json', 'TEXT')
    this.ensureColumn('aipin_data_items', 'push_request_json', 'TEXT')
    this.ensureColumn('aipin_data_items', 'full_label', 'TEXT')
  }

  ensureColumn(tableName, columnName, definition) {
    const exists = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
      .all()
      .some(column => column.name === columnName)
    if (!exists) {
      this.db.exec(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${definition}`)
    }
  }

  storePayload({ requestId, receivedAt, items }) {
    if (!requestId) throw new Error('requestId is required')
    if (!Array.isArray(items)) throw new Error('items must be an array')
    const now = this.now()
    const sourceRef = dataReferenceForBatch(requestId)
    const insertBatch = this.db.prepare(`
      INSERT INTO aipin_data_batches (
        request_id, received_at, received_count, source_ref,
        process_status, push_status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'received', 'pending', ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET
        received_at = excluded.received_at,
        received_count = excluded.received_count,
        source_ref = excluded.source_ref,
        updated_at = excluded.updated_at
    `)
    const itemColumns = [
      'item_id',
      'request_id',
      'item_index',
      'received_at',
      'raw_json',
      ...AIPIN_DATA_FIELD_NAMES,
      'process_status',
      'push_status',
      'created_at',
      'updated_at'
    ]
    const insertItem = this.db.prepare(`
      INSERT INTO aipin_data_items (${itemColumns.map(quoteIdentifier).join(', ')})
      VALUES (${itemColumns.map(() => '?').join(', ')})
      ON CONFLICT(item_id) DO UPDATE SET
        raw_json = excluded.raw_json,
        ${AIPIN_DATA_FIELD_NAMES.map(name => `${quoteIdentifier(name)} = excluded.${quoteIdentifier(name)}`).join(',\n        ')},
        updated_at = excluded.updated_at
    `)
    const findExistingItemByOriginalId = this.db.prepare(`
      SELECT item_id FROM aipin_data_items
      WHERE CAST("id" AS TEXT) = ?
         OR CAST("id" AS TEXT) = ?
      LIMIT 1
    `)
    let storedCount = 0
    let duplicateCount = 0

    this.db.transaction(() => {
      insertBatch.run(requestId, receivedAt, items.length, sourceRef, now, now)
      items.forEach((rawItem, itemIndex) => {
        const item = rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem) ? rawItem : {}
        const itemId = `${requestId}__item_${itemIndex}`
        const originalId = normalizeOriginalDataId(item.id)
        const existing = originalId ? findExistingItemByOriginalId.get(originalId, legacyNumericDataId(originalId)) : null
        if (existing && existing.item_id !== itemId) {
          duplicateCount += 1
          return
        }
        const values = [
          itemId,
          requestId,
          itemIndex,
          receivedAt,
          JSON.stringify(item),
          ...AIPIN_DATA_FIELD_NAMES.map(field => field === 'id' ? normalizeOriginalDataId(item[field]) || null : normalizeColumnValue(item[field])),
          'received',
          'pending',
          now,
          now
        ]
        insertItem.run(...values)
        storedCount += 1
      })
    })()

    return {
      requestId,
      receivedAt,
      receivedCount: items.length,
      storedCount,
      duplicateCount,
      storedFile: sourceRef
    }
  }

  listBatches() {
    return this.db.prepare(`
      SELECT * FROM aipin_data_batches
      ORDER BY received_at DESC, request_id DESC
    `).all().map(rowToAdminPush)
  }

  getBatch(requestId) {
    const row = this.db.prepare('SELECT * FROM aipin_data_batches WHERE request_id = ?').get(requestId)
    return row ? rowToAdminPush(row) : null
  }

  getBatchEnvelope(requestId) {
    const batch = this.getBatch(requestId)
    if (!batch) return null
    const items = this.db.prepare(`
      SELECT * FROM aipin_data_items
      WHERE request_id = ?
      ORDER BY item_index ASC
    `).all(requestId)
    return {
      requestId,
      receivedAt: batch.receivedAt,
      receivedCount: batch.receivedCount,
      data: items.map(rowToData)
    }
  }

  getItemEnvelope(itemId) {
    const row = this.db.prepare('SELECT * FROM aipin_data_items WHERE item_id = ?').get(itemId)
    if (!row) return null
    return {
      requestId: itemId,
      parentRequestId: row.request_id,
      receivedAt: row.received_at,
      receivedCount: 1,
      data: [rowToData(row)]
    }
  }

  listItems() {
    return this.db.prepare(`
      SELECT * FROM aipin_data_items
      ORDER BY received_at DESC, item_index ASC
    `).all().map(rowToAdminItem)
  }

  buildItemListWhere({ status = null, pushStatus = null, pushFlag = null, publishStart = null, publishEnd = null } = {}) {
    const clauses = []
    const params = {}
    const logicalPushStatus = `
      CASE
        WHEN process_status = 'completed' THEN COALESCE(NULLIF(push_status, ''), 'pending')
        ELSE ''
      END
    `

    if (status) {
      clauses.push('process_status = @status')
      params.status = status
    }
    if (pushStatus) {
      if (pushStatus === 'none') {
        clauses.push(`${logicalPushStatus} = ''`)
      } else {
        clauses.push(`${logicalPushStatus} = @pushStatus`)
        params.pushStatus = pushStatus
      }
    }
    if (pushFlag) {
      if (pushFlag === 'none') {
        clauses.push("COALESCE(NULLIF(push_flag, ''), '') = ''")
      } else {
        clauses.push('push_flag = @pushFlag')
        params.pushFlag = pushFlag
      }
    }
    const normalizedPublishStart = normalizePublishTime(publishStart)
    if (normalizedPublishStart) {
      clauses.push("COALESCE(news_posttime, '') >= @publishStart")
      params.publishStart = normalizedPublishStart
    }
    const publishEndExclusive = exclusivePublishEnd(publishEnd)
    if (publishEndExclusive) {
      clauses.push("COALESCE(news_posttime, '') < @publishEndExclusive")
      params.publishEndExclusive = publishEndExclusive
    }

    return {
      whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      params,
      logicalPushStatus
    }
  }

  listItemsPage({ status = null, pushStatus = null, pushFlag = null, publishStart = null, publishEnd = null, page = 1, pageSize = 20 } = {}) {
    const normalizedPage = normalizePositiveInteger(page, 1)
    const normalizedPageSize = Math.min(normalizePositiveInteger(pageSize, 20), 100)
    const { whereSql, params } = this.buildItemListWhere({ status, pushStatus, pushFlag, publishStart, publishEnd })
    const total = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM aipin_data_items
      ${whereSql}
    `).get(params)?.count || 0
    const rows = this.db.prepare(`
      SELECT
        item_id, request_id, item_index, received_at, raw_json,
        news_uuid, news_title, platform_name, push_time, news_posttime, news_emotion,
        task_id, task_request_id, skill_id, process_status, created_at, started_at,
        finished_at, session_id, output_dir, result_file, process_error,
        optimized_summary, complaint_no, ai_summary, ai_judgment, push_flag, full_label,
        is_processed, push_status, push_error, pushed_at, push_attempts, push_request_json
      FROM aipin_data_items
      ${whereSql}
      ORDER BY received_at DESC, item_index ASC
      LIMIT @limit OFFSET @offset
    `).all({
      ...params,
      limit: normalizedPageSize,
      offset: (normalizedPage - 1) * normalizedPageSize
    }).map(rowToAdminListItem)

    return {
      items: rows,
      total,
      summary: this.summarizeItems({ status, pushStatus, pushFlag, publishStart, publishEnd }),
      page: normalizedPage,
      pageSize: normalizedPageSize
    }
  }

  summarizeItems({ status = null, pushStatus = null, pushFlag = null, publishStart = null, publishEnd = null } = {}) {
    const { whereSql, params, logicalPushStatus } = this.buildItemListWhere({ status, pushStatus, pushFlag, publishStart, publishEnd })
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN process_status IN ('received', 'pending') THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN process_status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
        COALESCE(SUM(CASE WHEN ${logicalPushStatus} = 'success' THEN 1 ELSE 0 END), 0) AS pushed,
        COALESCE(SUM(CASE WHEN process_status = 'failed' THEN 1 ELSE 0 END), 0) AS processFailed,
        COALESCE(SUM(CASE WHEN ${logicalPushStatus} = 'failed' THEN 1 ELSE 0 END), 0) AS pushFailed,
        COALESCE(SUM(CASE WHEN TRIM(COALESCE(push_flag, '')) = '推送' THEN 1 ELSE 0 END), 0) AS pushFlagPush,
        COALESCE(SUM(CASE WHEN TRIM(COALESCE(news_emotion, '')) = '正面' OR LOWER(TRIM(COALESCE(news_emotion, ''))) = 'positive' THEN 1 ELSE 0 END), 0) AS emotionPositive,
        COALESCE(SUM(CASE WHEN TRIM(COALESCE(news_emotion, '')) = '负面' OR LOWER(TRIM(COALESCE(news_emotion, ''))) = 'negative' THEN 1 ELSE 0 END), 0) AS emotionNegative
      FROM aipin_data_items
      ${whereSql}
    `).get(params) || {}

    return {
      total: row.total || 0,
      pending: row.pending || 0,
      processing: row.processing || 0,
      pushed: row.pushed || 0,
      processFailed: row.processFailed || 0,
      pushFailed: row.pushFailed || 0,
      pushFlagPush: row.pushFlagPush || 0,
      emotionPositive: row.emotionPositive || 0,
      emotionNegative: row.emotionNegative || 0
    }
  }

  getItem(itemId) {
    const row = this.db.prepare('SELECT * FROM aipin_data_items WHERE item_id = ?').get(itemId)
    return row ? rowToAdminItem(row) : null
  }

  getItemsForRequest(requestId) {
    return this.db.prepare(`
      SELECT * FROM aipin_data_items
      WHERE request_id = ?
      ORDER BY item_index ASC
    `).all(requestId).map(rowToAdminItem)
  }

  listUnlinkedReceivedBatches({ limit = 100 } = {}) {
    const normalizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000)
    return this.db.prepare(`
      SELECT request_id, source_ref, received_count, process_status, received_at
      FROM aipin_data_batches
      WHERE COALESCE(NULLIF(task_id, ''), '') = ''
        AND process_status IN ('received', 'pending')
      ORDER BY received_at ASC
      LIMIT ?
    `).all(normalizedLimit)
  }

  markTaskLinked({ requestId, task }) {
    if (!task?.taskId || !requestId) return
    const now = this.now()
    if (parseAipinDataReference(requestId)?.type === 'batch') {
      requestId = parseAipinDataReference(requestId).id
    }
    if (String(requestId).includes('__item_')) {
      this.db.prepare(`
        UPDATE aipin_data_items
        SET task_id = ?, task_request_id = ?, skill_id = ?, process_status = ?, process_error = NULL, updated_at = ?
        WHERE item_id = ?
      `).run(task.taskId, task.requestId || requestId, task.skillId || null, task.status || 'pending', now, requestId)
      return
    }

    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE aipin_data_batches
        SET task_id = ?, skill_id = ?, process_status = ?, process_error = NULL, updated_at = ?
        WHERE request_id = ?
      `).run(task.taskId, task.skillId || null, task.status || 'pending', now, requestId)
      this.db.prepare(`
        UPDATE aipin_data_items
        SET task_id = ?, task_request_id = ?, skill_id = ?, process_status = ?, process_error = NULL, updated_at = ?
        WHERE request_id = ?
      `).run(task.taskId, task.requestId || requestId, task.skillId || null, task.status || 'pending', now, requestId)
    })()
  }

  markTaskStatus({ requestId, task, status, error = null }) {
    if (!requestId) return
    const now = this.now()
    const startedAt = task?.startedAt || null
    const finishedAt = task?.finishedAt || null
    const patchArgs = [
      status,
      error,
      startedAt,
      finishedAt,
      task?.sessionId || null,
      task?.outputDir || null,
      task?.resultFile || null,
      now
    ]
    if (String(requestId).includes('__item_')) {
      this.db.prepare(`
        UPDATE aipin_data_items
        SET process_status = ?, process_error = ?, started_at = ?, finished_at = ?,
            session_id = ?, output_dir = ?, result_file = ?, updated_at = ?
        WHERE item_id = ?
      `).run(...patchArgs, requestId)
      return
    }

    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE aipin_data_batches
        SET process_status = ?, process_error = ?, started_at = ?, finished_at = ?,
            session_id = ?, output_dir = ?, result_file = ?, updated_at = ?
        WHERE request_id = ?
      `).run(...patchArgs, requestId)
      this.db.prepare(`
        UPDATE aipin_data_items
        SET process_status = ?, process_error = ?, started_at = ?, finished_at = ?,
            session_id = ?, output_dir = ?, result_file = ?, updated_at = ?
        WHERE request_id = ?
      `).run(...patchArgs, requestId)
    })()
  }

  updateProcessedFields({ itemId, fields = {}, task = null, status = 'completed' }) {
    if (!itemId) return
    const now = this.now()
    this.db.prepare(`
      UPDATE aipin_data_items
      SET optimized_summary = COALESCE(NULLIF(?, ''), optimized_summary),
          complaint_no = COALESCE(NULLIF(?, ''), complaint_no),
          ai_summary = COALESCE(NULLIF(?, ''), ai_summary),
          ai_judgment = COALESCE(NULLIF(?, ''), ai_judgment),
          push_flag = COALESCE(NULLIF(?, ''), push_flag),
          full_label = COALESCE(NULLIF(?, ''), full_label),
          is_processed = ?,
          process_status = ?,
          process_error = NULL,
          processed_at = ?,
          push_status = CASE
            WHEN ? = 'completed' THEN 'pending'
            ELSE push_status
          END,
          session_id = COALESCE(?, session_id),
          output_dir = COALESCE(?, output_dir),
          result_file = COALESCE(?, result_file),
          finished_at = COALESCE(?, finished_at),
          updated_at = ?
      WHERE item_id = ?
    `).run(
      fields.summary || fields.optimizedSummary || '',
      fields.complaintNo || fields.complaint_no || '',
      fields.aiSummary || fields.ai_summary || '',
      fields.aiJudgement || fields.aiJudgment || fields.ai_judgment || '',
      fields.pushFlag || fields.push_flag || '',
      fields.fullLabel || fields.full_label || fields.completeLabel || fields.complete_label || '',
      boolToInt(status === 'completed'),
      status,
      status === 'completed' ? now : null,
      status,
      task?.sessionId || null,
      task?.outputDir || null,
      task?.resultFile || null,
      task?.finishedAt || null,
      now,
      itemId
    )
  }

  updateProcessedFieldValues({ itemId, fields = {} }) {
    if (!itemId) return
    const now = this.now()
    this.db.prepare(`
      UPDATE aipin_data_items
      SET optimized_summary = COALESCE(NULLIF(?, ''), optimized_summary),
          complaint_no = COALESCE(NULLIF(?, ''), complaint_no),
          ai_summary = COALESCE(NULLIF(?, ''), ai_summary),
          ai_judgment = COALESCE(NULLIF(?, ''), ai_judgment),
          push_flag = COALESCE(NULLIF(?, ''), push_flag),
          full_label = COALESCE(NULLIF(?, ''), full_label),
          is_processed = CASE
            WHEN COALESCE(NULLIF(?, ''), optimized_summary) <> ''
              OR COALESCE(NULLIF(?, ''), complaint_no) <> ''
              OR COALESCE(NULLIF(?, ''), ai_summary) <> ''
              OR COALESCE(NULLIF(?, ''), ai_judgment) <> ''
              OR COALESCE(NULLIF(?, ''), push_flag) <> ''
              OR COALESCE(NULLIF(?, ''), full_label) <> ''
            THEN 1
            ELSE is_processed
          END,
          updated_at = ?
      WHERE item_id = ?
    `).run(
      fields.summary || fields.optimizedSummary || '',
      fields.complaintNo || fields.complaint_no || '',
      fields.aiSummary || fields.ai_summary || '',
      fields.aiJudgement || fields.aiJudgment || fields.ai_judgment || '',
      fields.pushFlag || fields.push_flag || '',
      fields.fullLabel || fields.full_label || fields.completeLabel || fields.complete_label || '',
      fields.summary || fields.optimizedSummary || '',
      fields.complaintNo || fields.complaint_no || '',
      fields.aiSummary || fields.ai_summary || '',
      fields.aiJudgement || fields.aiJudgment || fields.ai_judgment || '',
      fields.pushFlag || fields.push_flag || '',
      fields.fullLabel || fields.full_label || fields.completeLabel || fields.complete_label || '',
      now,
      itemId
    )
  }

  getPushableItems({ requestId = null, limit = 100 } = {}) {
    const whereRequest = requestId && !String(requestId).includes('__item_')
      ? 'AND request_id = @requestId'
      : requestId
        ? 'AND item_id = @requestId'
        : ''
    return this.db.prepare(`
      SELECT * FROM aipin_data_items
      WHERE process_status = 'completed'
        AND COALESCE(NULLIF(push_status, ''), 'pending') <> 'success'
        AND COALESCE(id, '') <> ''
        ${whereRequest}
      ORDER BY received_at ASC, item_index ASC
      LIMIT @limit
    `).all({ requestId, limit }).map(rowToAdminItem)
  }

  recoverInterruptedWork() {
    const now = this.now()
    return this.db.transaction(() => {
      const batchProcessing = this.db.prepare(`
        UPDATE aipin_data_batches
        SET process_status = 'pending',
            process_error = NULL,
            started_at = NULL,
            finished_at = NULL,
            session_id = NULL,
            output_dir = NULL,
            result_file = NULL,
            updated_at = ?
        WHERE process_status = 'processing'
      `).run(now)

      const itemProcessing = this.db.prepare(`
        UPDATE aipin_data_items
        SET process_status = 'pending',
            process_error = NULL,
            started_at = NULL,
            finished_at = NULL,
            session_id = NULL,
            output_dir = NULL,
            result_file = NULL,
            updated_at = ?
        WHERE process_status = 'processing'
      `).run(now)

      const batchPushing = this.db.prepare(`
        UPDATE aipin_data_batches
        SET push_status = 'pending',
            push_error = NULL,
            updated_at = ?
        WHERE push_status = 'pushing'
      `).run(now)

      const itemPushing = this.db.prepare(`
        UPDATE aipin_data_items
        SET push_status = 'pending',
            push_error = NULL,
            updated_at = ?
        WHERE push_status = 'pushing'
      `).run(now)

      return {
        processingBatches: batchProcessing.changes || 0,
        processingItems: itemProcessing.changes || 0,
        pushingBatches: batchPushing.changes || 0,
        pushingItems: itemPushing.changes || 0
      }
    })()
  }

  markPushStarted({ itemId, request = null }) {
    if (!itemId) return false
    const now = this.now()
    const result = this.db.prepare(`
      UPDATE aipin_data_items
      SET push_status = 'pushing',
          push_error = NULL,
          push_request_json = COALESCE(?, push_request_json),
          updated_at = ?
      WHERE item_id = ?
        AND COALESCE(NULLIF(push_status, ''), 'pending') <> 'success'
    `).run(toJsonText(request), now, itemId)
    return result.changes > 0
  }

  markPushResult({ itemId, status, request = null, response = null, error = null }) {
    if (!itemId) return
    const now = this.now()
    this.db.prepare(`
      UPDATE aipin_data_items
      SET push_status = ?,
          pushed_at = CASE WHEN ? = 'success' THEN ? ELSE pushed_at END,
          push_attempts = push_attempts + 1,
          push_request_json = COALESCE(?, push_request_json),
          push_response_json = ?,
          push_error = ?,
          updated_at = ?
      WHERE item_id = ?
    `).run(status, status, now, toJsonText(request), toJsonText(response), error || null, now, itemId)
  }
}

module.exports = {
  AipinDataStore,
  AIPIN_DATA_DB_FILE,
  AIPIN_DATA_FIELDS,
  AIPIN_DATA_FIELD_NAMES,
  dataReferenceForBatch,
  dataReferenceForItem,
  isAipinDataReference,
  parseAipinDataReference
}
