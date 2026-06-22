const Database = require('better-sqlite3')
const { ensureLeadMemorySchema, ENTITY_TYPES, VERIFICATION_STATUSES } = require('./schema')
const { mergeJsonArrays, normalizeFtsQuery, normalizeName, stableJson, uniqueId } = require('./text-utils')

const DEFAULT_FRESHNESS_DAYS = {
  identity: 180,
  stage: 30,
  evidence: 90
}

function daysBetween(leftIso, rightIso) {
  const left = new Date(leftIso).getTime()
  const right = new Date(rightIso).getTime()
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity
  return Math.floor((right - left) / 86400000)
}

function nowIso(options = {}) {
  return typeof options.now === 'function' ? options.now() : new Date().toISOString()
}

class LeadMemoryStore {
  constructor(dbPath, options = {}) {
    this.db = new Database(dbPath)
    this.options = options
    this.now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()
    ensureLeadMemorySchema(this.db)
  }

  close() {
    this.db.close()
  }

  findEntityByName(entityType, canonicalName, aliases = []) {
    return this.findEntityMatchByName(entityType, canonicalName, aliases).row
  }

  findEntityMatchByName(entityType, canonicalName, aliases = []) {
    const normalizedCanonicalName = normalizeName(canonicalName)
    if (normalizedCanonicalName) {
      const row = this.db.prepare(`
        SELECT * FROM lead_entities
        WHERE entity_type = ? AND normalized_name = ?
      `).get(entityType, normalizedCanonicalName)
      if (row) return { row, matchType: 'exact' }
    }

    const normalizedNames = [
      normalizedCanonicalName,
      ...mergeJsonArrays([], aliases).map(alias => normalizeName(alias))
    ].filter(Boolean)
    const rows = this.db.prepare(`
      SELECT * FROM lead_entities
      WHERE entity_type = ?
    `).all(entityType)
    const wanted = new Set(normalizedNames)

    const row = rows.find(candidate => {
      const aliasesJson = candidate.aliases_json || '[]'
      return mergeJsonArrays([], aliasesJson).some(alias => wanted.has(normalizeName(alias)))
    })
    return row ? { row, matchType: 'alias' } : { row: null, matchType: 'none' }
  }

  upsertEntityBundle(bundle) {
    return this.db.transaction(() => {
      const entity = bundle && bundle.entity
      this._validateEntity(entity)

      const now = this.now()
      const entityId = this._upsertEntity(entity, now)
      const topicIds = this._upsertTopics(bundle.topics || [], now)
      const relationIds = this._upsertRelations(entityId, bundle.relations || [], topicIds, now)
      const insertedEvidenceCount = this._insertEvidence(entityId, bundle.evidence || [], now)

      return { entityId, topicIds, relationIds, insertedEvidenceCount }
    })()
  }

  recall({ query, mode = 'mixed', keywords = [] } = {}) {
    const normalizedQuery = normalizeName(query)
    if (!normalizedQuery) {
      throw new Error('query is required')
    }

    const exactRows = this.db.prepare(`
      SELECT * FROM lead_entities
      WHERE normalized_name = ?
      ORDER BY confidence DESC
    `).all(normalizedQuery)

    let cacheHitLevel = exactRows.length > 0 ? 'exact' : 'none'
    let entityRows = exactRows

    if (entityRows.length === 0 && mode !== 'sector_discovery') {
      entityRows = this.db.prepare(`
        SELECT * FROM lead_entities
        ORDER BY confidence DESC
      `).all().filter(row => {
        return mergeJsonArrays([], row.aliases_json).some(alias => normalizeName(alias) === normalizedQuery)
      })
      cacheHitLevel = entityRows.length > 0 ? 'alias' : 'none'
    }

    let topicRows = []
    if (mode === 'sector_discovery' || mode === 'mixed') {
      topicRows = this.searchTopics(query, keywords)
      if (topicRows.length > 0) {
        const topicEntityRows = this._entitiesForTopics(topicRows.map(topic => topic.id))
        entityRows = this._dedupeRowsById([...entityRows, ...topicEntityRows])
        if (cacheHitLevel === 'none') cacheHitLevel = 'keyword'
      }
    }

    if (entityRows.length === 0 || mode === 'mixed') {
      const keywordEntityRows = this.searchEntitiesByKeyword(query, keywords)
      entityRows = this._dedupeRowsById([...entityRows, ...keywordEntityRows])
      if (keywordEntityRows.length > 0 && cacheHitLevel === 'none') cacheHitLevel = 'keyword'
    }

    const hydratedEntities = entityRows.map(row => this._hydrateEntity(row))
    const matchedEntityIds = hydratedEntities.map(entity => entity.id)
    const matchedTopicIds = topicRows.map(topic => topic.id)
    const needsEnrichment = hydratedEntities.length === 0 ||
      hydratedEntities.some(entity => entity.verification_status !== 'verified')
    const queryId = this.recordQuery({
      rawQuery: query,
      normalizedQuery,
      mode,
      keywords,
      matchedEntityIds,
      matchedTopicIds,
      cacheHitLevel,
      needsEnrichment
    })

    return {
      queryId,
      mode,
      cacheHitLevel,
      entities: hydratedEntities,
      topics: topicRows,
      needsEnrichment
    }
  }

  searchTopics(query, keywords = []) {
    const normalizedQuery = normalizeName(query)
    const rowsById = new Map()
    const addRows = rows => {
      for (const row of rows) {
        if (!rowsById.has(row.id)) rowsById.set(row.id, row)
      }
    }

    if (normalizedQuery) {
      addRows(this.db.prepare(`
        SELECT * FROM lead_topics
        WHERE normalized_name = ?
        ORDER BY updated_at DESC
      `).all(normalizedQuery))

      addRows(this.db.prepare(`
        SELECT * FROM lead_topics
        ORDER BY updated_at DESC
      `).all().filter(row => {
        return mergeJsonArrays([], row.aliases_json).some(alias => normalizeName(alias) === normalizedQuery)
      }))
    }

    const ftsQuery = normalizeFtsQuery([query, ...keywords].join(' '))
    if (ftsQuery) {
      addRows(this.db.prepare(`
        SELECT topic.*
        FROM lead_topics_fts fts
        JOIN lead_topics topic ON topic.id = fts.id
        WHERE lead_topics_fts MATCH ?
        ORDER BY topic.updated_at DESC
      `).all(ftsQuery))
    }

    return [...rowsById.values()].map(row => this._hydrateTopic(row))
  }

  searchEntitiesByKeyword(query, keywords = []) {
    const ftsQuery = normalizeFtsQuery([query, ...keywords].join(' '))
    if (!ftsQuery) return []

    const rowsById = new Map()
    const addRows = rows => {
      for (const row of rows) {
        if (!rowsById.has(row.id)) rowsById.set(row.id, row)
      }
    }

    addRows(this.db.prepare(`
      SELECT entity.*
      FROM lead_entities_fts fts
      JOIN lead_entities entity ON entity.id = fts.id
      WHERE lead_entities_fts MATCH ?
      ORDER BY
        CASE entity.verification_status WHEN 'verified' THEN 0 ELSE 1 END,
        entity.confidence DESC,
        entity.last_seen_at DESC
    `).all(ftsQuery))

    const evidenceRows = this.db.prepare(`
      SELECT DISTINCT entity.*
      FROM lead_evidence_fts fts
      JOIN lead_evidence evidence ON evidence.id = fts.id
      JOIN lead_entities entity ON entity.id = evidence.entity_id
      WHERE lead_evidence_fts MATCH ?
      ORDER BY
        CASE entity.verification_status WHEN 'verified' THEN 0 ELSE 1 END,
        entity.confidence DESC,
        entity.last_seen_at DESC
    `).all(ftsQuery)
    addRows(evidenceRows)

    addRows(this.db.prepare(`
      SELECT DISTINCT entity.*
      FROM lead_evidence evidence
      JOIN lead_entities entity ON entity.id = evidence.entity_id
      WHERE evidence.source_url = ?
      ORDER BY
        CASE entity.verification_status WHEN 'verified' THEN 0 ELSE 1 END,
        entity.confidence DESC,
        entity.last_seen_at DESC
    `).all(query))

    return [...rowsById.values()]
  }

  recordQuery({
    rawQuery,
    normalizedQuery,
    mode,
    keywords = [],
    matchedEntityIds = [],
    matchedTopicIds = [],
    cacheHitLevel = 'none',
    needsEnrichment = true
  }) {
    const now = this.now()
    const insertQuery = this.db.prepare(`
      INSERT INTO lead_queries (
        id, raw_query, normalized_query, query_mode, keywords_json,
        matched_entity_ids_json, matched_topic_ids_json, cache_hit_level,
        needs_enrichment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    let suffix = this.db.prepare('SELECT COUNT(*) + 1 AS suffix FROM lead_queries').get().suffix

    while (true) {
      const id = uniqueId('query', `${rawQuery}:${mode}:${now}:${cacheHitLevel}:${suffix}`)
      const existing = this.db.prepare('SELECT id FROM lead_queries WHERE id = ?').get(id)
      if (!existing) {
        insertQuery.run(
          id,
          rawQuery,
          normalizedQuery,
          mode,
          JSON.stringify(mergeJsonArrays([], keywords)),
          JSON.stringify(mergeJsonArrays([], matchedEntityIds)),
          JSON.stringify(mergeJsonArrays([], matchedTopicIds)),
          cacheHitLevel,
          needsEnrichment ? 1 : 0,
          now
        )
        return id
      }
      suffix += 1
    }
  }

  detectStaleFields(metadata = {}) {
    const now = nowIso(this.options)
    return {
      identity: daysBetween(metadata.identity_checked_at, now) > DEFAULT_FRESHNESS_DAYS.identity,
      stage: daysBetween(metadata.stage_checked_at, now) > DEFAULT_FRESHNESS_DAYS.stage,
      evidence: daysBetween(metadata.evidence_checked_at, now) > DEFAULT_FRESHNESS_DAYS.evidence
    }
  }

  _validateEntity(entity) {
    if (!entity || !entity.entity_type || !entity.canonical_name) {
      throw new Error('entity_type and canonical_name are required')
    }
    if (!ENTITY_TYPES.includes(entity.entity_type)) {
      throw new Error(`Unsupported entity_type: ${entity.entity_type}`)
    }
  }

  _upsertEntity(entity, now) {
    const entityMatch = this.findEntityMatchByName(entity.entity_type, entity.canonical_name, entity.aliases || [])
    const existing = entityMatch.row
    const normalizedName = normalizeName(entity.canonical_name)
    const canonicalDiffers = existing && normalizeName(existing.canonical_name) !== normalizedName
    const canonicalAliasCandidates = canonicalDiffers
      ? [existing.canonical_name, entity.canonical_name]
      : []
    const aliases = existing
      ? mergeJsonArrays(existing.aliases_json, [...canonicalAliasCandidates, ...(entity.aliases || [])])
      : mergeJsonArrays([], entity.aliases || [])
    const incomingMetadata = this._definedObject(entity.metadata)
    const existingMetadata = existing ? this._parseJsonObject(existing.metadata_json) : {}
    const metadataJson = stableJson({ ...existingMetadata, ...incomingMetadata })

    if (!existing) {
      const id = uniqueId('entity', `${entity.entity_type}:${normalizedName}`)
      this.db.prepare(`
        INSERT INTO lead_entities (
          id, entity_type, canonical_name, normalized_name, display_name,
          aliases_json, summary, tsinghua_affiliation_status, verification_status,
          confidence, source_quality, first_seen_at, last_seen_at, updated_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        entity.entity_type,
        entity.canonical_name,
        normalizedName,
        entity.display_name || entity.canonical_name,
        JSON.stringify(aliases),
        entity.summary || null,
        entity.tsinghua_affiliation_status || 'pending',
        this._verificationStatus(entity.verification_status),
        this._numberOrDefault(entity.confidence, 0),
        this._numberOrDefault(entity.source_quality, 0),
        now,
        now,
        now,
        metadataJson
      )
      this._refreshEntityFts(id)
      return id
    }

    const incomingStatus = this._verificationStatus(entity.verification_status)
    const verificationStatus = this._strongerVerificationStatus(existing.verification_status, incomingStatus)
    const existingConfidence = this._numberOrDefault(existing.confidence, 0)
    const incomingConfidence = this._numberOrDefault(entity.confidence, 0)
    const shouldPromoteIdentity = canonicalDiffers &&
      entityMatch.matchType === 'exact' &&
      this._statusRank(incomingStatus) >= this._statusRank(existing.verification_status) &&
      incomingConfidence > existingConfidence
    const canonicalName = shouldPromoteIdentity ? entity.canonical_name : existing.canonical_name
    const nextNormalizedName = shouldPromoteIdentity ? normalizedName : existing.normalized_name
    const displayName = shouldPromoteIdentity
      ? (entity.display_name || existing.display_name || entity.canonical_name)
      : (existing.display_name || entity.display_name || existing.canonical_name)

    this.db.prepare(`
      UPDATE lead_entities
      SET canonical_name = ?,
          normalized_name = ?,
          display_name = ?,
          aliases_json = ?,
          summary = ?,
          tsinghua_affiliation_status = ?,
          verification_status = ?,
          confidence = ?,
          source_quality = ?,
          last_seen_at = ?,
          updated_at = ?,
          metadata_json = ?
      WHERE id = ?
    `).run(
      canonicalName,
      nextNormalizedName,
      displayName,
      JSON.stringify(aliases),
      existing.summary || entity.summary || null,
      this._strongerAffiliationStatus(existing.tsinghua_affiliation_status, entity.tsinghua_affiliation_status),
      verificationStatus,
      Math.max(existingConfidence, incomingConfidence),
      Math.max(this._numberOrDefault(existing.source_quality, 0), this._numberOrDefault(entity.source_quality, 0)),
      now,
      now,
      metadataJson,
      existing.id
    )
    this._refreshEntityFts(existing.id)
    return existing.id
  }

  _upsertTopics(topics, now) {
    const topicIds = {}
    for (const topic of topics) {
      if (!topic || !topic.canonical_name) continue

      const topicType = topic.topic_type || 'general'
      const normalizedName = normalizeName(topic.canonical_name)
      const existing = this.db.prepare(`
        SELECT * FROM lead_topics
        WHERE normalized_name = ?
      `).get(normalizedName)
      const keywords = existing
        ? mergeJsonArrays(existing.keywords_json, topic.keywords || [])
        : mergeJsonArrays([], topic.keywords || [])
      const aliases = existing
        ? mergeJsonArrays(existing.aliases_json, topic.aliases || [])
        : mergeJsonArrays([], topic.aliases || [])

      if (!existing) {
        const id = uniqueId('topic', `${topicType}:${normalizedName}`)
        this.db.prepare(`
          INSERT INTO lead_topics (
            id, topic_type, canonical_name, normalized_name,
            aliases_json, description, keywords_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          topicType,
          topic.canonical_name,
          normalizedName,
          JSON.stringify(aliases),
          topic.description || null,
          JSON.stringify(keywords),
          now
        )
        this._refreshTopicFts(id)
        topicIds[topic.canonical_name] = id
      } else {
        this.db.prepare(`
          UPDATE lead_topics
          SET topic_type = ?,
              canonical_name = ?,
              normalized_name = ?,
              aliases_json = ?,
              description = ?,
              keywords_json = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          topic.topic_type || existing.topic_type,
          topic.canonical_name,
          normalizedName,
          JSON.stringify(aliases),
          topic.description || existing.description || null,
          JSON.stringify(keywords),
          now,
          existing.id
        )
        this._refreshTopicFts(existing.id)
        topicIds[topic.canonical_name] = existing.id
      }
    }
    return topicIds
  }

  _upsertRelations(entityId, relations, topicIds, now) {
    const relationIds = []
    for (const relation of relations) {
      if (!relation || !relation.relation_type) continue

      const targetType = relation.target_type || 'topic'
      const targetId = relation.target_id || topicIds[relation.target_topic_name]
      if (!targetId) continue

      const id = uniqueId('relation', `entity:${entityId}:${relation.relation_type}:${targetType}:${targetId}`)
      const existing = this.db.prepare('SELECT * FROM lead_relations WHERE id = ?').get(id)
      if (!existing) {
        this.db.prepare(`
          INSERT INTO lead_relations (
            id, source_type, source_id, relation_type, target_type, target_id,
            confidence, verification_status, evidence_ids_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          relation.source_type || 'entity',
          entityId,
          relation.relation_type,
          targetType,
          targetId,
          this._numberOrDefault(relation.confidence, 0),
          this._verificationStatus(relation.verification_status),
          JSON.stringify(relation.evidence_ids || []),
          now
        )
      } else {
        this.db.prepare(`
          UPDATE lead_relations
          SET confidence = ?,
              verification_status = ?,
              evidence_ids_json = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          Math.max(this._numberOrDefault(existing.confidence, 0), this._numberOrDefault(relation.confidence, 0)),
          this._mergeVerificationStatus(existing.verification_status, relation.verification_status),
          JSON.stringify(mergeJsonArrays(existing.evidence_ids_json, relation.evidence_ids || [])),
          now,
          id
        )
      }
      relationIds.push(id)
    }
    return relationIds
  }

  _insertEvidence(entityId, evidenceItems, now) {
    let insertedEvidenceCount = 0
    for (const evidence of evidenceItems) {
      if (!evidence || !evidence.source_type || !evidence.source_title) continue

      const id = uniqueId(
        'evidence',
        `${entityId}:${evidence.source_type}:${evidence.source_url || ''}:${evidence.source_title}:${evidence.evidence_summary || ''}`
      )
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO lead_evidence (
          id, entity_id, topic_id, relation_id, source_type, source_title,
          source_url, published_at, captured_at, evidence_summary,
          matched_fields_json, quote_or_excerpt, confidence, source_quality,
          conflict_group_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        entityId,
        evidence.topic_id || null,
        evidence.relation_id || null,
        evidence.source_type,
        evidence.source_title,
        evidence.source_url || null,
        evidence.published_at || null,
        evidence.captured_at || now,
        evidence.evidence_summary || null,
        stableJson(evidence.matched_fields || {}),
        evidence.quote_or_excerpt || null,
        this._numberOrDefault(evidence.confidence, 0),
        this._numberOrDefault(evidence.source_quality, 0),
        evidence.conflict_group_id || null
      )
      insertedEvidenceCount += result.changes
      if (result.changes > 0) this._refreshEvidenceFts(id)
    }
    return insertedEvidenceCount
  }

  _hydrateEntity(row) {
    return {
      ...row,
      aliases: mergeJsonArrays([], row.aliases_json),
      metadata: this._parseJsonObject(row.metadata_json),
      relations: this._relationsForEntity(row.id),
      evidence: this._evidenceForEntity(row.id)
    }
  }

  _hydrateTopic(row) {
    return {
      ...row,
      aliases: mergeJsonArrays([], row.aliases_json),
      keywords: mergeJsonArrays([], row.keywords_json)
    }
  }

  _entitiesForTopics(topicIds) {
    const uniqueTopicIds = mergeJsonArrays([], topicIds)
    if (uniqueTopicIds.length === 0) return []

    const placeholders = uniqueTopicIds.map(() => '?').join(', ')
    const relations = this.db.prepare(`
      SELECT *
      FROM lead_relations
      WHERE target_type = 'topic' AND target_id IN (${placeholders})
      ORDER BY confidence DESC
    `).all(...uniqueTopicIds)
    const entityIds = mergeJsonArrays(
      [],
      relations
        .filter(row => row.source_type === 'entity')
        .map(row => row.source_id)
    )
    if (entityIds.length === 0) return []

    const entityPlaceholders = entityIds.map(() => '?').join(', ')
    return this.db.prepare(`
      SELECT *
      FROM lead_entities
      WHERE id IN (${entityPlaceholders})
      ORDER BY
        CASE verification_status WHEN 'verified' THEN 0 ELSE 1 END,
        confidence DESC,
        last_seen_at DESC
    `).all(...entityIds)
  }

  _dedupeRowsById(rows) {
    const rowsById = new Map()
    for (const row of rows) {
      if (!rowsById.has(row.id)) rowsById.set(row.id, row)
    }
    return [...rowsById.values()]
  }

  _relationsForEntity(entityId) {
    return this.db.prepare(`
      SELECT * FROM lead_relations
      WHERE source_type = 'entity' AND source_id = ?
      ORDER BY confidence DESC
    `).all(entityId).map(row => ({
      ...row,
      evidence_ids: mergeJsonArrays([], row.evidence_ids_json)
    }))
  }

  _evidenceForEntity(entityId) {
    return this.db.prepare(`
      SELECT * FROM lead_evidence
      WHERE entity_id = ?
      ORDER BY confidence DESC, captured_at DESC
    `).all(entityId).map(row => ({
      ...row,
      matched_fields: this._parseJsonObject(row.matched_fields_json)
    }))
  }

  _parseJsonObject(value) {
    if (!value) return {}
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  _plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }

  _definedObject(value) {
    const object = this._plainObject(value)
    return Object.fromEntries(Object.entries(object).filter(([, entryValue]) => entryValue !== undefined))
  }

  _refreshEntityFts(entityId) {
    const row = this.db.prepare('SELECT * FROM lead_entities WHERE id = ?').get(entityId)
    if (!row) return
    const aliases = mergeJsonArrays([], row.aliases_json).join(' ')
    this.db.prepare('DELETE FROM lead_entities_fts WHERE id = ?').run(entityId)
    this.db.prepare(`
      INSERT INTO lead_entities_fts (id, canonical_name, display_name, aliases, summary)
      VALUES (?, ?, ?, ?, ?)
    `).run(entityId, row.canonical_name, row.display_name || '', aliases, row.summary || '')
  }

  _refreshTopicFts(topicId) {
    const row = this.db.prepare('SELECT * FROM lead_topics WHERE id = ?').get(topicId)
    if (!row) return
    const aliases = mergeJsonArrays([], row.aliases_json).join(' ')
    const keywords = mergeJsonArrays([], row.keywords_json).join(' ')
    this.db.prepare('DELETE FROM lead_topics_fts WHERE id = ?').run(topicId)
    this.db.prepare(`
      INSERT INTO lead_topics_fts (id, canonical_name, aliases, keywords, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(topicId, row.canonical_name, aliases, keywords, row.description || '')
  }

  _refreshEvidenceFts(evidenceId) {
    const row = this.db.prepare('SELECT * FROM lead_evidence WHERE id = ?').get(evidenceId)
    if (!row) return
    this.db.prepare('DELETE FROM lead_evidence_fts WHERE id = ?').run(evidenceId)
    this.db.prepare(`
      INSERT INTO lead_evidence_fts (id, source_title, evidence_summary, quote_or_excerpt)
      VALUES (?, ?, ?, ?)
    `).run(evidenceId, row.source_title, row.evidence_summary || '', row.quote_or_excerpt || '')
  }

  _numberOrDefault(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback
  }

  _verificationStatus(value) {
    return VERIFICATION_STATUSES.includes(value) ? value : 'pending'
  }

  _statusRank(value) {
    return {
      rejected: 0,
      pending: 1,
      conflict: 2,
      verified: 3
    }[this._verificationStatus(value)]
  }

  _strongerVerificationStatus(existingValue, nextValue) {
    return this._mergeVerificationStatus(existingValue, nextValue)
  }

  _mergeVerificationStatus(existingValue, nextValue) {
    const existing = this._verificationStatus(existingValue)
    const next = this._verificationStatus(nextValue)
    if (existing === 'conflict' || next === 'conflict') return 'conflict'
    return this._statusRank(next) > this._statusRank(existing)
      ? this._verificationStatus(nextValue)
      : this._verificationStatus(existingValue)
  }

  _strongerAffiliationStatus(existingValue, nextValue) {
    if (existingValue === 'conflict' || nextValue === 'conflict') return 'conflict'
    if (existingValue === 'verified' && nextValue !== 'verified') return existingValue
    return nextValue || existingValue || 'pending'
  }
}

module.exports = {
  LeadMemoryStore
}
