<template>
  <div class="agent-chat-tab" v-show="visible">
    <div class="messages-region">
      <!-- 消息列表 -->
      <div class="messages-list" ref="messagesListRef">
        <div
          v-if="showInlineReportPreview && (activeReportPreview || activeReportPreviewLoading) && shouldShowActiveReportPreviewAtTop"
          ref="inlineReportPreviewRef"
          class="inline-report-preview"
          :class="{ 'inline-report-preview-maximized': inlineReportPreviewMaximized }"
        >
          <InlineFilePreview
            class="inline-file-preview"
            :preview="activeReportPreview"
            :loading="activeReportPreviewLoading"
            :maximized="inlineReportPreviewMaximized"
            @close="clearActiveReportPreview"
            @toggle-maximize="toggleInlineReportPreviewMaximized"
            @insert-path="handleInlinePreviewInsertPath"
          />
        </div>
        <!-- 欢迎引导（无消息且未在流式输出时显示） -->
        <div v-else-if="displayMessages.length === 0 && !isStreaming" class="welcome-guide">
          <div class="welcome-icon">
            <Icon name="robot" :size="48" />
          </div>
          <h3 class="welcome-title">{{ t('agent.welcomeTitle') }}</h3>
          <p class="welcome-desc">{{ t('agent.welcomeDesc') }}</p>
        </div>

        <template v-for="msg in displayMessages" :key="msg.id">
          <!-- 用户/助手消息 -->
          <MessageBubble
            v-if="msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system'"
            :message="msg"
            :session-cwd="sessionCwd"
            @preview-image="$emit('preview-image', $event)"
            @preview-link="$emit('preview-link', $event)"
            @preview-path="handleMessagePreviewPath($event, msg)"
            @run-command="$emit('run-command', $event)"
          />
          <!-- 工具调用 / 宿主交互 -->
          <AskUserQuestionCard
            v-else-if="msg.role === 'tool' && (msg.toolName === 'AskUserQuestion' || msg.input?.kind === 'permission_request')"
            :message="msg"
            :submitting="Boolean(interactionSubmitting[msg.input?.interactionId])"
            @submit="handleInteractionSubmit"
            @cancel="handleInteractionCancel"
          />
          <ScheduledTaskDraftCard
            v-else-if="msg.role === 'tool' && msg.toolName === 'ScheduledTaskDraft'"
            :message="msg"
            :submitting="Boolean(scheduledTaskSubmitting[msg.id])"
            @submit="handleScheduledTaskDraftSubmit"
            @cancel="handleScheduledTaskDraftCancel"
          />
          <ToolCallCard
            v-else-if="msg.role === 'tool'"
            :message="msg"
            @preview-image="$emit('preview-image', $event)"
            @preview-path="handleMessagePreviewPath($event, msg)"
          />
          <div
            v-if="showInlineReportPreview && isActiveReportPreviewAnchoredTo(msg)"
            ref="inlineReportPreviewRef"
            class="inline-report-preview"
            :class="{ 'inline-report-preview-maximized': inlineReportPreviewMaximized }"
          >
            <InlineFilePreview
              class="inline-file-preview"
              :preview="activeReportPreview"
              :loading="activeReportPreviewLoading"
              :maximized="inlineReportPreviewMaximized"
              @close="clearActiveReportPreview"
              @toggle-maximize="toggleInlineReportPreviewMaximized"
              @insert-path="handleInlinePreviewInsertPath"
            />
          </div>
        </template>

        <!-- 流式输出指示器 -->
        <StreamingIndicator
          :visible="isStreaming"
          :text="currentStreamText"
          :thinking="currentStreamThinking"
          :elapsed="streamingElapsed"
        />

        <!-- 错误提示 -->
        <div v-if="error" class="error-banner">
          <Icon name="xCircle" :size="16" />
          <span>{{ error }}</span>
        </div>

        <!-- 滚动锚点 -->
        <div ref="scrollAnchor"></div>
      </div>

      <div v-if="canScrollMessages" class="chat-scroll-controls" aria-label="消息滚动导航">
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

    <!-- 提示条：根据会话状态显示不同提示 -->
    <div v-if="sessionType === 'dingtalk'" class="dingtalk-observe-bar">
      <Icon name="dingtalk" :size="14" />
      <span>{{ t('agent.dingtalkObserving') }}</span>
    </div>
    <div v-else-if="sessionType === 'weixin'" class="dingtalk-observe-bar">
      <Icon name="weixin" :size="14" />
      <span>{{ t('agent.weixinObserving') }}</span>
    </div>
    <div v-else-if="sessionType === 'feishu'" class="dingtalk-observe-bar">
      <Icon name="feishu" :size="14" />
      <span>{{ t('agent.feishuObserving') }}</span>
    </div>
    <div v-else-if="!hasActiveSession" class="status-hint-bar">
      <Icon name="info" :size="14" />
      <span>{{ t('agent.historyHint') }}</span>
    </div>

    <!-- 输入框 -->
    <ChatInput
      ref="chatInputRef"
      :is-streaming="isStreaming"
      :disabled="false"
      :queue-enabled="queueEnabled"
      :placeholder="queueEnabled ? t('agent.inputPlaceholder') : t('agent.inputPlaceholderDisabled')"
      :context-tokens="contextTokens"
      :slash-commands="slashCommands"
      :slash-commands-supported="!isExternalObserveSession"
      :enable-slash-commands="!isExternalObserveSession && hasActiveSession"
      :model-options="modelOptions"
      :session-id="props.sessionId"
      :session-type="props.sessionType"
      :project-path="effectiveProjectPath"
      :context-files="activeReportContextFiles"
      :auto-select-investment-leads-skill="!props.preserveInitialTitle"
      v-model:model-value="selectedModel"
      @send="handleSend"
      @schedule="handleScheduleDraftCreate"
      @cancel="handleCancel"
      @remove-context-file="handleRemoveActiveReportContext"
      @update:queue-enabled="handleToggleQueue"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, onUnmounted } from 'vue'
import { useMessage } from 'naive-ui'
import { useLocale } from '@composables/useLocale'
import { useAgentChat } from '@composables/useAgentChat'
import { useAutoScrollToBottom } from '@composables/useAutoScrollToBottom'
import { isSessionClosed, unmarkSessionClosed } from '@composables/useAgentPanel'
import { useReportIndex } from '@composables/useReportIndex.js'
import { extractToolResultFilePaths } from '@utils/mcp-tool-result'
import { extractReportTitleFromText } from '@utils/radar-agent-workflow'
import { isVisibleAgentMessage } from '@utils/agent-message-visibility'
import MessageBubble from './agent/MessageBubble.vue'
import ToolCallCard from './agent/ToolCallCard.vue'
import AskUserQuestionCard from './agent/AskUserQuestionCard.vue'
import ScheduledTaskDraftCard from './agent/ScheduledTaskDraftCard.vue'
import StreamingIndicator from './agent/StreamingIndicator.vue'
import ChatInput from './agent/ChatInput.vue'
import InlineFilePreview from './AgentRightPanel/FilePreview.vue'
import Icon from '@components/icons/Icon.vue'

const { t } = useLocale()
const message = useMessage()
const normalizeModelValue = (value) => typeof value === 'string' ? value.trim() : ''
const { addReportsForFiles, touchReport } = useReportIndex()
const activeReportFilePath = ref('')
const activeReportPreview = ref(null)
const activeReportPreviewLoading = ref(false)
const activeReportPreviewRequestId = ref(0)
const activeReportPreviewAnchorMessageId = ref('')
const inlineReportPreviewRef = ref(null)
const inlineReportPreviewMaximized = ref(false)
const ACTIVE_REPORT_CONTEXT_MAX_CHARS = 1000
const REPORT_TEXT_UNAVAILABLE_NOTICE = [
  '当前预览报告的文本暂时无法读取。',
  '不要使用 Read 工具读取本地 PDF 路径。',
  '请基于当前对话回答；如果必须引用报告细节，请提示用户重新选择或重新生成报告。'
].join('\n')
const REPORT_MARKDOWN_PREVIEW_PDF_INSTRUCTION = [
  '如果本轮用户要求生成、重新生成或导出 PDF，必须先确认或生成最终报告 Markdown 文件。',
  'PDF 必须使用 `node scripts/render-markdown-preview-pdf.js <最终报告.md> <最终报告.pdf>` 从 Markdown 导出。',
  '不要创建、保存、验证或汇报任何 HTML 交付物或 HTML 中间文件；不要另写 HTML/CSS、不要使用 WeasyPrint、Pandoc、临时 Puppeteer/Playwright 模板或 printToPDF 自定义页面。',
  '最终回复只能说明已从 Markdown 导出 PDF，并给出 PDF 文件路径；PDF 排版必须与应用内 Markdown 预览（.markdown-preview）一致。'
].join('\n')
const REPORT_FOLLOWUP_CHAT_INSTRUCTION = [
  '请基于当前报告上下文直接回答这次追问。',
  '除非用户明确要求生成、重新生成、保存或导出文件，否则不要创建、修改或导出任何 Markdown、PDF、HTML 或其他文件；只输出对话回复，适合继续讨论和头脑风暴。'
].join('\n')
const REPORT_PDF_REQUEST_PATTERN = /(?:pdf|导出|生成|重新生成|重生成|制作|保存).{0,16}(?:pdf|报告|文件)|(?:pdf|报告).{0,16}(?:导出|生成|重新生成|重生成|制作|保存)/i
const shouldAppendReportPdfInstruction = (text) => REPORT_PDF_REQUEST_PATTERN.test(String(text || ''))
const getFileNameFromPath = (filePath) => String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || ''
const normalizeAttachmentDedupeText = (value) => String(value || '')
  .trim()
  .replace(/\\/g, '/')
  .replace(/\.(?:md|pdf|txt)$/i, '')
  .replace(/\s+/g, '')
  .toLowerCase()
const getAttachmentDedupeKeys = (file = {}) => {
  const keys = [
    file.filePath,
    file.path,
    file.relativePath,
    file.name,
    file.fileName
  ].map(normalizeAttachmentDedupeText).filter(Boolean)
  return [...new Set(keys)]
}
const activeReportContextFiles = computed(() => {
  const filePath = activeReportFilePath.value
  if (!filePath) return []

  const name = getFileNameFromPath(filePath) || activeReportPreview.value?.name || 'Radar Report.pdf'
  return [{
    id: filePath,
    name,
    filePath,
    sizeText: 'PDF',
    contextOnly: true
  }]
})

const props = defineProps({
  sessionId: {
    type: String,
    required: true
  },
  sessionType: {
    type: String,
    default: 'chat'  // 'chat' | 'dingtalk' | 'weixin'
  },
  sessionCwd: {
    type: String,
    default: null
  },
  fallbackProjectPath: {
    type: String,
    default: null
  },
  visible: {
    type: Boolean,
    default: true
  },
  apiProfileId: {
    type: String,
    default: null
  },
  modelId: {
    type: String,
    default: null
  },
  preserveInitialTitle: {
    type: Boolean,
    default: false
  },
  showInlineReportPreview: {
    type: Boolean,
    default: true
  },
  reportPreviewPlacement: {
    type: String,
    default: 'auto',
    validator: (value) => ['auto', 'top'].includes(value)
  }
})

const emit = defineEmits(['ready', 'preview-image', 'preview-link', 'preview-path', 'run-command', 'agent-done', 'request-clear-session', 'profile-changed'])
const resolvedApiProfileId = ref(props.apiProfileId)
const resolvedModelId = ref(props.modelId)

// 使用 Agent 对话 composable
const {
  messages,
  isStreaming,
  currentStreamText,
  currentStreamThinking,
  error,
  selectedModel,
  streamingElapsed,
  contextTokens,
  isCompacting,
  slashCommands,
  modelOptions,
  isInterrupting,  // 中断标志，用于阻止队列自动消费
  hasActiveSession,  // 激活状态，用于显示提示文字
  loadMessages,
  addAssistantMessage,
  sendMessage,
  cancelGeneration,
  submitInteractionAnswer,
  cancelInteraction,
  submitScheduledTaskDraft,
  cancelScheduledTaskDraft,
  compactConversation,
  triggerScheduledTaskDraft,
  syncActiveSessionState,
  setupStreamListeners,
  setupDingTalkListeners,
  setupWeixinListeners,
  setupFeishuListeners,
  setupListeners,
  initDefaultModel,
  cleanup
} = useAgentChat(props.sessionId, {
  enableSlashCommands: !['dingtalk', 'weixin', 'feishu'].includes(props.sessionType),
  sessionCwd: props.sessionCwd,
  apiProfileId: props.apiProfileId,
  autoRenameFirstUserMessage: !props.preserveInitialTitle,
  onClearRequested: () => {
    emit('request-clear-session')
  },
  onProfileChanged: ({ sessionId, apiProfileId, modelId }) => {
    resolvedApiProfileId.value = apiProfileId || null
    resolvedModelId.value = modelId || null
    emit('profile-changed', { sessionId, apiProfileId, modelId })
  }
})

const isExternalObserveSession = computed(() => ['dingtalk', 'weixin', 'feishu'].includes(props.sessionType))
const effectiveProjectPath = computed(() => props.sessionCwd || props.fallbackProjectPath || null)
const displayMessages = computed(() => messages.value.filter(isVisibleAgentMessage))
const shouldForceReportPreviewTop = computed(() => props.reportPreviewPlacement === 'top')
const shouldShowActiveReportPreviewAtTop = computed(() => (
  shouldForceReportPreviewTop.value || !activeReportPreviewAnchorMessageId.value
))

const normalizePreviewSearchText = (value) => String(value || '')
  .replace(/\\\\/g, '\\')
  .replace(/\//g, '\\')
  .toLowerCase()

const stringifyPreviewSearchValue = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const getMessagePreviewSearchText = (msg) => normalizePreviewSearchText([
  msg?.content,
  msg?.thinking,
  msg?.input,
  msg?.output,
  msg?.toolInput,
  msg?.toolOutput,
  ...(Array.isArray(msg?.files)
    ? msg.files.map((file) => `${file?.name || ''} ${file?.filePath || file?.path || ''}`)
    : [])
].map(stringifyPreviewSearchValue).filter(Boolean).join('\n'))

const findReportAnchorMessageId = (report = {}, preferredMessageId = '') => {
  if (preferredMessageId && displayMessages.value.some((msg) => msg?.id === preferredMessageId)) {
    return preferredMessageId
  }

  const reportFilePath = report?.filePath || report?.path || report?.url || ''
  const candidates = [
    reportFilePath,
    getFileNameFromPath(reportFilePath),
    report?.name
  ].map(normalizePreviewSearchText).filter(Boolean)

  if (candidates.length > 0) {
    const matched = [...displayMessages.value].reverse().find((msg) => {
      const messageText = getMessagePreviewSearchText(msg)
      return candidates.some((candidate) => messageText.includes(candidate))
    })
    if (matched?.id) return matched.id
  }

  const fallback = [...displayMessages.value].reverse()
    .find((msg) => ['assistant', 'tool', 'system'].includes(msg?.role)) || displayMessages.value.at(-1)
  return fallback?.id || ''
}

const isActiveReportPreviewAnchoredTo = (msg) => (
  Boolean(msg?.id) &&
  activeReportPreviewAnchorMessageId.value === msg.id &&
  Boolean(activeReportPreview.value || activeReportPreviewLoading.value)
)

// 消息队列开关（从配置读取）
const queueEnabled = ref(true)
const loadQueueSetting = async () => {
  try {
    const config = await window.electronAPI?.getConfig()
    if (config?.settings?.agent?.messageQueue !== undefined) {
      queueEnabled.value = config.settings.agent.messageQueue
    }
  } catch {}
}

// 工具栏切换队列开关 — 同时持久化到配置
const handleToggleQueue = async (enabled) => {
  queueEnabled.value = enabled
  try {
    const config = await window.electronAPI?.getConfig()
    if (config?.settings?.agent) {
      config.settings.agent.messageQueue = enabled
      await window.electronAPI?.saveConfig(JSON.parse(JSON.stringify(config)))
    }
  } catch (err) {
    console.error('Failed to save queue setting:', err)
    message.error(t('messages.saveFailed') + ': ' + err.message)
  }
}

const messagesListRef = ref(null)
const scrollAnchor = ref(null)
const chatInputRef = ref(null)
const interactionSubmitting = ref({})
const scheduledTaskSubmitting = ref({})
const {
  userAtTop,
  userAtBottom,
  canScroll: canScrollMessages,
  scrollToTop,
  scrollToBottom,
  onContainerScroll: onMessagesScroll,
  startAutoScrollObservers,
  stopAutoScrollObservers
} = useAutoScrollToBottom({
  containerRef: messagesListRef,
  anchorRef: scrollAnchor,
  itemsRef: displayMessages,
  streamingTextRef: currentStreamText,
  isStreamingRef: isStreaming
})

const readActiveReportText = async () => {
  const filePath = activeReportFilePath.value
  if (!filePath) return null

  try {
    if (!/\.pdf$/i.test(filePath)) {
      const fileData = await window.electronAPI?.readAbsolutePath?.({
        filePath,
        sessionId: props.sessionId,
        confirmed: true
      })
      if (!fileData || fileData.error || !fileData.content) {
        console.warn('[AgentChatTab] Failed to read active report text:', fileData?.error || 'empty content')
        return null
      }
      const content = String(fileData.content || '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
        .trim()
        .slice(0, ACTIVE_REPORT_CONTEXT_MAX_CHARS)
      return {
        ...fileData,
        name: fileData.name || getFileNameFromPath(filePath),
        content,
        truncated: Boolean(fileData.truncated) || String(fileData.content || '').length > ACTIVE_REPORT_CONTEXT_MAX_CHARS
      }
    }

    const result = await window.electronAPI?.readReportText?.({
      filePath,
      sessionId: props.sessionId,
      maxChars: ACTIVE_REPORT_CONTEXT_MAX_CHARS
    })
    if (!result || result.error || !result.content) {
      console.warn('[AgentChatTab] Failed to read active report text:', result?.error || 'empty content')
      return null
    }
    const content = result.content
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, ACTIVE_REPORT_CONTEXT_MAX_CHARS)
    return {
      ...result,
      content,
      truncated: Boolean(result.truncated) || String(result.content || '').length > ACTIVE_REPORT_CONTEXT_MAX_CHARS
    }
  } catch (err) {
    console.warn('[AgentChatTab] Failed to read active report text:', err)
    return null
  }
}

// 发送消息 → 强制回到底部
const buildActiveReportAttachmentMessage = (messageValue, activeReportText) => {
  if (!activeReportFilePath.value) return messageValue

  const activeReportPath = activeReportFilePath.value
  const reportContent = activeReportText?.content || REPORT_TEXT_UNAVAILABLE_NOTICE
  const rawText = messageValue && typeof messageValue === 'object'
    ? String(messageValue.text || '')
    : String(messageValue || '')
  const textWithReportInstruction = [
    rawText.trim(),
    REPORT_FOLLOWUP_CHAT_INSTRUCTION,
    shouldAppendReportPdfInstruction(rawText) ? REPORT_MARKDOWN_PREVIEW_PDF_INSTRUCTION : ''
  ].filter(Boolean).join('\n\n')

  const activeReportFile = {
    name: activeReportText?.name || getFileNameFromPath(activeReportPath) || 'report.md',
    content: reportContent,
    filePath: activeReportPath,
    sizeBytes: Number.isFinite(activeReportText?.size) ? activeReportText.size : 0
  }

  if (messageValue && typeof messageValue === 'object') {
    const existingFiles = Array.isArray(messageValue.files) ? messageValue.files : []
    const existingFileKeys = new Set(existingFiles.flatMap(file => getAttachmentDedupeKeys(file)))
    const activeReportKeys = getAttachmentDedupeKeys(activeReportFile)
    const nextFiles = activeReportKeys.some(key => existingFileKeys.has(key))
      ? existingFiles
      : [...existingFiles, activeReportFile]
    const nextContextFiles = Array.isArray(messageValue.contextFiles)
      ? messageValue.contextFiles.filter(file => !getAttachmentDedupeKeys(file).some(key => existingFileKeys.has(key) || activeReportKeys.includes(key)))
      : messageValue.contextFiles
    const hasDisplayText = typeof messageValue.displayText === 'string'
    return {
      ...messageValue,
      text: textWithReportInstruction,
      displayText: hasDisplayText ? messageValue.displayText : rawText,
      files: nextFiles,
      ...(Array.isArray(nextContextFiles) ? { contextFiles: nextContextFiles } : {})
    }
  }

  return {
    text: textWithReportInstruction,
    displayText: rawText,
    files: [activeReportFile]
  }
}

const handleSend = async (text) => {
  const activeReportText = await readActiveReportText()
  const outgoingMessage = buildActiveReportAttachmentMessage(text, activeReportText)
  await sendMessage(outgoingMessage)
  scrollToBottom(false, true)
}

// 取消生成（只停止当前输出，保留队列）
const handleCancel = async () => {
  await cancelGeneration()
  // 注意：不清空队列！队列面板有独立的"清空全部"按钮供用户使用
}

const handleScheduleDraftCreate = (prompt = '') => {
  triggerScheduledTaskDraft(typeof prompt === 'string' ? prompt : '')
  scrollToBottom(false, true)
}

const setInteractionSubmitting = (interactionId, submitting) => {
  if (!interactionId) return
  const next = { ...interactionSubmitting.value }
  if (submitting) {
    next[interactionId] = true
  } else {
    delete next[interactionId]
  }
  interactionSubmitting.value = next
}

const setScheduledTaskSubmitting = (messageId, submitting) => {
  if (!messageId) return
  const next = { ...scheduledTaskSubmitting.value }
  if (submitting) {
    next[messageId] = true
  } else {
    delete next[messageId]
  }
  scheduledTaskSubmitting.value = next
}

const handleInteractionSubmit = async ({ interactionId, answers, questions, annotations, updatedInput, updatedPermissions, decisionClassification, behavior }) => {
  if (!interactionId || interactionSubmitting.value[interactionId]) return

  setInteractionSubmitting(interactionId, true)
  try {
    const result = await submitInteractionAnswer({
      interactionId,
      answers,
      questions,
      annotations,
      updatedInput,
      updatedPermissions,
      decisionClassification,
      behavior
    })
    if (result?.error) {
      message.error(result.error)
    }
  } finally {
    setInteractionSubmitting(interactionId, false)
  }
}

const handleInteractionCancel = async ({ interactionId }) => {
  if (!interactionId || interactionSubmitting.value[interactionId]) return

  setInteractionSubmitting(interactionId, true)
  try {
    const result = await cancelInteraction({ interactionId, reason: 'User cancelled the question' })
    if (result?.error) {
      message.error(result.error)
    }
  } finally {
    setInteractionSubmitting(interactionId, false)
  }
}

const handleScheduledTaskDraftSubmit = async ({ messageId, draft }) => {
  if (!messageId || scheduledTaskSubmitting.value[messageId]) return

  setScheduledTaskSubmitting(messageId, true)
  try {
    const result = await submitScheduledTaskDraft({ messageId, draft })
    if (result?.error) {
      message.error(result.error)
      return
    }
    message.success(t('agent.scheduleDraftCreatedToast', { name: result?.task?.name || draft?.name || '' }))
    if (result?.runError) {
      message.warning(`${t('rightPanel.scheduledTasks.runFailed')}: ${result.runError}`)
    }
  } finally {
    setScheduledTaskSubmitting(messageId, false)
  }
}

const handleScheduledTaskDraftCancel = async ({ messageId }) => {
  if (!messageId || scheduledTaskSubmitting.value[messageId]) return

  setScheduledTaskSubmitting(messageId, true)
  try {
    const result = await cancelScheduledTaskDraft({ messageId })
    if (result?.error) {
      message.error(result.error)
    }
  } finally {
    setScheduledTaskSubmitting(messageId, false)
  }
}

const emitPreviewPath = (filePath) => {
  emit('preview-path', {
    filePath,
    sessionId: props.sessionId
  })
}

const handleMessagePreviewPath = async (filePath, sourceMessage = null) => {
  const normalizedPath = typeof filePath === 'string' ? filePath.trim() : ''
  if (!normalizedPath) return

  if (isPdfPath(normalizedPath)) {
    await openReportInline({
      filePath: normalizedPath,
      name: getFileNameFromPath(normalizedPath),
      type: 'pdf',
      ext: '.pdf'
    }, {
      anchorMessageId: sourceMessage?.id
    })
    return
  }

  emitPreviewPath(normalizedPath)
}

const insertText = (text) => {
  chatInputRef.value?.insertText(text)
}

const handleInlinePreviewInsertPath = (filePath) => {
  if (!filePath) return
  insertText(`${filePath}\n`)
}

const toggleInlineReportPreviewMaximized = () => {
  inlineReportPreviewMaximized.value = !inlineReportPreviewMaximized.value
}

const clearActiveReportPreview = () => {
  activeReportPreviewRequestId.value += 1
  activeReportPreview.value = null
  activeReportPreviewLoading.value = false
  activeReportFilePath.value = ''
  activeReportPreviewAnchorMessageId.value = ''
  inlineReportPreviewMaximized.value = false
}

const handleRemoveActiveReportContext = () => {
  activeReportFilePath.value = ''
}

const waitForNextFrame = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => resolve())
    return
  }
  setTimeout(resolve, 0)
})

const scrollActiveReportPreviewIntoView = async () => {
  userAtBottom.value = false
  await nextTick()
  await waitForNextFrame()
  const previewElement = Array.isArray(inlineReportPreviewRef.value)
    ? inlineReportPreviewRef.value.find(Boolean)
    : inlineReportPreviewRef.value
  previewElement?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
    inline: 'nearest'
  })
}

const openReportInline = async (report, options = {}) => {
  const reportFilePath = report?.filePath || report?.path || report?.url
  if (!reportFilePath) return false
  const requestId = ++activeReportPreviewRequestId.value
  activeReportFilePath.value = reportFilePath
  activeReportPreviewAnchorMessageId.value = shouldForceReportPreviewTop.value || options.anchorMessageId === false
    ? ''
    : findReportAnchorMessageId(report, options.anchorMessageId)
  touchReport(report.id || report.filePath)

  activeReportPreviewLoading.value = true
  await scrollActiveReportPreviewIntoView()
  try {
    if (requestId !== activeReportPreviewRequestId.value) return false

    if (report.url) {
      activeReportPreview.value = {
        type: report.type || 'pdf',
        name: report.name || getFileNameFromPath(reportFilePath) || 'Report.pdf',
        filePath: reportFilePath,
        url: report.url,
        size: report.size,
        ext: report.ext || '.pdf',
        sessionId: props.sessionId,
        isExternalFile: true
      }
      return true
    }

    const fileData = await window.electronAPI?.readAbsolutePath?.({
      filePath: reportFilePath,
      sessionId: props.sessionId,
      confirmed: true
    })
    if (requestId !== activeReportPreviewRequestId.value) return false

    if (!fileData || fileData.error) {
      const error = fileData?.error || t('agent.files.errorLoading')
      activeReportPreview.value = {
        type: 'binary',
        name: report.name,
        filePath: reportFilePath,
        error
      }
      message.error(error)
      return false
    }

    activeReportPreview.value = {
      ...fileData,
      name: fileData.name || report.name,
      filePath: fileData.filePath || fileData.path || reportFilePath,
      sessionId: props.sessionId,
      isExternalFile: true
    }
    return true
  } catch (err) {
    if (requestId !== activeReportPreviewRequestId.value) return false
    console.error('[AgentChatTab] Failed to preview report inline:', err)
    const error = t('agent.files.errorLoading')
    activeReportPreview.value = {
      type: 'binary',
      name: report.name,
      filePath: reportFilePath,
      error
    }
    message.error(error)
    return false
  } finally {
    if (requestId === activeReportPreviewRequestId.value) {
      activeReportPreviewLoading.value = false
    }
  }
}

const handleOpenReport = async (report) => {
  await openReportInline(report)
}

// --- 卸载标志：防止在组件卸载过程中触发消息发送 ---
let isUnmounting = false

// --- 队列自动消费：提取公共逻辑避免重复 ---
const tryAutoConsumeQueue = () => {
  // CRITICAL: 如果会话已关闭，不发送新消息（避免会话重启）
  if (isSessionClosed(props.sessionId)) {
    console.log('[AgentChatTab] 🚫 Skip auto-send - session is closed')
    return
  }
  // 如果组件正在卸载，不发送新消息（避免会话重启）
  if (isUnmounting) {
    console.log('[AgentChatTab] 🚫 Skip auto-send - component is unmounting')
    return
  }
  nextTick(async () => {
    const next = chatInputRef.value?.dequeue()
    if (next) {
      await handleSend(next)
    }
  })
}

// --- streaming 结束时通知父组件刷新文件树，并带出本轮生成的文件路径 ---
const isPdfPath = (filePath) => /\.pdf$/i.test(String(filePath || '').split(/[?#]/)[0])

const sanitizeGeneratedReportFileName = (title) => {
  const base = String(title || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  return base ? `${base.slice(0, 120)}.pdf` : ''
}

const replaceFileNameInPath = (filePath, nextName) => {
  const value = String(filePath || '')
  const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
  return index >= 0 ? `${value.slice(0, index + 1)}${nextName}` : nextName
}

const renameGeneratedReportFilesByTitle = async (filePaths, reportTitle) => {
  const nextName = sanitizeGeneratedReportFileName(reportTitle)
  if (!nextName || !window.electronAPI?.renameAgentFile) return filePaths

  const renamed = []
  for (const filePath of filePaths) {
    if (!isPdfPath(filePath)) {
      renamed.push(filePath)
      continue
    }

    if (getFileNameFromPath(filePath) === nextName) {
      renamed.push(filePath)
      continue
    }

    try {
      const result = await window.electronAPI.renameAgentFile({
        sessionId: props.sessionId,
        oldPath: filePath,
        newName: nextName
      })
      renamed.push(result?.success ? replaceFileNameInPath(filePath, nextName) : filePath)
    } catch (err) {
      console.warn('[AgentChatTab] Failed to rename generated report file:', err)
      renamed.push(filePath)
    }
  }

  return renamed
}

const appendGeneratedFileSummary = (filePaths, turnText) => {
  const missingPaths = filePaths
    .filter(filePath => isPdfPath(filePath))
    .filter(filePath => filePath && !String(turnText || '').includes(filePath))
  if (missingPaths.length === 0) return

  addAssistantMessage([
    'PDF报告已生成成功。',
    '',
    ...missingPaths.map(filePath => `${filePath}`)
  ].join('\n'))
}

watch(isStreaming, async (streaming, wasStreaming) => {
  if (wasStreaming && !streaming) {
    const msgs = messages.value
    let startIdx = msgs.length - 1
    while (startIdx > 0 && msgs[startIdx].role !== 'user') startIdx--
    const filePaths = []
    const turnTextParts = []
    for (let i = startIdx + 1; i < msgs.length; i++) {
      const msg = msgs[i]
      // Claude Code 工具：从 input.file_path 提取
      const fp = msg.input?.file_path || msg.input?.filePath
      if (fp) filePaths.push(fp)
      // MCP 工具结构化输出：提取标准 tool_result/resource_link 返回的文件路径
      if (msg.output) {
        extractToolResultFilePaths(msg.output).forEach(p => filePaths.push(p))
        if (typeof msg.output === 'string') {
          turnTextParts.push(msg.output)
        } else {
          try {
            turnTextParts.push(JSON.stringify(msg.output))
          } catch {}
        }
      }
      // 助手文本 / MCP 工具：从回复内容中提取绝对路径
      if (msg.content) {
        turnTextParts.push(String(msg.content))
        const unixPaths = msg.content.match(/\/(?:[\w\-. ]+\/)+[\w\-. ]+\.[\w]{1,10}/g) || []
        const winPaths = msg.content.match(/[A-Za-z]:\\(?:[\w\-. ]+\\)+[\w\-. ]+\.[\w]{1,10}/g) || []
        unixPaths.concat(winPaths).forEach(p => filePaths.push(p))
      }
    }
    const turnText = turnTextParts.join('\n\n')
    const reportTitle = extractReportTitleFromText(turnText)
    const uniqueFilePaths = await renameGeneratedReportFilesByTitle([...new Set(filePaths)], reportTitle)
    const reportItems = addReportsForFiles(uniqueFilePaths, props.sessionId, { reportTitle })
    const primaryReport = reportItems[reportItems.length - 1]
    const primaryReportName = primaryReport?.name || reportTitle
    let openedPrimaryReport = false
    if (primaryReport?.filePath) {
      activeReportFilePath.value = primaryReport.filePath
      openedPrimaryReport = await openReportInline(primaryReport, { anchorMessageId: false })
    }
    const summarizedGeneratedFilePaths = openedPrimaryReport
      ? uniqueFilePaths.filter(filePath => filePath !== primaryReport.filePath)
      : uniqueFilePaths
    appendGeneratedFileSummary(summarizedGeneratedFilePaths, turnText)
    if (primaryReportName) {
      try {
        await window.electronAPI?.renameAgentSession?.({
          sessionId: props.sessionId,
          title: primaryReportName
        })
      } catch {}
    }

    emit('agent-done', {
      sessionId: props.sessionId,
      filePaths: uniqueFilePaths,
      reportTitle,
      reportName: primaryReportName
    })
  }
})

// --- 消息队列自动发送：流式正常结束后自动消费队列 ---
const streamingWatchStop = watch(isStreaming, (streaming, wasStreaming) => {
  if (wasStreaming && !streaming && queueEnabled.value) {
    // CRITICAL: 用户中断时不自动消费，避免立即发送下一条
    if (isInterrupting.value) {
      console.log('[AgentChatTab] 🛑 User interrupted, skip auto-consume')
      return
    }
    // 流式刚结束 — 如果有错误，暂停队列消费，避免连环出错
    if (error.value) return
    tryAutoConsumeQueue()
  }
})

// --- 队列开关：从关闭切换到启用时，自动消费队列 ---
const queueEnabledWatchStop = watch(queueEnabled, (enabled, wasEnabled) => {
  // 从 false → true，且不在流式输出中，且队列有消息
  if (!wasEnabled && enabled && !isStreaming.value) {
    tryAutoConsumeQueue()
  }
})

// --- 队列持久化：监听队列变化自动保存 ---
let saveQueueTimer = null
let queueWatchStop = null

const startQueuePersistence = () => {
  if (queueWatchStop) return  // 避免重复监听
  if (!chatInputRef.value?.messageQueue) {
    console.error('[AgentChatTab] ❌ Cannot start queue persistence: chatInputRef or messageQueue not ready')
    return
  }

  console.log('[AgentChatTab] 🚀 Starting queue persistence watch for session:', props.sessionId)
  console.log('[AgentChatTab] 🔍 Initial queue state:', chatInputRef.value.messageQueue)

  // defineExpose 会自动解包 ref，所以 messageQueue 直接就是数组
  queueWatchStop = watch(
    () => chatInputRef.value?.messageQueue,  // 添加可选链，防止组件卸载时报错
    (newQueue, oldQueue) => {
      // 组件卸载时 chatInputRef.value 可能为 null，直接忽略
      if (!chatInputRef.value) {
        return
      }

      console.log('[AgentChatTab] 📝 Queue changed:', {
        oldLength: oldQueue?.length || 0,
        newLength: newQueue?.length || 0,
        sessionId: props.sessionId,
        newQueue
      })

      // 忽略 undefined 值（组件卸载时触发）
      if (newQueue === undefined) {
        console.log('[AgentChatTab] ⏭️ Skip save - queue is undefined (component unmounting?)')
        return
      }

      // 防抖保存（避免高频变化时频繁写入数据库）
      if (saveQueueTimer) clearTimeout(saveQueueTimer)
      saveQueueTimer = setTimeout(async () => {
        // CRITICAL: 即使队列为空也要保存，确保数据库与前端状态同步
        // 用户点击停止清空队列时，必须清空数据库中的队列，否则重新打开会话时队列又出现
        try {
          const plainQueue = newQueue ? JSON.parse(JSON.stringify(newQueue)) : []  // 深拷贝避免 Proxy
          await window.electronAPI?.saveAgentQueue({
            sessionId: props.sessionId,
            queue: plainQueue
          })
          console.log('[AgentChatTab] ✅ Saved queue:', plainQueue.length, 'messages', plainQueue)
        } catch (err) {
          console.error('[AgentChatTab] ❌ Failed to save queue:', err)
        }
      }, 300)
    },
    { deep: true }  // 必须 deep: true 才能追踪数组内部变化
  )
}

// 窗口获焦时重新读取队列开关（同步全局设置页面的修改）
// 添加 500ms 防抖，避免频繁切换窗口时重复读取
let focusDebounceTimer = null
const onWindowFocus = () => {
  if (focusDebounceTimer) clearTimeout(focusDebounceTimer)
  focusDebounceTimer = setTimeout(() => {
    loadQueueSetting()
  }, 500)
}

onMounted(async () => {
  // 先注册流式监听器，再加载历史消息，确保钉钉第一条消息的 streaming 事件不被错过
  setupStreamListeners()
  await loadQueueSetting()
  if (window.electronAPI?.getAgentSession) {
    try {
      const latestSession = await window.electronAPI.getAgentSession(props.sessionId)
      if (latestSession) {
        resolvedApiProfileId.value = latestSession.apiProfileId !== undefined
          ? latestSession.apiProfileId
          : (props.apiProfileId || null)
        resolvedModelId.value = latestSession.modelId !== undefined
          ? latestSession.modelId
          : (props.modelId || null)
      }
    } catch (err) {
      console.warn('[AgentChatTab] Failed to read latest session snapshot:', err)
    }
  }
  await initDefaultModel(resolvedApiProfileId.value, resolvedModelId.value)  // 从会话快照读取模型
  await loadMessages()  // 加载历史消息
  await syncActiveSessionState()

  setupDingTalkListeners()  // 钉钉监听器在历史加载后注册，避免与 loadMessages 竞争
  setupWeixinListeners()
  setupFeishuListeners()
  // 绑定滚动事件检测用户手动滚动
  if (messagesListRef.value) {
    messagesListRef.value.addEventListener('scroll', onMessagesScroll, { passive: true })
  }
  startAutoScrollObservers()
  window.addEventListener('focus', onWindowFocus)

  // 恢复持久化队列（需要等待 chatInputRef 准备好）
  await nextTick()  // 确保 ChatInput 组件已渲染

  try {
    const result = await window.electronAPI?.getAgentQueue(props.sessionId)
    console.log('[AgentChatTab] 📖 Loading queue for session:', props.sessionId, result)
    console.log('[AgentChatTab] 🔍 chatInputRef.value:', chatInputRef.value)
    console.log('[AgentChatTab] 🔍 chatInputRef.value?.messageQueue:', chatInputRef.value?.messageQueue)

    if (result?.success && result.queue?.length > 0 && chatInputRef.value) {
      // defineExpose 自动解包，messageQueue 直接是数组，替换整个数组
      chatInputRef.value.messageQueue.splice(0, chatInputRef.value.messageQueue.length, ...result.queue)
      console.log('[AgentChatTab] ✅ Restored queue:', result.queue.length, 'messages', result.queue)

      // CRITICAL: 清除关闭标记，允许队列自动消费
      unmarkSessionClosed(props.sessionId)
    } else {
      console.log('[AgentChatTab] ⏭️ No queue to restore, reasons:', {
        hasResult: !!result,
        success: result?.success,
        queueLength: result?.queue?.length,
        hasChatInputRef: !!chatInputRef.value
      })
    }
  } catch (err) {
    console.error('[AgentChatTab] ❌ Failed to load queue:', err)
  }

  // 启动队列持久化监听（必须在 chatInputRef 有值后）
  startQueuePersistence()

  scrollToBottom(true, true)
  emit('ready', { sessionId: props.sessionId })
})

watch(() => [props.apiProfileId, props.modelId], ([apiProfileId, modelId]) => {
  resolvedApiProfileId.value = apiProfileId || null
  const normalizedModelId = normalizeModelValue(modelId)
  resolvedModelId.value = normalizedModelId || null
  void initDefaultModel(resolvedApiProfileId.value, resolvedModelId.value)
})

// 在组件卸载前保存队列（此时子组件还存在）
onBeforeUnmount(async () => {
  console.log('[AgentChatTab] 🚪 Component before unmount, sessionId:', props.sessionId)

  // CRITICAL: 立即设置卸载标志，防止任何异步操作触发消息发送
  isUnmounting = true
  console.log('[AgentChatTab] 🚫 Set isUnmounting = true, blocking all message sends')

  // 立即停止所有 watch，防止卸载过程中触发异步操作
  if (queueWatchStop) {
    console.log('[AgentChatTab] 🛑 Stopping queue persistence watch')
    queueWatchStop()
  }
  if (streamingWatchStop) {
    console.log('[AgentChatTab] 🛑 Stopping streaming watch (auto-consume)')
    streamingWatchStop()
  }
  if (queueEnabledWatchStop) {
    console.log('[AgentChatTab] 🛑 Stopping queue enabled watch')
    queueEnabledWatchStop()
  }

  // 清除防抖，立即保存队列
  if (saveQueueTimer) {
    console.log('[AgentChatTab] ⏱️ Clearing pending save timer')
    clearTimeout(saveQueueTimer)
  }
  stopAutoScrollObservers()

  console.log('[AgentChatTab] 🔍 Checking queue before unmount:', {
    hasChatInputRef: !!chatInputRef.value,
    hasMessageQueue: !!chatInputRef.value?.messageQueue,
    queueValue: chatInputRef.value?.messageQueue,
    queueLength: chatInputRef.value?.messageQueue?.length
  })

  const currentQueue = chatInputRef.value?.messageQueue
  if (currentQueue && currentQueue.length > 0) {
    console.log('[AgentChatTab] 💾 Saving queue on beforeUnmount...')
    try {
      const plainQueue = JSON.parse(JSON.stringify(currentQueue))
      // CRITICAL: 使用 await 确保保存完成后再卸载
      await window.electronAPI?.saveAgentQueue({
        sessionId: props.sessionId,
        queue: plainQueue
      })
      console.log('[AgentChatTab] ✅ Saved queue on beforeUnmount:', plainQueue.length, 'messages')
    } catch (err) {
      console.error('[AgentChatTab] ❌ Failed to save queue on beforeUnmount:', err)
    }
  } else {
    console.log('[AgentChatTab] ⏭️ No queue to save on beforeUnmount')
  }
})

onUnmounted(() => {
  console.log('[AgentChatTab] 🗑️ Component unmounted, sessionId:', props.sessionId)

  if (messagesListRef.value) {
    messagesListRef.value.removeEventListener('scroll', onMessagesScroll)
  }
  window.removeEventListener('focus', onWindowFocus)
  if (focusDebounceTimer) clearTimeout(focusDebounceTimer)
  // watch 已在 onBeforeUnmount 中停止，无需重复
  cleanup()
})

defineExpose({
  focus: () => chatInputRef.value?.focus(),
  insertText,
  sendInitialMessage: handleSend,
  openReportInline,
  setActiveReport: (report) => {
    if (report?.filePath) {
      activeReportFilePath.value = report.filePath
    }
  }
})
</script>

<style scoped>
.agent-chat-tab {
  display: flex;
  flex-direction: column;
  position: relative;
  height: 100%;
  background: var(--panel-bg);
}

.messages-region {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.messages-list {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
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

.inline-report-preview {
  width: min(calc(100% - 32px), 1280px);
  height: min(clamp(520px, 72vh, 860px), calc(100% - 32px));
  margin: 0 auto 16px;
  display: flex;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-color);
}

.inline-report-preview.inline-report-preview-maximized {
  width: min(calc(100% - 16px), 1600px);
  height: min(88vh, calc(100% - 32px), 1040px);
  margin-bottom: 20px;
}

.inline-report-preview :deep(.file-preview) {
  flex: 1;
  width: 100%;
  min-width: 0;
  height: 100%;
  border-top: none;
}

.inline-report-preview :deep(.preview-header) {
  display: none;
}

.inline-report-preview :deep(.preview-body) {
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.inline-report-preview :deep(.preview-pdf) {
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.inline-report-preview :deep(.pdf-container) {
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.inline-report-preview :deep(.pdf-iframe),
.inline-report-preview :deep(.pdf-webview) {
  display: block;
  width: 100%;
  height: 100%;
}

/* Welcome Guide */
.welcome-guide {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}

.welcome-icon {
  color: var(--primary-color);
  opacity: 0.7;
  margin-bottom: 16px;
}

.welcome-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-color);
  margin: 0 0 8px;
}

.welcome-desc {
  font-size: 14px;
  color: var(--text-color-muted);
  margin: 0 0 24px;
  max-width: 400px;
  line-height: 1.6;
}

/* 钉钉观察模式提示条 */
.dingtalk-observe-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: var(--warning-bg);
  border-top: 1px solid var(--border-color);
  font-size: 12px;
  color: var(--text-color-secondary);
  flex-shrink: 0;
}

/* 历史信息提示条 */
.status-hint-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: var(--info-bg);
  border-top: 1px solid var(--border-color);
  font-size: 12px;
  color: var(--text-color-secondary);
  flex-shrink: 0;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  margin: 8px 16px;
  background: rgba(255, 77, 79, 0.1);
  border: 1px solid rgba(255, 77, 79, 0.3);
  border-radius: 8px;
  color: #ff4d4f;
  font-size: 13px;
}
</style>
