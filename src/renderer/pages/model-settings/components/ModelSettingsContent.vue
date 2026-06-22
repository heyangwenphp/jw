<template>
  <div class="model-settings">
    <div class="header">
      <h1>{{ t('modelSettings.title') }}</h1>
    </div>

    <div class="content-layout">
      <div class="left-panel">
        <div class="panel-header">
          <span class="panel-title">{{ t('modelSettings.providers') }}</span>
          <button class="add-provider-btn" @click="showAddProviderModal = true">
            <Icon name="plus" :size="16" />
          </button>
        </div>

        <div class="provider-list">
          <div
            v-for="provider in providers"
            :key="provider.id"
            class="provider-item"
            :class="{ active: selectedProviderId === provider.id }"
            @click="selectProvider(provider.id)"
          >
            <div class="provider-icon" v-html="getProviderIcon(provider.id)"></div>
            <span class="provider-name">{{ provider.name }}</span>
            <n-switch
              :value="provider.enabled"
              @click.stop
              @update:value="toggleProvider(provider.id, $event)"
            />
            <button
              class="delete-provider-btn-left"
              :title="t('common.delete')"
              @click.stop="handleDeleteProviderFromLeft(provider)"
            >
              <Icon name="trash" :size="14" />
            </button>
          </div>
        </div>
      </div>

      <div class="right-panel" v-if="selectedProvider">
        <div class="settings-content">
          <div class="form-item">
            <div class="form-label">
              <span>API Key</span>
            </div>
            <div class="input-wrapper">
              <input
                :type="showApiKey ? 'text' : 'password'"
                v-model="editingProfile.authToken"
                :placeholder="t('modelSettings.apiKeyPlaceholder')"
              />
              <button class="input-icon-btn" @click="toggleApiKeyVisibility">
                <Icon :name="showApiKey ? 'eyeOff' : 'eye'" :size="18" />
              </button>
            </div>
          </div>

          <div class="form-item">
            <div class="form-label">API Base URL</div>
            <div class="input-wrapper">
              <input
                type="text"
                v-model="editingProfile.baseUrl"
                :placeholder="t('modelSettings.baseUrlPlaceholder')"
              />
              <button class="input-icon-btn" @click="clearBaseUrl" v-if="editingProfile.baseUrl">
                <Icon name="close" :size="16" />
              </button>
            </div>
          </div>

          <button class="test-btn" @click="testConnection" :disabled="testing">
            <Icon name="zap" :size="16" />
            {{ testing ? t('common.connecting') : t('modelSettings.testConnection') }}
          </button>

          <div class="model-list-section">
            <div class="section-header">
              <span>{{ t('modelSettings.availableModels') }}</span>
              <button class="add-btn" @click="handleAddModel">
                <Icon name="plus" :size="16" />
                {{ t('modelSettings.addModel') }}
              </button>
            </div>
            <div class="model-list">
              <div
                v-for="model in availableModels"
                :key="model.id"
                class="model-item"
                :class="{ active: editingProfile.selectedModelId === model.id }"
                @click="selectModel(model.id)"
              >
                <div class="model-status">
                  <div
                    v-if="editingProfile.selectedModelId === model.id"
                    class="model-status-dot selected"
                  ></div>
                  <div v-else class="model-status-dot"></div>
                </div>
                <div class="model-info">
                  <div class="model-name">{{ model.name }}</div>
                  <div class="model-id">{{ model.id }}</div>
                </div>
                <button class="delete-model-btn" @click.stop="handleDeleteModel(model.id)">
                  <Icon name="close" :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-footer">
          <button class="footer-btn cancel-btn" @click="handleCancel">{{ t('common.cancel') }}</button>
          <button class="footer-btn save-btn" @click="handleSave">{{ t('common.save') }}</button>
        </div>
      </div>

      <div class="right-panel empty-panel" v-else>
        <div class="empty-content">
          <Icon name="settings" :size="48" />
          <p>{{ t('modelSettings.selectProviderHint') }}</p>
        </div>
      </div>
    </div>

    <n-modal
      v-model:show="showAddModelModal"
      preset="card"
      title="添加模型"
      style="width: 500px; max-width: 95vw;"
      :mask-closable="false"
    >
      <n-form :model="addModelForm" label-placement="top">
        <n-form-item label="模型 ID">
          <n-input
            v-model:value="addModelForm.id"
            placeholder="例如: claude-3-sonnet-20240229"
          />
        </n-form-item>
        <n-form-item label="模型名称 (可选)">
          <n-input
            v-model:value="addModelForm.name"
            placeholder="留空则自动生成显示名称"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAddModelModal = false">取消</n-button>
          <n-button type="primary" @click="confirmAddModel">添加</n-button>
        </n-space>
      </template>
    </n-modal>

    <n-modal
      v-model:show="showAddProviderModal"
      preset="card"
      title="添加第三方提供商"
      style="width: 500px; max-width: 95vw;"
      :mask-closable="false"
    >
      <n-form :model="addProviderForm" label-placement="top">
        <n-form-item label="提供商名称">
          <n-input
            v-model:value="addProviderForm.name"
            placeholder="例如: 我的自定义提供商"
          />
        </n-form-item>
        <n-form-item label="API Base URL">
          <n-input
            v-model:value="addProviderForm.baseUrl"
            placeholder="例如: https://api.example.com/v1"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showAddProviderModal = false">取消</n-button>
          <n-button type="primary" @click="confirmAddProvider">添加</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { useProfiles } from '@composables/useProfiles'
import { useProviders } from '@composables/useProviders'
import { useLocale } from '@composables/useLocale'
import Icon from '@components/icons/Icon.vue'

console.log('[ModelSettingsContent] Loading...')

const message = useMessage()
const dialog = useDialog()
const { t, initLocale } = useLocale()
const { profiles, loadProfiles, addProfile, updateProfile, testConnection: testProfileConnection } = useProfiles()
const { providers, loadProviders, updateProvider } = useProviders()

const selectedProviderId = ref(null)
const testing = ref(false)
const showApiKey = ref(false)
const showAddModelModal = ref(false)

const addModelForm = reactive({
  id: '',
  name: ''
})

const showAddProviderModal = ref(false)
const addProviderForm = reactive({
  name: '',
  baseUrl: ''
})

const editingProfile = reactive({
  id: '',
  name: '',
  icon: '',
  serviceProvider: '',
  authToken: '',
  baseUrl: '',
  selectedModelId: ''
})

const customModels = reactive({})

const selectedProvider = computed(() => {
  return providers.value.find(p => p.id === selectedProviderId.value)
})

const availableModels = computed(() => {
  if (!selectedProvider.value) return []
  const defaultModels = selectedProvider.value.defaultModels || []
  const customList = customModels[selectedProviderId.value] || []
  const allModelIds = [...new Set([...defaultModels, ...customList])]
  return allModelIds.map(modelId => ({
    id: modelId,
    name: formatModelName(modelId),
    isCustom: customList.includes(modelId)
  }))
})

const formatModelName = (modelId) => {
  const nameMap = {
    'kimi-for-coding': 'KIMI for Coding',
    'deepseek-chat': 'DeepSeek Chat',
    'deepseek-coder': 'DeepSeek Coder',
    'deepseek-reasoner': 'DeepSeek Reasoner',
    'moonshot-v1-8k': 'Moonshot V1 8K',
    'moonshot-v1-32k': 'Moonshot V1 32K',
    'moonshot-v1-128k': 'Moonshot V1 128K',
    'qwen-plus': 'Qwen Plus',
    'qwen-turbo': 'Qwen Turbo',
    'qwen-max': 'Qwen Max',
    'glm-4': 'GLM-4',
    'glm-4-flash': 'GLM-4 Flash',
    'glm-4-plus': 'GLM-4 Plus',
    'abab6.5s-chat': 'ABAB 6.5S Chat',
    'abab7-chat': 'ABAB 7 Chat',
    'minimax-text-01': 'MiniMax Text 01',
    'doubao-pro-32k': 'Doubao Pro 32K',
    'doubao-lite-32k': 'Doubao Lite 32K',
    'doubao-pro-128k': 'Doubao Pro 128K',
    'ernie-4.0': 'ERNIE 4.0',
    'ernie-3.5': 'ERNIE 3.5',
    'ernie-lite': 'ERNIE Lite',
    'step-1-8k': 'Step 1 8K',
    'step-1-32k': 'Step 1 32K',
    'step-2': 'Step 2'
  }
  return nameMap[modelId] || modelId
}

const getProviderIcon = (providerId) => {
  const colorMap = {
    'deepseek': '#00ACC1',
    'moonshot': '#7C4DFF',
    'qwen': '#FF6D00',
    'zhipu': '#00BFA5',
    'minimax': '#FF4081',
    'volcengine': '#F57C00',
    'youdao': '#5C6BC0',
    'qianfan': '#00BCD4',
    'kimi': '#0369A1',
    'stepfun': '#AB47BC',
    'openai': '#10B981',
    'anthropic': '#FF5722'
  }
  const color = colorMap[providerId] || '#888888'
  return `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background-color:${color}"></span>`
}

const selectProvider = (providerId) => {
  selectedProviderId.value = providerId

  const existingProfile = profiles.value.find(p => p.serviceProvider === providerId)
  const provider = providers.value.find(p => p.id === providerId)

  // 加载提供商的自定义模型
  if (provider && provider.defaultModels && provider.defaultModels.length > 0) {
    customModels[providerId] = [...provider.defaultModels]
  }

  if (existingProfile) {
    editingProfile.id = existingProfile.id
    editingProfile.name = existingProfile.name
    editingProfile.icon = existingProfile.icon
    editingProfile.serviceProvider = existingProfile.serviceProvider
    editingProfile.authToken = existingProfile.authToken || ''
    editingProfile.baseUrl = existingProfile.baseUrl || provider?.baseUrl || ''
    editingProfile.selectedModelId = existingProfile.selectedModelId || ''
  } else {
    editingProfile.id = ''
    editingProfile.name = provider?.name || providerId
    editingProfile.icon = ''  // 图标由模型设置页面单独渲染，不保存HTML到profile
    editingProfile.serviceProvider = providerId
    editingProfile.authToken = ''
    editingProfile.baseUrl = provider?.baseUrl || ''
    editingProfile.selectedModelId = ''
  }
}

const toggleProvider = async (providerId, enabled) => {
  console.log('[toggleProvider] called:', providerId, enabled)
  const provider = providers.value.find(p => p.id === providerId)
  if (provider) {
    provider.enabled = enabled
    try {
      const result = await window.electronAPI.updateProvider({
        id: providerId,
        updates: { enabled }
      })
      console.log('[toggleProvider] IPC result:', result)
    } catch (err) {
      console.error('[toggleProvider] IPC error:', err)
      message.error('保存失败: ' + err.message)
    }
  }
}

const toggleApiKeyVisibility = () => {
  showApiKey.value = !showApiKey.value
}

const clearBaseUrl = () => {
  editingProfile.baseUrl = ''
}

const testConnection = async () => {
  if (!editingProfile.authToken) {
    message.warning(t('modelSettings.apiKeyRequired'))
    return
  }

  testing.value = true
  try {
    const config = {
      baseUrl: editingProfile.baseUrl,
      authToken: editingProfile.authToken,
      authType: 'bearer',
      serviceProvider: editingProfile.serviceProvider,
      selectedModelId: editingProfile.selectedModelId || ''
    }

    const result = await testProfileConnection(config)
    if (result.success) {
      message.success(t('modelSettings.testSuccess'))
    } else {
      message.error(t('modelSettings.testFailed') + ': ' + result.message)
    }
  } catch (err) {
    message.error(t('modelSettings.testFailed') + ': ' + err.message)
  } finally {
    testing.value = false
  }
}

const handleSave = async () => {
  try {
    // 如果提供商已启用，检查是否设置了 API Key 和可用模型
    if (selectedProvider.value?.enabled) {
      if (!editingProfile.authToken.trim()) {
        message.warning(t('modelSettings.apiKeyRequired'))
        return
      }
      if (availableModels.value.length === 0) {
        message.warning(t('modelSettings.modelsRequired'))
        return
      }
    }

    if (editingProfile.id) {
      await updateProfile(editingProfile.id, {
        name: editingProfile.name,
        icon: editingProfile.icon,
        serviceProvider: editingProfile.serviceProvider,
        authToken: editingProfile.authToken,
        baseUrl: editingProfile.baseUrl,
        selectedModelId: editingProfile.selectedModelId
      })
    } else {
      const newProfile = await addProfile({
        name: editingProfile.name,
        icon: editingProfile.icon,
        serviceProvider: editingProfile.serviceProvider,
        authToken: editingProfile.authToken,
        baseUrl: editingProfile.baseUrl,
        selectedModelId: editingProfile.selectedModelId
      })
      editingProfile.id = newProfile.id
    }

    // 保存自定义模型到提供商定义
    const customList = customModels[selectedProviderId.value] || []
    if (customList.length > 0) {
      await window.electronAPI.updateProvider({
        id: selectedProviderId.value,
        updates: { defaultModels: JSON.parse(JSON.stringify(customList)) }
      })
    }

    message.success(t('modelSettings.saveSuccess'))
  } catch (err) {
    console.error('[ModelSettings] Save error:', err)
    message.error(t('messages.saveFailed') + ': ' + err.message)
  }
  window.close()
}

const handleCancel = () => {
  window.close()
}

const handleImport = () => {
  message.info(t('modelSettings.importFeature'))
}

const handleExport = () => {
  message.info(t('modelSettings.exportFeature'))
}

const handleAddModel = () => {
  addModelForm.id = ''
  addModelForm.name = ''
  showAddModelModal.value = true
}

const confirmAddModel = () => {
  const modelId = addModelForm.id.trim()
  if (!modelId) {
    message.warning('请输入模型 ID')
    return
  }

  if (!customModels[selectedProviderId.value]) {
    customModels[selectedProviderId.value] = []
  }

  if (!customModels[selectedProviderId.value].includes(modelId)) {
    customModels[selectedProviderId.value].push(modelId)
    message.success('模型已添加')
  } else {
    message.warning('该模型已存在')
  }

  showAddModelModal.value = false
}

const confirmAddProvider = async () => {
  const name = addProviderForm.name.trim()
  if (!name) {
    message.warning('请输入提供商名称')
    return
  }

  try {
    const id = 'custom_' + Date.now()
    const newProvider = {
      id,
      name,
      baseUrl: addProviderForm.baseUrl.trim(),
      enabled: true,
      isCustom: true,
      defaultModels: []
    }

    await window.electronAPI.addProvider(newProvider)
    await loadProviders()
    message.success('第三方提供商已添加')
    showAddProviderModal.value = false
    selectProvider(id)
  } catch (err) {
    console.error('Failed to add provider:', err)
    message.error('添加失败: ' + err.message)
  }
}

const handleDeleteModel = (modelId) => {
  dialog.warning({
    title: t('common.confirmDelete'),
    content: `确定要删除模型 "${modelId}" 吗？`,
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      let deleted = false

      // 1. 从本地 customModels 中删除
      const customList = customModels[selectedProviderId.value] || []
      const customIndex = customList.indexOf(modelId)
      if (customIndex > -1) {
        customList.splice(customIndex, 1)
        deleted = true
      }

      // 2. 从 provider 定义的 defaultModels 中删除并持久化
      const provider = providers.value.find(p => p.id === selectedProviderId.value)
      if (provider) {
        const defaultModels = provider.defaultModels || []
        const defaultIndex = defaultModels.indexOf(modelId)
        if (defaultIndex > -1) {
          const nextDefaultModels = [...defaultModels]
          nextDefaultModels.splice(defaultIndex, 1)
          await window.electronAPI.updateProvider({
            id: selectedProviderId.value,
            updates: { defaultModels: nextDefaultModels }
          })
          deleted = true
        }
      }

      if (editingProfile.selectedModelId === modelId) {
        editingProfile.selectedModelId = ''
      }

      if (deleted) {
        message.success(t('common.deleteSuccess'))
        await loadProviders()
      } else {
        message.error(t('common.deleteFailed'))
      }
    }
  })
}

const handleDeleteProviderFromLeft = async (provider) => {
  if (!provider) return

  dialog.warning({
    title: t('common.confirmDelete'),
    content: `确定要删除提供商 "${provider.name}" 吗？`,
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        await window.electronAPI.deleteProvider(provider.id)
        message.success(t('common.deleteSuccess'))

        // 如果删除的是当前选中的提供商，自动切换选中项
        if (selectedProviderId.value === provider.id) {
          const remaining = providers.value.filter(p => p.id !== provider.id)
          if (remaining.length > 0) {
            selectProvider(remaining[0].id)
          } else {
            selectedProviderId.value = null
          }
        }

        await loadProviders()
      } catch (err) {
        console.error('[ModelSettings] deleteProvider error:', err)
        message.error(t('common.deleteFailed') + ': ' + err.message)
      }
    }
  })
}

const selectModel = (modelId) => {
  editingProfile.selectedModelId = modelId
}

const handleClose = () => {
  window.close()
}

onMounted(async () => {
  console.log('[ModelSettingsContent] Mounted')
  await initLocale()
  await Promise.all([loadProfiles(), loadProviders()])

  if (providers.value.length > 0) {
    selectProvider(providers.value[0].id)
  }

  console.log('[ModelSettingsContent] Load complete')
})
</script>

<style scoped>
.model-settings {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--bg-color);
  color: var(--text-color);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  border-bottom: 1px solid var(--border-color);
}

.header h1 {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--text-color);
}

.close-btn:hover {
  background-color: var(--bg-color-tertiary);
}

.content-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.left-panel {
  width: 360px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  background-color: var(--bg-color-secondary);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.panel-title {
  font-size: 16px;
  font-weight: 500;
}

.panel-actions {
  display: flex;
  gap: 8px;
}

.add-provider-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: #fff;
  transition: background-color 0.2s;
}

.add-provider-btn:hover {
  background: var(--primary-color-hover);
}

.action-btn {
  padding: 6px 12px;
  background-color: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  color: var(--text-color);
}

.action-btn:hover {
  background-color: var(--bg-color-tertiary);
}

.provider-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.provider-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background-color 0.2s;
}

.provider-item:hover {
  background-color: var(--bg-color-tertiary);
}

.provider-item.active {
  background-color: var(--primary-ghost);
}

.provider-item:not(.active) {
  opacity: 0.6;
}

.provider-icon {
  width: 32px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.provider-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
}

.provider-icon-img {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.provider-name {
  flex: 1;
  font-size: 15px;
  font-weight: 500;
}

.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}


.delete-provider-btn-left {
  opacity: 0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-color-3);
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.provider-item:hover .delete-provider-btn-left {
  opacity: 1;
}

.delete-provider-btn-left:hover {
  color: #dc2626;
  background-color: #fee2e2;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.form-item {
  margin-bottom: 24px;
}

.form-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 15px;
  font-weight: 500;
  margin-bottom: 10px;
}

.link {
  color: var(--primary-color);
  text-decoration: none;
  font-size: 14px;
}

.link:hover {
  text-decoration: underline;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-wrapper input {
  width: 100%;
  padding: 12px 16px;
  padding-right: 44px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  font-size: 15px;
  background-color: var(--bg-color-tertiary);
  color: var(--text-color);
}

.input-wrapper input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.input-icon-btn {
  position: absolute;
  right: 12px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  opacity: 0.6;
}

.input-icon-btn:hover {
  opacity: 1;
}

.radio-group {
  display: flex;
  gap: 24px;
}

.radio-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 15px;
}

.radio-item input {
  width: 18px;
  height: 18px;
}

.form-hint {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-color-secondary);
}

.test-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background-color: var(--bg-color-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-color);
}

.test-btn:hover:not(:disabled) {
  background-color: var(--bg-color-secondary);
}

.test-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.model-list-section {
  margin-top: 32px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  font-size: 15px;
  font-weight: 500;
}

.add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: none;
  border: none;
  color: var(--primary-color);
  cursor: pointer;
  font-size: 14px;
}

.add-btn:hover {
  text-decoration: underline;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background-color: var(--bg-color-secondary);
  border-radius: 12px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.model-item:hover {
  background-color: var(--bg-color-tertiary);
}

.model-item.active {
  background-color: var(--primary-ghost);
}

.model-status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
}

.model-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #d1d5db;
}

.model-status-dot.selected {
  background-color: #10b981;
}

.model-info {
  flex: 1;
}

.model-name {
  font-size: 15px;
  font-weight: 500;
}

.model-id {
  font-size: 13px;
  color: var(--text-color-secondary);
  margin-top: 2px;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color);
}

.footer-btn {
  padding: 12px 28px;
  border-radius: 12px;
  font-size: 15px;
  cursor: pointer;
  border: none;
}

.cancel-btn {
  background-color: var(--bg-color-tertiary);
  color: var(--text-color);
}

.save-btn {
  background-color: var(--primary-color);
  color: white;
}

.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-content {
  text-align: center;
  color: var(--text-color-secondary);
}
</style>
