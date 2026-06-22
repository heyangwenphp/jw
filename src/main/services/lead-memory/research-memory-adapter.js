const { mergeJsonArrays, normalizeName } = require('./text-utils')

const ENTITY_TYPE_BY_SUBJECT = {
  person: 'person',
  team: 'team',
  project: 'project',
  company: 'company',
  lab: 'lab',
  institution: 'institution',
  '个人': 'person',
  '团队': 'team',
  '项目': 'project',
  '企业': 'company',
  '公司': 'company',
  '实验室': 'lab',
  '机构': 'institution'
}

function compact(values) {
  return values.map(value => String(value || '').trim()).filter(Boolean)
}

function uniqueValues(values) {
  const seen = new Set()
  const unique = []
  for (const value of compact(values)) {
    const key = normalizeName(value)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(value)
  }
  return unique
}

function firstValue(...values) {
  return compact(values)[0] || ''
}

function inferResearchMode(input, explicitMode) {
  if (explicitMode) return explicitMode
  const value = String(input || '').trim()
  if (/^https?:\/\//i.test(value)) return 'entity_lookup'
  return 'mixed'
}

class ResearchMemoryAdapter {
  constructor(store) {
    if (!store || typeof store.recall !== 'function' || typeof store.upsertEntityBundle !== 'function') {
      throw new Error('A LeadMemoryStore-compatible store is required')
    }
    this.store = store
  }

  recallForResearch({ input, query, mode, keywords = [] } = {}) {
    const rawQuery = firstValue(input, query)
    const recallMode = inferResearchMode(rawQuery, mode)
    const result = this.store.recall({
      query: rawQuery,
      mode: recallMode,
      keywords
    })

    return {
      ...result,
      context: this.formatRecallContext(result)
    }
  }

  formatRecallContext(result = {}) {
    const entities = Array.isArray(result.entities) ? result.entities : []
    const topics = Array.isArray(result.topics) ? result.topics : []
    if (entities.length === 0 && topics.length === 0) {
      return [
        '结构化历史线索：未发现可直接复用的主体或赛道记录。',
        '使用方式：继续执行来源核验；形成可核验主体后写回结构化线索。'
      ].join('\n')
    }

    const lines = [
      '结构化历史线索：以下内容仅用于辅助研判，不得在报告中暴露内部检索或存储细节。',
      `命中级别：${result.cacheHitLevel || 'none'}`,
      `建议补充：${result.needsEnrichment ? '需要补充或核验' : '可优先复用，仍需核对最新公开来源'}`
    ]

    if (topics.length > 0) {
      lines.push('相关赛道/主题：')
      topics.slice(0, 8).forEach((topic, index) => {
        const keywords = mergeJsonArrays([], topic.keywords || topic.keywords_json).join('、')
        lines.push(`${index + 1}. ${topic.canonical_name}${keywords ? `；关键词：${keywords}` : ''}`)
      })
    }

    if (entities.length > 0) {
      lines.push('相关主体：')
      entities.slice(0, 12).forEach((entity, index) => {
        const metadata = entity.metadata || {}
        const staleFields = this.store.detectStaleFields(metadata)
        const staleNames = Object.entries(staleFields)
          .filter(([, isStale]) => isStale)
          .map(([name]) => name)
        const evidenceUrls = (entity.evidence || [])
          .map(evidence => evidence.source_url)
          .filter(Boolean)
          .slice(0, 3)
          .join('、')

        lines.push(`${index + 1}. 主体：${entity.canonical_name}`)
        lines.push(`   类型：${entity.entity_type || 'unknown'}；核验状态：${entity.verification_status || 'pending'}；清华关联：${entity.tsinghua_affiliation_status || 'pending'}`)
        if (metadata.sector || metadata.research_direction) {
          lines.push(`   方向：${compact([metadata.sector, metadata.research_direction]).join(' / ')}`)
        }
        if (metadata.technology || metadata.product) {
          lines.push(`   技术/产品：${compact([metadata.technology, metadata.product]).join(' / ')}`)
        }
        if (evidenceUrls) lines.push(`   可复核来源：${evidenceUrls}`)
        if (staleNames.length > 0) lines.push(`   待补充字段：${staleNames.join('、')}`)
      })
    }

    return lines.join('\n')
  }

  upsertFromResearchLead(lead = {}) {
    const canonicalName = firstValue(
      lead.canonicalName,
      lead.project,
      lead.entityName,
      lead.teamName,
      lead.companyName,
      lead.personName
    )
    if (!canonicalName) {
      throw new Error('A project, canonicalName, or entityName is required')
    }

    const subjectType = lead.subjectType || lead.entityType || 'project'
    const entityType = ENTITY_TYPE_BY_SUBJECT[subjectType] || ENTITY_TYPE_BY_SUBJECT[lead.entity_type] || 'project'
    const topicNames = uniqueValues([
      lead.sector,
      lead.researchDirection,
      lead.technology,
      lead.product
    ])
    const sharedKeywords = uniqueValues([
      lead.sector,
      lead.researchDirection,
      lead.technology,
      lead.product,
      ...(Array.isArray(lead.keywords) ? lead.keywords : [])
    ])
    const metadata = {
      sector: lead.sector || undefined,
      research_direction: lead.researchDirection || undefined,
      technology: lead.technology || undefined,
      product: lead.product || undefined,
      stage: lead.stage || undefined,
      financing_status: lead.financingStatus || undefined,
      current_status: lead.currentStatus || undefined,
      identity_checked_at: lead.identityCheckedAt || undefined,
      stage_checked_at: lead.stageCheckedAt || undefined,
      evidence_checked_at: lead.evidenceCheckedAt || undefined
    }

    return this.store.upsertEntityBundle({
      entity: {
        entity_type: entityType,
        canonical_name: canonicalName,
        display_name: lead.displayName || canonicalName,
        aliases: Array.isArray(lead.aliases) ? lead.aliases : [],
        summary: lead.summary || lead.sourceFacts || null,
        tsinghua_affiliation_status: lead.tsinghuaAffiliationStatus || lead.tsinghua_affiliation_status || 'pending',
        verification_status: lead.verificationStatus || lead.verification_status || 'pending',
        confidence: lead.confidence || 0,
        source_quality: lead.sourceQuality || lead.source_quality || 0,
        metadata
      },
      topics: topicNames.map(name => ({
        topic_type: this._topicTypeForName(name, lead),
        canonical_name: name,
        keywords: sharedKeywords
      })),
      relations: topicNames.map(name => ({
        relation_type: 'related_to_topic',
        target_topic_name: name,
        verification_status: lead.verificationStatus || lead.verification_status || 'pending',
        confidence: lead.confidence || 0
      })),
      evidence: this._evidenceFromLead(lead, canonicalName)
    })
  }

  _topicTypeForName(name, lead) {
    if (name === lead.product) return 'product'
    if (name === lead.technology || name === lead.researchDirection) return 'technology'
    return 'sector'
  }

  _evidenceFromLead(lead, canonicalName) {
    const hasEvidenceSource = Boolean(firstValue(
      lead.sourceTitle,
      lead.sourceName,
      lead.sourceUrl,
      lead.sourceFacts,
      lead.summary,
      lead.quoteOrExcerpt
    ))
    if (!hasEvidenceSource) return []

    const sourceTitle = firstValue(lead.sourceTitle, lead.sourceName, canonicalName)

    return [{
      source_type: lead.sourceType || 'public_web',
      source_title: sourceTitle,
      source_url: lead.sourceUrl || null,
      published_at: lead.publishedAt || null,
      evidence_summary: lead.sourceFacts || lead.summary || null,
      quote_or_excerpt: lead.quoteOrExcerpt || null,
      matched_fields: {
        project: lead.project || canonicalName,
        sector: lead.sector || undefined,
        research_direction: lead.researchDirection || undefined,
        technology: lead.technology || undefined,
        product: lead.product || undefined
      },
      confidence: lead.confidence || 0,
      source_quality: lead.sourceQuality || lead.source_quality || 0
    }]
  }
}

function createResearchMemoryAdapter(store) {
  return new ResearchMemoryAdapter(store)
}

module.exports = {
  ResearchMemoryAdapter,
  createResearchMemoryAdapter,
  inferResearchMode
}
