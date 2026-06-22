function compact(value) {
  return String(value == null ? '' : value).trim()
}

function findValue(object, names) {
  if (!object || typeof object !== 'object') return ''
  for (const name of names) {
    if (object[name] !== undefined) return compact(object[name])
  }
  return ''
}

function normalizeModelName(value) {
  const model = compact(value)
  const normalized = model.toLowerCase()
  if (model === 'DeepSeek-V4-Pro' || model === 'DeepSeek-V4-Flash') return model
  if (!normalized || normalized === 'deepseek' || normalized === 'deepseek-v4-pro') return 'deepseek-v4-pro'
  if (normalized === 'deepseek-v4-flash') return 'deepseek-v4-flash'
  return model
}

function normalizeDeepSeekConfig(config = {}) {
  const source = config.DeepSeek || config.deepseek || config.deepSeek || config
  const baseUrl = findValue(source, ['baseUrl', 'baseURL', 'url']) || compact(process.env.DEEPSEEK_BASE_URL)
  const apiKey = findValue(source, ['apiKey', 'apiKey ', 'authToken', 'token', 'key']) || compact(process.env.DEEPSEEK_API_KEY)
  const model = normalizeModelName(findValue(source, ['model', 'modelId']) || compact(process.env.DEEPSEEK_MODEL))
  const authType = findValue(source, ['authType']) || (baseUrl.toLowerCase().includes('anthropic') ? 'x-api-key' : 'bearer')
  return {
    baseUrl,
    apiKey,
    model,
    authType,
    timeoutMs: Number(source.timeoutMs || source.timeout || process.env.DEEPSEEK_TIMEOUT_MS || 60000),
    maxTokens: Number(source.maxTokens || source.max_tokens || process.env.DEEPSEEK_MAX_TOKENS || 2048),
    temperature: Number(source.temperature ?? process.env.DEEPSEEK_TEMPERATURE ?? 0)
  }
}

function buildMessagesUrl(baseUrl) {
  const trimmed = compact(baseUrl).replace(/\/+$/, '')
  if (/\/v1\/messages$/i.test(trimmed)) return trimmed
  return `${trimmed}/v1/messages`
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.text === 'string') return payload.text
  if (Array.isArray(payload.content)) {
    return payload.content
      .map(part => typeof part === 'string' ? part : part?.text)
      .filter(Boolean)
      .join('\n')
      .trim()
  }
  const choice = payload.choices?.[0]
  if (choice?.message?.content) return compact(choice.message.content)
  if (choice?.text) return compact(choice.text)
  return ''
}

class DeepSeekClient {
  constructor(options = {}) {
    this.baseUrl = compact(options.baseUrl)
    this.apiKey = compact(options.apiKey)
    this.model = compact(options.model) || 'DeepSeek-V4-Pro'
    this.authType = compact(options.authType) || (this.baseUrl.toLowerCase().includes('anthropic') ? 'x-api-key' : 'bearer')
    this.timeoutMs = Number(options.timeoutMs || 60000)
    this.maxTokens = Number(options.maxTokens || 2048)
    this.temperature = Number(options.temperature ?? 0)
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    if (!this.fetchImpl) throw new Error('No fetch implementation available for DeepSeekClient')
    if (!this.baseUrl || !this.apiKey) throw new Error('DeepSeekClient requires baseUrl and apiKey')
  }

  buildHeaders() {
    const headers = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01'
    }
    if (this.authType === 'x-api-key') {
      headers['x-api-key'] = this.apiKey
    } else {
      headers.authorization = `Bearer ${this.apiKey}`
    }
    return headers
  }

  async createJsonCompletion({ system = '', prompt = '', maxTokens, temperature } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(buildMessagesUrl(this.baseUrl), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: this.model,
          max_tokens: Number(maxTokens || this.maxTokens),
          temperature: Number(temperature ?? this.temperature),
          system,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      })
      const body = await response.text()
      if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${body.slice(0, 300)}`)
      return {
        text: extractResponseText(JSON.parse(body)),
        raw: body,
        model: this.model
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

module.exports = {
  DeepSeekClient,
  buildMessagesUrl,
  extractResponseText,
  normalizeDeepSeekConfig
}
