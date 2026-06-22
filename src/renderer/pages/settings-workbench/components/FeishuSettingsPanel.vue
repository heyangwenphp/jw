<template>
  <div class="feishu-settings-panel">
    <n-alert type="info" :show-icon="true" style="margin-bottom: 16px;">
      {{ t('feishuSettings.description') }}
    </n-alert>
    <n-alert v-if="!supportsBridge" type="warning" :show-icon="true" style="margin-bottom: 16px;">
      {{ t('feishuSettings.desktopOnly') }}
    </n-alert>

    <!-- Basic Config -->
    <n-card :title="t('feishuSettings.basicConfig')" class="settings-section">
      <n-form-item :label="t('feishuSettings.enableBridge')">
        <n-switch v-model:value="formData.enabled" />
        <template #feedback>{{ t('feishuSettings.enableHint') }}</template>
      </n-form-item>

      <n-form-item :label="t('feishuSettings.appId')">
        <n-input
          v-model:value="formData.appId"
          :placeholder="t('feishuSettings.appIdPlaceholder')"
          :disabled="!formData.enabled"
        />
        <template #feedback>{{ t('feishuSettings.appIdHint') }}</template>
      </n-form-item>

      <n-form-item :label="t('feishuSettings.appSecret')">
        <n-input
          v-model:value="formData.appSecret"
          type="password"
          show-password-on="click"
          :placeholder="t('feishuSettings.appSecretPlaceholder')"
          :disabled="!formData.enabled"
        />
        <template #feedback>{{ t('feishuSettings.appSecretHint') }}</template>
      </n-form-item>

    </n-card>

    <!-- Connection Control -->
    <n-card :title="t('feishuSettings.connectionControl')" class="settings-section">
      <n-space>
        <n-button
          type="primary"
          :disabled="!canConnect"
          :loading="connecting"
          @click="handleConnect"
        >
          {{ connected ? t('feishuSettings.reconnect') : t('feishuSettings.connect') }}
        </n-button>
        <n-button
          :disabled="!connected"
          @click="handleDisconnect"
        >
          {{ t('feishuSettings.disconnect') }}
        </n-button>
      </n-space>
      <div v-if="activeSessions > 0" class="session-info">
        {{ t('feishuSettings.activeSessions', { count: activeSessions }) }}
      </div>
    </n-card>

    <!-- Advanced Settings -->
    <n-card :title="t('feishuSettings.advancedSettings')" class="settings-section">
      <n-form-item :label="t('feishuSettings.maxHistorySessions')">
        <n-input-number
          v-model:value="formData.maxHistorySessions"
          :min="1"
          :max="20"
          :disabled="!formData.enabled"
        />
        <template #feedback>{{ t('feishuSettings.maxHistorySessionsHint') }}</template>
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
  appId: '',
  appSecret: '',
  notificationChatId: '',
  maxHistorySessions: 5
})

const connected = ref(false)
const activeSessions = ref(0)
const connecting = ref(false)

const supportsBridge = computed(() => window.electronAPI?.supportsIMBridge !== false)

const canConnect = computed(() =>
  supportsBridge.value && formData.value.enabled && formData.value.appId && formData.value.appSecret
)

const cleanups = []

onMounted(async () => {
  await loadConfig()
  await refreshStatus()

  if (window.electronAPI?.onFeishuStatusChange) {
    cleanups.push(window.electronAPI.onFeishuStatusChange((data) => {
      connected.value = data.connected
    }))
  }
  if (window.electronAPI?.onFeishuError) {
    cleanups.push(window.electronAPI.onFeishuError((data) => {
      message.error(data.error || 'Feishu error')
    }))
  }
})

onUnmounted(() => {
  cleanups.forEach(fn => fn && fn())
})

const loadConfig = async () => {
  try {
    const config = await invoke('getConfig')
    const fs = config?.feishu || {}
    formData.value.enabled = fs.enabled || false
    formData.value.appId = fs.appId || ''
    formData.value.appSecret = fs.appSecret || ''
    formData.value.notificationChatId = fs.notificationChatId || ''
    formData.value.maxHistorySessions = fs.maxHistorySessions || 5
  } catch (err) {
    console.error('Failed to load Feishu config:', err)
  }
}

const refreshStatus = async () => {
  try {
    const status = await invoke('getFeishuStatus')
    if (status) {
      connected.value = status.connected
      activeSessions.value = status.activeSessions || 0
    }
  } catch (err) {
    console.error('Failed to get Feishu status:', err)
  }
}

const handleSave = async () => {
  try {
    await invoke('updateFeishuConfig', {
      appId: formData.value.appId,
      appSecret: formData.value.appSecret,
      enabled: formData.value.enabled,
      notificationChatId: formData.value.notificationChatId,
      maxHistorySessions: formData.value.maxHistorySessions,
    })
    message.success(t('feishuSettings.saveSuccess'))
    await refreshStatus()
  } catch (err) {
    console.error('Failed to save Feishu config:', err)
    message.error(t('messages.saveFailed') + ': ' + err.message)
  }
}

const handleConnect = async () => {
  if (!supportsBridge.value) {
    message.warning(t('feishuSettings.desktopOnly'))
    return
  }
  connecting.value = true
  try {
    await invoke('updateFeishuConfig', {
      appId: formData.value.appId,
      appSecret: formData.value.appSecret,
      enabled: true,
      notificationChatId: formData.value.notificationChatId,
      maxHistorySessions: formData.value.maxHistorySessions,
    })
    formData.value.enabled = true
    const result = await invoke('startFeishu')
    if (result) {
      message.success(t('feishuSettings.connectSuccess'))
    } else {
      message.warning(t('feishuSettings.connectFailed'))
    }
    await refreshStatus()
  } catch (err) {
    console.error('Failed to connect Feishu:', err)
    message.error(t('feishuSettings.connectFailed') + ': ' + err.message)
  } finally {
    connecting.value = false
  }
}

const handleDisconnect = async () => {
  try {
    await invoke('stopFeishu')
    message.success(t('feishuSettings.disconnected'))
    await refreshStatus()
  } catch (err) {
    console.error('Failed to disconnect Feishu:', err)
    message.error(err.message)
  }
}
</script>

<style scoped>
.feishu-settings-panel {
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
