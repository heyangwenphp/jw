#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')
const { LeadMemoryStore } = require('../src/main/services/lead-memory/lead-memory-store')
const { normalizeName } = require('../src/main/services/lead-memory/text-utils')

const ROOT_DIR = path.resolve(__dirname, '..')
const DEFAULT_DB_PATH = path.join(ROOT_DIR, 'wechat_765.sqlite')
const TABLE_NAME = 'wechat_articles'

const DEFAULT_LIMIT = 10
const DEFAULT_CANDIDATE_LIMIT = 50
const MAX_TERMS = 18
const STOP_WORDS = new Set(['for', 'and', 'the', 'of', 'in', 'to', 'with', 'by', 'science'])

const TEXT_FIELDS = [
  'project',
  'team_name',
  'sector',
  'technology',
  'product',
  'research_direction',
  'core_members',
  'owner',
  'advisor_or_mentor',
  'title',
  'summary',
  'keywords',
  'topic',
  'subject',
  'matched_keywords',
  'content_text'
]

const SOURCE_FIELDS = [
  'id',
  'title',
  'url',
  'account_name',
  'published_at',
  'summary',
  'keywords',
  'topic',
  'subject',
  'level',
  'confidence',
  'project',
  'team_name',
  'sector',
  'technology',
  'product',
  'research_direction',
  'core_members',
  'owner',
  'advisor_or_mentor',
  'matched_keywords',
  'matched_keyword_count',
  'matched_evidence_json',
  'analysis_json',
  'signal_record_json',
  'field_enrichment_json',
  'content_text'
]

const COMMERCIAL_TERMS = [
  '创业',
  '融资',
  '投资',
  '产业化',
  '成果转化',
  '转化',
  '孵化',
  '公司',
  '客户',
  '订单',
  '试点',
  '量产',
  '产品',
  '样机',
  'Demo',
  '路演',
  '发布'
]

const TSINGHUA_TERMS = [
  '清华',
  '清华大学',
  '清华系',
  '清华校友',
  '清华团队',
  '清华实验室',
  '清华苏州',
  '启迪',
  '水木',
  '力合'
]

const NOISE_TERMS = [
  '讲座',
  '沙龙',
  '论坛',
  '会议',
  '课程',
  '报名',
  '通知',
  '预告',
  '征集',
  '培训',
  '研讨会',
  '读书会',
  '大会',
  '年会',
  '讲堂',
  '党建',
  '共建活动'
]

const HARD_NOISE_TERMS = [
  '报名',
  '活动回顾',
  '活动预告',
  '开放日',
  '讲堂',
  '论坛',
  '会议',
  '年会',
  '理事大会',
  '研讨会'
]

const TOPIC_EXPANSIONS = [
  {
    match: ['机器人', '具身智能', '灵巧手', '触觉'],
    terms: ['机器人', '具身智能', '灵巧手', '触觉传感', '柔性传感', '电子皮肤', '力控', '末端执行器', '多模态感知']
  },
  {
    match: ['脑机', 'bci', '神经接口'],
    terms: ['脑机接口', '侵入式脑机', '非侵入式脑机', '脑电', '神经调控', '医疗器械', '神经科学']
  },
  {
    match: ['合成生物', '生物制造', '生物技术'],
    terms: ['合成生物学', '生物制造', '发酵', '酶工程', '菌株', '细胞工厂', '生物基材料']
  },
  {
    match: ['ai for science', '科学智能', 'ai4s'],
    terms: ['AI for Science', '科学智能', '自驱动实验室', '材料计算', '蛋白设计', '药物发现', '高通量实验']
  },
  {
    match: ['散热', '热管理', '液冷', '光模块', 'cpo', 'lpo'],
    terms: ['热管理', '液冷', '浸没式冷却', '冷板', '导热材料', '热界面材料', '光模块散热', 'CPO', 'LPO']
  },
  {
    match: ['半导体', '芯片', '先进封装', '硅光'],
    terms: ['半导体', '芯片', '先进封装', '硅光', '封装材料', 'EDA', '光电集成', '晶圆']
  },
  {
    match: ['低空', '无人机', 'evtol', '航空'],
    terms: ['低空经济', '无人机', 'eVTOL', '飞行器', '航空', '物流无人机', '空域管理']
  },
  {
    match: ['材料', '超滑', '摩擦', '高导热'],
    terms: ['新材料', '超滑', '自超滑', '摩擦学', '高导热材料', '功能材料', '纳米材料']
  },
  {
    match: ['医疗', '医学', '超声', '影像'],
    terms: ['医疗器械', '医学影像', '超声', 'AI医疗', '辅助诊断', '注册证', '临床']
  }
]

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

function readOptionValue(argv, index, option) {
  const value = argv[index + 1]
  if (value === undefined || String(value).startsWith('--')) {
    throw new Error(`Missing ${option} value`)
  }
  return value
}

function parseArgs(argv) {
  const args = {
    topic: '',
    dbPath: process.env.WECHAT_COLLECTOR_DB || DEFAULT_DB_PATH,
    memoryDbPath: process.env.LEAD_MEMORY_DB_PATH || process.env.REPORT_LEAD_MEMORY_DB || '',
    skipMemory: process.env.SKIP_LEAD_MEMORY === '1',
    allowMissingLocal: false,
    limit: DEFAULT_LIMIT,
    candidateLimit: DEFAULT_CANDIDATE_LIMIT,
    pretty: true
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--topic' || arg === '-t') {
      args.topic = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--db') {
      args.dbPath = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--memory-db') {
      args.memoryDbPath = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '--limit') {
      args.limit = Number(readOptionValue(argv, index, arg))
      index += 1
    } else if (arg === '--candidate-limit') {
      args.candidateLimit = Number(readOptionValue(argv, index, arg))
      index += 1
    } else if (arg === '--compact') {
      args.pretty = false
    } else if (arg === '--skip-memory') {
      args.skipMemory = true
    } else if (arg === '--allow-missing-local') {
      args.allowMissingLocal = true
    } else if (!arg.startsWith('--') && !args.topic) {
      args.topic = arg
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  args.topic = String(args.topic || '').trim()
  args.dbPath = path.resolve(ROOT_DIR, args.dbPath)
  args.memoryDbPath = args.memoryDbPath ? path.resolve(ROOT_DIR, args.memoryDbPath) : ''
  if (!args.topic) throw new Error('Missing --topic')
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = DEFAULT_LIMIT
  if (!Number.isFinite(args.candidateLimit) || args.candidateLimit <= 0) args.candidateLimit = DEFAULT_CANDIDATE_LIMIT
  return args
}

function splitTopic(topic) {
  return String(topic)
    .split(/[\s,，、/|;；:：()（）【】\[\]{}]+/u)
    .map(term => term.trim())
    .filter(term => {
      if (term.length < 2) return false
      const lowerTerm = term.toLowerCase()
      if (STOP_WORDS.has(lowerTerm)) return false
      if (/^[a-z]+$/i.test(term) && term.length <= 2) return false
      return true
    })
}

function expandTerms(topic) {
  const lowerTopic = topic.toLowerCase()
  const terms = new Set(splitTopic(topic))
  terms.add(topic)

  for (const expansion of TOPIC_EXPANSIONS) {
    const matched = expansion.match.some(term => lowerTopic.includes(term.toLowerCase()))
    if (!matched) continue
    for (const term of expansion.terms) terms.add(term)
  }

  return Array.from(terms)
    .map(term => term.trim())
    .filter(Boolean)
    .slice(0, MAX_TERMS)
}

function primaryTerms(topic) {
  const terms = new Set(splitTopic(topic))
  terms.add(topic)
  return Array.from(terms).filter(Boolean)
}

function getColumns(db) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(TABLE_NAME)})`).all().map(column => column.name)
}

function buildLikeQuery(columns, terms, limit) {
  const searchableFields = TEXT_FIELDS.filter(field => columns.includes(field))
  const selectedFields = SOURCE_FIELDS.filter(field => columns.includes(field))
  if (!searchableFields.length) throw new Error('No searchable fields found in wechat_articles')

  const whereParts = []
  const params = {}
  terms.forEach((term, termIndex) => {
    const key = `term${termIndex}`
    params[key] = `%${term}%`
    const fieldClauses = searchableFields.map(field => `${quoteIdentifier(field)} LIKE @${key}`)
    whereParts.push(`(${fieldClauses.join(' OR ')})`)
  })

  const hasPublishedAt = columns.includes('published_at')
  const orderBy = hasPublishedAt
    ? `ORDER BY ${quoteIdentifier('published_at')} DESC`
    : `ORDER BY rowid DESC`

  params.limit = Math.max(limit * 8, 100)

  return {
    sql: `
      SELECT ${selectedFields.map(quoteIdentifier).join(', ')}
      FROM ${quoteIdentifier(TABLE_NAME)}
      WHERE ${whereParts.join(' OR ')}
      ${orderBy}
      LIMIT @limit
    `,
    params
  }
}

function textOf(row, fields) {
  return fields.map(field => row[field]).filter(Boolean).join(' ')
}

function countMatches(text, terms) {
  const lowerText = String(text || '').toLowerCase()
  return terms.reduce((count, term) => {
    return lowerText.includes(term.toLowerCase()) ? count + 1 : count
  }, 0)
}

function hasAny(text, terms) {
  const lowerText = String(text || '').toLowerCase()
  return terms.some(term => lowerText.includes(term.toLowerCase()))
}

function candidateName(row) {
  const structured = [row.project, row.team_name, row.product, row.technology]
    .map(value => String(value || '').trim())
    .find(Boolean)
  if (structured) return structured.slice(0, 80)

  const title = String(row.title || '').trim()
  if (!title) return `article:${row.id || 'unknown'}`
  return title.replace(/[丨｜|].*$/u, '').slice(0, 80)
}

function isLikelyEventRow(row) {
  const title = String(row.title || '')
  const project = String(row.project || '')
  const teamName = String(row.team_name || '')
  const titleLikeText = `${title} ${project}`
  const structuredText = textOf(row, ['project', 'team_name', 'technology', 'product', 'research_direction'])
  const articleText = textOf(row, ['title', 'summary', 'keywords'])
  const hasEventTitle = hasAny(titleLikeText, NOISE_TERMS)
  const projectLooksLikeTitle = project && title && (title.includes(project) || project.includes(title.slice(0, 24)))
  const teamLooksInstitutional = /学会|协会|分会|学院|研究院|委员会|党支部|校友会/u.test(teamName)
  const hasStrongCommercialSignal = hasAny(articleText, ['融资', '投资', '客户', '订单', '量产', '产品发布', '注册证', '成立公司'])
  const hasConcreteProduct = hasAny(structuredText, ['产品', '平台', '系统', '设备', '材料', '芯片', '机器人', '传感器', '药物', '器械'])
  return hasEventTitle && !hasStrongCommercialSignal && (projectLooksLikeTitle || teamLooksInstitutional || !hasConcreteProduct)
}

function scoreRow(row, terms, originalTerms) {
  const structuredText = textOf(row, [
    'project',
    'team_name',
    'sector',
    'technology',
    'product',
    'research_direction',
    'core_members',
    'owner',
    'advisor_or_mentor'
  ])
  const articleText = textOf(row, ['title', 'summary', 'keywords', 'topic', 'subject', 'matched_keywords'])
  const contentText = String(row.content_text || '')
  const allText = `${structuredText} ${articleText} ${contentText.slice(0, 2000)}`
  const titleText = String(row.title || '')
  const projectText = String(row.project || '')

  if (hasAny(titleText, HARD_NOISE_TERMS) && (!projectText || hasAny(projectText, NOISE_TERMS))) {
    return -1
  }

  let score = 0
  score += countMatches(structuredText, originalTerms) * 24
  score += countMatches(articleText, originalTerms) * 12
  score += countMatches(contentText.slice(0, 2000), originalTerms) * 4
  score += countMatches(structuredText, terms) * 8
  score += countMatches(articleText, terms) * 4
  score += countMatches(contentText.slice(0, 2000), terms) * 1
  score += countMatches(allText, COMMERCIAL_TERMS) * 4
  score += countMatches(allText, TSINGHUA_TERMS) * 3

  if (row.project) score += 14
  if (row.team_name) score += 10
  if (row.technology || row.product || row.research_direction) score += 8
  if (!row.project && !row.team_name && !row.technology && !row.product && !row.research_direction) score -= 40
  if (row.signal_record_json || row.analysis_json || row.field_enrichment_json) score += 6
  if (Number.isFinite(Number(row.confidence))) {
    const confidence = Number(row.confidence)
    score += confidence <= 1 ? Math.round(confidence * 10) : Math.round(confidence / 5)
  }
  if (isLikelyEventRow(row)) score -= 60
  else if (hasAny(titleText, NOISE_TERMS) && !hasAny(allText, COMMERCIAL_TERMS)) score -= 18

  return score
}

function missingFieldsFor(row) {
  const missing = []
  if (!row.project && !row.team_name) missing.push('项目/团队名称')
  if (!row.technology && !row.product && !row.research_direction) missing.push('技术/产品方向')
  if (!row.core_members && !row.owner && !row.advisor_or_mentor) missing.push('核心团队')
  if (!row.signal_record_json && !row.analysis_json && !row.field_enrichment_json) missing.push('结构化研判')
  return missing
}

function compactSource(row) {
  return {
    id: row.id || '',
    title: row.title || '',
    url: row.url || '',
    accountName: row.account_name || '',
    publishedAt: row.published_at || '',
    topic: row.topic || '',
    confidence: row.confidence ?? null
  }
}

function memoryCandidateFromEntity(entity, terms) {
  const metadata = entity?.metadata || {}
  const evidence = Array.isArray(entity?.evidence) ? entity.evidence : []
  const relations = Array.isArray(entity?.relations) ? entity.relations : []
  const matchedText = [
    entity?.canonical_name,
    entity?.display_name,
    entity?.summary,
    metadata.sector,
    metadata.research_direction,
    metadata.technology,
    metadata.product,
    metadata.stage,
    metadata.financing_status,
    ...evidence.map(item => `${item.source_title || ''} ${item.evidence_summary || ''}`)
  ].filter(Boolean).join(' ')

  const verifiedBoost = entity?.verification_status === 'verified' ? 20 : 0
  const affiliationBoost = entity?.tsinghua_affiliation_status === 'verified' ? 16 : 0
  const confidence = Number(entity?.confidence || 0)
  const sourceQuality = Number(entity?.source_quality || 0)
  const matchedTermScore = countMatches(matchedText, terms) * 8
  const sourceScore = Math.min(evidence.length, 5) * 5
  const relationScore = Math.min(relations.length, 5) * 3
  const score = Math.round(
    confidence * 80 +
    sourceQuality * 40 +
    matchedTermScore +
    sourceScore +
    relationScore +
    verifiedBoost +
    affiliationBoost
  )

  return {
    name: entity?.display_name || entity?.canonical_name || '',
    score,
    candidateSource: 'memory',
    articleCount: 0,
    fields: {
      project: metadata.project || entity?.canonical_name || '',
      teamName: metadata.team_name || '',
      sector: metadata.sector || '',
      technology: metadata.technology || '',
      product: metadata.product || '',
      researchDirection: metadata.research_direction || '',
      coreMembers: metadata.core_members || '',
      owner: metadata.owner || '',
      advisorOrMentor: metadata.advisor_or_mentor || '',
      stage: metadata.stage || '',
      financingStatus: metadata.financing_status || '',
      currentStatus: metadata.current_status || '',
      summary: entity?.summary || ''
    },
    matchedTerms: terms.filter(term => hasAny(matchedText, [term])),
    commercialSignals: COMMERCIAL_TERMS.filter(term => hasAny(matchedText, [term])).slice(0, 8),
    tsinghuaSignals: TSINGHUA_TERMS.filter(term => hasAny(matchedText, [term])).slice(0, 8),
    missingFields: [
      !metadata.technology && !metadata.product && !metadata.research_direction ? '技术/产品方向' : '',
      evidence.length === 0 ? '来源证据' : '',
      entity?.verification_status !== 'verified' ? '主体核验' : '',
      entity?.tsinghua_affiliation_status !== 'verified' ? '清华关联核验' : ''
    ].filter(Boolean),
    sources: evidence.slice(0, 3).map(item => ({
      id: item.id || '',
      title: item.source_title || '',
      url: item.source_url || '',
      accountName: item.source_type || '',
      publishedAt: item.published_at || item.captured_at || '',
      topic: '',
      confidence: item.confidence ?? null
    }))
  }
}

function recallMemoryCandidates(memoryDbPath, topic, terms, limit) {
  if (!memoryDbPath || !fs.existsSync(memoryDbPath)) return []
  const store = new LeadMemoryStore(memoryDbPath)
  try {
    const result = store.recall({ query: topic, mode: 'mixed', keywords: terms })
    return (result.entities || [])
      .map(entity => memoryCandidateFromEntity(entity, terms))
      .filter(candidate => candidate.name && candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  } finally {
    store.close()
  }
}

function mergeLocalCandidates(rows, terms, originalTerms, limit) {
  const groups = new Map()

  for (const row of rows) {
    const name = candidateName(row)
    const key = name.toLowerCase()
    const score = scoreRow(row, terms, originalTerms)
    if (score <= 0) continue
    if (!groups.has(key)) {
      groups.set(key, {
        name,
        score: 0,
        candidateSource: 'local',
        articleCount: 0,
        fields: {
          project: row.project || '',
          teamName: row.team_name || '',
          sector: row.sector || '',
          technology: row.technology || '',
          product: row.product || '',
          researchDirection: row.research_direction || '',
          coreMembers: row.core_members || '',
          owner: row.owner || '',
          advisorOrMentor: row.advisor_or_mentor || ''
        },
        matchedTerms: new Set(),
        commercialSignals: new Set(),
        tsinghuaSignals: new Set(),
        missingFields: new Set(),
        sources: []
      })
    }

    const group = groups.get(key)
    group.score += score
    group.articleCount += 1
    for (const [field, value] of Object.entries(group.fields)) {
      if (!value) {
        const rowField = {
          teamName: 'team_name',
          researchDirection: 'research_direction',
          coreMembers: 'core_members',
          advisorOrMentor: 'advisor_or_mentor'
        }[field] || field
        group.fields[field] = row[rowField] || ''
      }
    }

    const allText = textOf(row, TEXT_FIELDS)
    for (const term of terms) {
      if (hasAny(allText, [term])) group.matchedTerms.add(term)
    }
    for (const term of COMMERCIAL_TERMS) {
      if (hasAny(allText, [term])) group.commercialSignals.add(term)
    }
    for (const term of TSINGHUA_TERMS) {
      if (hasAny(allText, [term])) group.tsinghuaSignals.add(term)
    }
    for (const field of missingFieldsFor(row)) group.missingFields.add(field)

    if (group.sources.length < 3) group.sources.push(compactSource(row))
  }

  return Array.from(groups.values())
    .map(group => ({
      name: group.name,
      score: group.score,
      candidateSource: group.candidateSource,
      articleCount: group.articleCount,
      fields: group.fields,
      matchedTerms: Array.from(group.matchedTerms),
      commercialSignals: Array.from(group.commercialSignals).slice(0, 8),
      tsinghuaSignals: Array.from(group.tsinghuaSignals).slice(0, 8),
      missingFields: Array.from(group.missingFields),
      sources: group.sources
    }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function mergeCandidateLists(memoryCandidates, localCandidates, limit) {
  const mergedByKey = new Map()
  const mergeInto = candidate => {
    const key = normalizeName(candidate.name || candidate.fields?.project || '')
    if (!key) return
    const existing = mergedByKey.get(key)
    if (!existing) {
      mergedByKey.set(key, {
        ...candidate,
        candidateSource: candidate.candidateSource || 'local',
        sources: Array.isArray(candidate.sources) ? [...candidate.sources] : [],
        matchedTerms: Array.isArray(candidate.matchedTerms) ? [...candidate.matchedTerms] : [],
        commercialSignals: Array.isArray(candidate.commercialSignals) ? [...candidate.commercialSignals] : [],
        tsinghuaSignals: Array.isArray(candidate.tsinghuaSignals) ? [...candidate.tsinghuaSignals] : [],
        missingFields: Array.isArray(candidate.missingFields) ? [...candidate.missingFields] : []
      })
      return
    }

    existing.score = Math.max(existing.score || 0, candidate.score || 0) + 8
    existing.articleCount = (existing.articleCount || 0) + (candidate.articleCount || 0)
    existing.candidateSource = existing.candidateSource === candidate.candidateSource
      ? existing.candidateSource
      : 'memory+local'
    existing.fields = {
      ...(candidate.fields || {}),
      ...(existing.fields || {})
    }
    existing.sources = [...existing.sources, ...(candidate.sources || [])].slice(0, 5)
    existing.matchedTerms = Array.from(new Set([...existing.matchedTerms, ...(candidate.matchedTerms || [])]))
    existing.commercialSignals = Array.from(new Set([...existing.commercialSignals, ...(candidate.commercialSignals || [])])).slice(0, 8)
    existing.tsinghuaSignals = Array.from(new Set([...existing.tsinghuaSignals, ...(candidate.tsinghuaSignals || [])])).slice(0, 8)
    existing.missingFields = Array.from(new Set([...existing.missingFields, ...(candidate.missingFields || [])]))
  }

  for (const candidate of memoryCandidates) mergeInto(candidate)
  for (const candidate of localCandidates) mergeInto(candidate)

  return Array.from(mergedByKey.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const hasLocalDb = fs.existsSync(args.dbPath)
  if (!hasLocalDb && !args.allowMissingLocal) {
    throw new Error(`Database not found: ${args.dbPath}`)
  }

  const db = hasLocalDb ? new Database(args.dbPath, { readonly: true }) : null
  try {
    const terms = expandTerms(args.topic)
    const originalTerms = primaryTerms(args.topic)
    const memoryCandidates = args.skipMemory
      ? []
      : recallMemoryCandidates(args.memoryDbPath, args.topic, terms, Math.min(args.limit, args.candidateLimit))
    let rows = []
    let localCandidates = []
    if (db) {
      const columns = getColumns(db)
      if (!columns.includes('id')) throw new Error('wechat_articles table must include id column')
      const query = buildLikeQuery(columns, terms, args.candidateLimit)
      rows = db.prepare(query.sql).all(query.params)
      localCandidates = mergeLocalCandidates(rows, terms, originalTerms, Math.min(args.limit, args.candidateLimit))
    }
    const candidates = mergeCandidateLists(memoryCandidates, localCandidates, Math.min(args.limit, args.candidateLimit))
    const result = {
      topic: args.topic,
      expandedTerms: terms,
      memoryEnabled: Boolean(!args.skipMemory && args.memoryDbPath),
      memoryHitCount: memoryCandidates.length,
      totalMatchedArticles: rows.length,
      candidateLimit: args.candidateLimit,
      outputLimit: args.limit,
      webEnrichmentPolicy: {
        maxSearches: 5,
        onlyForTopCandidates: true,
        missingFieldsShouldUsePendingPlaceholders: true
      },
      memoryCandidates,
      localCandidates,
      candidates
    }
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0))
    process.stdout.write('\n')
  } finally {
    db?.close()
  }
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
