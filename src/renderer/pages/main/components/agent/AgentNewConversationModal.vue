<template>
  <n-modal
    :show="show"
    preset="card"
    :title="t('agent.newConversationTitle')"
    style="width: 480px;"
    @update:show="$emit('update:show', $event)"
  >
    <!-- 模型选择 -->
    <div class="model-section">
      <div class="section-label">模型</div>
      <n-select
        v-model:value="selectedModelId"
        :options="modelOptions"
        :render-label="renderLabel"
        :menu-props="{ class: 'model-select-menu' }"
        size="small"
      />
    </div>

    <template #footer>
      <div class="modal-footer">
        <n-button @click="$emit('update:show', false)">{{ t('common.cancel') }}</n-button>
        <n-button type="primary" @click="handleCreate">{{ t('agent.create') }}</n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch, h } from 'vue'
import { NModal, NInput, NButton, NSelect } from 'naive-ui'
import { useLocale } from '@composables/useLocale'
import Icon from '@components/icons/Icon.vue'

const { t } = useLocale()

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:show', 'create'])

const selectedCwd = ref(null)
const recentDirectories = ref([])
const modelOptions = ref([])
const selectedModelId = ref(null)

const MAX_RECENT_DIRECTORIES = 10

// 最多显示 10 个最近目录
const displayDirectories = computed(() => {
  return recentDirectories.value.slice(0, MAX_RECENT_DIRECTORIES)
})

// 每次打开时重置选择并检查目录存在性
watch(() => props.show, async (newVal) => {
  if (newVal) {
    selectedCwd.value = null
    selectedModelId.value = null
    await Promise.all([
      loadModelOptions(),
      loadRecentDirectories()
    ])
  }
})

// Provider color map
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
  'anthropic': '#FF5722',
  'other': '#888888',
  'official': '#FF5722'
}

const loadModelOptions = async () => {
  if (!window.electronAPI?.getConfig) {
    modelOptions.value = []
    return
  }

  try {
    const config = await window.electronAPI.getConfig()
    const definitions = config.serviceProviderDefinitions || []

    const options = []
    const seen = new Set()

    for (const def of definitions) {
      // Skip disabled providers
      if (def.enabled === false) continue

      const models = def.defaultModels || []
      for (const modelId of models) {
        if (seen.has(modelId)) continue
        seen.add(modelId)
        options.push({
          label: modelId,
          value: modelId,
          color: colorMap[def.id] || '#888888',
          providerName: def.name || def.id
        })
      }
    }

    modelOptions.value = options
  } catch {
    modelOptions.value = []
  }
}

const renderLabel = (option) => {
  return h('div', {
    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }
  }, [
    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, option.label),
    h('span', {
      style: {
        color: '#999',
        fontSize: '12px',
        marginLeft: '8px',
        flexShrink: 0
      }
    }, option.providerName || '')
  ])
}

const loadRecentDirectories = async () => {
  if (!window.electronAPI?.listAgentSessions) {
    recentDirectories.value = []
    return
  }

  try {
    const sessions = await window.electronAPI.listAgentSessions()
    const seen = new Set()
    const directories = []

    for (const session of Array.isArray(sessions) ? sessions : []) {
      const cwd = session?.cwd
      if (!cwd || seen.has(cwd) || session?.type === 'dingtalk') continue

      if (window.electronAPI?.checkPath) {
        try {
          const result = await window.electronAPI.checkPath(cwd)
          if (!result?.valid) continue
        } catch {
          continue
        }
      }

      seen.add(cwd)
      directories.push({
        id: cwd,
        name: cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() || cwd,
        path: cwd
      })

      if (directories.length >= MAX_RECENT_DIRECTORIES) {
        break
      }
    }

    recentDirectories.value = directories
  } catch {
    recentDirectories.value = []
  }
}

const browseFolder = async () => {
  if (!window.electronAPI) return
  const folderPath = await window.electronAPI.selectFolder()
  if (folderPath) {
    selectedCwd.value = folderPath
  }
}

const toggleDirectory = (directory) => {
  if (selectedCwd.value === directory.path) {
    selectedCwd.value = null
  } else {
    selectedCwd.value = directory.path
  }
}

const shortenPath = (fullPath) => {
  if (!fullPath) return ''
  const maxLen = 35
  if (fullPath.length <= maxLen) return fullPath
  // 保留开头盘符/根和末尾目录名
  const sep = fullPath.includes('\\') ? '\\' : '/'
  const parts = fullPath.split(sep)
  if (parts.length <= 3) return fullPath
  return parts[0] + sep + '...' + sep + parts.slice(-2).join(sep)
}

const handleCreate = () => {
  emit('create', {
    cwd: selectedCwd.value || null,
    modelId: selectedModelId.value || null
  })
}
</script>

<style scoped>
.cwd-section {
  margin-bottom: 16px;
}

.section-label {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
  color: var(--text-color);
}

.cwd-input-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.cwd-input-row .n-input {
  flex: 1;
  cursor: pointer;
}

.projects-section {
  margin-bottom: 8px;
}

.project-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background-color 0.15s;
  border-bottom: 1px solid var(--border-color);
}

.project-item:last-child {
  border-bottom: none;
}

.project-item:hover {
  background-color: var(--hover-color);
}

.project-item.selected {
  background-color: var(--primary-color-hover, rgba(var(--primary-color-rgb, 99, 102, 241), 0.1));
  outline: 1px solid var(--primary-color);
  outline-offset: -1px;
}

.project-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.project-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.project-path {
  font-size: 11px;
  color: var(--text-color-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  text-align: right;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.model-section {
  margin-bottom: 16px;
}
</style>

<style>
.model-select-menu .n-base-select-option__content {
  width: 100%;
  display: flex;
  align-items: center;
}
</style>
