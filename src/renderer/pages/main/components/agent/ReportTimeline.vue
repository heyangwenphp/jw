<template>
  <div class="report-timeline agent-chat-tab">
    <div class="messages-region report-messages-region">
      <div ref="messagesListRef" class="messages-list report-messages-list" @scroll="onMessagesScroll">
        <div v-if="loading" class="report-timeline-state">
          <Icon name="refresh" :size="18" class="spin-icon" />
          <span>正在加载报告</span>
        </div>
        <div v-else-if="latestReports.length === 0" class="report-timeline-state">
          <Icon name="file" :size="30" />
          <span>暂无 Markdown 报告</span>
        </div>
        <template v-else>
          <div
            v-for="report in latestReports"
            :key="getReportKey(report)"
            :ref="setReportEntryRef(report)"
            class="message-bubble assistant report-message"
            :class="{ 'is-active': getReportKey(report) === activeReportKey }"
          >
            <div class="bubble-avatar report-avatar">
              <Icon name="file" :size="17" />
            </div>
            <div class="bubble-content">
              <div class="bubble-capture" :ref="setReportCaptureRef(report)">
                <div v-if="contentByKey[getReportKey(report)]?.loading" class="report-entry-state">
                  <Icon name="refresh" :size="15" class="spin-icon" />
                  <span>加载中</span>
                </div>
                <div v-else-if="contentByKey[getReportKey(report)]?.error" class="report-entry-state is-error">
                  {{ contentByKey[getReportKey(report)].error }}
                </div>
                <div
                  v-else
                  class="bubble-body markdown-preview report-markdown jedi-markdown-preview"
                  v-html="renderReportMarkdown(contentByKey[getReportKey(report)]?.content || '')"
                  @click="handleReportBodyClick"
                ></div>
                <footer class="report-message-footer">
                  <button
                    type="button"
                    class="report-download-btn"
                    :title="t('agent.saveAsImage')"
                    :aria-label="t('agent.saveAsImage')"
                    @click="saveReportAsImage(report)"
                  >
                    <Icon name="image" :size="14" />
                    <span>保存图片</span>
                  </button>
                  <button
                    type="button"
                    class="report-download-btn"
                    title="下载 Markdown 报告"
                    aria-label="下载 Markdown 报告"
                    @click="downloadReport(report)"
                  >
                    <Icon name="download" :size="14" />
                    <span>下载 MD</span>
                  </button>
                </footer>
              </div>
            </div>
          </div>
        </template>
        <template v-if="displayChatMessages.length > 0">
          <MessageBubble
            v-for="msg in displayChatMessages"
            :key="msg.id"
            :message="msg"
            :session-cwd="sessionCwd"
            @preview-image="emit('preview-image', $event)"
            @preview-link="emit('preview-link', $event)"
            @preview-path="emit('preview-path', $event)"
            @run-command="emit('run-command', $event)"
          />
        </template>
        <StreamingIndicator
          :visible="isStreaming"
          :text="currentStreamText"
          :thinking="currentStreamThinking"
          :elapsed="streamingElapsed"
        />
        <div ref="scrollAnchor"></div>
      </div>

      <div v-if="canScrollMessages" class="chat-scroll-controls" aria-label="报告滚动导航">
        <button
          type="button"
          class="chat-scroll-btn"
          :disabled="userAtTop"
          title="滚动到顶部"
          aria-label="滚动到顶部"
          @click="scrollToTop(false)"
        >
          <Icon name="arrowUp" :size="15" />
        </button>
        <button
          type="button"
          class="chat-scroll-btn"
          :disabled="userAtBottom"
          title="滚动到底部"
          aria-label="滚动到底部"
          @click="scrollToBottom(false, true)"
        >
          <Icon name="arrowDown" :size="15" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import Icon from '@components/icons/Icon.vue'
import MessageBubble from './MessageBubble.vue'
import StreamingIndicator from './StreamingIndicator.vue'
import { useLocale } from '@composables/useLocale'
import {
  getAgentMessages,
  onAgentCliError,
  onAgentError,
  onAgentMessage,
  onAgentResult,
  onAgentStatusChange,
  onAgentStream
} from '@/client-api/api.js'
import { isVisibleAgentMessage } from '@utils/agent-message-visibility'
import { renderMarkdownWithHighlight } from '@utils/highlight-utils'
import { buildFileDownloadUrl, downloadFileFromUrl } from '@utils/file-preview-url-utils'
import { applyCanvasSafeStyles, canvasToOpaqueDataUrl, resolveCanvasBackgroundColor } from '@utils/canvas-capture-utils'

const { t } = useLocale()
const messageApi = useMessage()

const props = defineProps({
  reports: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  activeReport: { type: Object, default: null },
  sessionId: { type: String, default: null },
  sessionCwd: { type: String, default: null },
  chatRefreshKey: { type: Number, default: 0 }
})

const emit = defineEmits([
  'activate-report',
  'refresh',
  'preview-image',
  'preview-link',
  'preview-path',
  'run-command',
  'streaming-change'
])

const messagesListRef = ref(null)
const scrollAnchor = ref(null)
const contentByKey = ref({})
const chatMessages = ref([])
const chatMessagesLoading = ref(false)
const isStreaming = ref(false)
const currentStreamText = ref('')
const currentStreamThinking = ref('')
const streamingElapsed = ref(0)
const userAtTop = ref(true)
const userAtBottom = ref(true)
const canScrollMessages = ref(false)
const reportEntryRefs = new Map()
const reportCaptureRefs = new Map()
let resizeObserver = null
let chatMessagesRequestId = 0
let streamingTimer = null
let currentBlockType = null
let streamTextReceived = false
const cleanupFns = []

const getReportKey = (report) => report?.id || report?.filePath || report?.path || ''
const getReportName = (report) => report?.name || String(report?.filePath || '').split(/[\\/]/).pop() || 'Markdown 报告'
const ensureMarkdownFileName = (name = '') => {
  const trimmed = String(name || '').trim() || 'Markdown 报告.md'
  return /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`
}
const ensurePngFileName = (name = '') => {
  const baseName = String(name || '').trim() || 'report'
  const withoutMarkdownExt = baseName.replace(/\.(md|markdown)$/i, '')
  return /\.png$/i.test(withoutMarkdownExt) ? withoutMarkdownExt : `${withoutMarkdownExt}.png`
}

const orderedReports = computed(() => (
  [...(Array.isArray(props.reports) ? props.reports : [])]
    .sort((a, b) => Number(a?.updatedAt || a?.createdAt || 0) - Number(b?.updatedAt || b?.createdAt || 0))
))

const activeReportKey = computed(() => getReportKey(props.activeReport))

const latestReports = computed(() => {
  const activeKey = activeReportKey.value
  if (activeKey) {
    const activeReport = orderedReports.value.find(report => getReportKey(report) === activeKey) || props.activeReport
    return activeReport ? [activeReport] : []
  }

  const latest = orderedReports.value[orderedReports.value.length - 1]
  return latest ? [latest] : []
})

const latestReportKey = computed(() => {
  const reports = orderedReports.value
  return getReportKey(reports[reports.length - 1])
})

const normalizeComparableReportValue = (value) => String(value || '')
  .trim()
  .replace(/\\/g, '/')
  .replace(/\.(?:md|markdown|pdf|txt)$/i, '')
  .replace(/\s+/g, '')
  .toLowerCase()

const getBaseName = (filePath = '') => String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || ''

const activeReportComparableValues = computed(() => {
  const report = props.activeReport || {}
  return new Set([
    report.name,
    report.filePath,
    report.path,
    getBaseName(report.filePath || report.path)
  ].map(normalizeComparableReportValue).filter(Boolean))
})

const isActiveReportContextFile = (file = {}) => {
  const activeValues = activeReportComparableValues.value
  if (activeValues.size === 0) return false
  const candidates = [
    file.name,
    file.fileName,
    file.filePath,
    file.path,
    file.relativePath,
    getBaseName(file.filePath || file.path || file.relativePath)
  ].map(normalizeComparableReportValue).filter(Boolean)
  return candidates.some(candidate => activeValues.has(candidate))
}

const stripReportAttachmentMarker = (content = '') => String(content || '')
  .replace(/\s*\[\d+个文件\]\s*$/u, '')
  .trim()

const sanitizeReportFollowupMessage = (message = {}) => {
  if (message?.role !== 'user' || !Array.isArray(message.files) || message.files.length === 0) {
    return message
  }

  const visibleFiles = message.files.filter(file => !isActiveReportContextFile(file))
  if (visibleFiles.length === message.files.length) return message

  const nextMessage = {
    ...message,
    content: visibleFiles.length === 0
      ? stripReportAttachmentMarker(message.content)
      : message.content
  }
  if (visibleFiles.length > 0) {
    nextMessage.files = visibleFiles
  } else {
    delete nextMessage.files
  }
  return nextMessage
}

const displayChatMessages = computed(() => (
  chatMessages.value
    .filter(isVisibleAgentMessage)
    .map(sanitizeReportFollowupMessage)
))

const formatReportDate = (value) => {
  const timestamp = Number(value || 0)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

const normalizeReportMarkdown = (content) => String(content || '')
const renderReportMarkdown = (content) => renderMarkdownWithHighlight(normalizeReportMarkdown(content))

const isHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim())

const downloadMarkdownBlob = (report, content) => {
  if (typeof document === 'undefined') return false
  const blob = new Blob([String(content || '')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    return downloadFileFromUrl(url, ensureMarkdownFileName(getReportName(report)))
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

const downloadReport = (report) => {
  const filePath = report?.filePath || report?.path
  const fileName = ensureMarkdownFileName(getReportName(report))
  if (filePath) {
    const url = buildFileDownloadUrl({
      filePath,
      sessionId: report?.sessionId || null
    })
    if (downloadFileFromUrl(url, fileName)) return
  }

  const key = getReportKey(report)
  const content = contentByKey.value[key]?.content || ''
  if (content) {
    downloadMarkdownBlob(report, content)
  }
}

const downloadImageDataUrl = (dataUrl, filename) => {
  if (!dataUrl) return false
  return downloadFileFromUrl(dataUrl, ensurePngFileName(filename))
}

const captureReportAsDataUrl = async (report) => {
  const key = getReportKey(report)
  const el = key ? reportCaptureRefs.get(key) : null
  if (!el) return null

  const html2canvas = (await import('html2canvas')).default
  const captureId = `jedi-report-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`
  el.dataset.captureId = captureId
  const backgroundColor = resolveCanvasBackgroundColor(el)
  try {
    const canvas = await html2canvas(el, {
      backgroundColor,
      scale: 2,
      useCORS: true,
      ignoreElements: (element) => element?.classList?.contains('report-message-footer'),
      onclone: (clonedDocument) => {
        const clonedEl = clonedDocument.querySelector(`[data-capture-id="${captureId}"]`)
        applyCanvasSafeStyles(clonedEl, { rootBackgroundColor: backgroundColor })
      }
    })
    return canvasToOpaqueDataUrl(canvas, backgroundColor, 'image/png')
  } finally {
    delete el.dataset.captureId
  }
}

const saveReportAsImage = async (report) => {
  try {
    const dataUrl = await captureReportAsDataUrl(report)
    if (!dataUrl) return

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    const filename = ensurePngFileName(getReportName(report))
    const isWebRuntime = window.electronAPI?.platform === 'web'
    let saved = false

    if (!isWebRuntime && typeof window.electronAPI?.saveImage === 'function') {
      const saveResult = await window.electronAPI.saveImage({
        filename,
        base64
      })
      saved = Boolean(saveResult?.success)
    }

    if (!saved) {
      saved = downloadImageDataUrl(dataUrl, filename)
    }

    if (saved) {
      messageApi.success(t('agent.imageSaved'))
    }
  } catch (err) {
    console.error('[ReportTimeline] Save report image failed:', err)
  }
}

const handleReportBodyClick = async (event) => {
  const link = event.target?.closest?.('a[href]')
  if (!link) return

  const href = link.getAttribute('href') || ''
  if (!isHttpUrl(href)) return

  event.preventDefault()
  event.stopPropagation()
  await window.electronAPI?.openExternal?.(href)
}

const waitForFrame = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(resolve)
  } else {
    setTimeout(resolve, 0)
  }
})

const isCurrentSessionEvent = (data = {}) => (
  props.sessionId &&
  data?.sessionId === props.sessionId
)

const emitStreamingChange = () => {
  emit('streaming-change', {
    sessionId: props.sessionId,
    streaming: isStreaming.value
  })
}

const startStreamingTimer = () => {
  if (streamingTimer) return
  const startedAt = Date.now()
  streamingElapsed.value = 0
  streamingTimer = window.setInterval?.(() => {
    streamingElapsed.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  }, 1000) || null
}

const stopStreamingTimer = () => {
  if (streamingTimer) {
    window.clearInterval?.(streamingTimer)
  }
  streamingTimer = null
}

const beginStreamingPreview = () => {
  if (!isStreaming.value) {
    isStreaming.value = true
    emitStreamingChange()
  }
  startStreamingTimer()
  void scrollToBottom(true, true)
}

const clearStreamingPreview = async () => {
  const wasStreaming = isStreaming.value
  isStreaming.value = false
  stopStreamingTimer()
  currentBlockType = null
  streamTextReceived = false
  currentStreamText.value = ''
  currentStreamThinking.value = ''
  streamingElapsed.value = 0
  if (wasStreaming) {
    emitStreamingChange()
    await loadChatMessages({ scrollToBottom: true })
  }
}

const resetStreamingPreview = () => {
  const wasStreaming = isStreaming.value
  isStreaming.value = false
  stopStreamingTimer()
  currentBlockType = null
  streamTextReceived = false
  currentStreamText.value = ''
  currentStreamThinking.value = ''
  streamingElapsed.value = 0
  if (wasStreaming) {
    emitStreamingChange()
  }
}

const updateScrollState = () => {
  const container = messagesListRef.value
  if (!container) {
    userAtTop.value = true
    userAtBottom.value = true
    canScrollMessages.value = false
    return
  }

  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  canScrollMessages.value = maxScrollTop > 2
  userAtTop.value = container.scrollTop <= 2
  userAtBottom.value = maxScrollTop - container.scrollTop <= 2
}

const onMessagesScroll = () => {
  updateScrollState()
}

const setReportEntryRef = (report) => (element) => {
  const key = getReportKey(report)
  if (!key) return
  if (element) {
    reportEntryRefs.set(key, element)
  } else {
    reportEntryRefs.delete(key)
  }
}

const setReportCaptureRef = (report) => (element) => {
  const key = getReportKey(report)
  if (!key) return
  if (element) {
    reportCaptureRefs.set(key, element)
  } else {
    reportCaptureRefs.delete(key)
  }
}

const scrollToTop = async (instant = true) => {
  await nextTick()
  const container = messagesListRef.value
  if (!container) return
  container.scrollTo({
    top: 0,
    behavior: instant ? 'auto' : 'smooth'
  })
  await waitForFrame()
  updateScrollState()
}

const scrollToBottom = async (instant = true, force = false) => {
  await nextTick()
  await waitForFrame()
  if (scrollAnchor.value) {
    scrollAnchor.value.scrollIntoView({
      behavior: instant ? 'auto' : 'smooth',
      block: 'end'
    })
  } else if (messagesListRef.value) {
    messagesListRef.value.scrollTop = messagesListRef.value.scrollHeight
  }
  if (force) {
    await waitForFrame()
    if (messagesListRef.value) {
      messagesListRef.value.scrollTop = messagesListRef.value.scrollHeight
    }
    scrollAnchor.value?.scrollIntoView({
      behavior: 'auto',
      block: 'end'
    })
  }
  updateScrollState()
}

const scrollToReportEntry = async (reportKey, instant = true, force = false) => {
  await nextTick()
  await waitForFrame()
  const target = reportEntryRefs.get(reportKey)
  if (!target) {
    updateScrollState()
    return
  }

  target.scrollIntoView({
    behavior: instant ? 'auto' : 'smooth',
    block: 'start'
  })

  if (force) {
    await waitForFrame()
    target.scrollIntoView({
      behavior: 'auto',
      block: 'start'
    })
  }

  updateScrollState()
}

const scrollToActiveReportEntry = async (instant = true, force = false) => {
  const targetKey = activeReportKey.value || latestReportKey.value
  if (!targetKey) {
    updateScrollState()
    return
  }
  await scrollToReportEntry(targetKey, instant, force)
}

const loadReportContent = async (report) => {
  const key = getReportKey(report)
  const filePath = report?.filePath || report?.path
  if (!key || !filePath || contentByKey.value[key]?.content || contentByKey.value[key]?.loading) {
    void scrollToActiveReportEntry(true)
    return
  }

  contentByKey.value = {
    ...contentByKey.value,
    [key]: { loading: true, content: '', error: '' }
  }

  try {
    const fileData = await window.electronAPI?.readAbsolutePath?.({
      filePath,
      sessionId: report?.sessionId || null,
      confirmed: true
    })
    if (!fileData || fileData.error) {
      throw new Error(fileData?.error || '报告加载失败')
    }
    contentByKey.value = {
      ...contentByKey.value,
      [key]: {
        loading: false,
        content: String(fileData.content || ''),
        error: ''
      }
    }
  } catch (err) {
    contentByKey.value = {
      ...contentByKey.value,
      [key]: {
        loading: false,
        content: '',
        error: err?.message || '报告加载失败'
      }
    }
  } finally {
    void scrollToActiveReportEntry(true, true)
  }
}

const loadChatMessages = async (options = {}) => {
  const sessionId = String(props.sessionId || '').trim()
  const shouldScrollToBottom = options?.scrollToBottom === true
  const requestId = ++chatMessagesRequestId
  if (!sessionId) {
    chatMessages.value = []
    chatMessagesLoading.value = false
    return []
  }

  chatMessagesLoading.value = true
  try {
    const history = await getAgentMessages(sessionId)
    if (requestId !== chatMessagesRequestId) return chatMessages.value
    chatMessages.value = Array.isArray(history) ? history : []
    return chatMessages.value
  } catch (err) {
    if (requestId === chatMessagesRequestId) {
      chatMessages.value = []
    }
    console.warn('[ReportTimeline] Failed to load follow-up messages:', err)
    return []
  } finally {
    if (requestId === chatMessagesRequestId) {
      chatMessagesLoading.value = false
      if (shouldScrollToBottom) {
        void scrollToBottom(true, true)
      } else {
        updateScrollState()
      }
    }
  }
}

const handleAgentStream = (data = {}) => {
  if (!isCurrentSessionEvent(data)) return
  const event = data.event
  if (!event) return

  beginStreamingPreview()

  if (event.type === 'content_block_start') {
    currentBlockType = event.content_block?.type || null
  }

  if (event.type === 'content_block_delta') {
    if (event.delta?.type === 'text_delta') {
      currentStreamText.value += event.delta.text || ''
      streamTextReceived = true
      void scrollToBottom(true, true)
    } else if (event.delta?.type === 'thinking_delta') {
      currentStreamThinking.value += event.delta.thinking || ''
      void scrollToBottom(true, true)
    }
  }

  if (event.type === 'content_block_stop') {
    currentBlockType = null
  }

  if (event.type === 'message_stop') {
    currentBlockType = null
  }
}

const handleAgentMessage = (data = {}) => {
  if (!isCurrentSessionEvent(data)) return
  const msg = data.message
  if (!msg || streamTextReceived) return
  const blocks = Array.isArray(msg.content) ? msg.content : []
  let text = ''
  let thinking = ''
  for (const block of blocks) {
    if (block?.type === 'text' && block.text) {
      text += block.text
    } else if (block?.type === 'thinking' && block.thinking) {
      thinking += block.thinking
    }
  }
  if (!text && !thinking) return
  beginStreamingPreview()
  if (text) currentStreamText.value += text
  if (thinking) currentStreamThinking.value += thinking
  void scrollToBottom(true, true)
}

const handleAgentStatusChange = (data = {}) => {
  if (!isCurrentSessionEvent(data)) return
  if (data.status === 'streaming') {
    beginStreamingPreview()
    return
  }
  if (data.status === 'idle' || data.status === 'error' || data.activeSessionEnded || data.cliExited) {
    void clearStreamingPreview()
  }
}

const handleAgentResult = (data = {}) => {
  if (!isCurrentSessionEvent(data)) return
  void clearStreamingPreview()
}

const handleAgentError = (data = {}) => {
  if (!isCurrentSessionEvent(data)) return
  void clearStreamingPreview()
}

watch(latestReports, (reports) => {
  for (const report of reports) {
    void loadReportContent(report)
  }
  void scrollToActiveReportEntry(true)
}, { immediate: true })

watch(() => [props.sessionId, props.chatRefreshKey], () => {
  void loadChatMessages()
}, { immediate: true })

watch(() => props.sessionId, () => {
  resetStreamingPreview()
})

watch(activeReportKey, () => {
  void scrollToActiveReportEntry(true, true)
})

onMounted(() => {
  cleanupFns.push(onAgentStream(handleAgentStream))
  cleanupFns.push(onAgentMessage(handleAgentMessage))
  cleanupFns.push(onAgentStatusChange(handleAgentStatusChange))
  cleanupFns.push(onAgentResult(handleAgentResult))
  cleanupFns.push(onAgentError(handleAgentError))
  cleanupFns.push(onAgentCliError(handleAgentError))
  void scrollToActiveReportEntry(true, true)
  updateScrollState()
  if (typeof ResizeObserver === 'function' && messagesListRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateScrollState()
    })
    resizeObserver.observe(messagesListRef.value)
  }
})

onUnmounted(() => {
  resetStreamingPreview()
  cleanupFns.forEach(cleanup => cleanup?.())
  cleanupFns.length = 0
  resizeObserver?.disconnect?.()
  resizeObserver = null
  reportEntryRefs.clear()
  reportCaptureRefs.clear()
})

defineExpose({
  reloadMessages: loadChatMessages,
  scrollToBottom
})
</script>

<style scoped>
.report-timeline {
  display: flex;
  flex-direction: column;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--panel-bg);
}

.report-messages-region {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.report-messages-list {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 0;
}

.chat-scroll-controls {
  position: absolute;
  right: 18px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 8;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.chat-scroll-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: color-mix(in srgb, var(--panel-bg) 92%, transparent);
  color: var(--text-color-secondary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  cursor: pointer;
  pointer-events: auto;
  transition: border-color 0.16s ease, color 0.16s ease, background 0.16s ease, opacity 0.16s ease;
}

.chat-scroll-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  background: var(--bg-color-hover);
  color: var(--primary-color);
}

.chat-scroll-btn:disabled {
  cursor: default;
  opacity: 0.42;
}

.report-timeline-state,
.report-entry-state {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-color-secondary);
}

.report-entry-state {
  min-height: 92px;
  border-top: 1px solid var(--border-color);
}

.report-entry-state.is-error {
  color: var(--error-color);
}

.message-bubble {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 16px;
  box-sizing: border-box;
}

.bubble-avatar {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.report-avatar {
  color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
}

.bubble-content {
  flex: 1;
  width: 0;
  min-width: 0;
}

.bubble-capture {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--bg-color-secondary);
  overflow: hidden;
  position: relative;
}

.markdown-preview {
  padding: 18px 22px 24px;
  color: var(--text-color);
  font-size: 14px;
  line-height: 1.68;
  overflow-wrap: anywhere;
}

.report-message-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 3;
  padding: 0;
  pointer-events: none;
}

.report-download-btn {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-color);
  color: var(--text-color-secondary);
  cursor: pointer;
  font-size: 13px;
  opacity: 0;
  transform: translateY(2px);
  pointer-events: auto;
  transition: opacity 0.16s ease, transform 0.16s ease, border-color 0.16s ease, color 0.16s ease, background 0.16s ease;
}

.report-message:hover .report-download-btn,
.report-download-btn:focus-visible {
  opacity: 1;
  transform: translateY(0);
}

.report-download-btn:hover {
  border-color: var(--primary-color);
  background: var(--bg-color-hover);
  color: var(--primary-color);
}

.spin-icon {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 760px) {
  .message-bubble {
    gap: 8px;
  }

  .bubble-avatar {
    display: none;
  }

  .markdown-preview {
    padding: 16px;
  }

  .report-message-footer {
    position: static;
    justify-content: flex-end;
    padding: 0 16px 12px;
    pointer-events: auto;
  }

  .report-download-btn {
    opacity: 1;
    transform: none;
  }

}
</style>
