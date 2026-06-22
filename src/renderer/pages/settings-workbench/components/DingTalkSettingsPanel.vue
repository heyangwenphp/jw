<template>
  <div class="dingtalk-settings-panel">
    <n-alert type="info" :show-icon="true" style="margin-bottom: 16px;">
      {{ t('dingtalkSettings.description') }}
    </n-alert>
    <n-alert v-if="!supportsBridge" type="warning" :show-icon="true" style="margin-bottom: 16px;">
      {{ t('dingtalkSettings.desktopOnly') }}
    </n-alert>

    <!-- Basic Config -->
    <n-card :title="t('dingtalkSettings.basicConfig')" class="settings-section">
      <n-form-item :label="t('dingtalkSettings.enableBridge')">
        <n-switch v-model:value="formData.enabled" />
        <template #feedback>{{ t('dingtalkSettings.enableHint') }}</template>
      </n-form-item>

      <n-form-item :label="t('dingtalkSettings.appKey')">
        <n-input
          v-model:value="formData.appKey"
          :placeholder="t('dingtalkSettings.appKeyPlaceholder')"
          :disabled="!formData.enabled"
        />
        <template #feedback>{{ t('dingtalkSettings.appKeyHint') }}</template>
      </n-form-item>

      <n-form-item :label="t('dingtalkSettings.appSecret')">
        <n-input
          v-model:value="formData.appSecret"
          type="password"
          show-password-on="click"
          :placeholder="t('dingtalkSettings.appSecretPlaceholder')"
          :disabled="!formData.enabled"
        />
        <template #feedback>{{ t('dingtalkSettings.appSecretHint') }}</template>
      </n-form-item>
    </n-card>

    <!-- Connection Control -->
    <n-card :title="t('dingtalkSettings.connectionControl')" class="settings-section">
      <n-space>
        <n-button
          type="primary"
          :disabled="!canConnect"
          :loading="connecting"
          @click="handleConnect"
        >
          {{ connected ? t('dingtalkSettings.reconnect') : t('dingtalkSettings.connect') }}
        </n-button>
        <n-button
          :disabled="!connected"
          @click="handleDisconnect"
        >
          {{ t('dingtalkSettings.disconnect') }}
        </n-button>
      </n-space>
      <div v-if="activeSessions > 0" class="session-info">
        {{ t('dingtalkSettings.activeSessions', { count: activeSessions }) }}
      </div>
    </n-card>

    <!-- Advanced Settings -->
    <n-card :title="t('dingtalkSettings.advancedSettings')" class="settings-section">
      <n-form-item :label="t('dingtalkSettings.maxHistorySessions')">
        <n-input-number
          v-model:value="formData.maxHistorySessions"
          :min="1"
          :max="20"
          :disabled="!formData.enabled"
        />
        <template #feedback>{{ t('dingtalkSettings.maxHistorySessionsHint') }}</template>
      </n-form-item>
    </n-card>

    <!-- Save Button -->
    <div class="settings-footer">
      <n-button type="primary" @click="handleSave">{{ t('common.save') }}</n-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { NCard, NFormItem, NInput, NInputNumber, NSwitch, NSpace, NButton, NAlert, useMessage } from 'naive-ui'
import { useIPC } from '@composables/useIPC'
import { useLocale } from '@composables/useLocale'

const message = useMessage()
const { invoke } = useIPC()
const { t } = useLocale()

const formData = ref({
  enabled: false,
  appKey: '',
  appSecret: '',
  maxHistorySessions: 5
})

const connected = ref(false)
const activeSessions = ref(0)
const connecting = ref(false)

const supportsBridge = computed(() => window.electronAPI?.supportsIMBridge !== false)

const canConnect = computed(() =>
  supportsBridge.value && formData.value.enabled && formData.value.appKey && formData.value.appSecret
)

const cleanups = []

onMounted(async () => {
  await loadConfig()
  await refreshStatus()

  if (window.electronAPI?.onDingTalkStatusChange) {
    cleanups.push(window.electronAPI.onDingTalkStatusChange((data) => {
      connected.value = data.connected
    }))
  }
  if (window.electronAPI?.onDingTalkError) {
    cleanups.push(window.electronAPI.onDingTalkError((data) => {
      message.error(data.error || 'DingTalk error')
    }))
  }
})

onUnmounted(() => {
  cleanups.forEach(fn => fn && fn())
})

const loadConfig = async () => {
  try {
    const config = await invoke('getConfig')
    const dt = config?.dingtalk || {}
    formData.value.enabled = dt.enabled || false
    formData.value.appKey = dt.appKey || ''
    formData.value.appSecret = dt.appSecret || ''
    formData.value.maxHistorySessions = dt.maxHistorySessions || 5
  } catch (err) {
    console.error('Failed to load DingTalk config:', err)
  }
}

const refreshStatus = async () => {
  try {
    const status = await invoke('getDingTalkStatus')
    if (status) {
      connected.value = status.connected
      activeSessions.value = status.activeSessions || 0
    }
  } catch (err) {
    console.error('Failed to get DingTalk status:', err)
  }
}

const handleSave = async () => {
  try {
    await invoke('updateDingTalkConfig', {
      appKey: formData.value.appKey,
      appSecret: formData.value.appSecret,
      enabled: formData.value.enabled,
      maxHistorySessions: formData.value.maxHistorySessions,
    })
    message.success(t('dingtalkSettings.saveSuccess'))
    await refreshStatus()
  } catch (err) {
    console.error('Failed to save DingTalk config:', err)
    message.error(t('messages.saveFailed') + ': ' + err.message)
  }
}

const handleConnect = async () => {
  if (!supportsBridge.value) {
    message.warning(t('dingtalkSettings.desktopOnly'))
    return
  }
  connecting.value = true
  try {
    await invoke('updateDingTalkConfig', {
      appKey: formData.value.appKey,
      appSecret: formData.value.appSecret,
      enabled: true,
      maxHistorySessions: formData.value.maxHistorySessions,
    })
    formData.value.enabled = true
    const result = await invoke('startDingTalk')
    if (result) {
      message.success(t('dingtalkSettings.connectSuccess'))
    } else {
      message.warning(t('dingtalkSettings.connectFailed'))
    }
    await refreshStatus()
  } catch (err) {
    console.error('Failed to connect DingTalk:', err)
    message.error(t('dingtalkSettings.connectFailed') + ': ' + err.message)
  } finally {
    connecting.value = false
  }
}

const handleDisconnect = async () => {
  try {
    await invoke('stopDingTalk')
    message.success(t('dingtalkSettings.disconnected'))
    await refreshStatus()
  } catch (err) {
    console.error('Failed to disconnect DingTalk:', err)
    message.error(err.message)
  }
}
</script>

<style scoped>
.dingtalk-settings-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  gap: 14px;
  overflow: auto;
}

.settings-section {
  background: var(--card-bg);
}

.session-info {
  margin-top: 12px;
  font-size: 13px;
  opacity: 0.7;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
