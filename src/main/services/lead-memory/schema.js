const ENTITY_TYPES = ['person', 'team', 'project', 'company', 'lab', 'institution']
const VERIFICATION_STATUSES = ['verified', 'pending', 'conflict', 'rejected']

function ensureLeadMemorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_entities (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      display_name TEXT,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT,
      tsinghua_affiliation_status TEXT NOT NULL DEFAULT 'pending',
      verification_status TEXT NOT NULL DEFAULT 'pending',
      confidence REAL NOT NULL DEFAULT 0,
      source_quality REAL NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS lead_topics (
      id TEXT PRIMARY KEY,
      topic_type TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lead_relations (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'pending',
      evidence_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lead_evidence (
      id TEXT PRIMARY KEY,
      entity_id TEXT,
      topic_id TEXT,
      relation_id TEXT,
      source_type TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_url TEXT,
      published_at TEXT,
      captured_at TEXT NOT NULL,
      evidence_summary TEXT,
      matched_fields_json TEXT NOT NULL DEFAULT '{}',
      quote_or_excerpt TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      source_quality REAL NOT NULL DEFAULT 0,
      conflict_group_id TEXT
    );

    CREATE TABLE IF NOT EXISTS lead_queries (
      id TEXT PRIMARY KEY,
      raw_query TEXT NOT NULL,
      normalized_query TEXT NOT NULL,
      query_mode TEXT NOT NULL,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      matched_entity_ids_json TEXT NOT NULL DEFAULT '[]',
      matched_topic_ids_json TEXT NOT NULL DEFAULT '[]',
      cache_hit_level TEXT NOT NULL DEFAULT 'none',
      needs_enrichment INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lead_snapshots (
      id TEXT PRIMARY KEY,
      query_id TEXT NOT NULL,
      snapshot_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_lead_entities_normalized_name ON lead_entities(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_lead_topics_normalized_name ON lead_topics(normalized_name);
    CREATE INDEX IF NOT EXISTS idx_lead_relations_source ON lead_relations(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_lead_relations_target ON lead_relations(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_lead_evidence_entity ON lead_evidence(entity_id);
    CREATE INDEX IF NOT EXISTS idx_lead_evidence_topic ON lead_evidence(topic_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS lead_entities_fts USING fts5(
      id UNINDEXED,
      canonical_name,
      display_name,
      aliases,
      summary
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS lead_topics_fts USING fts5(
      id UNINDEXED,
      canonical_name,
      aliases,
      keywords,
      description
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS lead_evidence_fts USING fts5(
      id UNINDEXED,
      source_title,
      evidence_summary,
      quote_or_excerpt
    );
  `)
}

module.exports = {
  ensureLeadMemorySchema,
  ENTITY_TYPES,
  VERIFICATION_STATUSES
}
