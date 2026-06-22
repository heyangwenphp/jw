const crypto = require('crypto')
const { extractWechatArticleFields } = require('./field-extractor')

function compact(value) {
  return String(value == null ? '' : value).trim()
}

function parseUrlParam(url, key) {
  try {
    const parsed = new URL(url)
    return compact(parsed.searchParams.get(key))
  } catch {
    return ''
  }
}

function stableHash(parts) {
  return crypto
    .createHash('md5')
    .update(parts.map(compact).join('|'), 'utf8')
    .digest('hex')
}

function extractArticleId(article) {
  const sn = parseUrlParam(article.news_url || article.url, 'sn')
  if (sn) return sn
  const uuid = compact(article.news_uuid)
  if (uuid) return uuid
  return stableHash([
    article.accountBiz,
    article.accountId,
    article.news_title || article.title,
    article.news_posttime || article.published_at,
    article.news_url || article.url
  ])
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
    .replace(/\s+/g, ' ')
    .trim()
}

function countWords(value) {
  const text = compact(value)
  if (!text) return 0
  const english = text.match(/[A-Za-z0-9_]+/g) || []
  const chinese = text.match(/[\u4e00-\u9fff]/g) || []
  return english.length + chinese.length
}

function normalizeQingboArticle(input) {
  const account = input.account || {}
  const article = input.article || {}
  const url = compact(article.news_url)
  const accountBiz = compact(account.fakeid) || parseUrlParam(url, '__biz')
  const accountId = compact(account.wechatId) || compact(article.wx_name) || compact(input.candidate?.value)
  const contentText = compact(input.contentText)
  const id = extractArticleId({
    ...article,
    accountBiz,
    accountId
  })
  const contentStatus = contentText ? 'success' : 'missing'
  const wordCount = contentText ? countWords(contentText) : null
  const publishedAt = compact(article.news_posttime)
  const collectedAt = compact(input.collectedAt)

  const record = {
    id,
    source: 'wechat',
    sourceProvider: 'qingbo',
    accountId,
    account: compact(account.name) || compact(article.wx_nickname),
    accountBiz,
    title: compact(article.news_title),
    url,
    author: compact(article.news_author) || compact(article.author_name),
    digest: compact(article.news_digest),
    publishedAt,
    collectedAt,
    runId: compact(input.runId),
    contentStatus,
    contentText,
    wordCount,
    qingbo: {
      newsUuid: compact(article.news_uuid),
      newsLocalUrl: compact(article.news_local_url),
      wxName: compact(article.wx_name)
    }
  }

  const extractedFields = extractWechatArticleFields({
    title: record.title,
    digest: record.digest,
    contentText
  })

  return {
    id,
    article_source: 'qingbo_wechat',
    account_id: accountId,
    account_name: record.account,
    account_biz: accountBiz,
    account_verify_name: compact(account.raw?.['核验结论']),
    account_tier: compact(account.tier),
    title: record.title,
    url,
    author: record.author,
    digest: record.digest,
    published_at: publishedAt,
    collected_at: collectedAt,
    content_status: contentStatus,
    content_text: contentText,
    word_count: wordCount,
    subject: extractedFields.subject,
    topic: compact(account.type) || null,
    level: null,
    summary: record.digest || contentText.slice(0, 200) || null,
    keywords: compact(account.raw?.['主要命中关键词']) || null,
    team_name: extractedFields.team_name,
    sector: extractedFields.sector,
    project: extractedFields.project,
    technology: null,
    product: null,
    research_direction: extractedFields.research_direction,
    core_members: extractedFields.core_members,
    owner: extractedFields.owner,
    advisor_or_mentor: extractedFields.advisor_or_mentor,
    llm_extraction_json: null,
    article_record_json: JSON.stringify(record)
  }
}

module.exports = {
  compact,
  parseUrlParam,
  extractArticleId,
  stripHtml,
  countWords,
  normalizeQingboArticle
}
