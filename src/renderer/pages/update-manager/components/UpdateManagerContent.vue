<template>
  <div class="about-page" :style="cssVars">

    <!-- Header -->
    <div class="about-header">
      <span class="title">{{ t('update.title') }}</span>
    </div>

    <!-- Body -->
    <div class="about-body">

      <!-- 1. 版本 -->
      <div class="list-item">
        <span class="item-label">{{ t('update.versionInfo') }}</span>
        <div class="item-content">
          <span class="ver-num">{{ currentVersion }}</span>
          <n-button
            size="small"
            :loading="isChecking"
            :disabled="isChecking || isDownloading"
            @click="handleCheckUpdate"
          >
            {{ isChecking ? t('update.checking') : t('update.checkForUpdate') }}
          </n-button>
        </div>
      </div>

      <!-- 状态提示 -->
      <div v-if="statusMessage" class="status-tip" :class="statusType">
        {{ statusMessage }}
      </div>

      <!-- 新版本详情 -->
      <template v-if="updateInfo">
        <div class="list-item">
          <span class="item-label">{{ t('update.latestVersion') }}</span>
          <div class="item-content">
            <span class="new-ver">{{ updateInfo.version }}</span>
            <span v-if="updateInfo.releaseDate" class="release-date">
              {{ formatDate(updateInfo.releaseDate) }}
            </span>
          </div>
        </div>

        <!-- 下载进度 -->
        <div v-if="isDownloading" class="progress-area">
          <n-progress
            type="line"
            :percentage="downloadProgress"
            :show-indicator="false"
            :height="8"
          />
          <div class="progress-text">
            <template v-if="isPreparingDownload">
              {{ t('update.preparingDifferentialDownload') }}
            </template>
            <template v-else>
              {{ downloadProgress }}%
              <span v-if="downloadSpeed" class="speed">· {{ formatSpeed(downloadSpeed) }}</span>
            </template>
          </div>
        </div>

        <!-- 下载完成 -->
        <div v-if="isDownloaded" class="done-tip">
          ✅ {{ t('update.downloadComplete') }}
        </div>

        <!-- 更新日志 -->
        <div v-if="updateInfo.releaseNotes" class="notes-area">
          <div class="notes-title">{{ t('update.releaseNotes') }}</div>
          <div class="notes-body">{{ updateInfo.releaseNotes }}</div>
        </div>

        <!-- 操作按钮 -->
        <div class="btn-row">
          <template v-if="!isDownloading && !isDownloaded">
            <n-button type="primary" @click="handleDownload">
              {{ t('update.downloadNow') }}
            </n-button>
          </template>
          <template v-if="isDownloading">
            <n-button disabled>{{ t('update.downloading') }}...</n-button>
          </template>
          <template v-if="isDownloaded">
            <n-button @click="handleClose">{{ t('update.installLater') }}</n-button>
            <n-button type="primary" @click="handleInstall">
              {{ t('update.quitAndInstall') }}
            </n-button>
          </template>
        </div>
      </template>

      <!-- 2. 联系我们 -->
      <div class="list-item">
        <span class="item-label">{{ t('update.contactUs') }}</span>
        <div class="item-content">
          <a class="contact-value" href="mailto:723617566@qq.com">723617566@qq.com</a>
        </div>
      </div>

      <!-- 3. 清除数据 -->
      <div class="list-item">
        <span class="item-label">{{ t('update.clearData') }}</span>
        <div class="item-content">
          <n-button type="error" size="small" @click="handleClearData">
            {{ t('update.clearDataButton') }}
          </n-button>
        </div>
      </div>

    </div>

    <!-- Footer -->
    <div class="about-footer">
      <n-button @click="handleClose">{{ t('common.close') }}</n-button>
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, h } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { useIPC } from '@composables/useIPC'
import { useTheme } from '@composables/useTheme'
import { useLocale } from '@composables/useLocale'

const message = useMessage()
const dialog = useDialog()
const { invoke } = useIPC()
const { cssVars, initTheme } = useTheme()
const { t, initLocale } = useLocale()

const currentVersion = ref('')
const isChecking = ref(false)
const updateInfo = ref(null)
const isDownloading = ref(false)
const isDownloaded = ref(false)
const isPreparingDownload = ref(false)
const downloadProgress = ref(0)
const downloadSpeed = ref(0)
const statusMessage = ref('')
const statusType = ref('')

const cleanupFunctions = []

onMounted(async () => {
  await initTheme()
  await initLocale()
  await loadVersion()
  await checkExistingUpdate()
  await checkInstallError()
  setupEventListeners()
})

onUnmounted(() => {
  cleanupFunctions.forEach(fn => fn())
})

const loadVersion = async () => {
  try {
    currentVersion.value = await invoke('getAppVersion')
  } catch {
    currentVersion.value = 'Unknown'
  }
}

const checkInstallError = async () => {
  try {
    const err = await invoke('getInstallError')
    if (err?.message) {
      statusMessage.value = t('update.previousInstallFailed', { error: err.message })
      statusType.value = 'error'
    }
  } catch {
    // 忽略（旧版本主进程可能无此 IPC）
  }
}

const checkExistingUpdate = async () => {
  try {
    const status = await invoke('getUpdateStatus')
    if (status?.hasUpdate && status?.updateInfo) {
      updateInfo.value = status.updateInfo
      statusMessage.value = t('update.updateAvailableStatus', { version: status.updateInfo.version })
      statusType.value = 'info'
      if (status.isDownloaded) {
        isDownloaded.value = true
        downloadProgress.value = 100
      }
    }
  } catch (err) {
    console.error('[UpdateManager] Failed to get existing update status:', err)
  }
}

const setupEventListeners = () => {
  if (window.electronAPI?.onUpdateAvailable) {
    const cleanup = window.electronAPI.onUpdateAvailable((info) => {
      isChecking.value = false
      updateInfo.value = info
      statusMessage.value = t('update.updateAvailableStatus', { version: info.version })
      statusType.value = 'info'
      isDownloaded.value = !!info.isDownloaded
      if (!info.isDownloaded && !isDownloading.value) {
        downloadProgress.value = 0
      }
    })
    cleanupFunctions.push(cleanup)
  }

  if (window.electronAPI?.onUpdateNotAvailable) {
    const cleanup = window.electronAPI.onUpdateNotAvailable(() => {
      isChecking.value = false
      updateInfo.value = null
      statusMessage.value = t('update.alreadyLatest')
      statusType.value = 'success'
    })
    cleanupFunctions.push(cleanup)
  }

  if (window.electronAPI?.onUpdateDownloadProgress) {
    const cleanup = window.electronAPI.onUpdateDownloadProgress((progress) => {
      isPreparingDownload.value = false
      downloadProgress.value = Math.round(progress.percent || 0)
      downloadSpeed.value = progress.bytesPerSecond || 0
    })
    cleanupFunctions.push(cleanup)
  }

  if (window.electronAPI?.onUpdateDownloaded) {
    const cleanup = window.electronAPI.onUpdateDownloaded(() => {
      isDownloading.value = false
      isDownloaded.value = true
      isPreparingDownload.value = false
      downloadProgress.value = 100
    })
    cleanupFunctions.push(cleanup)
  }

  if (window.electronAPI?.onUpdateError) {
    const cleanup = window.electronAPI.onUpdateError((error) => {
      if (isDownloaded.value) return
      const msg = error?.message || ''
      if (msg.includes('code signature') || msg.includes('Could not get code signature')) return
      isChecking.value = false
      isDownloading.value = false
      isPreparingDownload.value = false
      statusMessage.value = t('update.checkFailed', { error: msg })
      statusType.value = 'error'
    })
    cleanupFunctions.push(cleanup)
  }

  if (window.electronAPI?.onUpdateInstallFailed) {
    const cleanup = window.electronAPI.onUpdateInstallFailed((err) => {
      statusMessage.value = t('update.previousInstallFailed', { error: err?.message || '' })
      statusType.value = 'error'
    })
    cleanupFunctions.push(cleanup)
  }

  if (window.electronAPI?.onUpdateNeedRedownload) {
    const cleanup = window.electronAPI.onUpdateNeedRedownload(() => {
      isDownloaded.value = false
      isDownloading.value = false
      isPreparingDownload.value = false
      downloadProgress.value = 0
      statusMessage.value = t('update.needRedownload')
      statusType.value = 'error'
      message.warning(t('update.needRedownload'))
    })
    cleanupFunctions.push(cleanup)
  }
}

const handleCheckUpdate = async () => {
  isChecking.value = true
  statusMessage.value = ''
  updateInfo.value = null
  isDownloading.value = false
  isPreparingDownload.value = false
  downloadProgress.value = 0
  try {
    const result = await invoke('checkForUpdates', false)
    if (result?.error) {
      isChecking.value = false
      statusMessage.value = t('update.checkFailed', { error: result.error })
      statusType.value = 'error'
    }
  } catch (err) {
    isChecking.value = false
    statusMessage.value = t('update.checkFailed', { error: err.message })
    statusType.value = 'error'
  }
}

const handleDownload = async () => {
  isDownloading.value = true
  isPreparingDownload.value = true
  statusMessage.value = t('update.preparingDifferentialDownload')
  statusType.value = 'info'
  try {
    await invoke('downloadUpdate')
  } catch (err) {
    isDownloading.value = false
    isPreparingDownload.value = false
    message.error(t('update.downloadFailed', { error: err.message }))
  }
}

const handleInstall = async () => {
  try {
    await invoke('quitAndInstall')
  } catch (err) {
    message.error(t('update.installFailed', { error: err.message }))
  }
}

const handleClearData = () => {
  const d = dialog.warning({
    title: t('update.clearDataConfirmTitle'),
    content: () => h('div', {}, [
      h('p', { style: 'margin-bottom: 12px;' }, t('update.clearDataConfirmDesc')),
      h('ul', { style: 'margin: 0; padding-left: 18px; line-height: 1.8; color: var(--text-color-secondary);' }, [
        h('li', {}, t('update.clearDataItemSessions')),
        h('li', {}, t('update.clearDataItemConfig')),
        h('li', {}, t('update.clearDataItemFiles')),
        h('li', {}, t('update.clearDataItemCache'))
      ])
    ]),
    positiveText: t('update.clearDataButton'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      d.loading = true
      try {
        const result = await window.electronAPI.clearAllData()
        if (result?.success) {
          message.success(t('update.clearDataSuccess'))
        } else {
          message.error(t('update.clearDataFailed', { error: result?.error || 'Unknown error' }))
        }
      } catch (err) {
        message.error(t('update.clearDataFailed', { error: err.message }))
      } finally {
        d.loading = false
      }
    }
  })
}

const handleClose = () => {
  window.close()
}

const formatDate = (dateString) => {
  if (!dateString) return ''
  const d = new Date(dateString)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

const formatSpeed = (bytesPerSecond) => {
  if (!bytesPerSecond) return ''
  return (bytesPerSecond / 1024 / 1024).toFixed(2) + ' MB/s'
}
</script>

<style scoped>
.about-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-color, #f5f5f5);
  overflow: hidden;
}

/* ── 标题 ── */
.about-header {
  padding: 16px 20px 14px;
  border-bottom: 1px solid var(--border-color, #e4e4e4);
  flex-shrink: 0;
}

.title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color, #222);
}

/* ── 主体 ── */
.about-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

/* ── 列表项 ── */
.list-item {
  display: flex;
  align-items: center;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-color, #e4e4e4);
  min-height: 48px;
}

.item-label {
  font-size: 13px;
  color: var(--text-color-secondary, #999);
  flex-shrink: 0;
  width: 72px;
}

.item-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

/* ── 版本号 ── */
.ver-num {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color, #222);
}

/* ── 状态提示 ── */
.status-tip {
  margin: 0 20px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}

.status-tip + .status-tip {
  margin-top: 4px;
}

.status-tip.success { background: rgba(82,196,26,.1); color: #52c41a; }
.status-tip.info    { background: rgba(24,144,255,.1); color: #1890ff; }
.status-tip.error   { background: rgba(255,77,79,.1);  color: #ff4d4f; }

/* ── 新版本 ── */
.new-ver {
  font-size: 15px;
  font-weight: 700;
  color: #1890ff;
}

.release-date {
  font-size: 12px;
  color: var(--text-color-secondary, #999);
}

/* ── 进度条 ── */
.progress-area {
  margin: 0 20px;
  padding: 8px 0;
}

.progress-text {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-color-secondary, #999);
  text-align: center;
}

.speed {
  color: #1890ff;
}

/* ── 下载完成 ── */
.done-tip {
  margin: 8px 20px;
  padding: 8px 12px;
  background: rgba(82,196,26,.1);
  border-radius: 6px;
  color: #52c41a;
  font-size: 13px;
  font-weight: 500;
}

/* ── 更新日志 ── */
.notes-area {
  margin: 0 20px;
  padding: 12px 0 8px;
  border-top: 1px solid var(--border-color, #e4e4e4);
}

.notes-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color-secondary, #999);
  margin-bottom: 6px;
}

.notes-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-color, #333);
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

/* ── 操作按钮行 ── */
.btn-row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 8px 20px;
}

/* ── 联系我们 ── */
.contact-value {
  font-size: 14px;
  color: #1890ff;
  text-decoration: none;
}

.contact-value:hover {
  text-decoration: underline;
}

/* ── 底部 ── */
.about-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border-color, #e4e4e4);
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}
</style>
