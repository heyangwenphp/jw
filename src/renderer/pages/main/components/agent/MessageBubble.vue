<template>
  <div class="message-bubble" :class="[message.role]" @contextmenu.prevent="handleContextMenu">
    <div class="bubble-avatar">
      <Icon :name="avatarIconName" :size="16" />
    </div>
    <div class="bubble-content">
      <div class="bubble-capture" ref="captureRef">
        <div v-if="message.role === 'assistant' && visibleThinkingText" class="thinking-section">
          <div class="thinking-header" @click="toggleThinkingCollapse" :title="isThinkingCollapsed ? t('common.expand') : t('common.collapse')">
            <Icon name="brain" :size="14" />
            <span class="thinking-title">{{ t('agent.thinkingProcess') }}</span>
            <Icon
              :name="isThinkingCollapsed ? 'chevronRight' : 'chevronDown'"
              :size="14"
              class="thinking-toggle-icon"
            />
          </div>
          <div class="thinking-body" v-show="!isThinkingCollapsed">
            <pre class="thinking-content">{{ visibleThinkingText }}</pre>
          </div>
        </div>
        <div v-else-if="message.role === 'assistant' && thinkingStatus && !hasVisibleBubbleBody" class="thinking-section">
          <div class="thinking-header">
            <Icon name="brain" :size="14" />
            <span class="thinking-title">{{ thinkingStatus }}</span>
          </div>
        </div>
        <!-- 外部来源标识 -->
        <div v-if="externalSenderLabel" class="external-sender">
          {{ externalSenderLabel }}
        </div>
        <!-- 文件区域（如果消息包含文件） -->
        <div v-if="message.files && message.files.length > 0" class="bubble-files">
          <div
            v-for="(file, index) in message.files"
            :key="index"
            class="bubble-file-item"
            :title="file.name"
          >
            <Icon name="fileText" :size="14" class="bubble-file-icon" />
            <span class="bubble-file-name">{{ file.name }}</span>
          </div>
        </div>
        <!-- 图片区域（如果消息包含图片） -->
        <div v-if="message.images && message.images.length > 0" class="bubble-images">
          <div
            v-for="(img, index) in message.images"
            :key="index"
            class="bubble-image-item"
            @click="handleImageClick(img)"
            @contextmenu.prevent.stop="handleImageContextMenu($event, img)"
          >
            <img
              :src="`data:${img.mediaType};base64,${img.base64}`"
              :alt="`Image ${index + 1}`"
              class="bubble-image"
            />
          </div>
        </div>
        <!-- 文字内容（过滤掉附件占位符） -->
        <div
          v-if="hasVisibleBubbleBody"
          class="bubble-body jedi-markdown-preview"
          :class="{ 'user-clamped': shouldClampUserMessage && isUserCollapsed, 'user-toggleable': shouldClampUserMessage }"
          ref="bodyRef"
          v-html="renderedContent"
          @click="handleBubbleBodyClick"
        ></div>
        <div v-if="shouldClampUserMessage" class="bubble-expand-row">
          <button class="bubble-expand-btn" @click="toggleUserCollapse">
            {{ isUserCollapsed ? t('common.expand') : t('common.collapse') }}
          </button>
        </div>
      </div>
      <div class="bubble-meta" :class="{ 'notebook-actions': isNotebookAssistant }" v-if="message.timestamp || message.role === 'assistant'">
        <span v-if="message.timestamp">{{ formatTime(message.timestamp) }}</span>
        <template v-if="message.role === 'assistant' && !isNotebookMode">
          <button
            v-if="reportMarkdownDownloadTarget"
            class="bubble-save-btn"
            title="下载 MD 文档"
            @click="downloadReportMarkdown"
          >
            <Icon name="download" :size="12" />
          </button>
          <button
            v-if="hasVisibleBubbleBody"
            class="bubble-save-btn"
            :title="t('agent.saveAsImage')"
            @click="saveAsImage"
          >
            <Icon name="image" :size="12" />
          </button>
          <button class="bubble-save-btn" :title="t('agent.copyContent')" @click="copyContent">
            <Icon name="copy" :size="12" />
          </button>
        </template>
        <template v-else-if="isNotebookAssistant">
          <button class="bubble-save-btn" :title="t('notebook.chat.saveImageToSource')" @click="emitNotebookImageAction('save-image-to-source')">
            <Icon name="imageArrowLeft" :size="12" />
          </button>
          <button class="bubble-save-btn" :title="t('notebook.chat.saveImageToAchievement')" @click="emitNotebookImageAction('save-image-to-achievement')">
            <Icon name="imageArrowRight" :size="12" />
          </button>
          <button class="bubble-save-btn" :title="t('agent.copyContent')" @click="copyContent">
            <Icon name="copy" :size="12" />
          </button>
          <button class="bubble-save-btn" :title="t('notebook.chat.copyContentToSource')" @click="copyContentToSource">
            <Icon name="copyArrowLeft" :size="12" />
          </button>
          <button class="bubble-save-btn" :title="t('notebook.chat.copyContentToAchievement')" @click="copyContentToAchievement">
            <Icon name="copyArrowRight" :size="12" />
          </button>
        </template>
      </div>
    </div>
  </div>
  <ContextMenu ref="contextMenuRef" :items="contextMenuItems" @select="onContextMenuSelect" />
</template>

<script setup>
import { computed, ref, onMounted, watch, nextTick } from 'vue'
import { useMessage } from 'naive-ui'
import Icon from '@components/icons/Icon.vue'
import ContextMenu from '@components/ContextMenu.vue'
import { useLocale } from '@composables/useLocale'
import { renderMarkdownWithHighlight } from '@utils/highlight-utils'
import { escapeHtml, renderMessageHtml, trimTrailingPathPunctuation } from '@utils/message-render-utils'
import { renderAssistantMessageContent } from '@utils/agent-message-display'
import { isSourceReferenceLabel, isSourceReferenceLine, renderSourceReferenceIcons } from '@utils/source-reference-render-utils'
import { copyTextToClipboard } from '@utils/clipboard-utils'
import { buildFileDownloadUrl, buildWebRawFileUrl, downloadFileFromUrl } from '@utils/file-preview-url-utils'
import { applyCanvasSafeStyles, canvasToOpaqueDataUrl, resolveCanvasBackgroundColor } from '@utils/canvas-capture-utils'
import {
  compactThinkingText,
  extractVisibleReportFromThinking,
  sanitizeAgentVisibleText,
  summarizeThinkingStatus
} from '@utils/agent-thinking-display'

const { t } = useLocale()
const messageApi = useMessage()

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  sessionCwd: {
    type: String,
    default: null
  },
  chatMode: {
    type: String,
    default: 'agent'
  }
})

const emit = defineEmits([
  'preview-image',
  'preview-link',
  'preview-path',
  'run-command',
  'save-image-to-source',
  'save-image-to-achievement',
  'copy-content-to-source',
  'copy-content-to-achievement',
  'add-path-to-source',
  'add-path-to-achievement'
])

// 调试日志：检�?message 对象中的文件数据
console.log('[MessageBubble] mounted/updated - message:', {
  role: props.message.role,
  content: props.message.content?.substring(0, 30),
  hasFiles: !!props.message.files,
  fileCount: props.message.files?.length || 0,
  files: props.message.files?.map(f => ({ name: f.name, contentLength: f.content?.length }))
})

const bodyRef = ref(null)
const captureRef = ref(null)
const isUserCollapsed = ref(true)
const isThinkingCollapsed = ref(true)
const isUserOverflowing = ref(false)
const isNotebookMode = computed(() => props.chatMode === 'notebook')
const isNotebookAssistant = computed(() => isNotebookMode.value && props.message.role === 'assistant')
const promotedThinkingText = computed(() => extractVisibleReportFromThinking(props.message.thinking))
const visibleThinkingText = computed(() => compactThinkingText(props.message.thinking || ''))
const assistantDisplayContent = computed(() => {
  const content = sanitizeAgentVisibleText(props.message.content || '')
  return content || promotedThinkingText.value
})
const thinkingStatus = computed(() => {
  if (props.message.role !== 'assistant' || assistantDisplayContent.value || visibleThinkingText.value) return ''
  return summarizeThinkingStatus(props.message.thinking)
})
const shouldClampUserMessage = computed(() => isNotebookMode.value && props.message.role === 'user' && isUserOverflowing.value)
const avatarIconName = computed(() => {
  if (props.message.role === 'user') return 'user'
  if (props.message.role === 'system') return 'info'
  return 'robot'
})
const externalSenderLabel = computed(() => {
  if (!props.message.senderNick) return ''
  if (props.message.source === 'dingtalk') return `${props.message.senderNick}${t('agent.dingtalkSuffix')}`
  if (props.message.source === 'weixin') return `${props.message.senderNick}${t('agent.weixinSuffix')}`
  if (props.message.source === 'feishu') return `${props.message.senderNick}${t('agent.feishuSuffix')}`
  return ''
})

const getMessageSessionId = () => props.message?.sessionId || props.message?.conversationId || props.message?.conversation_id

const normalizePathForAction = async (rawPath) => {
  if (!rawPath) return rawPath

  let normalizedPath = trimTrailingPathPunctuation(rawPath)
  if (!normalizedPath) return rawPath

  if (/^\.\.?[/\\]/.test(normalizedPath) && props.sessionCwd) {
    normalizedPath = await window.electronAPI.resolvePath(props.sessionCwd, normalizedPath)
  }

  const sessionId = getMessageSessionId()
  try {
    const fileData = await window.electronAPI.readAbsolutePath({
      filePath: normalizedPath,
      sessionId,
      confirmed: true
    })
    if (!fileData?.error) {
      return fileData.path || fileData.filePath || normalizedPath
    }
  } catch {
    // ignore and fall back to normalized path
  }

  return normalizedPath
}

const getFileNameFromPath = (filePath) => {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || 'download'
}

const ensureMarkdownFileName = (name = '') => {
  const trimmed = String(name || '').trim() || 'report.md'
  return /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`
}

const toBrowserUrl = (url) => {
  if (!url || typeof window === 'undefined') return url
  try {
    return new URL(url, window.location.href).href
  } catch {
    return url
  }
}

const openBlankPreviewWindow = () => {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null
  const previewWindow = window.open('about:blank', '_blank')
  if (previewWindow) {
    try {
      previewWindow.opener = null
    } catch { /* ignore cross-window hardening failures */ }
  }
  return previewWindow
}

const buildPathPreviewUrl = (filePath) => buildWebRawFileUrl({
  filePath,
  sessionId: getMessageSessionId(),
  isExternalFile: true
})

const openPathPreviewWindow = (filePath, previewWindow = null) => {
  if (!filePath) return false
  const url = toBrowserUrl(buildPathPreviewUrl(filePath))

  if (previewWindow && !previewWindow.closed) {
    previewWindow.location.href = url
    return true
  }

  const opened = typeof window !== 'undefined' && typeof window.open === 'function'
    ? window.open(url, '_blank', 'noopener,noreferrer')
    : null
  return Boolean(opened)
}

const downloadPath = async (rawPath) => {
  const resolvedPath = await normalizePathForAction(rawPath)
  if (!resolvedPath) return

  const url = buildFileDownloadUrl({
    filePath: resolvedPath,
    sessionId: getMessageSessionId(),
    isExternalFile: true
  })
  downloadFileFromUrl(url, getFileNameFromPath(resolvedPath))
}

const downloadMarkdownContent = (filename, content) => {
  if (typeof document === 'undefined') return false
  const blob = new Blob([String(content || '')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    return downloadFileFromUrl(url, ensureMarkdownFileName(filename))
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

const decodeHtmlAttr = (value = '') => {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

const getRenderedLinkType = (href = '') => /^https?:\/\//i.test(decodeHtmlAttr(href)) ? 'url' : 'path'

const normalizeRenderedHref = (href = '', type = '') => {
  let normalized = decodeHtmlAttr(href)
  if (type === 'path') {
    try {
      normalized = decodeURI(normalized)
    } catch {
      // keep the original href when it is not URI-encoded
    }
  }
  return normalized
}

const linkPdfPathLines = (content = '') => {
  const pdfPathLinePattern = /((?:PDF|pdf|报告)[^\r\n]{0,30}(?:路径|地址|文件)[�?\s]*)(?!\[)((?:[a-zA-Z]:[\\/]|\\\\)[^\r\n]+?\.pdf)/g
  const linkedInlinePaths = content.replace(pdfPathLinePattern, (_match, prefix, filePath) => {
    const safeTarget = filePath.replace(/>/g, '%3E')
    return `${prefix}[${filePath}](<${safeTarget}>)`
  })

  const standalonePdfPathPattern = /(^|\n)(?!\s*[-*]\s*\[)(\s*)((?:[a-zA-Z]:[\\/]|\\\\)[^\r\n]+?\.pdf)(?=\s*(?:\n|$))/g
  return linkedInlinePaths.replace(standalonePdfPathPattern, (_match, lineStart, indent, filePath) => {
    const safeTarget = filePath.replace(/>/g, '%3E')
    return `${lineStart}${indent}[${filePath}](<${safeTarget}>)`
  })
}

const renderFieldCard = (body = '') => {
  const rows = []
  body.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) return

    const normalizedLine = line.replace(/^[-*]\s+/, '')
    if (
      rows.length > 0 &&
      isSourceReferenceLabel(rows[rows.length - 1].label) &&
      isSourceReferenceLine(normalizedLine)
    ) {
      rows[rows.length - 1].value = `${rows[rows.length - 1].value}\n${normalizedLine}`
      return
    }

    const match = normalizedLine.match(/^([^:：]{1,80})[:：]\s*(.*)$/)
    if (match) {
      rows.push({
        label: match[1].trim(),
        value: match[2].trim() || 'N/A'
      })
      return
    }

    if (rows.length > 0) {
      rows[rows.length - 1].value = `${rows[rows.length - 1].value}\n${normalizedLine}`
    }
  })

  if (rows.length === 0) return ''

  const rowHtml = rows.map((row) => `
    <div class="field-card-row">
      <div class="field-card-label">${escapeHtml(row.label)}</div>
      <div class="field-card-value">${isSourceReferenceLabel(row.label) ? (renderSourceReferenceIcons(row.value) || renderMessageHtml(row.value, {
        platform: window.electronAPI?.platform || 'win32'
      })) : renderMessageHtml(row.value, {
        platform: window.electronAPI?.platform || 'win32'
      })}</div>
    </div>
  `).join('')

  return `<div class="field-card">${rowHtml}</div>`
}

const renderMarkdownFieldCards = (content = '') => {
  const cards = []
  const markdown = content.replace(/(?:^|\n):::\s*field-card\s*\n([\s\S]*?)\n:::/g, (_match, body) => {
    const token = `JEDI_FIELD_CARD_${cards.length}_TOKEN`
    cards.push({
      token,
      html: renderFieldCard(body)
    })
    return `\n\n${token}\n\n`
  })

  let html = renderMarkdownWithHighlight(linkPdfPathLines(markdown))
  cards.forEach(({ token, html: cardHtml }) => {
    html = html.split(`<p>${token}</p>`).join(cardHtml)
    html = html.split(token).join(cardHtml)
  })
  return html
}

const enhancePdfLinks = (html = '') => {
  return html.replace(/<a\s+href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gi, (match, href, attrs, label) => {
    if (!/\.pdf(?:$|[?#])/i.test(decodeHtmlAttr(href))) return match
    if (/clickable-link-action|pdf-link-group/.test(match)) return match

    const linkType = getRenderedLinkType(href)
    return `<span class="clickable-link-group pdf-link-group">
      <a href="${href}"${attrs} class="clickable-link" data-link-type="${linkType}" data-file-kind="pdf" data-href="${href}">${label}</a>
      <button type="button" class="clickable-link-action" data-link-type="${linkType}" data-file-kind="pdf" data-href="${href}" data-link-action="preview">预览</button>
      <button type="button" class="clickable-link-action" data-link-type="${linkType}" data-file-kind="pdf" data-href="${href}" data-link-action="download">下载</button>
    </span>`
  })
}

const renderAssistantContent = (content = '') => renderAssistantMessageContent(content, {
  platform: window.electronAPI?.platform || 'win32'
})

/**
 * 简单的 Markdown 渲染（代码块、加粗、斜体、链接、路径）
 */
const renderedContent = computed(() => {
  let text = props.message.role === 'assistant'
    ? assistantDisplayContent.value
    : (props.message.content || '')

  // 如果有图片且内容只是 [图片] 占位符，不显示文�?
  if (props.message.images && props.message.images.length > 0 && text === '[图片]') {
    return ''
  }
  // 如果有文件且内容只是 [文件] 占位符，不显示文�?
  if (props.message.files && props.message.files.length > 0 && text === '[文件]') {
    return ''
  }
  // 如果有图�?文件且内容只�?[图片+文件] 占位符，不显示文�?
  if (props.message.images && props.message.images.length > 0 && props.message.files && props.message.files.length > 0 && text === '[图片+文件]') {
    return ''
  }
  if (props.message.role === 'assistant') {
    return renderAssistantContent(text)
  }

  return renderMessageHtml(text, {
    platform: window.electronAPI?.platform || 'win32'
  })
})

const hasVisibleBubbleBody = computed(() => renderedContent.value.trim().length > 0)

const getMarkdownFilePath = (file = {}) => file.filePath || file.path || file.absolutePath || file.relativePath || ''
const isMarkdownFile = (file = {}) => {
  const name = String(file.name || getMarkdownFilePath(file) || '')
  return /\.(md|markdown)$/i.test(name)
}

const extractMarkdownPathFromText = (text = '') => {
  const match = String(text || '').match(/((?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/])(?:[^\r\n<>:"|?*]+[\\/])*[^\r\n<>:"|?*]+\.m(?:d|arkdown))/i)
  return match?.[1]?.trim() || ''
}

const isAssistantReportMarkdown = computed(() => {
  if (props.message.role !== 'assistant') return false
  const text = assistantDisplayContent.value.trim()
  return /^#\s+/.test(text) && /(?:项目线索统计|(?:单个)?项目线索介绍|投资研判|清华早期创业项目线索分析报告)/.test(text)
})

const reportMarkdownDownloadTarget = computed(() => {
  if (props.message.role !== 'assistant') return null

  const markdownFile = Array.isArray(props.message.files)
    ? props.message.files.find(isMarkdownFile)
    : null
  if (markdownFile) {
    return {
      type: 'path',
      path: getMarkdownFilePath(markdownFile),
      name: markdownFile.name || getFileNameFromPath(getMarkdownFilePath(markdownFile))
    }
  }

  const markdownPath = extractMarkdownPathFromText(assistantDisplayContent.value)
  if (markdownPath) {
    return {
      type: 'path',
      path: markdownPath,
      name: getFileNameFromPath(markdownPath)
    }
  }

  if (isAssistantReportMarkdown.value) {
    const title = assistantDisplayContent.value.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'report'
    return {
      type: 'content',
      name: title,
      content: assistantDisplayContent.value
    }
  }

  const content = assistantDisplayContent.value.trim()
  if (content) {
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'report'
    return {
      type: 'content',
      name: title,
      content
    }
  }

  return null
})

const measureUserClampState = async () => {
  if (!isNotebookMode.value || props.message.role !== 'user' || !hasVisibleBubbleBody.value) {
    isUserOverflowing.value = false
    isUserCollapsed.value = true
    return
  }
  await nextTick()
  const el = bodyRef.value
  if (!el) return
  const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 22.4
  const maxHeight = lineHeight * 10 + 2
  const overflow = el.scrollHeight > maxHeight
  isUserOverflowing.value = overflow
  isUserCollapsed.value = overflow
}

const toggleUserCollapse = () => {
  if (!isUserOverflowing.value) return
  isUserCollapsed.value = !isUserCollapsed.value
}

const toggleThinkingCollapse = () => {
  isThinkingCollapsed.value = !isThinkingCollapsed.value
}

watch(() => props.message.content, () => {
  isUserCollapsed.value = true
  measureUserClampState()
})

watch(() => props.chatMode, () => {
  isUserCollapsed.value = true
  measureUserClampState()
})

onMounted(() => {
  measureUserClampState()
})

const handleBubbleBodyClick = async (e) => {
  // 代码块操作按�?
  const actionBtn = e.target.closest('.hljs-action-btn')
  if (actionBtn) {
    const action = actionBtn.dataset.action
    const code = actionBtn.dataset.code
    if (action === 'copy' && code) {
      try {
        await copyTextToClipboard(code)
        actionBtn.classList.add('copied')
        setTimeout(() => actionBtn.classList.remove('copied'), 1500)
      } catch { /* clipboard unavailable */ }
    } else if (action === 'run' && code) {
      emit('run-command', code.trim())
    }
    return
  }

  const link = e.target.closest('.clickable-link, .clickable-link-action, a[href]')
  if (link) {
    await handleLinkClick(e)
    return
  }

  if (!(isNotebookMode.value && props.message.role === 'user' && isUserOverflowing.value)) {
    return
  }

  // 选中文本时不触发展开收起
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed) return

  toggleUserCollapse()
}

/**
 * 点击事件委托：普通点击预览，Ctrl+点击外部打开
 */
const handleLinkClick = async (e) => {
  const link = e.target.closest('.clickable-link, .clickable-link-action, a[href]')
  if (!link) return

  e.preventDefault()
  e.stopPropagation()
  let type = link.dataset.linkType
  let href = link.dataset.href
  const linkAction = link.dataset.linkAction || ''

  if (!href && link.tagName?.toLowerCase() === 'a') {
    href = link.getAttribute('href') || ''
  }
  if (!type && href) {
    type = /^https?:\/\//i.test(href) ? 'url' : 'path'
  }
  href = normalizeRenderedHref(href, type)
  if (!href) return

  const previewWindow = type === 'path' && linkAction === 'preview'
    ? openBlankPreviewWindow()
    : null
  let resolvedPath = href
  if (type === 'path') {
    resolvedPath = await normalizePathForAction(href)
  }

  // Ctrl/Cmd+点击：在外部打开
  if (e.ctrlKey || e.metaKey) {
    if (type === 'url') {
      await window.electronAPI.openExternal(href)
    } else if (type === 'path') {
      if (linkAction === 'download') {
        await downloadPath(resolvedPath)
        return
      }
      if (linkAction === 'preview') {
        openPathPreviewWindow(resolvedPath, previewWindow)
        return
      }
      await window.electronAPI.openPath(resolvedPath)
    }
  }
  // 普通点击：预览
  else {
    if (type === 'url') {
      await window.electronAPI.openExternal(href)
    } else if (type === 'path') {
      // 文件路径：请求后端读取文件并预览（文件）或打开（目录）
      if (linkAction === 'download') {
        await downloadPath(resolvedPath)
        return
      }
      if (linkAction === 'preview') {
        openPathPreviewWindow(resolvedPath, previewWindow)
        return
      }
      emit('preview-path', resolvedPath)
    }
  }
}

const formatTime = (timestamp) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * 点击图片处理 - 在右侧面板预�?
 */
const handleImageClick = (img) => {
  // 发射事件到父组件，传递图片数�?
  emit('preview-image', {
    type: 'image',
    name: img.fileName || 'image.png',
    content: `data:${img.mediaType};base64,${img.base64}`,
    size: img.base64 ? Math.round((img.base64.length * 3) / 4) : 0, // base64 大小估算
    ext: `.${img.mediaType?.split('/')[1] || 'png'}`
  })
}

const buildImagePreviewPayload = (img) => ({
  dataUrl: `data:${img.mediaType};base64,${img.base64}`,
  message: props.message,
  filename: img.fileName || 'image.png'
})

/**
 * 右键菜单
 */
const contextMenuRef = ref(null)
const contextMenuItems = ref([])
const contextMenuPath = ref(null)
const contextMenuImageData = ref(null)

const handleImageContextMenu = (event, img) => {
  if (!isNotebookMode.value) {
    handleContextMenu(event)
    return
  }

  contextMenuPath.value = null
  contextMenuImageData.value = buildImagePreviewPayload(img)
  contextMenuItems.value = [
    { key: 'save-image-to-source', label: t('notebook.chat.saveImageToSource') },
    { key: 'save-image-to-achievement', label: t('notebook.chat.saveImageToAchievement') }
  ]
  contextMenuRef.value.show(event.clientX, event.clientY)
}

const handleContextMenu = async (event) => {
  const sel = window.getSelection()?.toString() || ''
  const link = event.target?.closest?.('.clickable-link, .clickable-link-action')
  const linkType = link?.dataset?.linkType
  const linkHref = normalizeRenderedHref(link?.dataset?.href || '', linkType)
  const linkFileKind = link?.dataset?.fileKind
  contextMenuPath.value = null
  contextMenuImageData.value = null
  const items = [
    { key: 'copy-selection', label: t('agent.copySelection'), disabled: !sel },
    { key: 'copy-content', label: t('agent.copyContent') }
  ]

  if (linkType === 'path' && linkHref) {
    contextMenuPath.value = await normalizePathForAction(linkHref)
    items.push({ key: 'preview-path-link', label: 'Preview in browser' })
    if (linkFileKind === 'pdf') {
      items.push({ key: 'download-path-link', label: t('agent.files.download') })
    }
  }

  if (isNotebookMode.value && linkType === 'path' && linkHref) {
    const resolvedPath = contextMenuPath.value || await normalizePathForAction(linkHref)
    const sessionId = getMessageSessionId()
    try {
      const fileData = await window.electronAPI.readAbsolutePath({
        filePath: resolvedPath,
        sessionId,
        confirmed: true
      })

      if (!fileData?.error && fileData?.type !== 'directory') {
        contextMenuPath.value = fileData.path || fileData.filePath || resolvedPath
        items.push(
          { key: 'add-path-to-source', label: t('notebook.chat.addLinkToSource') },
          { key: 'add-path-to-achievement', label: t('notebook.chat.addLinkToAchievement') }
        )
      }
    } catch {
      contextMenuPath.value = null
    }
  }

  if (props.message.role === 'assistant') {
    if (isNotebookMode.value) {
      items.push(
        { key: 'save-image-to-source', label: t('notebook.chat.saveImageToSource') },
        { key: 'save-image-to-achievement', label: t('notebook.chat.saveImageToAchievement') },
        { key: 'copy-content-to-source', label: t('notebook.chat.copyContentToSource') },
        { key: 'copy-content-to-achievement', label: t('notebook.chat.copyContentToAchievement') }
      )
    } else {
      items.push({ key: 'save-as-image', label: t('agent.saveAsImage') })
    }
  }
  contextMenuItems.value = items
  contextMenuRef.value.show(event.clientX, event.clientY)
}

const onContextMenuSelect = async (key) => {
  if (key === 'copy-selection') {
    try {
      await copyTextToClipboard(window.getSelection()?.toString() || '')
    } catch {
      messageApi.error(t('common.copyFailed'))
    }
  } else if (key === 'copy-content') {
    await copyContent()
  } else if (key === 'save-as-image') {
    await saveAsImage()
  } else if (key === 'save-image-to-source') {
    if (contextMenuImageData.value) {
      emit('save-image-to-source', contextMenuImageData.value)
    } else {
      await emitNotebookImageAction('save-image-to-source')
    }
  } else if (key === 'save-image-to-achievement') {
    if (contextMenuImageData.value) {
      emit('save-image-to-achievement', contextMenuImageData.value)
    } else {
      await emitNotebookImageAction('save-image-to-achievement')
    }
  } else if (key === 'copy-content-to-source') {
    await copyContentToSource()
  } else if (key === 'copy-content-to-achievement') {
    await copyContentToAchievement()
  } else if (key === 'preview-path-link') {
    if (!contextMenuPath.value) return
    const resolvedPath = await normalizePathForAction(contextMenuPath.value)
    openPathPreviewWindow(resolvedPath)
  } else if (key === 'download-path-link') {
    if (!contextMenuPath.value) return
    await downloadPath(contextMenuPath.value)
  } else if (key === 'add-path-to-source' || key === 'add-path-to-achievement') {
    if (!contextMenuPath.value) return
    const resolvedPath = await normalizePathForAction(contextMenuPath.value)
    emit(key === 'add-path-to-source' ? 'add-path-to-source' : 'add-path-to-achievement', {
      filePath: resolvedPath,
      message: props.message
    })
  }
}

/**
 * 保存消息气泡为图�?
 */
const captureBubbleAsDataUrl = async () => {
  const el = captureRef.value || bodyRef.value
  if (!el) return null

  const html2canvas = (await import('html2canvas')).default
  const captureId = `jedi-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`
  el.dataset.captureId = captureId
  const backgroundColor = resolveCanvasBackgroundColor(el)
  try {
    const canvas = await html2canvas(el, {
      backgroundColor,
      scale: 2,
      useCORS: true,
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

const downloadImageDataUrl = (dataUrl, filename) => {
  if (!dataUrl) return false
  return downloadFileFromUrl(dataUrl, filename)
}

const saveAsImage = async () => {
  try {
    const dataUrl = await captureBubbleAsDataUrl()
    if (!dataUrl) return
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `message-${timestamp}.png`
    const isWebRuntime = window.electronAPI?.platform === 'web'
    let saved = false

    if (!isWebRuntime && typeof window.electronAPI?.saveImage === 'function') {
      const res = await window.electronAPI.saveImage({
        filename,
        base64
      })
      saved = Boolean(res?.success && res.filePath)
    }

    if (!saved) {
      saved = downloadImageDataUrl(dataUrl, filename)
    }

    if (saved) {
      emit('preview-image', {
        type: 'image',
        name: filename,
        content: dataUrl,
        size: Math.round((base64.length * 3) / 4),
        ext: '.png'
      })
      messageApi.success(t('agent.imageSaved'))
    }
  } catch (err) {
    console.error('[MessageBubble] Save as image failed:', err)
  }
}

const downloadReportMarkdown = async () => {
  const target = reportMarkdownDownloadTarget.value
  if (!target) return false

  if (target.type === 'path' && target.path) {
    await downloadPath(target.path)
    return true
  }

  if (target.type === 'content') {
    return downloadMarkdownContent(target.name, target.content)
  }

  return false
}

const emitNotebookImageAction = async (eventName) => {
  try {
    const dataUrl = await captureBubbleAsDataUrl()
    if (!dataUrl) return
    emit(eventName, { dataUrl, message: props.message })
  } catch (err) {
    console.error(`[MessageBubble] ${eventName} failed:`, err)
  }
}

const copyContent = async () => {
  try {
    await copyTextToClipboard(props.message.role === 'assistant' ? assistantDisplayContent.value : (props.message.content || ''))
    messageApi.success(t('common.copySuccess'))
  } catch {
    messageApi.error(t('common.copyFailed'))
  }
}

const copyContentToSource = async () => {
  emit('copy-content-to-source', { content: props.message.role === 'assistant' ? assistantDisplayContent.value : (props.message.content || ''), message: props.message })
}

const copyContentToAchievement = async () => {
  emit('copy-content-to-achievement', { content: props.message.role === 'assistant' ? assistantDisplayContent.value : (props.message.content || ''), message: props.message })
}
</script>

<style scoped>
.message-bubble {
  display: flex;
  gap: 10px;
  padding: 8px 16px;
  transition: background 0.15s;
}

.message-bubble:hover {
  background: unset;
}

.message-bubble.user {
  flex-direction: row-reverse;
}

.bubble-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-color-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--primary-color);
}

.message-bubble.user .bubble-avatar {
  background: var(--primary-color);
  color: white;
}

.bubble-content {
  max-width: 90%;
  min-width: 0;
  position: relative;
}

.bubble-body {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  word-wrap: break-word;
  overflow-wrap: break-word;
  border: 1px solid transparent;
}

.message-bubble.assistant .bubble-body {
  background: var(--bg-color-secondary);
  color: var(--text-color);
  border-top-left-radius: 4px;
}

.message-bubble.user .bubble-body {
  background: var(--primary-color);
  color: white;
  border-top-right-radius: 4px;
}

.message-bubble.system .bubble-avatar {
  background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  color: var(--primary-color);
}

.message-bubble.system .bubble-content {
  max-width: 88%;
}

.message-bubble.system .bubble-body {
  background: var(--bg-color-tertiary);
  color: var(--text-color-secondary);
  border-color: var(--border-color);
  border-style: dashed;
  border-radius: 10px;
  font-size: 13px;
}

.message-bubble.user .bubble-body.user-clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 10;
  overflow: hidden;
}

.message-bubble.user .bubble-body.user-toggleable {
  cursor: pointer;
}

.bubble-expand-row {
  margin-top: 4px;
  padding: 0 4px;
}

.message-bubble.user .bubble-expand-row {
  display: flex;
  justify-content: flex-end;
}

.bubble-expand-btn {
  border: none;
  background: transparent;
  color: var(--text-color-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

/* 普通代码块（无高亮�?*/
.bubble-body :deep(pre:not(.hljs)) {
  background: var(--bg-color-tertiary);
  padding: 10px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 8px 0;
  font-size: 13px;
}

.bubble-body :deep(code) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
}

.bubble-body :deep(code:not(pre code)) {
  background: var(--bg-color-tertiary);
  padding: 2px 6px;
  border-radius: 4px;
}

/* 高亮代码块适配：让 hljs-code-wrapper 保持自身暗色主题 */
.bubble-body :deep(.hljs-code-wrapper) {
  margin: 8px 0;
  border-radius: 6px;
  overflow: hidden;
}

.bubble-body :deep(.hljs-code-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 4px 12px;
  background: rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
}

.bubble-body :deep(.hljs-lang-label) {
  color: rgba(255, 255, 255, 0.45);
  text-transform: lowercase;
  user-select: none;
}

.bubble-body :deep(.hljs-code-actions) {
  display: flex;
  gap: 2px;
}

.bubble-body :deep(.hljs-action-btn) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.bubble-body :deep(.hljs-action-btn:hover) {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

.bubble-body :deep(.hljs-copy-btn.copied) {
  color: #10b981;
}

.bubble-body :deep(.hljs-code-wrapper pre) {
  background: transparent;
  padding: 10px 12px;
  margin: 0;
  flex: 1;
  overflow: auto;
}

.bubble-body :deep(.clickable-link) {
  color: var(--primary-color);
  text-decoration: none;
  cursor: pointer;
  border-bottom: 1px dashed var(--primary-color);
  opacity: 0.85;
  transition: opacity 0.15s;
}

.bubble-body :deep(.clickable-link:hover) {
  opacity: 1;
  border-bottom-style: solid;
}

.bubble-body :deep(.clickable-link-group) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  vertical-align: baseline;
}

.bubble-body :deep(.pdf-link-group) {
  flex-wrap: wrap;
  margin: 0 2px;
}

.bubble-body :deep(.clickable-link-action) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 20px;
  box-sizing: border-box;
  padding: 0 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-color-secondary);
  color: var(--text-color-secondary);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.bubble-body :deep(.clickable-link-action:hover) {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: var(--primary-ghost);
}

.bubble-body :deep(code .clickable-link) {
  border-bottom: none;
  opacity: 1;
  text-decoration: underline;
  text-decoration-style: dashed;
  text-underline-offset: 2px;
}

.message-bubble.user .bubble-body :deep(.clickable-link) {
  color: rgba(255, 255, 255, 0.9);
  border-bottom-color: rgba(255, 255, 255, 0.5);
}

.message-bubble.user .bubble-body :deep(code:not(pre code)) {
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.95);
}

.message-bubble.user .bubble-body :deep(.clickable-link:hover) {
  color: white;
  border-bottom-color: white;
}

/* hover 操作�?- 已移除，按钮内联�?bubble-meta */

.bubble-meta {
  font-size: 11px;
  color: var(--text-color-muted);
  margin-top: 4px;
  padding: 0 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.bubble-meta.notebook-actions {
  gap: 6px;
}

.message-bubble.user .bubble-meta {
  justify-content: flex-end;
}

.bubble-save-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-color-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
  padding: 0;
}

.bubble-content:hover .bubble-save-btn {
  opacity: 1;
}

.bubble-meta.notebook-actions .bubble-save-btn {
  opacity: 1;
}

.bubble-save-btn:hover {
  background: var(--bg-color-tertiary);
  color: var(--primary-color);
}

/* 文件显示区域 */
.bubble-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.bubble-file-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.15);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
  max-width: 100%;
}

.bubble-file-icon {
  flex-shrink: 0;
}

.bubble-file-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-bubble.user .bubble-file-item {
  background: rgba(0, 0, 0, 0.2);
  color: rgba(255, 255, 255, 0.95);
}

.message-bubble.assistant .bubble-file-item {
  background: var(--bg-color-tertiary);
  color: var(--text-color);
}

.message-bubble.assistant .bubble-file-icon {
  color: var(--primary-color);
}

/* 图片显示区域 */
.bubble-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.bubble-image-item {
  max-width: 200px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
  background: var(--bg-color-tertiary);
}

.bubble-image-item:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.bubble-image {
  width: 100%;
  height: auto;
  display: block;
  max-height: 200px;
  object-fit: cover;
}

/* 用户消息的图片样�?*/
.message-bubble.user .bubble-images {
  justify-content: flex-end;
}

/* 外部来源标识 */
.external-sender {
  font-size: 11px;
  color: var(--text-color-muted);
  margin-bottom: 4px;
  padding: 0 4px;
}

.message-bubble.user .external-sender {
  text-align: right;
}

/* KaTeX 公式样式 */
.bubble-body :deep(.katex-display) {
  margin: 8px 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.message-bubble.user .bubble-body :deep(.katex) {
  color: white;
}

/* 思考过程区�?*/
.thinking-section {
  margin-bottom: 8px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  overflow: hidden;
  background: var(--bg-color-tertiary);
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-color-secondary);
  user-select: none;
  transition: background 0.15s;
}

.thinking-header:hover {
  background: var(--bg-color-secondary);
}

.thinking-title {
  flex: 1;
  font-weight: 500;
}

.thinking-toggle-icon {
  flex-shrink: 0;
  transition: transform 0.2s;
}

.thinking-body {
  padding: 10px 14px;
  border-top: 1px solid var(--border-color);
}

.thinking-content {
  margin: 0;
  font-family: 'Consolas', 'Monaco', 'SF Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-color-secondary);
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
</style>
