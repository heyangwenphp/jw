const LLM_TEXT_FIELD_NAMES = [
  'subject',
  'team_name',
  'sector',
  'project',
  'research_direction',
  'core_members',
  'owner',
  'advisor_or_mentor'
]
const LLM_JSON_ARRAY_FIELD_NAMES = ['technology', 'product']
const LLM_FIELD_NAMES = [...LLM_TEXT_FIELD_NAMES, ...LLM_JSON_ARRAY_FIELD_NAMES]

function compact(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeExtractionList(value) {
  const values = Array.isArray(value) ? value : (value ? [value] : [])
  const seen = new Set()
  const normalized = []
  for (const item of values) {
    const text = compact(item)
    if (!text || seen.has(text)) continue
    seen.add(text)
    normalized.push(text)
  }
  return normalized
}

function hasEvidence(evidence, field) {
  return normalizeExtractionList(evidence?.[field]).length > 0
}

function extractJsonObject(text) {
  const raw = compact(text)
  if (!raw) return {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] || raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) return {}
  return JSON.parse(candidate.slice(start, end + 1))
}

function buildPrompt({ article = {}, contentText = '', maxInputChars = 12000 }) {
  return [
    '\u8bf7\u53ea\u57fa\u4e8e\u4e0b\u9762\u7684\u6587\u7ae0\u5185\u5bb9\uff0c\u62bd\u53d6\u7ed3\u6784\u5316\u5b57\u6bb5\u3002',
    '\u4e0d\u8981\u731c\u6d4b\uff0c\u4e0d\u8981\u4ece\u63a8\u8350\u9605\u8bfb\u3001\u5e7f\u544a\u3001\u9875\u811a\u4e2d\u62bd\u53d6\u3002',
    '\u4e3b\u4f53 subject\uff1a\u6587\u7ae0\u4e3b\u8981\u63cf\u8ff0\u7684\u56e2\u961f\u3001\u9879\u76ee\u3001\u4ea7\u54c1\u6216\u673a\u6784\u3002',
    '\u56e2\u961f\u540d\u79f0 team_name\uff1a\u660e\u786e\u7684\u56e2\u961f\u3001\u8bfe\u9898\u7ec4\u3001\u5b9e\u9a8c\u5ba4\u3001\u7814\u7a76\u4e2d\u5fc3\u540d\u79f0\u3002',
    '\u8d5b\u9053 sector\uff1a\u6240\u5c5e\u9886\u57df\u6216\u4ea7\u4e1a\u8d5b\u9053\u3002',
    '\u9879\u76ee project\uff1a\u9879\u76ee\u3001\u8bfe\u9898\u3001\u7814\u7a76\u9879\u76ee\u6216\u6d3b\u52a8\u9879\u76ee\u540d\u79f0\u3002',
    '\u7814\u7a76\u65b9\u5411 research_direction\uff1a\u7814\u7a76\u4e3b\u9898\u3001\u6280\u672f\u65b9\u5411\u6216\u7814\u7a76\u9886\u57df\u3002',
    '\u6838\u5fc3\u6210\u5458 core_members\uff1a\u660e\u786e\u5217\u51fa\u7684\u6838\u5fc3\u6210\u5458\u6216\u56e2\u961f\u6210\u5458\u3002',
    '\u8d1f\u8d23\u4eba owner\uff1a\u9879\u76ee\u6216\u56e2\u961f\u8d1f\u8d23\u4eba\u3002',
    '\u5bfc\u5e08/\u987e\u95ee advisor_or_mentor\uff1a\u5bfc\u5e08\u3001\u987e\u95ee\u6216\u6307\u5bfc\u8001\u5e08\u3002',
    '\u6280\u672f\uff1a\u7b97\u6cd5\u3001\u65b9\u6cd5\u3001\u5de5\u827a\u3001\u6750\u6599\u3001\u6280\u672f\u8def\u7ebf\u3001\u5e73\u53f0\u6280\u672f\u7b49\u3002',
    '\u4ea7\u54c1\uff1a\u4ea7\u54c1\u3001\u7cfb\u7edf\u3001\u5e73\u53f0\u3001\u5de5\u5177\u3001\u8f6f\u4ef6\u3001\u6a21\u578b\u3001\u88c5\u7f6e\u3001\u89e3\u51b3\u65b9\u6848\u7b49\u3002',
    '\u6bcf\u4e2a\u5b57\u6bb5\u4e0d\u8bbe\u6570\u91cf\u4e0a\u9650\uff0c\u627e\u5230\u591a\u5c11\u8fd4\u56de\u591a\u5c11\u3002',
    '\u6240\u6709\u5b57\u6bb5\u90fd\u7528\u6570\u7ec4\u8fd4\u56de\uff1b\u6ca1\u6709\u660e\u786e\u5185\u5bb9\u65f6\u8fd4\u56de\u7a7a\u6570\u7ec4\u3002',
    '\u53ea\u8f93\u51fa JSON\uff0c\u683c\u5f0f\u4e3a\uff1a{"subject":[],"team_name":[],"sector":[],"project":[],"research_direction":[],"core_members":[],"owner":[],"advisor_or_mentor":[],"technology":[],"product":[],"confidence":0,"evidence":{}}',
    '',
    `\u6807\u9898\uff1a${compact(article.title)}`,
    `\u6458\u8981\uff1a${compact(article.digest)}`,
    `\u6b63\u6587\uff1a${String(contentText || '').slice(0, maxInputChars)}`
  ].join('\n')
}

class LlmFieldExtractor {
  constructor(options = {}) {
    this.client = options.client
    this.model = compact(options.model || options.client?.model || 'DeepSeek-V4-Pro')
    this.maxInputChars = Number(options.maxInputChars || 12000)
    if (!this.client) throw new Error('LlmFieldExtractor requires a client')
  }

  async extract({ article = {}, contentText = '' } = {}) {
    const system = '\u4f60\u662f\u4e00\u4e2a\u4e25\u683c\u7684\u7ed3\u6784\u5316\u4fe1\u606f\u62bd\u53d6\u5668\uff0c\u53ea\u8f93\u51fa JSON\u3002'
    const completion = await this.client.createJsonCompletion({
      system,
      prompt: buildPrompt({ article, contentText, maxInputChars: this.maxInputChars })
    })
    const parsed = extractJsonObject(completion.text)
    const fields = {}
    for (const field of LLM_FIELD_NAMES) {
      fields[field] = hasEvidence(parsed.evidence, field)
        ? normalizeExtractionList(parsed[field])
        : []
    }
    return {
      fields,
      confidence: Number(parsed.confidence || 0),
      evidence: parsed.evidence || {},
      parsed,
      rawText: completion.text,
      model: completion.model || this.model
    }
  }
}

module.exports = {
  LLM_FIELD_NAMES,
  LLM_TEXT_FIELD_NAMES,
  LLM_JSON_ARRAY_FIELD_NAMES,
  LlmFieldExtractor,
  buildPrompt,
  extractJsonObject,
  normalizeExtractionList
}
