<template>
  <div class="streaming-indicator" v-if="visible">
    <div class="bubble-avatar">
      <Icon name="robot" :size="16" />
    </div>
    <div class="streaming-content">
      <div v-if="visibleThinkingText" class="thinking-section streaming-thinking">
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
      <div v-else-if="thinkingStatus && !visibleText" class="thinking-section streaming-thinking">
        <div class="thinking-header">
          <Icon name="brain" :size="14" />
          <span class="thinking-title">{{ thinkingStatus }}</span>
        </div>
      </div>
      <div class="streaming-text jedi-markdown-preview" v-if="visibleText" v-html="renderedText"></div>
      <div class="typing-dots" v-else>
        <span></span>
        <span></span>
        <span></span>
        <span v-if="elapsed > 0" class="elapsed-time">{{ elapsed }}s</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Icon from '@components/icons/Icon.vue'
import { useLocale } from '@composables/useLocale'
import { extractLatex, restoreLatex } from '@utils/latex-utils'
import { renderMarkdownWithHighlight } from '@utils/highlight-utils'
import { escapeHtml, normalizeSafeHtmlAnchors, renderMessageHtml } from '@utils/message-render-utils'
import { isSourceReferenceLabel, isSourceReferenceLine, renderSourceReferenceIcons } from '@utils/source-reference-render-utils'
import {
  compactThinkingText,
  extractVisibleReportFromThinking,
  sanitizeAgentVisibleText,
  summarizeThinkingStatus
} from '@utils/agent-thinking-display'

const { t } = useLocale()

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  text: {
    type: String,
    default: ''
  },
  thinking: {
    type: String,
    default: ''
  },
  elapsed: {
    type: Number,
    default: 0
  }
})

const promotedThinkingText = computed(() => extractVisibleReportFromThinking(props.thinking))
const visibleText = computed(() => {
  const text = sanitizeAgentVisibleText(props.text || '')
  return text || promotedThinkingText.value
})
const visibleThinkingText = computed(() => compactThinkingText(props.thinking || ''))
const thinkingStatus = computed(() => visibleText.value || visibleThinkingText.value ? '' : summarizeThinkingStatus(props.thinking))
const isThinkingCollapsed = ref(false)
const toggleThinkingCollapse = () => {
  isThinkingCollapsed.value = !isThinkingCollapsed.value
}

watch(visibleText, (text) => {
  if (!text) {
    isThinkingCollapsed.value = false
  }
})

const renderFieldCard = (body = '') => {
  const rows = []
  const appendToLastRow = (line) => {
    if (rows.length === 0) {
      rows.push({ label: '', value: line })
      return
    }
    rows[rows.length - 1].value = [
      rows[rows.length - 1].value,
      line
    ].filter(Boolean).join('\n')
  }

  body.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) return

    const normalizedLine = line.replace(/^[-*]\s+/, '')
    const headingMatch = normalizedLine.match(/^【([^】]{1,80})】$/)
    if (headingMatch) {
      rows.push({
        label: headingMatch[1].trim(),
        value: ''
      })
      return
    }

    if (
      rows.length > 0 &&
      isSourceReferenceLabel(rows[rows.length - 1].label) &&
      isSourceReferenceLine(normalizedLine)
    ) {
      appendToLastRow(line)
      return
    }

    const isLinkLine = /^<a\b/i.test(normalizedLine) ||
      /^\[[^\]]+\]\(/.test(normalizedLine) ||
      /^https?:\/\//i.test(normalizedLine)
    const match = isLinkLine ? null : normalizedLine.match(/^([^:：]{1,80})[:：]\s*(.*)$/)
    if (match) {
      rows.push({
        label: match[1].trim(),
        value: match[2].trim() || '未查到'
      })
      return
    }

    appendToLastRow(line)
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
  const markdown = content.replace(/(?:^|\n):::\s*field-card\s*\n([\s\S]*?)(?:\n:::|$)/g, (_match, body) => {
    const token = `JEDI_STREAM_FIELD_CARD_${cards.length}_TOKEN`
    cards.push({
      token,
      html: renderFieldCard(body)
    })
    return `\n\n${token}\n\n`
  })

  let html = renderMarkdownWithHighlight(normalizeSafeHtmlAnchors(markdown))
  cards.forEach(({ token, html: cardHtml }) => {
    html = html.split(`<p>${token}</p>`).join(cardHtml)
    html = html.split(token).join(cardHtml)
  })
  return html
}

const renderedText = computed(() => {
  let text = visibleText.value || ''
  // 提取 LaTeX（在 HTML 转义之前）
  const { text: latexProcessed, blocks: latexBlocks } = extractLatex(text)
  text = renderMarkdownFieldCards(latexProcessed)
  // 还原 LaTeX
  text = restoreLatex(text, latexBlocks)
  return text + '<span class="cursor-blink">▎</span>'
})
</script>

<style scoped>
.streaming-indicator {
  display: flex;
  gap: 10px;
  padding: 8px 16px;
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

.streaming-content {
  max-width: 75%;
  min-width: 0;
}

.streaming-text {
  padding: 10px 14px;
  border-radius: 12px;
  border-top-left-radius: 4px;
  background: var(--bg-color-secondary);
  color: var(--text-color);
  font-size: 14px;
  line-height: 1.6;
  word-wrap: break-word;
}

.streaming-text :deep(.cursor-blink) {
  animation: blink 1s step-end infinite;
  color: var(--primary-color);
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.typing-dots {
  display: flex;
  gap: 4px;
  padding: 14px 18px;
  background: var(--bg-color-secondary);
  border-radius: 12px;
  border-top-left-radius: 4px;
}

.typing-dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-color-muted);
  animation: dotPulse 1.4s infinite;
}

.typing-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.elapsed-time {
  width: auto !important;
  height: auto !important;
  background: none !important;
  border-radius: 0 !important;
  animation: none !important;
  font-size: 11px;
  color: var(--text-color-muted);
  margin-left: 6px;
  font-variant-numeric: tabular-nums;
}

/* 流式思考过程 */
.streaming-thinking {
  margin-bottom: 8px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  overflow: hidden;
  background: var(--bg-color-tertiary);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.streaming-thinking:hover {
  border-color: #f59e0b;
  box-shadow: 0 0 0 1px #f59e0b;
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
