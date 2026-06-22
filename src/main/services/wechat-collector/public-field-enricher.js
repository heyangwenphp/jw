const { FIELD_NAMES, compact, extractWechatArticleFields } = require('./field-extractor')
const { LLM_FIELD_NAMES, LLM_JSON_ARRAY_FIELD_NAMES } = require('./llm-field-extractor')

const FIELD_LABELS = {
  subject: '\u4e3b\u4f53',
  team_name: '\u56e2\u961f\u540d\u79f0',
  sector: '\u8d5b\u9053',
  project: '\u9879\u76ee',
  research_direction: '\u7814\u7a76\u65b9\u5411',
  core_members: '\u6838\u5fc3\u6210\u5458',
  owner: '\u8d1f\u8d23\u4eba',
  advisor_or_mentor: '\u5bfc\u5e08 \u987e\u95ee',
  technology: '\u6280\u672f',
  product: '\u4ea7\u54c1'
}

const SEARCH_FIELD_NAMES = Array.from(new Set([...FIELD_NAMES, ...LLM_FIELD_NAMES]))

function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

function stripHtml(value) {
  return compact(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function decodeDuckDuckGoUrl(url) {
  try {
    const parsed = new URL(url, 'https://duckduckgo.com')
    const uddg = parsed.searchParams.get('uddg')
    return uddg ? decodeURIComponent(uddg) : parsed.href
  } catch {
    return url
  }
}

class DuckDuckGoPublicSearcher {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    this.timeoutMs = Number(options.timeoutMs || 15000)
    this.maxResults = Number(options.maxResults || 5)
  }

  async search(query) {
    if (!this.fetchImpl) throw new Error('No fetch implementation available for public search')
    try {
      return await this.searchBing(query)
    } catch {
      return this.searchDuckDuckGo(query)
    }
  }

  async searchDuckDuckGo(query) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
      const response = await this.fetchImpl(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 Jedi WeChat Collector'
        },
        signal: controller.signal
      })
      const html = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${html.slice(0, 200)}`)
      return this.parseResults(html)
    } finally {
      clearTimeout(timer)
    }
  }

  async searchBing(query) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`
      const response = await this.fetchImpl(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 Jedi WeChat Collector'
        },
        signal: controller.signal
      })
      const html = await response.text()
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${html.slice(0, 200)}`)
      return this.parseBingResults(html)
    } finally {
      clearTimeout(timer)
    }
  }

  parseResults(html) {
    const results = []
    const blockPattern = /<div[^>]+class="[^"]*result[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|$)/gi
    const blocks = html.match(blockPattern) || []
    for (const block of blocks) {
      const titleMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      if (!titleMatch) continue
      const snippetMatch = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[\s\S]*?>([\s\S]*?)<\/a>/i)
        || block.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[\s\S]*?>([\s\S]*?)<\/div>/i)
      results.push({
        title: stripHtml(titleMatch[2]),
        url: decodeDuckDuckGoUrl(titleMatch[1]),
        snippet: stripHtml(snippetMatch?.[1] || '')
      })
      if (results.length >= this.maxResults) break
    }
    return results
  }

  parseBingResults(html) {
    const results = []
    const blockPattern = /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<\/li>/gi
    const blocks = html.match(blockPattern) || []
    for (const block of blocks) {
      const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i)
      if (!titleMatch) continue
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      results.push({
        title: stripHtml(titleMatch[2]),
        url: titleMatch[1],
        snippet: stripHtml(snippetMatch?.[1] || '')
      })
      if (results.length >= this.maxResults) break
    }
    return results
  }
}

class PublicFieldEnricher {
  constructor(options = {}) {
    this.searcher = options.searcher || new DuckDuckGoPublicSearcher(options)
    this.maxResultsPerField = Number(options.maxResultsPerField || 3)
    this.llmFieldExtractor = options.llmFieldExtractor || null
  }

  buildQuery(article, fields, field) {
    return [
      compact(fields.team_name || fields.subject || fields.project),
      compact(article.title),
      compact(article.account_name || article.account),
      FIELD_LABELS[field] || field
    ].filter(Boolean).join(' ')
  }

  async enrich({ article = {}, fields = {}, missingFields = SEARCH_FIELD_NAMES, overwrite = false }) {
    const nextFields = { ...fields }
    const sources = []
    for (const field of missingFields) {
      if (!SEARCH_FIELD_NAMES.includes(field)) continue
      if (!overwrite && !isEmpty(nextFields[field])) continue
      const query = this.buildQuery(article, nextFields, field)
      if (!query) continue
      const results = (await this.searcher.search(query)).slice(0, this.maxResultsPerField)
      for (const result of results) {
        const extracted = this.llmFieldExtractor
          ? await this.llmFieldExtractor.extract({
            article: { ...article, title: result.title, digest: result.snippet },
            contentText: result.snippet
          })
          : { fields: extractWechatArticleFields({
            title: result.title,
            digest: result.snippet,
            contentText: result.snippet
          }) }
        const value = this.llmFieldExtractor
          ? serializeSearchLlmField(field, extracted.fields?.[field])
          : extracted.fields?.[field]
        if (!isEmpty(value)) {
          nextFields[field] = value
          sources.push({
            field,
            source_type: this.llmFieldExtractor ? 'public_search_llm' : 'public_search',
            query,
            title: result.title,
            url: result.url,
            snippet: result.snippet
          })
          break
        }
      }
    }
    return { fields: nextFields, sources }
  }
}

function serializeSearchLlmField(field, value) {
  if (!Array.isArray(value) || !value.length) return null
  if (LLM_JSON_ARRAY_FIELD_NAMES.includes(field)) return JSON.stringify(value)
  return value.join('\u3001')
}

module.exports = {
  FIELD_LABELS,
  SEARCH_FIELD_NAMES,
  DuckDuckGoPublicSearcher,
  PublicFieldEnricher
}
