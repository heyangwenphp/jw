const { buildDateChunks, resolveCollectionWindow } = require('./date-windows')
const { extractArticleId, normalizeQingboArticle, stripHtml } = require('./article-normalizer')
const { FIELD_NAMES } = require('./field-extractor')
const { LLM_FIELD_NAMES, LLM_JSON_ARRAY_FIELD_NAMES } = require('./llm-field-extractor')
const { PublicFieldEnricher } = require('./public-field-enricher')

function createRunId(now = Date.now()) {
  return `wechat-${now.toString(36)}`
}

function createEmptySummary(options, window) {
  return {
    runId: options.runId,
    mode: options.mode,
    startDate: window.startDate,
    endDate: window.endDate,
    accountCount: 0,
    successfulAccountCount: 0,
    emptyAccountCount: 0,
    failedAccountCount: 0,
    articleCandidatesFetched: 0,
    newArticleCount: 0,
    filledExistingArticleCount: 0,
    skippedDuplicateCount: 0,
    contentSuccessCount: 0,
    contentErrorCount: 0,
    llmFieldExtractionCount: 0,
    llmFieldExtractionErrorCount: 0,
    publicFieldEnrichmentCount: 0,
    publicFieldEnrichmentErrorCount: 0,
    accountStatuses: []
  }
}

function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

function serializeLlmField(field, value) {
  if (!Array.isArray(value) || !value.length) return null
  if (LLM_JSON_ARRAY_FIELD_NAMES.includes(field)) return JSON.stringify(value)
  return value.join('、')
}

async function runWechatCollection(options) {
  const mode = options.mode || 'daily'
  const window = resolveCollectionWindow({
    mode,
    today: options.today,
    startDate: options.startDate,
    endDate: options.endDate,
    lookbackDays: options.lookbackDays
  })
  const runOptions = {
    ...options,
    mode,
    runId: options.runId || createRunId(),
    collectedAt: options.collectedAt || new Date().toISOString()
  }
  const chunks = buildDateChunks(window.startDate, window.endDate, options.chunkDays || 7)
  const summary = createEmptySummary(runOptions, window)
  const seenArticleIds = new Set()
  const publicFieldEnricher = options.publicFieldEnricher
    || (options.enablePublicFieldEnrichment ? new PublicFieldEnricher({
      ...(options.publicFieldEnrichmentOptions || {}),
      llmFieldExtractor: options.llmFieldExtractor || null
    }) : null)
  const llmFieldExtractor = options.llmFieldExtractor || null

  summary.accountCount = options.accounts.length

  for (const account of options.accounts) {
    const status = {
      rowNumber: account.rowNumber,
      accountName: account.name,
      candidatesTried: [],
      candidatesUsed: [],
      articleCount: 0,
      error: '',
      status: 'empty'
    }

    if (!account.candidates.length) {
      status.status = 'no_candidate'
      summary.emptyAccountCount += 1
      summary.accountStatuses.push(status)
      continue
    }

    try {
      const accountArticles = []
      const candidateByArticleId = new Map()
      for (const candidate of account.candidates) {
        status.candidatesTried.push(`${candidate.kind}=${candidate.value}`)
        let candidateFound = false

        for (const chunk of chunks) {
          const result = await options.qingboClient.searchArticles({
            wxName: candidate.value,
            startAt: chunk.startAt,
            endAt: chunk.endAt,
            pageSize: options.pageSize || 50,
            maxPages: options.maxPages || 20
          })
          summary.articleCandidatesFetched += result.articles.length
          if (result.articles.length) candidateFound = true
          for (const article of result.articles) {
            const id = extractArticleId({
              ...article,
              accountBiz: account.fakeid,
              accountId: account.wechatId
            })
            if (!candidateByArticleId.has(id)) candidateByArticleId.set(id, candidate)
            accountArticles.push(article)
          }
        }

        if (candidateFound) status.candidatesUsed.push(`${candidate.kind}=${candidate.value}`)
      }

      for (const article of accountArticles) {
        const id = extractArticleId({
          ...article,
          accountBiz: account.fakeid,
          accountId: account.wechatId
        })
        if (seenArticleIds.has(id)) {
          summary.skippedDuplicateCount += 1
          continue
        }
        seenArticleIds.add(id)

        let contentText = ''
        try {
          contentText = stripHtml(await options.qingboClient.fetchArticleContent(article.news_local_url))
          if (contentText) summary.contentSuccessCount += 1
        } catch (error) {
          summary.contentErrorCount += 1
          status.error = [status.error, `content ${article.news_local_url}: ${error.message}`].filter(Boolean).join(' | ')
        }

        const normalized = normalizeQingboArticle({
          account,
          candidate: candidateByArticleId.get(id) || account.candidates[0],
          article,
          contentText,
          collectedAt: runOptions.collectedAt,
          runId: runOptions.runId
        })

        if (llmFieldExtractor) {
          const missingLlmFields = LLM_FIELD_NAMES.filter(field => isEmpty(normalized[field]))
          if (missingLlmFields.length) {
            try {
              const extracted = await llmFieldExtractor.extract({
                article: normalized,
                contentText: normalized.content_text || ''
              })
              let filled = 0
              for (const field of LLM_FIELD_NAMES) {
                if (!isEmpty(normalized[field])) continue
                const serialized = serializeLlmField(field, extracted.fields?.[field])
                if (serialized) {
                  normalized[field] = serialized
                  filled += 1
                }
              }
              if (filled > 0) {
                normalized.llm_extraction_json = JSON.stringify({
                  model: extracted.model || null,
                  confidence: extracted.confidence ?? null,
                  evidence: extracted.evidence || {},
                  rawText: extracted.rawText || ''
                })
                summary.llmFieldExtractionCount += 1
              }
            } catch (error) {
              summary.llmFieldExtractionErrorCount += 1
              status.error = [status.error, `llm field extraction ${id}: ${error.message}`].filter(Boolean).join(' | ')
            }
          }
        }

        if (publicFieldEnricher) {
          const searchableFields = Array.from(new Set([...FIELD_NAMES, ...LLM_FIELD_NAMES]))
          const missingFields = searchableFields.filter(field => isEmpty(normalized[field]))
          if (missingFields.length) {
            try {
              const enriched = await publicFieldEnricher.enrich({
                article: normalized,
                fields: Object.fromEntries(searchableFields.map(field => [field, normalized[field]])),
                missingFields
              })
              for (const field of searchableFields) {
                if (!isEmpty(normalized[field])) continue
                if (!isEmpty(enriched.fields?.[field])) normalized[field] = enriched.fields[field]
              }
              if (enriched.sources?.length) {
                normalized.field_enrichment_json = JSON.stringify(enriched.sources)
                summary.publicFieldEnrichmentCount += enriched.sources.length
              }
            } catch (error) {
              summary.publicFieldEnrichmentErrorCount += 1
              status.error = [status.error, `public field enrichment ${id}: ${error.message}`].filter(Boolean).join(' | ')
            }
          }
        }

        const result = options.store.upsertArticle(normalized)
        if (result.action === 'inserted') summary.newArticleCount += 1
        if (result.action === 'filled') summary.filledExistingArticleCount += 1
        if (result.action === 'skipped') summary.skippedDuplicateCount += 1
        status.articleCount += 1
      }

      status.status = status.articleCount > 0 ? 'matched' : 'empty'
      if (status.status === 'matched') summary.successfulAccountCount += 1
      if (status.status === 'empty') summary.emptyAccountCount += 1
    } catch (error) {
      status.status = 'error'
      status.error = error.message
      summary.failedAccountCount += 1
    }

    summary.accountStatuses.push(status)
  }

  return summary
}

module.exports = {
  createRunId,
  runWechatCollection
}
