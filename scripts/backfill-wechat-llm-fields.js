#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { DeepSeekClient, normalizeDeepSeekConfig } = require('../src/main/services/wechat-collector/deepseek-client')
const {
  LLM_FIELD_NAMES,
  LLM_JSON_ARRAY_FIELD_NAMES,
  LlmFieldExtractor
} = require('../src/main/services/wechat-collector/llm-field-extractor')
const { PublicFieldEnricher } = require('../src/main/services/wechat-collector/public-field-enricher')

const ROOT_DIR = path.resolve(__dirname, '..')

const BACKFILL_COLUMNS = {
  subject: 'TEXT',
  team_name: 'TEXT',
  sector: 'TEXT',
  project: 'TEXT',
  research_direction: 'TEXT',
  core_members: 'TEXT',
  owner: 'TEXT',
  advisor_or_mentor: 'TEXT',
  technology: 'TEXT',
  product: 'TEXT',
  llm_extraction_json: 'TEXT',
  field_enrichment_json: 'TEXT'
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
}

function resolveFromRoot(value) {
  return path.resolve(ROOT_DIR, value)
}

function parseArgs(argv) {
  const args = {
    config: path.join(ROOT_DIR, 'config.local.json'),
    db: path.join(ROOT_DIR, 'wechat_765.sqlite'),
    limit: 0,
    concurrency: 3,
    timeoutMs: 90000,
    maxInputChars: 12000,
    progressEvery: 10,
    publicSearchTimeoutMs: 15000,
    publicSearchMaxResults: 5,
    publicSearchMaxResultsPerField: 3,
    enablePublicSearch: false,
    dryRun: false,
    llmModel: '',
    llmBaseUrl: '',
    llmApiKey: '',
    overwrite: false,
    publicSearchOverwrite: false
  }

  const needValue = (index, name) => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--config':
        args.config = resolveFromRoot(needValue(index, arg))
        index += 1
        break
      case '--db':
        args.db = resolveFromRoot(needValue(index, arg))
        index += 1
        break
      case '--limit':
        args.limit = Number(needValue(index, arg))
        index += 1
        break
      case '--concurrency':
        args.concurrency = Number(needValue(index, arg))
        index += 1
        break
      case '--timeout-ms':
        args.timeoutMs = Number(needValue(index, arg))
        index += 1
        break
      case '--max-input-chars':
        args.maxInputChars = Number(needValue(index, arg))
        index += 1
        break
      case '--progress-every':
        args.progressEvery = Number(needValue(index, arg))
        index += 1
        break
      case '--public-search-timeout-ms':
        args.publicSearchTimeoutMs = Number(needValue(index, arg))
        index += 1
        break
      case '--public-search-max-results':
        args.publicSearchMaxResults = Number(needValue(index, arg))
        index += 1
        break
      case '--public-search-max-results-per-field':
        args.publicSearchMaxResultsPerField = Number(needValue(index, arg))
        index += 1
        break
      case '--llm-model':
        args.llmModel = needValue(index, arg)
        index += 1
        break
      case '--llm-base-url':
        args.llmBaseUrl = needValue(index, arg)
        index += 1
        break
      case '--llm-api-key':
        args.llmApiKey = needValue(index, arg)
        index += 1
        break
      case '--enable-public-search':
        args.enablePublicSearch = true
        break
      case '--disable-public-search':
        args.enablePublicSearch = false
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--overwrite':
        args.overwrite = true
        break
      case '--no-overwrite':
        args.overwrite = false
        break
      case '--public-search-overwrite':
        args.publicSearchOverwrite = true
        break
      case '--no-public-search-overwrite':
        args.publicSearchOverwrite = false
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  args.limit = Math.max(0, Number(args.limit || 0))
  args.concurrency = Math.max(1, Number(args.concurrency || 1))
  args.progressEvery = Math.max(1, Number(args.progressEvery || 10))
  args.publicSearchMaxResults = Math.max(1, Number(args.publicSearchMaxResults || 1))
  args.publicSearchMaxResultsPerField = Math.max(1, Number(args.publicSearchMaxResultsPerField || 1))
  return args
}

function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

function isJsonArrayField(field) {
  return LLM_JSON_ARRAY_FIELD_NAMES.includes(field)
}

function isMissingField(field, value) {
  if (isEmpty(value)) return true
  if (!isJsonArrayField(field)) return false

  const text = String(value).trim()
  if (text === '[]') return true
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) && parsed.length === 0
  } catch {
    return false
  }
}

function hasSerializedValue(field, value) {
  return !isMissingField(field, value)
}

function shouldApplySerializedField(field, currentValue, nextValue, overwrite = false) {
  if (!hasSerializedValue(field, nextValue)) return false
  if (!overwrite) return isMissingField(field, currentValue)
  return String(currentValue == null ? '' : currentValue).trim() !== String(nextValue).trim()
}

function serializeField(field, value) {
  if (!Array.isArray(value) || !value.length) return null
  if (isJsonArrayField(field)) return JSON.stringify(value)
  return value.join('\u3001')
}

function missingSql(field) {
  if (isJsonArrayField(field)) {
    return `(${field} IS NULL OR TRIM(${field}) = '' OR TRIM(${field}) = '[]')`
  }
  return `(${field} IS NULL OR TRIM(${field}) = '')`
}

function ensureBackfillColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(wechat_articles)').all().map(column => column.name))
  for (const [column, type] of Object.entries(BACKFILL_COLUMNS)) {
    if (!existing.has(column)) {
      db.prepare(`ALTER TABLE wechat_articles ADD COLUMN ${column} ${type}`).run()
    }
  }
}

function selectRows(db, limit, options = {}) {
  const overwrite = Boolean(options.overwrite)
  const columns = [
    'id',
    'title',
    'digest',
    'account_name',
    'content_text',
    ...LLM_FIELD_NAMES,
    'llm_extraction_json',
    'field_enrichment_json'
  ]
  const missingFilter = LLM_FIELD_NAMES.map(missingSql).join(' OR ')
  const sql = `
    SELECT ${columns.join(', ')}
    FROM wechat_articles
    WHERE (
      content_text IS NOT NULL AND TRIM(content_text) <> ''
      OR title IS NOT NULL AND TRIM(title) <> ''
      OR digest IS NOT NULL AND TRIM(digest) <> ''
    )
      ${overwrite ? '' : `AND (${missingFilter})`}
    ORDER BY published_at DESC, id
    ${limit > 0 ? 'LIMIT ?' : ''}
  `
  return limit > 0 ? db.prepare(sql).all(limit) : db.prepare(sql).all()
}

function createUpdater(db, options = {}) {
  const overwrite = Boolean(options.overwrite)
  const fieldSetSql = LLM_FIELD_NAMES
    .map(field => {
      const condition = overwrite ? `@${field} IS NOT NULL` : `@${field} IS NOT NULL AND ${missingSql(field)}`
      return `${field} = CASE WHEN ${condition} THEN @${field} ELSE ${field} END`
    })
    .join(',\n        ')
  return db.prepare(`
    UPDATE wechat_articles
    SET ${fieldSetSql},
        llm_extraction_json = CASE WHEN @llm_extraction_json IS NOT NULL THEN @llm_extraction_json ELSE llm_extraction_json END,
        field_enrichment_json = CASE WHEN @field_enrichment_json IS NOT NULL THEN @field_enrichment_json ELSE field_enrichment_json END
    WHERE id = @id
  `)
}

async function runPool(rows, worker, concurrency) {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (cursor < rows.length) {
      const row = rows[cursor]
      cursor += 1
      await worker(row)
    }
  })
  await Promise.all(workers)
}

function createUpdateParams(row) {
  return {
    id: row.id,
    llm_extraction_json: null,
    field_enrichment_json: null,
    ...Object.fromEntries(LLM_FIELD_NAMES.map(field => [field, null]))
  }
}

function buildLlmMetadata(result) {
  return JSON.stringify({
    model: result.model || null,
    confidence: result.confidence ?? null,
    evidence: result.evidence || {},
    rawText: result.rawText || ''
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = readJson(args.config)
  const deepSeekConfig = normalizeDeepSeekConfig(config)
  if (args.llmModel) deepSeekConfig.model = args.llmModel
  if (args.llmBaseUrl) deepSeekConfig.baseUrl = args.llmBaseUrl
  if (args.llmApiKey) deepSeekConfig.apiKey = args.llmApiKey

  const db = new Database(args.db)
  ensureBackfillColumns(db)
  const rows = selectRows(db, args.limit, { overwrite: args.overwrite })
  const update = createUpdater(db, { overwrite: args.overwrite })
  const client = new DeepSeekClient({
    ...deepSeekConfig,
    timeoutMs: args.timeoutMs
  })
  const extractor = new LlmFieldExtractor({
    client,
    model: deepSeekConfig.model,
    maxInputChars: args.maxInputChars
  })
  const publicFieldEnricher = args.enablePublicSearch
    ? new PublicFieldEnricher({
      llmFieldExtractor: extractor,
      timeoutMs: args.publicSearchTimeoutMs,
      maxResults: args.publicSearchMaxResults,
      maxResultsPerField: args.publicSearchMaxResultsPerField
    })
    : null
  const summary = {
    totalCandidates: rows.length,
    processed: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
    llmFieldUpdates: 0,
    publicFieldUpdates: 0,
    publicSourceCount: 0,
    dryRun: args.dryRun,
    overwrite: args.overwrite,
    publicSearchOverwrite: args.publicSearchOverwrite,
    publicSearch: Boolean(publicFieldEnricher),
    model: deepSeekConfig.model
  }

  console.log(JSON.stringify({ event: 'start', ...summary }))

  await runPool(rows, async row => {
    try {
      console.log(JSON.stringify({
        event: 'row_start',
        id: row.id,
        title: String(row.title || '').slice(0, 80)
      }))
      const params = createUpdateParams(row)
      const currentFields = Object.fromEntries(LLM_FIELD_NAMES.map(field => [field, row[field]]))
      const result = await extractor.extract({
        article: row,
        contentText: row.content_text || ''
      })
      let rowFieldUpdates = 0
      let llmFieldUpdates = 0
      let publicFieldUpdates = 0

      for (const field of LLM_FIELD_NAMES) {
        const serialized = serializeField(field, result.fields?.[field])
        if (shouldApplySerializedField(field, currentFields[field], serialized, args.overwrite)) {
          params[field] = serialized
          currentFields[field] = serialized
          rowFieldUpdates += 1
          llmFieldUpdates += 1
        }
      }

      if (llmFieldUpdates > 0) {
        params.llm_extraction_json = buildLlmMetadata(result)
      }

      if (publicFieldEnricher) {
        const publicSearchFields = args.overwrite && args.publicSearchOverwrite
          ? LLM_FIELD_NAMES.filter(field => params[field] === null)
          : LLM_FIELD_NAMES.filter(field => isMissingField(field, currentFields[field]))
        if (publicSearchFields.length) {
          console.log(JSON.stringify({
            event: 'public_search_start',
            id: row.id,
            fields: publicSearchFields
          }))
          const enriched = await publicFieldEnricher.enrich({
            article: row,
            fields: currentFields,
            missingFields: publicSearchFields,
            overwrite: args.overwrite && args.publicSearchOverwrite
          })
          for (const field of publicSearchFields) {
            const value = enriched.fields?.[field]
            if (shouldApplySerializedField(field, currentFields[field], value, args.overwrite)) {
              params[field] = value
              currentFields[field] = value
              rowFieldUpdates += 1
              publicFieldUpdates += 1
            }
          }
          if (enriched.sources?.length) {
            params.field_enrichment_json = JSON.stringify(enriched.sources)
            summary.publicSourceCount += enriched.sources.length
          }
        }
      }

      if (rowFieldUpdates > 0 && !args.dryRun) {
        update.run(params)
      }

      if (rowFieldUpdates > 0) {
        summary.updated += 1
        summary.llmFieldUpdates += llmFieldUpdates
        summary.publicFieldUpdates += publicFieldUpdates
      } else {
        summary.unchanged += 1
      }
    } catch (error) {
      summary.errors += 1
      console.error(JSON.stringify({ event: 'error', id: row.id, message: error.message }))
    } finally {
      summary.processed += 1
      if (summary.processed % args.progressEvery === 0 || summary.processed === rows.length) {
        console.log(JSON.stringify({
          event: 'progress',
          processed: summary.processed,
          totalCandidates: summary.totalCandidates,
          updated: summary.updated,
          unchanged: summary.unchanged,
          errors: summary.errors,
          llmFieldUpdates: summary.llmFieldUpdates,
          publicFieldUpdates: summary.publicFieldUpdates,
          publicSourceCount: summary.publicSourceCount
        }))
      }
    }
  }, args.concurrency)

  console.log(JSON.stringify({ event: 'finish', ...summary }))
  db.close()
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message)
    process.exit(1)
  })
}

module.exports = {
  parseArgs,
  isMissingField,
  hasSerializedValue,
  shouldApplySerializedField,
  serializeField,
  selectRows,
  createUpdater,
  ensureBackfillColumns
}
