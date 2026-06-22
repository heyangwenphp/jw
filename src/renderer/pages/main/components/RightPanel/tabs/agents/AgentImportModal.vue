<template>
  <n-modal v-model:show="visible" preset="card" :title="t('rightPanel.agents.importTitle')" style="width: 600px; max-width: 90vw;">
    <div class="import-modal-content">
      <div v-if="step === 1" class="import-step">
        <p class="step-title">{{ t('rightPanel.agents.importStep1') }}</p>
        <div class="source-buttons">
          <n-button size="large" @click="selectSource('files')">
            {{ t('rightPanel.agents.importFromFiles') }}
          </n-button>
          <n-button size="large" @click="selectSource('zip')">
            {{ t('rightPanel.agents.importFromZip') }}
          </n-button>
        </div>
        <input
          ref="filesInputRef"
          class="hidden-file-input"
          type="file"
          accept=".md,text/markdown"
          multiple
          @change="handleWebImportFiles('files', $event)"
        />
        <input
          ref="zipInputRef"
          class="hidden-file-input"
          type="file"
          accept=".zip,application/zip"
          @change="handleWebImportFiles('zip', $event)"
        />
        <p v-if="form.sourcePath" class="selected-source">
          {{ t('rightPanel.agents.selectedSource') }}: {{ form.sourcePath }}
        </p>
      </div>

      <div v-if="step === 2" class="import-step">
        <p class="step-title">{{ t('rightPanel.agents.importStep2') }}</p>
        <div v-if="validating" class="validating">
          <Icon name="clock" :size="16" class="loading-icon" /> {{ t('rightPanel.agents.validating') }}
        </div>
        <div v-else-if="validation">
          <div v-if="validation.errors?.length" class="validation-errors">
            <p class="validation-label error">{{ t('rightPanel.agents.validationErrors') }}:</p>
            <ul><li v-for="(err, i) in validation.errors" :key="i">{{ err }}</li></ul>
          </div>
          <div v-if="validation.valid && validation.agents?.length" class="validation-agents">
            <p class="validation-label success">{{ t('rightPanel.agents.foundAgents', { count: validation.agents.length }) }}:</p>
            <div class="agent-list-preview">
              <div v-for="agent in validation.agents" :key="agent.agentId" class="agent-preview-item">
                <span class="agent-color" :style="{ background: getAgentColor(agent.color) }"></span>
                <span class="agent-id">{{ agent.agentId }}</span>
                <span v-if="agent.name && agent.name !== agent.agentId" class="agent-name">({{ agent.name }})</span>
              </div>
            </div>

            <div class="target-section">
              <p class="section-label">{{ t('rightPanel.agents.importStep3') }}</p>
              <n-radio-group v-model:value="form.targetSource" class="target-radio-group">
                <n-radio value="user">{{ t('rightPanel.agents.importToUser') }}</n-radio>
                <n-radio v-if="currentProject" value="project">{{ t('rightPanel.agents.importToProject') }}</n-radio>
              </n-radio-group>
            </div>
          </div>
        </div>
      </div>

      <div v-if="step === 3" class="import-step">
        <p class="step-title">{{ t('rightPanel.agents.importResult') }}</p>

        <div v-if="importResult.imported?.length" class="result-section success">
          <p class="result-label">{{ t('rightPanel.agents.importedCount', { count: importResult.imported.length }) }}</p>
          <ul class="result-list">
            <li v-for="agent in importResult.imported" :key="agent.agentId">
              {{ agent.agentId }}
              <span v-if="agent.name && agent.name !== agent.agentId" class="agent-name">({{ agent.name }})</span>
            </li>
          </ul>
        </div>

        <div v-if="importResult.skipped?.length" class="result-section warning">
          <p class="result-label">{{ t('rightPanel.agents.skippedCount', { count: importResult.skipped.length }) }}</p>
          <ul class="result-list">
            <li v-for="agent in importResult.skipped" :key="agent.agentId">
              <span class="skip-id">{{ agent.agentId }}</span>
              <span class="skip-reason">{{ agent.reason }}</span>
            </li>
          </ul>
        </div>

        <div v-if="importResult.errors?.length" class="result-section error">
          <p class="result-label">{{ t('rightPanel.agents.errorCount', { count: importResult.errors.length }) }}</p>
          <ul class="result-list">
            <li v-for="(err, i) in importResult.errors" :key="i">
              {{ err.agentId }}: {{ err.error }}
            </li>
          </ul>
        </div>

        <div v-if="!importResult.imported?.length && !importResult.skipped?.length && !importResult.errors?.length" class="result-section info">
          <p class="result-label">{{ t('rightPanel.agents.noImportResult') }}</p>
        </div>
      </div>
    </div>
    <template #footer>
      <div style="display: flex; justify-content: space-between;">
        <n-button v-if="step === 2" @click="step = 1">{{ t('common.previous') }}</n-button>
        <span v-else></span>
        <div style="display: flex; gap: 12px;">
          <n-button @click="visible = false">{{ step === 3 ? t('common.close') : t('common.cancel') }}</n-button>
          <n-button v-if="step === 2 && validation?.valid" type="primary" @click="handleImport" :loading="importing">
            {{ t('rightPanel.agents.confirmImport') }}
          </n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NModal, NButton, NRadio, NRadioGroup, useMessage } from 'naive-ui'
import { useLocale } from '@composables/useLocale'
import { getAgentColor } from '@composables/constants'
import Icon from '@components/icons/Icon.vue'

const { t } = useLocale()
const message = useMessage()

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  currentProject: { type: Object, default: null },
  defaultTargetSource: { type: String, default: 'user' }
})

const emit = defineEmits(['update:modelValue', 'imported'])

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const step = ref(1)
const form = ref({
  sourcePath: '',
  sourceType: '',
  sourcePayload: null,
  sourceFiles: null,
  targetSource: 'user'
})
const validating = ref(false)
const validation = ref(null)
const importing = ref(false)
const importResult = ref({})
const filesInputRef = ref(null)
const zipInputRef = ref(null)

watch(visible, (val) => {
  if (val) {
    const targetSource = props.defaultTargetSource === 'project' && props.currentProject ? 'project' : 'user'
    step.value = 1
    form.value = {
      sourcePath: '',
      sourceType: '',
      sourcePayload: null,
      sourceFiles: null,
      targetSource
    }
    validation.value = null
    importResult.value = {}
  }
})

const fileToBase64 = async (file) => {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

const validateSelectedSource = async (sourceForValidation) => {
  step.value = 2
  validating.value = true
  try {
    const result = await window.electronAPI.validateAgentImport(sourceForValidation)
    validation.value = result
  } catch (err) {
    validation.value = { valid: false, errors: [err.message] }
  } finally {
    validating.value = false
  }
}

const handleWebImportFiles = async (type, event) => {
  try {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return

    let sourcePayload
    let label
    if (type === 'files') {
      const payloadFiles = await Promise.all(files.map(async file => ({
        relativePath: file.webkitRelativePath || file.name,
        fileName: file.name,
        dataBase64: await fileToBase64(file)
      })))
      label = payloadFiles.map(file => file.fileName || file.relativePath).join(', ')
      sourcePayload = { type: 'files', files: payloadFiles }
    } else {
      const file = files[0]
      label = file.name
      sourcePayload = {
        type: 'zip',
        fileName: file.name,
        dataBase64: await fileToBase64(file)
      }
    }

    form.value.sourcePath = label
    form.value.sourceType = type
    form.value.sourceFiles = null
    form.value.sourcePayload = sourcePayload
    await validateSelectedSource(sourcePayload)
  } catch (err) {
    message.error(err.message)
  } finally {
    event.target.value = ''
  }
}

const selectSource = async (type) => {
  try {
    if (window.electronAPI?.platform === 'web') {
      if (type === 'files') {
        filesInputRef.value?.click()
      } else {
        zipInputRef.value?.click()
      }
      return
    }

    let sourcePath
    if (type === 'files') {
      const files = await window.electronAPI.selectFiles({
        title: t('rightPanel.agents.importFromFiles'),
        filters: [{ name: 'Markdown Files', extensions: ['md'] }],
        multiSelections: true
      })
      if (!files || files.length === 0) return
      sourcePath = files
    } else {
      sourcePath = await window.electronAPI.selectFile({
        title: t('rightPanel.agents.importFromZip'),
        filters: [{ name: 'ZIP Files', extensions: ['zip'] }]
      })
    }
    if (!sourcePath) return

    form.value.sourcePath = Array.isArray(sourcePath) ? sourcePath.join(', ') : sourcePath
    form.value.sourceType = type
    form.value.sourceFiles = sourcePath
    form.value.sourcePayload = null
    await validateSelectedSource(sourcePath)
  } catch (err) {
    message.error(err.message)
  }
}

const handleImport = async () => {
  if (!validation.value?.agents?.length) {
    message.warning(t('rightPanel.agents.noAgentsSelected'))
    return
  }

  importing.value = true
  try {
    const sourcePayload = window.electronAPI?.platform === 'web'
      ? { source: form.value.sourcePayload }
      : { sourcePath: JSON.parse(JSON.stringify(form.value.sourceFiles)) }
    const result = await window.electronAPI.importAgents({
      ...sourcePayload,
      targetSource: form.value.targetSource,
      projectPath: props.currentProject?.path,
      selectedAgentIds: validation.value.agents.map(a => a.agentId)
    })

    importResult.value = result
    step.value = 3

    if (result.imported?.length > 0) {
      emit('imported')
    }
  } catch (err) {
    message.error(`${t('rightPanel.agents.importFailed')}: ${err.message}`)
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.import-modal-content {
  padding: 4px 0;
}

.import-step {
  padding: 8px 0;
}

.step-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 12px;
}

.source-buttons {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.source-buttons .n-button {
  flex: 1;
  height: 60px;
  font-size: 14px;
}

.hidden-file-input {
  display: none;
}

.selected-source {
  font-size: 12px;
  color: var(--text-color-muted);
  background: var(--hover-bg);
  padding: 8px 12px;
  border-radius: 4px;
  word-break: break-all;
}

.validating {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px;
  justify-content: center;
  color: var(--text-color-muted);
}

.loading-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.validation-errors,
.validation-agents {
  margin-bottom: 12px;
}

.validation-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.validation-label.error { color: #e74c3c; }
.validation-label.success { color: #52c41a; }

.validation-errors ul {
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  color: var(--text-color-muted);
}

.agent-list-preview {
  max-height: 150px;
  overflow-y: auto;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  margin-bottom: 16px;
}

.agent-preview-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
}

.agent-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.agent-id {
  font-weight: 500;
  color: var(--text-color);
}

.agent-name {
  color: var(--text-color-muted);
  margin-left: 4px;
}

.target-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 8px;
}

.target-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.result-section {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 6px;
}

.result-section.success {
  background: rgba(82, 196, 26, 0.1);
  border: 1px solid rgba(82, 196, 26, 0.3);
}

.result-section.warning {
  background: rgba(250, 173, 20, 0.1);
  border: 1px solid rgba(250, 173, 20, 0.3);
}

.result-section.error {
  background: rgba(231, 76, 60, 0.1);
  border: 1px solid rgba(231, 76, 60, 0.3);
}

.result-section.info {
  background: rgba(114, 132, 154, 0.1);
  border: 1px solid rgba(114, 132, 154, 0.3);
}

.result-label {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.result-section.success .result-label { color: #52c41a; }
.result-section.warning .result-label { color: #d48806; }
.result-section.error .result-label { color: #e74c3c; }
.result-section.info .result-label { color: var(--text-color-muted); }

.result-list {
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
}

.result-list li {
  padding: 2px 0;
}

.skip-id {
  font-weight: 500;
}

.skip-reason {
  color: var(--text-color-muted);
  margin-left: 8px;
}
</style>
