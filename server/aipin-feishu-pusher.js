const crypto = require('crypto')

function encodePart(value) {
  return encodeURIComponent(String(value))
}

function signMideaFeishuPayload({ appId, timestamp, appSecret, signKeyStyle = 'appId' }) {
  if (!appId) throw new Error('Midea Feishu appId is required')
  if (!timestamp) throw new Error('Midea Feishu timestamp is required')
  if (!appSecret) throw new Error('Midea Feishu appSecret is required')
  const appKey = signKeyStyle === 'app_id' ? 'app_id' : 'appId'
  const params = {
    [appKey]: appId,
    timestamp
  }
  const query = Object.keys(params)
    .sort()
    .map(key => `${encodePart(key)}=${encodePart(params[key])}`)
    .join('&')
  return crypto
    .createHash('md5')
    .update(`${query}&app_secret=${appSecret}`)
    .digest('hex')
    .toLowerCase()
}

function normalizePushFlagForFeishu(pushFlag) {
  const normalized = String(pushFlag || '').trim()
  if (normalized === '推送') return '是'
  if (normalized === '重复') return '重复'
  if (normalized === '不推送') return '否'
  return normalized || '否'
}

function buildFeishuRecord(item) {
  const data = item?.data || {}
  const articleId = data.id
  return {
    push_flag: normalizePushFlagForFeishu(item?.pushFlag),
    full_label: item?.fullLabel || data.fullLabel || data.full_label || data.completeLabel || data.complete_label || data['完整标签'] || '',
    news_digest: item?.optimizedSummary || item?.summary || data.news_digest || data.summary || data['摘要'] || data.manual_digest || '',
    complaint_no: item?.complaintNo || data.complaintNo || data.complaint_no || data['投诉编号'] || '',
    ai_summary: item?.aiSummary || data.aiSummary || data.ai_summary || data['AI总结'] || '',
    ai_judgment: item?.aiJudgment || item?.aiJudgement || data.aiJudgment || data.aiJudgement || data.ai_judgment || data.ai_judgement || data['AI研判'] || '',
    article_id: articleId === null || articleId === undefined ? '' : String(articleId)
  }
}

function buildFeishuPayload({ appId, appSecret, timestamp, records, signKeyStyle }) {
  return {
    app_id: appId,
    timestamp,
    sign: signMideaFeishuPayload({ appId, timestamp, appSecret, signKeyStyle }),
    records
  }
}

function isSuccessCode(body) {
  return Number(body?.code) === 10000 || body?.code === '10000'
}

function buildPushRequestLog({ endpoint, payload, record, item, requestedAt }) {
  return {
    endpoint,
    requested_at: requestedAt,
    item_id: item?.itemId || '',
    article_id: record?.article_id || '',
    payload,
    record
  }
}

class AipinFeishuPusher {
  constructor({
    dataStore,
    endpoint = process.env.MIDEA_FEISHU_PUSH_ENDPOINT || 'https://aipincustom.gsdata.cn/customapi/aipinData/meidi-push/receive',
    appId = process.env.MIDEA_FEISHU_APP_ID || 'SP202606080001',
    appSecret = process.env.MIDEA_FEISHU_APP_SECRET || 'ea5mgAg1v5M9!EI1v6F4Q',
    signKeyStyle = process.env.MIDEA_FEISHU_SIGN_KEY_STYLE || 'appId',
    fetchImpl = globalThis.fetch,
    now = () => new Date()
  } = {}) {
    if (!dataStore) throw new Error('dataStore is required')
    this.dataStore = dataStore
    this.endpoint = endpoint
    this.appId = appId
    this.appSecret = appSecret
    this.signKeyStyle = signKeyStyle
    this.fetchImpl = fetchImpl
    this.now = now
  }

  isConfigured() {
    return !!(this.endpoint && this.appId && this.appSecret && this.fetchImpl)
  }

  async pushPending({ requestId = null, limit = 100 } = {}) {
    if (!this.isConfigured()) {
      return { success: false, skipped: true, reason: 'Midea Feishu push is not configured' }
    }

    const items = this.dataStore.getPushableItems({ requestId, limit })
    if (!items.length) {
      return { success: true, total: 0, pushed: 0 }
    }

    const records = items.map(buildFeishuRecord)
    const missingArticle = records.findIndex(record => !record.article_id)
    if (missingArticle >= 0) {
      const item = items[missingArticle]
      this.dataStore.markPushResult({
        itemId: item.itemId,
        status: 'failed',
        error: 'article_id is required for Midea Feishu push'
      })
      return this.pushPending({ requestId, limit })
    }

    const timestamp = String(Math.floor(this.now().getTime() / 1000))
    const payload = buildFeishuPayload({
      appId: this.appId,
      appSecret: this.appSecret,
      timestamp,
      records,
      signKeyStyle: this.signKeyStyle
    })
    const requestedAt = this.now().toISOString()
    const requestLogs = items.map((item, index) => buildPushRequestLog({
      endpoint: this.endpoint,
      payload,
      record: records[index],
      item,
      requestedAt
    }))
    items.forEach((item, index) => {
      if (typeof this.dataStore.markPushStarted === 'function') {
        this.dataStore.markPushStarted({
          itemId: item.itemId,
          request: requestLogs[index]
        })
      }
    })
    console.info('[AipinData] Midea Feishu push request', {
      endpoint: this.endpoint,
      total: items.length,
      articleIds: records.map(record => record.article_id)
    })

    let body
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      body = await response.json().catch(() => ({}))
      if (!response.ok || !isSuccessCode(body)) {
        const error = body?.msg || `HTTP ${response.status}`
        items.forEach((item, index) => this.dataStore.markPushResult({
          itemId: item.itemId,
          status: 'failed',
          request: requestLogs[index],
          response: body,
          error
        }))
        return { success: false, total: items.length, pushed: 0, error, response: body }
      }
    } catch (err) {
      items.forEach((item, index) => this.dataStore.markPushResult({
        itemId: item.itemId,
        status: 'failed',
        request: requestLogs[index],
        error: err?.message || String(err)
      }))
      return { success: false, total: items.length, pushed: 0, error: err?.message || String(err) }
    }

    const details = Array.isArray(body?.data?.details) ? body.data.details : []
    const detailByArticleId = new Map(details.map(detail => [String(detail.article_id || ''), detail]))
    items.forEach((item, index) => {
      const record = records[index]
      const detail = detailByArticleId.get(record.article_id)
      this.dataStore.markPushResult({
        itemId: item.itemId,
        status: 'success',
        request: requestLogs[index],
        response: detail || body,
        error: ''
      })
    })

    return { success: true, total: items.length, pushed: items.length, response: body }
  }
}

module.exports = {
  AipinFeishuPusher,
  buildFeishuPayload,
  buildFeishuRecord,
  normalizePushFlagForFeishu,
  signMideaFeishuPayload
}
