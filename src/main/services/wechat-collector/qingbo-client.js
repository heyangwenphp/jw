const crypto = require('crypto')

function compact(value) {
  return String(value == null ? '' : value).trim()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function buildAccessToken(appKey, appSecret, router, params) {
  const sortedParams = Object.keys(params)
    .sort()
    .filter(key => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map(key => `${key}${params[key]}`)
    .join('')
  const sign = crypto
    .createHash('md5')
    .update(`${appSecret}_${sortedParams}_${appSecret}`, 'utf8')
    .digest('hex')
  return Buffer.from(`${appKey}:${sign}:${router}`, 'utf8').toString('base64')
}

class QingboClient {
  constructor(options) {
    this.baseUrl = compact(options.baseUrl)
    this.appKey = compact(options.appKey)
    this.appSecret = compact(options.appSecret)
    this.timeoutMs = Number(options.timeoutMs || 30000)
    this.delayMs = Number(options.delayMs ?? 200)
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    if (!this.fetchImpl) throw new Error('No fetch implementation available')
    if (!this.baseUrl || !this.appKey || !this.appSecret) {
      throw new Error('QingboClient requires baseUrl, appKey, and appSecret')
    }
  }

  async get(router, params) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
    }
    const url = `${this.baseUrl}?${query.toString()}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          'access-token': buildAccessToken(this.appKey, this.appSecret, router, params)
        },
        signal: controller.signal
      })
      const body = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`)
      return JSON.parse(body)
    } finally {
      clearTimeout(timer)
      if (this.delayMs > 0) await sleep(this.delayMs)
    }
  }

  async searchArticles(options) {
    const router = '/weixin/article/search1'
    const pageSize = Number(options.pageSize || 50)
    const maxPages = Number(options.maxPages || 20)
    const articles = []
    let numFound = 0

    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await this.get(router, {
        wx_name: options.wxName,
        posttime_start: options.startAt,
        posttime_end: options.endAt,
        order: 'desc',
        sort: 'posttime',
        page,
        limit: pageSize
      })
      if (payload.success !== true) {
        throw new Error(payload.message || payload.msg || 'Qingbo article search failed')
      }
      const newsList = payload.data?.newsList || []
      numFound = Number(payload.data?.numFound || newsList.length || numFound)
      articles.push(...newsList)
      if (articles.length >= numFound || newsList.length < pageSize) break
    }

    return {
      articles,
      numFound,
      truncated: Boolean(numFound && articles.length < numFound)
    }
  }

  async fetchArticleContent(newsLocalUrl) {
    const localUrl = compact(newsLocalUrl)
    if (!localUrl) return ''
    const payload = await this.get('/weixin/article/content', { news_local_url: localUrl })
    if (payload.success !== true) return ''
    return compact(payload.data?.news_content)
  }
}

module.exports = {
  buildAccessToken,
  QingboClient
}
