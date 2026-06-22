<template>
  <div class="chat-input-area" ref="chatInputAreaRef" :class="{ expanded: isExpanded, 'drag-over': isDragOver }" @dragover="handleDragOver" @dragenter="handleDragEnter" @dragleave="handleDragLeave" @drop="handleDrop">
    <div ref="inputToolbarRef">
      <ChatInputToolbar
        :model-value="modelValue"
        :model-options="modelOptions"
        :context-tokens="contextTokens"
        :queue-enabled="queueEnabled"
        :is-expanded="isExpanded"
        :session-id="sessionId"
        :session-type="sessionType"
        :project-path="projectPath"
        :draft-text="composedInputText"
        :show-capability-button="showCapabilityButton"
        :show-image-upload="showImageUpload"
        :show-file-upload="showFileUpload"
        :show-expand-button="showExpandButton"
        @update:model-value="$emit('update:modelValue', $event)"
        @toggle-queue="$emit('update:queueEnabled', !queueEnabled)"
        @toggle-expanded="toggleExpanded"
        @schedule="handleSchedule"
        @trigger-image-upload="triggerImageUpload"
        @trigger-file-upload="triggerFileUpload"
        @clear="handleClear"
        @use-capability="useCapability"
        @use-capability-refs="applyCapabilityRefs"
      />
    </div>
    <input
      ref="imageInputRef"
      type="file"
      accept="image/png,image/jpeg,image/gif,image/webp"
      multiple
      style="display: none"
      @change="handleImageUpload"
    />
    <input
      ref="fileInputRef"
      type="file"
      multiple
      style="display: none"
      @change="handleFileUpload"
    />

    <div v-if="attachedImages.length > 0" ref="imagePreviewRef">
      <ChatInputImagePreview :images="attachedImages" @remove="removeImage" />
    </div>

    <div v-if="contextFilePreviews.length > 0 || attachedFiles.length > 0" ref="filePreviewRef" class="file-preview-area">
      <div
        v-for="file in contextFilePreviews"
        :key="`context-${file.id}`"
        class="file-preview-item context-file-preview"
        :title="file.filePath || file.fileName"
      >
        <Icon name="fileText" :size="14" class="file-preview-icon" />
        <span class="file-preview-name">{{ file.fileName }}</span>
        <span class="file-preview-size">{{ file.sizeText }}</span>
        <button class="file-preview-remove" @click="removeContextFilePreview(file)">
          <Icon name="close" :size="12" />
        </button>
      </div>
      <div
        v-for="(file, index) in attachedFiles"
        :key="file.id"
        class="file-preview-item"
        :class="{ uploading: file.status === 'uploading', error: file.status === 'error' }"
        :title="file.fileName"
      >
        <Icon name="fileText" :size="14" class="file-preview-icon" />
        <span class="file-preview-name">{{ file.fileName }}</span>
        <span class="file-preview-size">
          {{ file.status === 'uploading' ? file.statusText : file.sizeText }}
        </span>
        <div v-if="file.status === 'uploading'" class="file-preview-progress" aria-hidden="true">
          <div class="file-preview-progress-bar" :style="{ width: `${file.uploadProgress || 0}%` }"></div>
        </div>
        <button class="file-preview-remove" @click="removeFile(index)">
          <Icon name="close" :size="12" />
        </button>
      </div>
    </div>

    <!-- 杈撳叆鍖哄煙 -->
    <div class="input-wrapper" ref="inputWrapperRef">
      <!-- Slash 鍛戒护闈㈡澘 -->
      <ChatInputSlashPanel
        :show="showSlashPanel"
        :unavailable="panelUnavailable"
        :commands="filteredCommands"
        :active-index="slashActiveIndex"
        :title="panelTitle"
        :empty-text="panelEmptyText"
        @select="selectSlashCommand"
        @hover="slashActiveIndex = $event"
      />

      <div v-if="selectedCapabilities.length > 0" class="selected-capability-chips">
        <button
          v-for="cap in selectedCapabilities"
          :key="`${cap.type}-${cap.id}`"
          type="button"
          class="selected-capability-chip"
          :class="`chip-${cap.type}`"
          :title="cap.description || cap.name"
          @click="removeSelectedCapability(cap)"
        >
          <Icon :name="cap.type === 'agent' ? 'robot' : 'zap'" :size="12" />
          <span class="selected-capability-chip-text">{{ cap.marker }}{{ cap.name }}</span>
          <Icon name="close" :size="10" class="selected-capability-chip-remove" />
        </button>
      </div>

      <textarea
        ref="textareaRef"
        v-model="inputText"
        :placeholder="placeholder"
        :disabled="disabled"
        class="chat-textarea"
        :rows="collapsedRows"
        :style="textareaStyle"
        @input="handleInput"
        @keydown="handleKeyDown"
        @paste="handlePaste"
        @contextmenu.prevent="handleInputContextMenu"
      />
      <ChatInputQueuePanel :queue="messageQueue" @update:queue="messageQueue = $event" />

      <!-- Suffix Slot (e.g. for Notebook Source Count) -->
      <slot name="suffix"></slot>

      <!-- 鍋滄/鍙戦€佹寜閽?-->
      <button
        v-if="isStreaming"
        class="stop-btn"
        @click="$emit('cancel')"
        :title="t('agent.stopGeneration')"
      >
        <Icon name="stop" :size="18" />
      </button>
      <button
        v-else
        class="send-btn"
        :disabled="(!hasDraftContent && attachedImages.length === 0 && attachedFiles.length === 0) || hasBlockingFiles || disabled"
        @click="handleSend"
        :title="t('agent.send')"
      >
        <Icon name="send" :size="18" />
      </button>
    </div>
  </div>
  <ContextMenu ref="inputContextMenuRef" :items="inputContextMenuItems" @select="onInputContextMenuSelect" />
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useMessage } from 'naive-ui'
import { useLocale } from '@composables/useLocale'
import Icon from '@components/icons/Icon.vue'
import ContextMenu from '@components/ContextMenu.vue'
import ChatInputToolbar from './ChatInputToolbar.vue'
import ChatInputImagePreview from './ChatInputImagePreview.vue'
import ChatInputSlashPanel from './ChatInputSlashPanel.vue'
import ChatInputQueuePanel from './ChatInputQueuePanel.vue'
import {
  readFileAsBase64,
  getImageMediaType,
  getBase64Size,
  isImageTooLarge,
  formatFileSize,
  isSupportedImageType
} from '@/utils/image-utils'
import {
  buildBuiltinSlashCommands,
  filterSlashCommands,
  mergeSlashCommands,
  normalizeSlashCommands,
  shouldAutoSubmitSlashCommand
} from '@utils/slash-commands'
import {
  addSelectedCapabilityToken,
  buildCapabilityMessageText,
  shouldOpenSlashPanel,
  shouldBlockAsUnavailableSlash,
  isLeadingCapabilitySkillInvocation,
  getCapabilityTriggerAtCursor,
  filterCapabilityItems,
  removeCapabilityTrigger
} from '@utils/chat-input-utils'
import {
  getAttachmentFileSizeLimitMb,
  getServerUploadAttachmentFileSizeLimitMb,
  isServerUploadAttachmentFile,
  isSupportedAttachmentFile
} from '@utils/file-attachment-utils'
import { copyTextToClipboard } from '@utils/clipboard-utils'

const { t } = useLocale()
const message = useMessage()

const props = defineProps({
  isStreaming: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  placeholder: {
    type: String,
    default: ''
  },
  modelValue: {
    type: String,
    default: ''
  },
  contextTokens: {
    type: Number,
    default: 0
  },
  slashCommands: {
    type: Array,
    default: () => []
  },
  slashCommandsSupported: {
    type: Boolean,
    default: true
  },
  enableSlashCommands: {
    type: Boolean,
    default: true
  },
  modelOptions: {
    type: Array,
    default: () => []
  },
  queueEnabled: {
    type: Boolean,
    default: true
  },
  collapsedRows: {
    type: Number,
    default: 3
  },
  collapsedMaxHeight: {
    type: Number,
    default: 200
  },
  collapsedMinHeight: {
    type: Number,
    default: 0
  },
  expandedHeightRatio: {
    type: Number,
    default: 3 / 4
  },
  sessionId: {
    type: String,
    default: null
  },
  sessionType: {
    type: String,
    default: 'chat'
  },
  projectPath: {
    type: String,
    default: null
  },
  contextFiles: {
    type: Array,
    default: () => []
  },
  showCapabilityButton: {
    type: Boolean,
    default: true
  },
  autoSelectInvestmentLeadsSkill: {
    type: Boolean,
    default: false
  },
  showImageUpload: {
    type: Boolean,
    default: true
  },
  showFileUpload: {
    type: Boolean,
    default: true
  },
  showExpandButton: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['send', 'cancel', 'schedule', 'update:modelValue', 'update:queueEnabled', 'enqueue', 'input-change', 'remove-context-file'])

const useCapability = (cap) => {
  if (props.isStreaming && !props.queueEnabled) return
  const prefix = cap.type === 'agent' ? '@' : '/'
  const text = `${prefix}${cap.id}`
  if (props.isStreaming) {
    if (messageQueue.value.length >= MAX_QUEUE_SIZE) return
    messageQueue.value.push({ id: ++queueIdCounter, text })
    emit('enqueue', text)
  } else {
    // 鎻掑叆鍒拌緭鍏ユ褰撳墠鍏夋爣浣嶇疆
    selectedCapabilityRefs.value = addSelectedCapabilityToken(selectedCapabilityRefs.value, cap)
    markDefaultInvestmentLeadsSkillSelected(cap)
    showSlashPanel.value = false
    capabilityTrigger.value = null
    slashFilter.value = ''
    nextTick(() => {
      textareaRef.value?.focus()
      emit('input-change', composedInputText.value)
    })
  }
}

// ============================
// Slash 鍛戒护闈㈡澘
// ============================

const builtinCommands = computed(() => buildBuiltinSlashCommands(t))
const normalizedSdkCommands = computed(() =>
  normalizeSlashCommands(props.slashCommands, {
    source: 'sdk',
    icon: 'zap',
    autoSubmit: false
  })
)

const allCommands = computed(() => {
  if (!props.enableSlashCommands) return []
  return mergeSlashCommands(builtinCommands.value, normalizedSdkCommands.value)
})

const showSlashPanel = ref(false)
const slashActiveIndex = ref(0)
const slashFilter = ref('')
const capabilityTrigger = ref(null)
const capabilityList = ref([])
const selectedCapabilityRefs = ref([])
const capabilityLoading = ref(false)
const capabilitiesLoaded = ref(false)
const capabilityLoadedAt = ref(0)
const DEFAULT_INVESTMENT_LEADS_SKILL_ID = 'daily-investment-leads-report'
const defaultInvestmentLeadsSkillDismissed = ref(false)
const showSlashUnavailableHint = computed(() => props.slashCommandsSupported && !props.enableSlashCommands)

const showCapabilityPanel = computed(() => Boolean(capabilityTrigger.value))
const panelUnavailable = computed(() => !showCapabilityPanel.value && showSlashUnavailableHint.value)

const capabilityCommands = computed(() => {
  if (!capabilityTrigger.value) return []
  return filterCapabilityItems(capabilityList.value, capabilityTrigger.value).map(item => ({
    name: `${capabilityTrigger.value.marker}${item.id}`,
    description: item.description || item.name || '',
    argumentHint: item.type === 'agent' ? t('agent.capTypeAgent') : t('agent.capTypeSkill'),
    source: 'capability',
    icon: item.type === 'agent' ? 'robot' : 'zap',
    autoSubmit: false,
    capabilityId: item.id,
    capabilityType: item.type
  }))
})

const filteredCommands = computed(() => {
  if (!capabilityTrigger.value) {
    return filterSlashCommands(allCommands.value, slashFilter.value)
  }

  if (capabilityTrigger.value.type === 'skill' && capabilityTrigger.value.start === 0 && !inputText.value.includes(' ')) {
    return [
      ...capabilityCommands.value,
      ...filterSlashCommands(allCommands.value, slashFilter.value)
    ]
  }

  return capabilityCommands.value
})

const panelTitle = computed(() => {
  if (capabilityTrigger.value?.type === 'agent') return t('agent.agentMentionTitle')
  if (capabilityTrigger.value?.type === 'skill') return t('agent.skillMentionTitle')
  return t('agent.slashTitle')
})

const panelEmptyText = computed(() => {
  if (capabilityLoading.value) return `${t('common.loading')}...`
  if (capabilityTrigger.value?.type === 'agent') return t('agent.agentMentionNoMatch')
  if (capabilityTrigger.value?.type === 'skill') return t('agent.skillMentionNoMatch')
  return t('agent.slashNoMatch')
})

const selectedCapabilities = computed(() => {
  return selectedCapabilityRefs.value.map(token => {
    const item = capabilityList.value.find(cap => cap.type === token.type && cap.id === token.id)
    return {
      ...token,
      name: item?.name || token.name || token.id,
      description: item?.description || token.description || ''
    }
  })
})

const composedInputText = computed(() => buildCapabilityMessageText(inputText.value, selectedCapabilityRefs.value))
const isDefaultInvestmentLeadsSkillToken = (token) => (
  token?.type === 'skill' && token.id === DEFAULT_INVESTMENT_LEADS_SKILL_ID
)
const hasOnlyDefaultInvestmentLeadsSkillSelected = computed(() => (
  selectedCapabilityRefs.value.length === 1 &&
  isDefaultInvestmentLeadsSkillToken(selectedCapabilityRefs.value[0])
))
const hasDraftContent = computed(() => (
  Boolean(inputText.value.trim()) ||
  selectedCapabilityRefs.value.some(token => !isDefaultInvestmentLeadsSkillToken(token))
))

const markDefaultInvestmentLeadsSkillSelected = (token) => {
  if (isDefaultInvestmentLeadsSkillToken(token)) {
    defaultInvestmentLeadsSkillDismissed.value = false
  }
}

const canAutoSelectDefaultInvestmentLeadsSkill = () => (
  props.autoSelectInvestmentLeadsSkill &&
  props.showCapabilityButton &&
  props.sessionType === 'chat' &&
  !props.disabled
)

const ensureDefaultInvestmentLeadsSkillSelected = async () => {
  if (!canAutoSelectDefaultInvestmentLeadsSkill()) return
  if (defaultInvestmentLeadsSkillDismissed.value) return
  if (selectedCapabilityRefs.value.some(isDefaultInvestmentLeadsSkillToken)) return

  await loadInputCapabilities()
  const defaultSkill = capabilityList.value.find(cap => (
    cap.type === 'skill' && cap.id === DEFAULT_INVESTMENT_LEADS_SKILL_ID
  ))
  if (!defaultSkill) return

  selectedCapabilityRefs.value = addSelectedCapabilityToken(selectedCapabilityRefs.value, defaultSkill)
  emit('input-change', composedInputText.value)
}

const removeSelectedCapability = (cap) => {
  if (isDefaultInvestmentLeadsSkillToken(cap)) {
    defaultInvestmentLeadsSkillDismissed.value = true
  }
  selectedCapabilityRefs.value = selectedCapabilityRefs.value.filter(token => (
    token.type !== cap.type || token.id !== cap.id
  ))
  emit('input-change', composedInputText.value)
  nextTick(() => textareaRef.value?.focus())
}

// 鐩戝惉 filteredCommands 鍙樺寲锛岄噸缃储寮?
watch(filteredCommands, () => {
  slashActiveIndex.value = 0
})

watch(() => props.projectPath, () => {
  capabilitiesLoaded.value = false
  capabilityList.value = []
  selectedCapabilityRefs.value = []
  defaultInvestmentLeadsSkillDismissed.value = false
  capabilityTrigger.value = null
  showSlashPanel.value = false
  slashFilter.value = ''
  void ensureDefaultInvestmentLeadsSkillSelected()
})

watch(() => props.sessionId, () => {
  defaultInvestmentLeadsSkillDismissed.value = false
  void ensureDefaultInvestmentLeadsSkillSelected()
})

watch(() => props.showCapabilityButton, () => {
  void ensureDefaultInvestmentLeadsSkillSelected()
})

watch(() => props.autoSelectInvestmentLeadsSkill, () => {
  void ensureDefaultInvestmentLeadsSkillSelected()
})

watch(() => props.disabled, () => {
  void ensureDefaultInvestmentLeadsSkillSelected()
})

const normalizeElectronCapability = (cap) => {
  if (!cap || !cap.installed || cap.disabled) return null
  if (cap.type !== 'agent' && cap.type !== 'skill') return null
  const id = cap.componentId || cap.id
  if (!id) return null
  return {
    id,
    type: cap.type,
    name: cap.name || id,
    description: cap.description || ''
  }
}

const pruneUnavailableSelectedCapabilities = () => {
  if (selectedCapabilityRefs.value.length === 0) return false
  const available = new Set(capabilityList.value.map(cap => `${cap.type}:${cap.id}`))
  const next = selectedCapabilityRefs.value.filter(token => available.has(`${token.type}:${token.id}`))
  const changed = next.length !== selectedCapabilityRefs.value.length
  if (changed) {
    selectedCapabilityRefs.value = next
    emit('input-change', composedInputText.value)
  }
  return changed
}

const applyCapabilityRefs = async (refs = []) => {
  if (!Array.isArray(refs) || refs.length === 0) return
  if (props.isStreaming && !props.queueEnabled) return
  await loadInputCapabilities({ force: true })
  for (const ref of refs) {
    const available = capabilityList.value.find(cap => cap.type === ref.type && cap.id === ref.id)
    if (available) {
      selectedCapabilityRefs.value = addSelectedCapabilityToken(selectedCapabilityRefs.value, ref)
      markDefaultInvestmentLeadsSkillSelected(ref)
    }
  }
  showSlashPanel.value = false
  capabilityTrigger.value = null
  slashFilter.value = ''
  emit('input-change', composedInputText.value)
  nextTick(() => {
    textareaRef.value?.focus()
  })
}

const loadInputCapabilities = async ({ force = false } = {}) => {
  if ((!force && capabilitiesLoaded.value) || capabilityLoading.value || !window.electronAPI?.fetchCapabilities) return
  capabilityLoading.value = true
  try {
    const result = await window.electronAPI.fetchCapabilities(props.projectPath)
    capabilityList.value = Array.isArray(result?.capabilities)
      ? result.capabilities.map(normalizeElectronCapability).filter(Boolean)
      : []
    capabilitiesLoaded.value = true
    capabilityLoadedAt.value = Date.now()
    pruneUnavailableSelectedCapabilities()
    void ensureDefaultInvestmentLeadsSkillSelected()
  } catch (err) {
    console.error('[ChatInput] load input capabilities error:', err)
    capabilityList.value = []
  } finally {
    capabilityLoading.value = false
  }
}

const updateCapabilityPanel = () => {
  const cursor = textareaRef.value?.selectionStart ?? inputText.value.length
  const previousTrigger = capabilityTrigger.value
  const trigger = getCapabilityTriggerAtCursor({ text: inputText.value, cursor })
  capabilityTrigger.value = trigger
  if (!trigger) return false

  showSlashPanel.value = true
  slashFilter.value = trigger.marker === '/' ? `/${trigger.query}` : trigger.query
  const shouldRefresh = !previousTrigger ||
    previousTrigger.type !== trigger.type ||
    Date.now() - capabilityLoadedAt.value > 5000
  void loadInputCapabilities({ force: shouldRefresh })
  return true
}

const selectCapabilityItem = (cmd) => {
  if (!capabilityTrigger.value) return
  selectedCapabilityRefs.value = addSelectedCapabilityToken(selectedCapabilityRefs.value, {
    type: cmd.capabilityType,
    id: cmd.capabilityId,
    name: cmd.name?.replace(/^[@/]/, ''),
    description: cmd.description
  })
  markDefaultInvestmentLeadsSkillSelected({
    type: cmd.capabilityType,
    id: cmd.capabilityId
  })
  const nextValue = removeCapabilityTrigger({
    text: inputText.value,
    trigger: capabilityTrigger.value
  })
  inputText.value = nextValue.text
  showSlashPanel.value = false
  capabilityTrigger.value = null
  slashFilter.value = ''
  emit('input-change', composedInputText.value)
  nextTick(() => {
    autoResize()
    textareaRef.value?.focus()
    textareaRef.value?.setSelectionRange(nextValue.cursor, nextValue.cursor)
  })
}

const selectSlashCommand = (cmd) => {
  if (cmd?.source === 'capability') {
    selectCapabilityItem(cmd)
    return
  }

  inputText.value = cmd.argumentHint ? `${cmd.name} ` : cmd.name
  showSlashPanel.value = false
  capabilityTrigger.value = null
  emit('input-change', inputText.value)
  nextTick(() => {
    autoResize()
    focus()
  })

  if (shouldAutoSubmitSlashCommand(cmd)) {
    handleSend()
  }
}

// ============================
// 杈撳叆涓庡彂閫?
// ============================
const inputText = ref('')
const textareaRef = ref(null)
const inputWrapperRef = ref(null)
const chatInputAreaRef = ref(null)
const inputToolbarRef = ref(null)
const imagePreviewRef = ref(null)
const filePreviewRef = ref(null)
const isExpanded = ref(false)
const expandedTextareaHeight = ref(0)
const hiddenContextFilePreviewIds = ref(new Set())
const contextFilePayloads = computed(() => (
  (Array.isArray(props.contextFiles) ? props.contextFiles : [])
    .filter(file => file && typeof file === 'object')
    .map(file => ({
      id: file.id || file.filePath || file.fileName || file.name,
      name: file.name || file.fileName || file.filePath || 'file',
      fileName: file.fileName || file.name || file.filePath || 'file',
      filePath: file.filePath || '',
      content: typeof file.content === 'string' ? file.content : '',
      sizeBytes: Number.isFinite(file.sizeBytes) ? file.sizeBytes : 0,
      sizeText: typeof file.sizeText === 'string' ? file.sizeText : '',
      projectLibraryItemId: file.projectLibraryItemId || null
    }))
    .filter(file => file.fileName)
))
const contextFilePreviews = computed(() => (
  contextFilePayloads.value
    .filter(file => !hiddenContextFilePreviewIds.value.has(String(file.id || file.filePath || file.fileName)))
    .map(file => ({
      id: file.id,
      fileName: file.fileName,
      filePath: file.filePath,
      sizeText: file.sizeText
    }))
))

const textareaStyle = computed(() => {
  if (!isExpanded.value || !expandedTextareaHeight.value) return {}
  return {
    height: `${expandedTextareaHeight.value}px`,
    maxHeight: 'none'
  }
})

const getWrapperVerticalPadding = () => {
  if (!inputWrapperRef.value) return 0
  const styles = window.getComputedStyle(inputWrapperRef.value)
  return (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0)
}

const applyCollapsedHeight = () => {
  if (!textareaRef.value) return
  textareaRef.value.style.height = 'auto'
  const minHeight = Math.max(0, Number(props.collapsedMinHeight) || 0)
  const maxHeight = Math.max(minHeight, Number(props.collapsedMaxHeight) || 200)
  const nextHeight = Math.min(textareaRef.value.scrollHeight, maxHeight)
  textareaRef.value.style.height = `${Math.max(nextHeight, minHeight)}px`
}

const updateExpandedLayout = () => {
  if (!isExpanded.value || !textareaRef.value) return
  const host = chatInputAreaRef.value?.parentElement
  const hostHeight = host?.clientHeight || window.innerHeight
  const toolbarHeight = inputToolbarRef.value?.offsetHeight || 0
  const previewHeight = (imagePreviewRef.value?.offsetHeight || 0) + (filePreviewRef.value?.offsetHeight || 0)
  const wrapperPadding = getWrapperVerticalPadding()
  const actionAreaHeight = 52
  const reservedHeight = toolbarHeight + previewHeight + wrapperPadding + actionAreaHeight + 28
  const targetHeight = Math.round(hostHeight * props.expandedHeightRatio) - reservedHeight
  expandedTextareaHeight.value = Math.max(180, targetHeight)
}

const autoResize = () => {
  nextTick(() => {
    if (!textareaRef.value) return
    if (isExpanded.value) {
      updateExpandedLayout()
      return
    }
    applyCollapsedHeight()
  })
}

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value
  nextTick(() => {
    if (isExpanded.value) {
      updateExpandedLayout()
    } else {
      expandedTextareaHeight.value = 0
      applyCollapsedHeight()
    }
    focus()
  })
}

const handleInput = () => {
  autoResize()
  emit('input-change', composedInputText.value)

  if (updateCapabilityPanel()) return

  // 妫€娴?slash 鍛戒护
  const text = inputText.value
  if (shouldOpenSlashPanel({ text, slashCommandsSupported: props.slashCommandsSupported })) {
    showSlashPanel.value = true
    slashFilter.value = text
  } else {
    showSlashPanel.value = false
    slashFilter.value = ''
  }
}

const handleKeyDown = (event) => {
  // Slash 闈㈡澘婵€娲绘椂鐨勯敭鐩樺鑸?
  if (showSlashPanel.value) {
    if (panelUnavailable.value) {
      if (event.key === 'Escape') {
        event.preventDefault()
        showSlashPanel.value = false
        capabilityTrigger.value = null
      }
    } else if (filteredCommands.value.length === 0) {
      if (event.key === 'Escape') {
        event.preventDefault()
        showSlashPanel.value = false
        capabilityTrigger.value = null
      }
      if (showCapabilityPanel.value && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
        event.preventDefault()
      }
      return
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      slashActiveIndex.value = Math.min(slashActiveIndex.value + 1, filteredCommands.value.length - 1)
      return
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      slashActiveIndex.value = Math.max(slashActiveIndex.value - 1, 0)
      return
    } else if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      if (filteredCommands.value.length > 0) {
        event.preventDefault()
        selectSlashCommand(filteredCommands.value[slashActiveIndex.value])
        return
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      showSlashPanel.value = false
      capabilityTrigger.value = null
      return
    }
  }

  // 鏅€氭ā寮忥細Enter 鍙戦€侊紝Shift+Enter 鎹㈣
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }

  // Ctrl+L: 娓呯┖杈撳叆妗?
  if ((event.ctrlKey || event.metaKey) && event.key === 'l') {
    event.preventDefault()
    handleClear()
  }
}

// 娑堟伅闃熷垪锛堟祦寮忚緭鍑烘湡闂存殏瀛橈級
const messageQueue = ref([])
const MAX_QUEUE_SIZE = 10
let queueIdCounter = 0

const clearQueue = () => {
  messageQueue.value = []
}

const dequeue = () => {
  if (messageQueue.value.length === 0) return null
  const item = messageQueue.value.shift()
  return item.text
}

// ============================
// 鍥剧墖涓婁紶涓庡鐞?
// ============================
const attachedImages = ref([])
const imageInputRef = ref(null)
let imageIdCounter = 0
const MAX_IMAGE_SIZE_MB = 5
const MAX_IMAGES = 5

const attachedFiles = ref([])
const fileInputRef = ref(null)
let fileIdCounter = 0
const MAX_FILES = 5
const hasUploadingFiles = computed(() => attachedFiles.value.some(file => file.status === 'uploading'))
const hasErroredFiles = computed(() => attachedFiles.value.some(file => file.status === 'error'))
const hasBlockingFiles = computed(() => hasUploadingFiles.value || hasErroredFiles.value)

const isDragOver = ref(false)

const triggerImageUpload = () => {
  if (props.disabled) return
  imageInputRef.value?.click()
}

const handleImageUpload = async (event) => {
  const files = Array.from(event.target.files)
  await processImages(files)
  // 娓呯┖ input锛屽厑璁搁噸澶嶉€夋嫨鐩稿悓鏂囦欢
  event.target.value = ''
}

const handlePaste = async (event) => {
  const items = Array.from(event.clipboardData.items)
  const imageItems = items.filter(item => item.type.startsWith('image/'))
  const fileItems = items.filter(item => item.kind === 'file' && !item.type.startsWith('image/'))

  if (imageItems.length > 0 || fileItems.length > 0) {
    event.preventDefault()  // 闃绘榛樿绮樿创琛屼负
  }

  if (imageItems.length > 0) {
    const files = await Promise.all(
      imageItems.map(item => item.getAsFile())
    ).then(files => files.filter(f => f !== null))
    await processImages(files)
  }

  if (fileItems.length > 0) {
    const files = await Promise.all(
      fileItems.map(item => item.getAsFile())
    ).then(files => files.filter(f => f !== null))
    await processFiles(files)
  }
}

const processImages = async (files) => {
  if (files.length === 0) return

  // 妫€鏌ユ暟閲忛檺鍒?
  const remaining = MAX_IMAGES - attachedImages.value.length
  if (remaining <= 0) {
    message.warning(t('agent.imageLimitReached', { max: MAX_IMAGES }))
    return
  }

  const filesToProcess = files.slice(0, remaining)

  for (const file of filesToProcess) {
    // 妫€鏌ユ枃浠剁被鍨?
    if (!isSupportedImageType(file)) {
      console.warn(`Unsupported image type: ${file.type}`)
      continue
    }

    try {
      const base64 = await readFileAsBase64(file)
      const mediaType = getImageMediaType(file)
      const sizeBytes = getBase64Size(base64)
      const warning = isImageTooLarge(base64, MAX_IMAGE_SIZE_MB)

      attachedImages.value.push({
        id: ++imageIdCounter,
        base64,
        mediaType,
        sizeBytes,
        sizeText: formatFileSize(sizeBytes),
        warning,
        fileName: file.name || 'image'
      })
    } catch (error) {
      console.error('Failed to process image:', error)
    }
  }
}

const removeImage = (index) => {
  attachedImages.value.splice(index, 1)
}

const triggerFileUpload = () => {
  if (props.disabled) return
  fileInputRef.value?.click()
}

const handleFileUpload = async (event) => {
  const files = Array.from(event.target.files)
  await processFiles(files)
  event.target.value = ''
}

let dragEnterCounter = 0

const handleDragOver = (event) => {
  event.preventDefault()
}

const handleDragEnter = (event) => {
  event.preventDefault()
  event.stopPropagation()
  dragEnterCounter++
  if (dragEnterCounter === 1) {
    isDragOver.value = true
  }
}

const handleDragLeave = (event) => {
  event.preventDefault()
  event.stopPropagation()
  dragEnterCounter--
  if (dragEnterCounter <= 0) {
    dragEnterCounter = 0
    isDragOver.value = false
  }
}

const handleDrop = async (event) => {
  event.preventDefault()
  event.stopPropagation()
  dragEnterCounter = 0
  isDragOver.value = false
  if (props.disabled) return

  const droppedFiles = Array.from(event.dataTransfer.files)
  const imageFiles = droppedFiles.filter(f => isSupportedImageType(f))
  const textFiles = droppedFiles.filter(f => !isSupportedImageType(f))

  if (imageFiles.length > 0) {
    await processImages(imageFiles)
  }
  if (textFiles.length > 0) {
    await processFiles(textFiles)
  }
}

const canUploadAttachmentsToServer = () => {
  return typeof window !== 'undefined' &&
    typeof window.electronAPI?.uploadAgentAttachment === 'function'
}

const isSupportedCurrentAttachmentFile = (file) => (
  isSupportedAttachmentFile(file) || isServerUploadAttachmentFile(file)
)

const getLocalAttachmentPath = (file) => {
  if (typeof window !== 'undefined' && typeof window.electronAPI?.getPathForFile === 'function') {
    return window.electronAPI.getPathForFile(file) || ''
  }
  return typeof file?.path === 'string' ? file.path : ''
}

const readAttachmentAsBase64Payload = async (file) => {
  if (typeof file?.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
    }
    return btoa(binary)
  }

  return await new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader is not available'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      resolve(dataUrl.includes(',') ? dataUrl.split(',').pop() : dataUrl)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const withAttachmentTimeout = (promise, label, timeoutMs = 120000) => {
  let timeoutId
  const timeout = new Promise((resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out`))
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId)
  })
}

const processFiles = async (files) => {
  if (files.length === 0) return

  const remaining = MAX_FILES - attachedFiles.value.length
  if (remaining <= 0) {
    message.warning(t('agent.fileLimitReached', { max: MAX_FILES }))
    return
  }

  const filesToProcess = files.slice(0, remaining)
  const canUploadToServer = canUploadAttachmentsToServer()

  for (const file of filesToProcess) {
    const shouldUploadToServer = canUploadToServer && isServerUploadAttachmentFile(file)

    if (!isSupportedCurrentAttachmentFile(file)) {
      message.warning(t('agent.unsupportedFileType', { name: file.name }))
      continue
    }

    const maxFileSizeMb = isServerUploadAttachmentFile(file)
      ? getServerUploadAttachmentFileSizeLimitMb(file)
      : getAttachmentFileSizeLimitMb(file)
    if (file.size > maxFileSizeMb * 1024 * 1024) {
      message.warning(t('agent.fileTooLarge', { name: file.name, max: maxFileSizeMb }))
      continue
    }

    const fileItem = {
      id: ++fileIdCounter,
      content: '',
      sizeBytes: file.size,
      sizeText: formatFileSize(file.size),
      fileName: file.name || 'file',
      filePath: '',
      relativePath: '',
      status: 'uploading',
      statusText: shouldUploadToServer ? '上传中' : '准备文件',
      uploadProgress: 0
    }
    attachedFiles.value.push(fileItem)
    const activeFileItem = attachedFiles.value[attachedFiles.value.length - 1]

    try {
      activeFileItem.uploadProgress = 15
      let localFilePath = getLocalAttachmentPath(file)
      let uploaded = null
      let uploadError = null
      if (shouldUploadToServer) {
        activeFileItem.uploadProgress = 35
        try {
          uploaded = await withAttachmentTimeout(window.electronAPI.uploadAgentAttachment({
            sessionId: props.sessionId || null,
            cwd: props.projectPath || null,
            file,
            onProgress: (percent) => {
              const normalized = Math.max(0, Math.min(100, Number(percent) || 0))
              const progress = Math.round(35 + normalized * 0.55)
              activeFileItem.uploadProgress = Math.max(activeFileItem.uploadProgress || 0, Math.min(90, progress))
              activeFileItem.statusText = `上传中 ${normalized}%`
            }
          }), 'Attachment upload')
        } catch (error) {
          uploadError = error
          console.warn('[ChatInput] attachment upload failed, falling back to inline payload:', error)
        }
      }
      if (uploaded?.error) {
        uploadError = new Error(uploaded.error)
        uploaded = null
      }
      if (!localFilePath) {
        localFilePath = getLocalAttachmentPath(file)
      }
      activeFileItem.uploadProgress = uploaded ? 75 : 55
      const contentBase64 = uploaded
        ? (typeof uploaded.contentBase64 === 'string' ? uploaded.contentBase64 : '')
        : (localFilePath ? '' : await withAttachmentTimeout(readAttachmentAsBase64Payload(file), 'Attachment read'))
      if (!uploaded && file.size > 0 && !contentBase64) {
        if (!localFilePath) {
          throw uploadError || new Error('Unable to read attachment bytes')
        }
      }
      Object.assign(activeFileItem, {
        content: typeof uploaded?.content === 'string' ? uploaded.content : '',
        contentBase64,
        mimeType: uploaded?.mimeType || file.type || '',
        fileName: uploaded?.name || file.name || 'file',
        filePath: uploaded?.filePath || localFilePath,
        relativePath: uploaded?.relativePath || '',
        status: 'ready',
        statusText: '',
        uploadProgress: 100
      })
    } catch (error) {
      console.error('Failed to process file:', error)
      Object.assign(activeFileItem, {
        status: 'error',
        statusText: '',
        uploadProgress: 0
      })
      message.error(t('agent.fileReadFailed', { name: file.name }))
    }
  }
}

const removeFile = (index) => {
  attachedFiles.value.splice(index, 1)
}

watch(() => attachedImages.value.length, () => {
  if (!isExpanded.value) return
  nextTick(() => {
    updateExpandedLayout()
  })
})

watch(() => attachedFiles.value.length, () => {
  if (!isExpanded.value) return
  nextTick(() => {
    updateExpandedLayout()
  })
})

watch(() => props.contextFiles.length, () => {
  if (!isExpanded.value) return
  nextTick(() => {
    updateExpandedLayout()
  })
})

watch(() => props.contextFiles.map(file => file?.id || file?.filePath || file?.fileName || file?.name).join('|'), () => {
  const currentIds = new Set(contextFilePayloads.value.map(file => String(file.id || file.filePath || file.fileName)))
  hiddenContextFilePreviewIds.value = new Set(
    [...hiddenContextFilePreviewIds.value].filter(id => currentIds.has(id))
  )
})

const removeContextFilePreview = (file) => {
  const key = String(file?.id || file?.filePath || file?.fileName || '')
  if (key) {
    hiddenContextFilePreviewIds.value = new Set([...hiddenContextFilePreviewIds.value, key])
  }
  emit('remove-context-file', file)
}

const handleClear = () => {
  inputText.value = ''
  selectedCapabilityRefs.value = []
  attachedImages.value = []
  attachedFiles.value = []
  capabilityTrigger.value = null
  emit('input-change', '')
  nextTick(() => {
    autoResize()
    void ensureDefaultInvestmentLeadsSkillSelected()
  })
}

const handleSchedule = () => {
  emit('schedule', composedInputText.value.trim())
}

const handleSend = async () => {
  const text = composedInputText.value.trim()
  const visibleTextForSend = inputText.value.trim()
  const hasImages = attachedImages.value.length > 0
  const sendableFiles = attachedFiles.value.filter(file => file.status === 'ready')
  const hasFiles = sendableFiles.length > 0
  const hasSelectedCapabilities = selectedCapabilityRefs.value.length > 0
  const hasContextFiles = contextFilePayloads.value.length > 0
  // 鏈夋枃鏈垨鏈夊浘鐗囨垨鏈夋枃浠舵墠鑳藉彂閫?
  if (hasBlockingFiles.value) return
  if (((!text || (hasOnlyDefaultInvestmentLeadsSkillSelected.value && !visibleTextForSend)) && !hasImages && !hasFiles) || props.disabled) return
  // 闃熷垪鍏抽棴鏃讹紝娴佸紡杈撳嚭涓姝㈠彂閫?
  if (props.isStreaming && !props.queueEnabled) return

  if (hasSelectedCapabilities) {
    await loadInputCapabilities({ force: true })
    if (pruneUnavailableSelectedCapabilities()) {
      message.warning(t('common.operationFailed'))
      return
    }
  }

  const startsWithAvailableSkill = isLeadingCapabilitySkillInvocation({
    text,
    selectedTokens: selectedCapabilityRefs.value,
    capabilities: capabilityList.value
  })
  if (shouldBlockAsUnavailableSlash({ text, slashUnavailable: showSlashUnavailableHint.value }) && !startsWithAvailableSkill) {
    showSlashPanel.value = false
    message.warning(t('agent.slashDisabledHint'))
    return
  }

  showSlashPanel.value = false
  capabilityTrigger.value = null

  // 鏋勫缓娑堟伅瀵硅薄
  const outgoingMessage = {
    text,
    ...(hasSelectedCapabilities ? { displayText: visibleTextForSend } : {}),
    images: attachedImages.value.map(img => ({
      base64: img.base64,
      mediaType: img.mediaType,
      sizeBytes: img.sizeBytes,
      warning: img.warning
    })),
    files: sendableFiles.map(file => ({
      name: file.fileName,
      content: file.content,
      contentBase64: file.contentBase64,
      mimeType: file.mimeType,
      relativePath: file.relativePath,
      filePath: file.filePath,
      sizeBytes: file.sizeBytes
    })),
    contextFiles: contextFilePayloads.value
  }
  console.log('[ChatInput] handleSend - outgoingMessage:', {
    text: outgoingMessage.text,
    imageCount: outgoingMessage.images.length,
    fileCount: outgoingMessage.files.length,
    files: outgoingMessage.files.map(f => ({ name: f.name, contentLength: f.content?.length, sizeBytes: f.sizeBytes }))
  })

  const hasAttachments = hasImages || hasFiles

  if (props.isStreaming) {
    // 娴佸紡杈撳嚭涓?鈫?鍔犲叆闃熷垪锛堜笂闄?MAX_QUEUE_SIZE 鏉★級
    // 娉ㄦ剰锛氶槦鍒楁殏涓嶆敮鎸佸浘鐗囨垨鏂囦欢锛屼粎鏀寔鏂囨湰
    if (messageQueue.value.length >= MAX_QUEUE_SIZE) return
    if (hasAttachments) {
      message.warning(t('agent.attachmentQueueNotSupported'))
      return
    }
    messageQueue.value.push({ id: ++queueIdCounter, text })
    emit('enqueue', text)
  } else {
    // 鏍规嵁鏄惁鏈夐檮浠跺喅瀹氬彂閫佹牸寮?
    if (hasAttachments || hasSelectedCapabilities || hasContextFiles) {
      emit('send', outgoingMessage)
    } else {
      // 鏃犻檮浠讹細鍙戦€佺函鏂囨湰锛堝吋瀹规棫浠ｇ爜锛?
      emit('send', text)
    }
  }

  // 娓呯┖杈撳叆銆佸浘鐗囧拰鏂囦欢
  inputText.value = ''
  selectedCapabilityRefs.value = []
  attachedImages.value = []
  attachedFiles.value = []
  capabilityTrigger.value = null
  nextTick(() => {
    autoResize()
    void ensureDefaultInvestmentLeadsSkillSelected()
  })
}

// ============================
// 鐐瑰嚮澶栭儴鍏抽棴
// ============================
const handleClickOutside = (e) => {
  if (inputWrapperRef.value && !inputWrapperRef.value.contains(e.target)) {
    showSlashPanel.value = false
    capabilityTrigger.value = null
  }
}

const handleWindowResize = () => {
  if (!isExpanded.value) return
  updateExpandedLayout()
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('resize', handleWindowResize)
  focus()
  void ensureDefaultInvestmentLeadsSkillSelected()
  if (props.collapsedRows !== 3 || props.collapsedMinHeight > 0 || props.collapsedMaxHeight !== 200) {
    nextTick(() => {
      applyCollapsedHeight()
    })
  }
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('resize', handleWindowResize)
})

const focus = () => {
  textareaRef.value?.focus()
}

const setText = (text) => {
  inputText.value = typeof text === 'string' ? text : ''
  selectedCapabilityRefs.value = []
  attachedImages.value = []
  attachedFiles.value = []
  showSlashPanel.value = false
  capabilityTrigger.value = null
  slashFilter.value = ''
  emit('input-change', inputText.value)
  nextTick(() => {
    autoResize()
    void ensureDefaultInvestmentLeadsSkillSelected()
    const textarea = textareaRef.value
    if (!textarea) return
    const position = inputText.value.length
    textarea.focus()
    textarea.setSelectionRange(position, position)
  })
}

// 鎻掑叆鏂囨湰鍒拌緭鍏ユ锛堝厜鏍囦綅缃垨鏈熬锛?
const insertText = (text) => {
  const textarea = textareaRef.value
  if (!textarea) {
    // 濡傛灉 textarea 鏈寕杞斤紝鐩存帴杩藉姞鍒版湯灏?
    inputText.value += text
    emit('input-change', inputText.value)
    return
  }

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const value = inputText.value

  // 鎻掑叆鍒板厜鏍囦綅缃?
  inputText.value = value.substring(0, start) + text + value.substring(end)
  emit('input-change', inputText.value)

  // 鎭㈠鍏夋爣浣嶇疆锛堝厜鏍囩Щ鍔ㄥ埌鎻掑叆鏂囨湰鍚庯級
  nextTick(() => {
    const newPosition = start + text.length
    textarea.setSelectionRange(newPosition, newPosition)
    textarea.focus()
  })
}

// ============================
// 杈撳叆妗嗗彸閿彍鍗?
// ============================
const inputContextMenuRef = ref(null)
const inputContextMenuItems = ref([])

const handleInputContextMenu = (event) => {
  const textarea = textareaRef.value
  const hasSelection = textarea && textarea.selectionStart !== textarea.selectionEnd
  inputContextMenuItems.value = [
    { key: 'cut', label: t('common.cut'), shortcut: 'Ctrl+X', disabled: !hasSelection },
    { key: 'copy', label: t('common.copy'), shortcut: 'Ctrl+C', disabled: !hasSelection },
    { key: 'paste', label: t('common.paste'), shortcut: 'Ctrl+V' }
  ]
  inputContextMenuRef.value.show(event.clientX, event.clientY)
}

const onInputContextMenuSelect = async (key) => {
  const textarea = textareaRef.value
  if (!textarea) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  if (key === 'cut') {
    const selected = inputText.value.substring(start, end)
    try {
      await copyTextToClipboard(selected)
    } catch {
      message.error(t('common.copyFailed'))
      return
    }
    inputText.value = inputText.value.substring(0, start) + inputText.value.substring(end)
    nextTick(() => textarea.setSelectionRange(start, start))
  } else if (key === 'copy') {
    try {
      await copyTextToClipboard(inputText.value.substring(start, end))
    } catch {
      message.error(t('common.copyFailed'))
    }
  } else if (key === 'paste') {
    // 浼樺厛灏濊瘯璇诲彇鍥剧墖
    try {
      const clipItems = await navigator.clipboard.read()
      const imageItem = clipItems.find(item => item.types.some(t => t.startsWith('image/')))
      if (imageItem) {
        const imageType = imageItem.types.find(t => t.startsWith('image/'))
        const blob = await imageItem.getType(imageType)
        const file = new File([blob], 'pasted-image.png', { type: imageType })
        await processImages([file])
        return
      }
    } catch {
      // clipboard.read() 鏉冮檺琚嫆缁濇椂闄嶇骇涓烘枃鏈矘璐?
    }
    const text = await navigator.clipboard.readText()
    insertText(text)
  }
}

defineExpose({ focus, messageQueue, dequeue, clearQueue, insertText, setText, applyCapabilityRefs })
</script>

<style scoped>
.chat-input-area {
  padding: 8px 16px 12px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-color);
}

/* Input wrapper */
.input-wrapper {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  background: var(--bg-color-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 8px 12px;
  transition: border-color 0.2s;
  position: relative;
}

.input-wrapper:focus-within {
  border-color: var(--primary-color);
}

.selected-capability-chips {
  order: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  flex-basis: 100%;
  max-width: 100%;
  padding-top: 2px;
}

.selected-capability-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border-color);
  max-width: 160px;
  min-height: 24px;
  padding: 3px 7px;
  border-radius: 7px;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.selected-capability-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-capability-chip.chip-agent {
  border-color: color-mix(in srgb, var(--primary-color) 42%, var(--border-color));
}

.selected-capability-chip.chip-skill {
  border-color: color-mix(in srgb, #22a06b 42%, var(--border-color));
}

.selected-capability-chip-remove {
  color: var(--text-color-muted);
  flex-shrink: 0;
}

/* Slash Command Panel */
.slash-panel {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 4px;
  background: var(--bg-color-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
}

.slash-panel-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.slash-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.1s;
}

.slash-item:hover,
.slash-item.active {
  background: var(--hover-bg);
}

.slash-item-icon {
  color: var(--primary-color);
  flex-shrink: 0;
}

.slash-item-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.slash-item-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.slash-item-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-color);
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.slash-item-hint {
  font-size: 11px;
  color: var(--text-color-muted);
  font-family: 'SF Mono', 'Fira Code', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.slash-item-desc {
  font-size: 11px;
  color: var(--text-color-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.slash-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--text-color-muted);
  text-align: center;
}

.slash-empty-disabled {
  text-align: left;
  line-height: 1.5;
}

/* Slash panel transition */
.slash-panel-enter-active,
.slash-panel-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}

.slash-panel-enter-from,
.slash-panel-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.chat-textarea {
  order: 1;
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text-color);
  font-size: 14px;
  line-height: 1.5;
  resize: none;
  outline: none;
  max-height: 200px;
  font-family: inherit;
}

.chat-input-area.expanded .chat-textarea {
  overflow-y: auto;
}

.chat-textarea::placeholder {
  color: var(--text-color-muted);
}

.chat-textarea:disabled {
  opacity: 0.5;
}

.send-btn,
.stop-btn {
  order: 1;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.send-btn {
  background: var(--primary-color);
  color: white;
}

.send-btn:hover:not(:disabled) {
  background: var(--primary-color-hover);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.stop-btn {
  background: #ff4d4f;
  color: white;
}

.stop-btn:hover {
  background: #ff7875;
}

/* 鏂囦欢棰勮鍖哄煙 */
.file-preview-area {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.file-preview-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 6px;
  border-radius: 6px;
  background: var(--bg-color-secondary);
  border: 1px solid var(--border-color);
  font-size: 12px;
  color: var(--text-color);
  max-width: 100%;
}

.file-preview-item.uploading {
  border-color: color-mix(in srgb, var(--primary-color) 45%, var(--border-color));
}

.file-preview-item.error {
  border-color: #ff7875;
}

.file-preview-icon {
  flex-shrink: 0;
  color: var(--primary-color);
}

.file-preview-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-preview-size {
  color: var(--text-color-muted);
  flex-shrink: 0;
}

.file-preview-progress {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 2px;
  height: 2px;
  border-radius: 999px;
  background: var(--border-color);
  overflow: hidden;
}

.file-preview-progress-bar {
  height: 100%;
  border-radius: inherit;
  background: var(--primary-color);
  transition: width 0.18s ease;
}

.file-preview-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-color-muted);
  border-radius: 4px;
  padding: 0;
  flex-shrink: 0;
}

.file-preview-remove:hover {
  background: var(--hover-bg);
  color: #ff4d4f;
}

/* 鎷栨嫿鐘舵€?*/
.chat-input-area.drag-over {
  outline: 2px dashed var(--primary-color);
  outline-offset: -2px;
  background: var(--hover-bg);
}

</style>
