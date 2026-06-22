/**
 * 服务商定义配置管理
 * 管理内置和自定义服务商的定义
 */

const { SERVICE_PROVIDERS } = require('../utils/constants')

const BUILTIN_PROVIDER_MODELS = {
  kimi: ['kimi-for-coding'],
  deepseek: ['DeepSeek-V4-Pro']
}

function normalizeModelIds(modelIds) {
  if (!Array.isArray(modelIds)) return []

  const normalized = []
  const seen = new Set()

  for (const modelId of modelIds) {
    const value = typeof modelId === 'string' ? modelId.trim() : ''
    if (!value || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
}

function normalizeProviderModelMapping(mapping) {
  if (!mapping || typeof mapping !== 'object') return null

  const normalized = {}

  for (const tier of ['opus', 'sonnet', 'haiku']) {
    const value = typeof mapping[tier] === 'string' ? mapping[tier].trim() : ''
    if (value) {
      normalized[tier] = value
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

function normalizeProviderDefinition(definition) {
  const providerId = typeof definition?.id === 'string' ? definition.id.trim() : ''
  const builtinModels = BUILTIN_PROVIDER_MODELS[providerId] || []
  const isBuiltin = Object.prototype.hasOwnProperty.call(SERVICE_PROVIDERS, providerId)
  const defaultModels = isBuiltin
    ? normalizeModelIds(builtinModels)
    : normalizeModelIds(definition?.defaultModels || builtinModels)

  return {
    id: providerId,
    name: definition?.name || providerId,
    baseUrl: definition?.baseUrl || '',
    defaultModelMapping: normalizeProviderModelMapping(definition?.defaultModelMapping),
    defaultModels,
    isCustom: definition?.isCustom || false,
    // 所有服务商默认禁用，需用户手动启用
    enabled: isBuiltin && providerId === 'kimi' ? definition?.enabled !== false : definition?.enabled === true
  }
}

/**
 * 初始化默认服务商定义
 * @returns {Array} 默认服务商列表
 */
function getDefaultProviders() {
  return Object.keys(SERVICE_PROVIDERS).map(id => normalizeProviderDefinition({
    id,
    name: SERVICE_PROVIDERS[id].label,
    baseUrl: SERVICE_PROVIDERS[id].baseUrl || '',
    defaultModelMapping: null,
    defaultModels: BUILTIN_PROVIDER_MODELS[id] || [],
    enabled: id === 'kimi'
  }))
}

/**
 * 服务商配置管理 mixin
 * 提供服务商相关的方法，需要绑定到 ConfigManager 实例
 */
const providerConfigMixin = {
  /**
   * 获取服务商枚举定义（用于下拉框）
   */
  getServiceProviders() {
    const definitions = this.getServiceProviderDefinitions()
    const providers = {}

    definitions.forEach(def => {
      providers[def.id] = {
        label: def.name,
        baseUrl: def.baseUrl,
        defaultModelMapping: def.defaultModelMapping,
        defaultModels: normalizeModelIds(def.defaultModels)
      }
    })

    return providers
  },

  /**
   * 获取所有服务商定义（从配置文件加载，如果为空则初始化默认值）
   */
  getServiceProviderDefinitions() {
    const existingDefinitions = Array.isArray(this.config.serviceProviderDefinitions)
      ? this.config.serviceProviderDefinitions
      : []

    const definitionMap = new Map()

    for (const definition of existingDefinitions) {
      const normalized = normalizeProviderDefinition({
        ...definition
      })
      definitionMap.set(normalized.id, normalized)
    }

    // 确保所有内置服务商都存在（默认启用）
    for (const id of Object.keys(SERVICE_PROVIDERS)) {
      if (!definitionMap.has(id)) {
        definitionMap.set(id, normalizeProviderDefinition({
          id,
          name: SERVICE_PROVIDERS[id].label,
          baseUrl: SERVICE_PROVIDERS[id].baseUrl || '',
          defaultModelMapping: null,
          defaultModels: BUILTIN_PROVIDER_MODELS[id] || [],
          enabled: id === 'kimi'
        }))
      }
    }

    for (const profile of Array.isArray(this.config.apiProfiles) ? this.config.apiProfiles : []) {
      const providerId = typeof profile?.serviceProvider === 'string' ? profile.serviceProvider.trim() : ''
      if (!providerId || definitionMap.has(providerId)) continue

      definitionMap.set(providerId, normalizeProviderDefinition({
        id: providerId,
        name: providerId,
        baseUrl: '',
        defaultModelMapping: null,
        defaultModels: []
      }))
    }

    const normalizedDefinitions = Array.from(definitionMap.values())
    const hasChanged = JSON.stringify(normalizedDefinitions) !== JSON.stringify(existingDefinitions)

    if (hasChanged || existingDefinitions.length === 0) {
      this.config.serviceProviderDefinitions = normalizedDefinitions
      this.save()
    }

    return normalizedDefinitions
  },

  /**
   * 获取单个服务商定义
   */
  getServiceProviderDefinition(id) {
    const provider = this.config.serviceProviderDefinitions?.find(p => p.id === id)
    return provider || null
  },

  /**
   * 添加自定义服务商定义
   */
  addServiceProviderDefinition(definition) {
    if (!this.config.serviceProviderDefinitions) {
      this.config.serviceProviderDefinitions = []
    }

    // 检查 ID 是否已存在
    const existingIndex = this.config.serviceProviderDefinitions.findIndex(
      p => p.id === definition.id
    )
    if (existingIndex !== -1) {
      throw new Error(`服务商 ID "${definition.id}" 已存在`)
    }

    // 创建新的服务商定义
    const newProvider = {
      ...normalizeProviderDefinition(definition),
      createdAt: new Date().toISOString()
    }

    this.config.serviceProviderDefinitions.push(newProvider)
    this.save()

    return newProvider
  },

  /**
   * 更新服务商定义
   */
  updateServiceProviderDefinition(id, updates) {
    if (!this.config.serviceProviderDefinitions) {
      console.log('[updateServiceProviderDefinition] serviceProviderDefinitions is null')
      return false
    }

    const index = this.config.serviceProviderDefinitions.findIndex(p => p.id === id)
    if (index === -1) {
      console.log('[updateServiceProviderDefinition] provider not found:', id)
      return false
    }

    // 不允许修改 ID
    const { id: newId, ...safeUpdates } = updates
    console.log('[updateServiceProviderDefinition] updating provider:', id, 'with:', safeUpdates)
    console.log('[updateServiceProviderDefinition] before:', JSON.stringify(this.config.serviceProviderDefinitions[index]))

    // 更新定义：直接替换整个对象，确保所有字段都被正确保留
    const nextDefinition = normalizeProviderDefinition({
      ...this.config.serviceProviderDefinitions[index],
      ...safeUpdates
    })
    this.config.serviceProviderDefinitions[index] = nextDefinition

    console.log('[updateServiceProviderDefinition] after:', JSON.stringify(this.config.serviceProviderDefinitions[index]))
    console.log('[updateServiceProviderDefinition] config serviceProviderDefinitions:', JSON.stringify(this.config.serviceProviderDefinitions.map(p => ({ id: p.id, enabled: p.enabled }))))

    return this.save()
  },

  /**
   * 删除服务商定义（级联删除关联的 Profile）
   */
  deleteServiceProviderDefinition(id) {
    if (!this.config.serviceProviderDefinitions) {
      return false
    }

    const index = this.config.serviceProviderDefinitions.findIndex(p => p.id === id)
    if (index === -1) {
      return false
    }

    // 级联删除所有使用该服务商的 Profile
    const profilesUsingProvider = this.config.apiProfiles?.filter(
      profile => profile.serviceProvider === id
    )

    if (profilesUsingProvider && profilesUsingProvider.length > 0) {
      for (const profile of profilesUsingProvider) {
        this.deleteAPIProfile(profile.id)
      }
    }

    // 删除服务商定义
    this.config.serviceProviderDefinitions.splice(index, 1)

    return this.save()
  }
}

module.exports = {
  getDefaultProviders,
  normalizeModelIds,
  providerConfigMixin
}
