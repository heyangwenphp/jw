const Database = require('better-sqlite3')

const TABLE = 'wechat_articles'
const REQUIRED_COLLECTION_COLUMNS = {
  content_text: 'TEXT',
  subject: 'TEXT',
  team_name: 'TEXT',
  sector: 'TEXT',
  project: 'TEXT',
  technology: 'TEXT',
  product: 'TEXT',
  research_direction: 'TEXT',
  core_members: 'TEXT',
  owner: 'TEXT',
  advisor_or_mentor: 'TEXT',
  llm_extraction_json: 'TEXT',
  field_enrichment_json: 'TEXT'
}
const PRESERVED_ANALYSIS_COLUMNS = new Set([
  'confidence',
  'favorite',
  'verification',
  'analysis_source',
  'analysis_model',
  'analysis_provider',
  'technical_agent',
  'technical_template',
  'analysis_reason',
  'ai_result_json',
  'ai_error',
  'technical_result_json',
  'technical_error',
  'matched_keywords',
  'matched_keyword_count',
  'matched_evidence_json',
  'keyword_tendencies_json',
  'analysis_json',
  'signal_record_json'
])

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

function isEmpty(value) {
  return value === null || value === undefined || value === ''
}

function mergeArticleRecordJson(existingValue, nextValue) {
  if (isEmpty(existingValue)) return nextValue
  if (isEmpty(nextValue)) return existingValue

  try {
    const existing = JSON.parse(existingValue)
    const next = JSON.parse(nextValue)
    if (isEmpty(existing.contentText) && !isEmpty(next.contentText)) {
      return JSON.stringify({ ...existing, ...next })
    }
    return existingValue
  } catch {
    return existingValue
  }
}

function shouldFillContentStatus(existingValue, nextValue) {
  return ['missing', 'error'].includes(String(existingValue || '').trim()) && String(nextValue || '').trim() === 'success'
}

class WechatArticleStore {
  constructor(dbPath) {
    this.db = new Database(dbPath)
    this.columns = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(TABLE)})`).all().map(row => row.name)
    if (!this.columns.includes('id')) throw new Error('wechat_articles table must include id column')
    this.ensureCollectionColumns()
  }

  ensureCollectionColumns() {
    const existing = new Set(this.columns)
    for (const [column, type] of Object.entries(REQUIRED_COLLECTION_COLUMNS)) {
      if (existing.has(column)) continue
      this.db.exec(`ALTER TABLE ${quoteIdentifier(TABLE)} ADD COLUMN ${quoteIdentifier(column)} ${type}`)
      this.columns.push(column)
      existing.add(column)
    }
  }

  close() {
    this.db.close()
  }

  getArticle(id) {
    return this.db.prepare(`SELECT * FROM ${quoteIdentifier(TABLE)} WHERE id = ?`).get(id)
  }

  insertArticle(article) {
    const columns = this.columns.filter(column => Object.prototype.hasOwnProperty.call(article, column))
    const sql = `
      INSERT INTO ${quoteIdentifier(TABLE)} (${columns.map(quoteIdentifier).join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
    `
    this.db.prepare(sql).run(...columns.map(column => article[column]))
  }

  buildFillPatch(existing, article) {
    const patch = {}
    for (const column of this.columns) {
      if (column === 'id') continue
      if (PRESERVED_ANALYSIS_COLUMNS.has(column)) continue
      if (!Object.prototype.hasOwnProperty.call(article, column)) continue

      if (column === 'article_record_json') {
        const merged = mergeArticleRecordJson(existing[column], article[column])
        if (merged !== existing[column]) patch[column] = merged
        continue
      }

      if (column === 'content_status' && shouldFillContentStatus(existing[column], article[column])) {
        patch[column] = article[column]
        continue
      }

      if (isEmpty(existing[column]) && !isEmpty(article[column])) {
        patch[column] = article[column]
      }
    }
    return patch
  }

  applyPatch(id, patch) {
    const columns = Object.keys(patch)
    if (!columns.length) return 0
    const assignments = columns.map(column => `${quoteIdentifier(column)} = ?`).join(', ')
    return this.db.prepare(`UPDATE ${quoteIdentifier(TABLE)} SET ${assignments} WHERE id = ?`)
      .run(...columns.map(column => patch[column]), id).changes
  }

  upsertArticle(article) {
    if (isEmpty(article.id)) throw new Error('article.id is required')
    const existing = this.getArticle(article.id)
    if (!existing) {
      this.insertArticle(article)
      return { action: 'inserted', changedColumns: [] }
    }

    const patch = this.buildFillPatch(existing, article)
    const changed = this.applyPatch(article.id, patch)
    return {
      action: changed > 0 ? 'filled' : 'skipped',
      changedColumns: Object.keys(patch)
    }
  }
}

module.exports = {
  WechatArticleStore,
  mergeArticleRecordJson,
  shouldFillContentStatus,
  PRESERVED_ANALYSIS_COLUMNS,
  REQUIRED_COLLECTION_COLUMNS
}
