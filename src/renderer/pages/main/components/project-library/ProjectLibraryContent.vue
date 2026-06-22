<template>
  <section class="project-library-content">
    <div v-if="!workspace" class="empty-content">
      <Icon name="folderOpen" :size="42" />
      <h2>选择或新建一个项目</h2>
      <p>项目会作为独立文件夹显示在左侧，并保留自己的目录、文件和 Agent 会话。</p>
    </div>

    <template v-else>
      <header class="content-header">
        <div class="title-block">
          <div class="title-row">
            <h1>{{ workspace.name }} / {{ activeItem?.name || '项目概况.md' }}</h1>
            <span class="type-badge">项目</span>
          </div>
          <p>当前上下文：{{ workspace.name }} · 关联线索 8</p>
        </div>
        <div v-if="canDownloadPreview" class="header-actions">
          <button type="button" title="下载" @click="handleDownloadPreview">
            <Icon name="download" :size="15" />
          </button>
        </div>
      </header>

      <div class="project-main-area">
        <div class="project-agent-container">
          <div class="messages-region project-messages-region">
            <div ref="messagesListRef" class="messages-list project-messages-list" @scroll="onContainerScroll">
              <article v-if="showGeneratedBrief" class="project-brief">
                <h1>{{ projectBrief.title }}</h1>
                <p v-for="paragraph in projectBrief.paragraphs" :key="paragraph">
                  {{ paragraph }}
                </p>

                <h2>核心投资逻辑</h2>
                <h3>短期逻辑</h3>
                <ul>
                  <li v-for="item in projectBrief.shortLogic" :key="item.title">
                    <strong>{{ item.title }}：</strong>{{ item.text }}
                  </li>
                </ul>

                <h3>长期逻辑</h3>
                <ul>
                  <li v-for="item in projectBrief.longLogic" :key="item.title">
                    <strong>{{ item.title }}：</strong>{{ item.text }}
                  </li>
                </ul>
              </article>

              <article
                v-else-if="isMarkdownContentView && hasMarkdownContent"
                class="project-brief markdown-document-view jedi-markdown-preview"
                v-html="renderedMarkdown"
              ></article>

              <article
                v-else-if="activeOriginalFilePreview"
                class="project-library-file-preview"
                :class="{ 'is-maximized': originalFilePreviewMaximized }"
              >
                <FilePreview
                  :preview="activeOriginalFilePreview"
                  :loading="false"
                  :maximized="originalFilePreviewMaximized"
                  @close="originalFilePreviewClosed = true"
                  @toggle-maximize="originalFilePreviewMaximized = !originalFilePreviewMaximized"
                  @insert-path="$emit('preview-path', { filePath: $event })"
                />
              </article>

              <article v-else-if="activeItem.nodeType === 'file' && !isMarkdownFileAsset" class="file-asset-panel">
                <Icon name="fileText" :size="36" />
                <h1>{{ activeItem.name }}</h1>
                <dl class="file-asset-meta">
                  <div>
                    <dt>Type</dt>
                    <dd>{{ activeItem.mimeType || 'Unknown' }}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{{ activeFileSizeText }}</dd>
                  </div>
                  <div>
                    <dt>Path</dt>
                    <dd>{{ activeItem.filePath }}</dd>
                  </div>
                </dl>
                <button type="button" class="file-asset-action" @click="handleDownloadOriginalFile">
                  <Icon name="download" :size="14" />
                  <span>Download</span>
                </button>
              </article>

              <article v-else-if="activeItem.nodeType !== 'markdown' && !isMarkdownFileAsset" class="folder-panel">
                <Icon name="folderOpen" :size="36" />
                <h1>{{ activeItem.name }}</h1>
                <p>这是项目内文件夹，可以在左侧继续创建 Markdown 文件或子文件夹。</p>
              </article>

              <template v-for="message in visibleMessages" :key="message.id || message.msg_id">
                <MessageBubble
                  v-if="message.role === 'user' || message.role === 'assistant' || message.role === 'system'"
                  :message="message"
                  :session-cwd="null"
                  @preview-image="$emit('preview-image', $event)"
                  @preview-link="$emit('preview-link', $event)"
                  @preview-path="$emit('preview-path', $event)"
                  @run-command="$emit('run-command', $event)"
                />
                <AskUserQuestionCard
                  v-else-if="message.role === 'tool' && (message.toolName === 'AskUserQuestion' || message.input?.kind === 'permission_request')"
                  :message="message"
                  :submitting="false"
                  @submit="$emit('submit-interaction', $event)"
                  @cancel="$emit('cancel-interaction', $event)"
                />
                <ScheduledTaskDraftCard
                  v-else-if="message.role === 'tool' && message.toolName === 'ScheduledTaskDraft'"
                  :message="message"
                  :submitting="false"
                  @submit="$emit('submit-scheduled-task', $event)"
                  @cancel="$emit('cancel-scheduled-task', $event)"
                />
                <ToolCallCard
                  v-else-if="message.role === 'tool'"
                  :message="message"
                  @preview-image="$emit('preview-image', $event)"
                  @preview-path="$emit('preview-path', $event)"
                />
              </template>
              <StreamingIndicator
                :visible="sending"
                text=""
                thinking=""
                :elapsed="streamingElapsed"
              />
              <div ref="scrollAnchorRef" class="scroll-anchor" aria-hidden="true"></div>
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

          <div class="status-hint-bar history-hint">
            <Icon name="info" :size="14" />
            <span>上面为会话的历史信息，请在输入框输入文字激活当前会话</span>
          </div>
          <ChatInput
            v-model:model-value="selectedModelProxy"
            :is-streaming="sending"
            :disabled="!workspace"
            :queue-enabled="false"
            placeholder="请输入您想说的话并按Enter发送；AI输出时自动加入队列按顺序发送...（Shift+Enter=换行）"
            :context-tokens="0"
            :slash-commands="[]"
            :slash-commands-supported="false"
            :enable-slash-commands="false"
            :model-options="modelOptions"
            :session-id="activeSessionId || null"
            :project-path="workspace?.path || null"
            :context-files="activeContextFiles"
            :show-capability-button="true"
            :show-image-upload="true"
            :show-file-upload="true"
            :show-expand-button="true"
            session-type="chat"
            @send="handleSend"
            @remove-context-file="handleRemoveActiveContextFile"
          />
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@components/icons/Icon.vue'
import ChatInput from '../agent/ChatInput.vue'
import MessageBubble from '../agent/MessageBubble.vue'
import ToolCallCard from '../agent/ToolCallCard.vue'
import AskUserQuestionCard from '../agent/AskUserQuestionCard.vue'
import ScheduledTaskDraftCard from '../agent/ScheduledTaskDraftCard.vue'
import StreamingIndicator from '../agent/StreamingIndicator.vue'
import FilePreview from '../AgentRightPanel/FilePreview.vue'
import { useAutoScrollToBottom } from '@composables/useAutoScrollToBottom'
import { isVisibleAgentMessage } from '@utils/agent-message-visibility'
import { renderMarkdownWithHighlight } from '@utils/highlight-utils'
import { buildFileDownloadUrl, downloadFileFromUrl } from '@utils/file-preview-url-utils'

const props = defineProps({
  workspace: {
    type: Object,
    default: null
  },
  activeItem: {
    type: Object,
    default: null
  },
  messages: {
    type: Array,
    default: () => []
  },
  sending: {
    type: Boolean,
    default: false
  },
  activeSessionId: {
    type: String,
    default: null
  },
  selectedModel: {
    type: String,
    default: ''
  },
  modelOptions: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'save-content',
  'send',
  'update:selected-model',
  'preview-image',
  'preview-link',
  'preview-path',
  'run-command',
  'submit-interaction',
  'cancel-interaction',
  'submit-scheduled-task',
  'cancel-scheduled-task'
])
const draftContent = ref('')
const markdownFileAssetContent = ref('')
const markdownFileAssetLoadId = ref(0)
const removedContextItemId = ref(null)
const originalFilePreviewClosed = ref(false)
const originalFilePreviewMaximized = ref(false)
const streamingElapsed = ref(0)
const messagesListRef = ref(null)
const scrollAnchorRef = ref(null)
let streamingElapsedTimer = null

const selectedModelProxy = computed({
  get: () => props.selectedModel,
  set: value => emit('update:selected-model', value)
})

const getProjectMessageContent = (message = {}) => {
  const content = message.content || message.output || ''
  if (message.role !== 'user' || typeof content !== 'string') return content
  const match = content.match(/用户问题[：:]\s*([\s\S]*)$/)
  return match?.[1]?.trim() || content
}

const visibleMessages = computed(() => props.messages
  .map(message => ({
    ...message,
    content: getProjectMessageContent(message)
  }))
  .filter(isVisibleAgentMessage))

const {
  userAtTop,
  userAtBottom,
  canScroll: canScrollMessages,
  scrollToTop,
  scrollToBottom,
  onContainerScroll,
  startAutoScrollObservers,
  stopAutoScrollObservers
} = useAutoScrollToBottom({
  containerRef: messagesListRef,
  anchorRef: scrollAnchorRef,
  itemsRef: visibleMessages,
  isStreamingRef: computed(() => props.sending)
})

const carbonBrief = {
  title: '项目近况跟踪',
  paragraphs: [
    '碳中和项目近期经营与政策演进的核心，是新能源消纳约束边际缓解、储能配置从政策驱动转向经济性验证，以及全国碳市场扩容预期升温。近两周新增线索显示，多地电力现货规则加速落地，独立储能参与调峰、容量补偿和辅助服务的收益模型逐步清晰；同时，CCER 重启后的供给节奏和碳价中枢仍需持续跟踪。',
    '当前项目应重点关注电力市场化改革、储能招标兑现、碳交易扩容、绿色绿证需求四条主线。若政策兑现节奏超预期，碳中和方向可能从主题性交易转向订单、收益率和资产回报驱动的基本面验证。'
  ],
  shortLogic: [
    { title: '新能源消纳边际改善', text: '近期多省发布电力现货和辅助服务细则，新能源发电侧弃电压力有望缓解，储能、电网调节资源和虚拟电厂的商业模式更容易被量化。' },
    { title: '储能招标进入验证期', text: '独立储能项目从“配储要求”走向“收益闭环”，后续应跟踪中标价格、调用小时数、容量补偿标准和实际 IRR，判断行业是否进入优胜劣汰阶段。' },
    { title: '碳市场扩容预期升温', text: '钢铁、水泥、电解铝等行业纳入全国碳市场的讨论升温，若扩容落地，碳配额需求和碳资产管理服务有望形成新的增量。' }
  ],
  longLogic: [
    { title: '能源结构转型仍是长期主线', text: '双碳目标约束下，新能源装机、电网投资、储能、绿电交易和碳资产服务将持续构成中长期产业链机会。' },
    { title: '电力市场化提升资产定价能力', text: '随着现货市场、容量电价和辅助服务市场完善，灵活调节资源的价值会从政策补贴转向市场化收益，优质运营商和设备商的估值体系有望重估。' },
    { title: '碳资产管理从可选项变成基础能力', text: '高排放企业将逐步建立碳核算、碳交易、减排项目开发和绿证采购体系，相关数据、咨询和交易服务具备长期渗透空间。' }
  ]
}

const photovoltaicBrief = {
  title: '项目近况跟踪',
  paragraphs: [
    '光电伏项目近期经营与技术演进的核心，是光伏装机需求从政策补贴驱动转向电力市场化收益验证，同时组件、逆变器、储能配套和电站运营环节的利润分化正在加速。近两周新增线索显示，集中式电站开工节奏边际恢复，分布式项目更关注并网消纳与电价收益测算。',
    '当前项目应重点关注装机需求、组件价格、消纳约束、储能配套和海外订单五条主线。若硅料和组件价格继续稳定，光电伏方向可能从价格下行带来的盈利压力，转向优质电站资源、渠道能力和系统集成效率的基本面验证。'
  ],
  shortLogic: [
    { title: '装机需求进入兑现观察期', text: '集中式项目备案、开工和并网节奏是短期核心变量，需要跟踪各地新能源指标释放、并网排队和电网接入条件。' },
    { title: '组件价格影响利润再分配', text: '硅料、硅片、电池片和组件价格下行有利于电站 IRR 修复，但会压缩中上游环节利润，项目应区分制造端和运营端机会。' },
    { title: '储能配套成为项目经济性变量', text: '强制配储逐步转向收益测算，储能调用小时数、容量补偿和现货套利空间会直接影响光伏电站投资回报。' }
  ],
  longLogic: [
    { title: '光伏仍是电力系统低碳化主线', text: '在双碳目标和电气化趋势下，光伏装机、电站运营、逆变器、储能和功率预测服务将持续构成长期产业机会。' },
    { title: '电力市场化重塑资产定价', text: '随着现货市场和绿电交易机制完善，优质光伏资产的价值会从装机规模转向发电曲线、消纳能力和交易收益。' },
    { title: '海外订单提供第二增长曲线', text: '欧洲、中东、拉美等市场的组件、逆变器和系统集成需求仍有结构性机会，但需要持续关注贸易壁垒和本地化交付风险。' }
  ]
}

const genericBrief = computed(() => {
  const name = props.workspace?.name || '项目'
  return {
    title: '项目近况跟踪',
    paragraphs: [
      `${name}近期需要围绕关键线索、政策变化、商业进展和核心风险进行持续跟踪。当前项目概况会作为该项目的默认首页，后续可以沉淀为结构化 Markdown 文档。`,
      `当前项目应重点关注需求变化、供给格局、关键客户、竞争壁垒和风险事件五条主线，并结合左侧目录中的 notes、纪要、公告和其他材料持续补充。`
    ],
    shortLogic: [
      { title: '线索密度变化', text: '关注新增线索是否集中出现在同一客户、同一地区或同一技术方向，判断项目是否进入加速验证阶段。' },
      { title: '商业进展兑现', text: '跟踪订单、试点、合作、融资和交付节点，优先识别能够验证需求强度的事实。' },
      { title: '风险事件扰动', text: '关注政策、竞争、供应链和财务风险，避免单一乐观叙事掩盖关键不确定性。' }
    ],
    longLogic: [
      { title: '长期需求是否成立', text: '判断项目所处方向是否具备长期增长基础，以及需求是否能从概念验证走向规模化落地。' },
      { title: '壁垒是否可持续', text: '持续评估技术、客户、渠道、数据和组织能力是否能够形成可持续竞争优势。' },
      { title: '项目资产持续沉淀', text: '通过目录和文档不断沉淀项目资料，让每个项目形成独立、可追溯的工作区。' }
    ]
  }
})

const projectBrief = computed(() => {
  const name = props.workspace?.name || ''
  if (name.includes('光电伏') || name.includes('光伏')) return photovoltaicBrief
  if (name.includes('碳中和')) return carbonBrief
  return genericBrief.value
})

const projectBriefText = computed(() => {
  const brief = projectBrief.value
  return [
    brief.title,
    '',
    ...brief.paragraphs,
    '',
    '核心投资逻辑',
    '短期逻辑',
    ...brief.shortLogic.map(item => `${item.title}：${item.text}`),
    '长期逻辑',
    ...brief.longLogic.map(item => `${item.title}：${item.text}`)
  ].join('\n')
})

const isOverviewItem = computed(() => !props.activeItem || props.activeItem.name === '项目概况.md')

const showGeneratedBrief = computed(() => {
  if (!isOverviewItem.value) return false
  return !draftContent.value.trim()
})

const isMarkdownFileAsset = computed(() => {
  if (props.activeItem?.nodeType !== 'file') return false
  const normalizedMime = String(props.activeItem?.mimeType || '').split(';')[0].trim().toLowerCase()
  const normalizedName = String(props.activeItem?.originalName || props.activeItem?.name || props.activeItem?.filePath || '').toLowerCase()
  return normalizedMime === 'text/markdown' ||
    normalizedName.endsWith('.md') ||
    normalizedName.endsWith('.markdown')
})

const isMarkdownContentView = computed(() => props.activeItem?.nodeType === 'markdown' || isMarkdownFileAsset.value)

const getPreviewableOriginalFileType = (item = {}) => {
  if (item?.nodeType !== 'file' || !item.filePath) return ''
  const normalizedMime = String(item.mimeType || '').split(';')[0].trim().toLowerCase()
  const normalizedName = String(item.originalName || item.name || item.filePath || '').toLowerCase()
  const ext = normalizedName.includes('.') ? normalizedName.slice(normalizedName.lastIndexOf('.')) : ''

  if (normalizedMime === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (
    normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === '.docx'
  ) return 'word'
  if (
    normalizedMime === 'application/msword' ||
    normalizedMime === 'application/vnd.ms-excel' ||
    normalizedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ['.doc', '.xls', '.xlsx'].includes(ext)
  ) return 'office'
  return ''
}

const activeOriginalFilePreview = computed(() => {
  if (originalFilePreviewClosed.value || isMarkdownFileAsset.value) return null
  const type = getPreviewableOriginalFileType(props.activeItem)
  if (!type) return null

  const name = props.activeItem.originalName || props.activeItem.name || props.activeItem.filePath.split(/[\\/]/).pop()
  const ext = String(name || props.activeItem.filePath).toLowerCase().match(/\.[^.\\/]+$/)?.[0] || ''
  return {
    type,
    name,
    ext,
    filePath: props.activeItem.filePath,
    path: props.activeItem.filePath,
    size: props.activeItem.sizeBytes || 0,
    mimeType: props.activeItem.mimeType || ''
  }
})

const currentViewContent = computed(() => {
  if (isOverviewItem.value) return draftContent.value.trim() ? draftContent.value : projectBriefText.value
  if (props.activeItem.nodeType === 'markdown') return draftContent.value
  if (isMarkdownFileAsset.value) return markdownFileAssetContent.value
  return ''
})

const downloadPreviewFileName = computed(() => {
  const rawName = isMarkdownContentView.value ? props.activeItem?.name : '项目概况.md'
  const name = String(rawName || '项目概况.md').trim() || '项目概况.md'
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`
})

const canDownloadPreview = computed(() => {
  return (isOverviewItem.value || isMarkdownContentView.value) && currentViewContent.value.trim().length > 0
})

const formatContextFileSize = (content = '') => {
  const byteLength = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(content).length
    : String(content).length
  if (byteLength >= 1024 * 1024) return `${(byteLength / 1024 / 1024).toFixed(1)} MB`
  if (byteLength >= 1024) return `${(byteLength / 1024).toFixed(1)} KB`
  return `${byteLength} B`
}

const formatByteSize = (sizeBytes = 0) => {
  const byteLength = Number(sizeBytes || 0)
  if (!Number.isFinite(byteLength) || byteLength <= 0) return '0 B'
  if (byteLength >= 1024 * 1024) return `${(byteLength / 1024 / 1024).toFixed(1)} MB`
  if (byteLength >= 1024) return `${(byteLength / 1024).toFixed(1)} KB`
  return `${byteLength} B`
}

const activeFileSizeText = computed(() => formatByteSize(props.activeItem?.sizeBytes || 0))

const activeContextFiles = computed(() => {
  if (props.activeItem?.nodeType === 'file') {
    if (props.activeItem.id === removedContextItemId.value) return []
    const markdownContent = isMarkdownFileAsset.value ? markdownFileAssetContent.value : ''
    return [{
      id: `project-library-${props.activeItem.id}`,
      name: props.activeItem.name,
      fileName: props.activeItem.name,
      filePath: props.activeItem.filePath,
      content: markdownContent || props.activeItem.filePath,
      sizeBytes: markdownContent
        ? (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(markdownContent).length : markdownContent.length)
        : Number(props.activeItem.sizeBytes || 0),
      sizeText: markdownContent ? formatContextFileSize(markdownContent) : activeFileSizeText.value,
      projectLibraryItemId: props.activeItem.id
    }]
  }
  if (props.activeItem?.nodeType !== 'markdown') return []
  if (props.activeItem.id === removedContextItemId.value) return []
  const content = draftContent.value
  if (!content.trim()) return []
  return [{
    id: `project-library-${props.activeItem.id}`,
    name: props.activeItem.name,
    fileName: props.activeItem.name,
    content,
    sizeBytes: typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(content).length : content.length,
    sizeText: formatContextFileSize(content),
    projectLibraryItemId: props.activeItem.id
  }]
})

const hasMarkdownContent = computed(() => {
  if (!isMarkdownContentView.value) return false
  return currentViewContent.value.trim().length > 0
})

const renderedMarkdown = computed(() => {
  if (!isMarkdownContentView.value) return ''
  return renderMarkdownWithHighlight(currentViewContent.value)
})

const getAbsoluteTextContent = (result = {}) => {
  if (typeof result?.content === 'string') return result.content
  if (typeof result?.text === 'string') return result.text
  return ''
}

const loadMarkdownFileAssetContent = async (item) => {
  const loadId = markdownFileAssetLoadId.value + 1
  markdownFileAssetLoadId.value = loadId
  markdownFileAssetContent.value = ''
  if (!item?.filePath || !window.electronAPI?.readAbsolutePath) return

  const result = await window.electronAPI.readAbsolutePath({
    filePath: item.filePath,
    confirmed: true
  })
  if (markdownFileAssetLoadId.value !== loadId) return
  if (result?.error) {
    console.warn('[ProjectLibrary] Failed to read markdown file asset:', result.error)
    return
  }
  markdownFileAssetContent.value = getAbsoluteTextContent(result)
}

watch(() => props.activeItem, (item) => {
  draftContent.value = item?.nodeType === 'markdown' ? (item.content || '') : ''
  originalFilePreviewClosed.value = false
  originalFilePreviewMaximized.value = false
  if (item?.nodeType === 'file' && isMarkdownFileAsset.value) {
    loadMarkdownFileAssetContent(item).catch(err => {
      console.warn('[ProjectLibrary] Failed to load markdown file asset:', err)
    })
  } else {
    markdownFileAssetLoadId.value += 1
    markdownFileAssetContent.value = ''
  }
}, { immediate: true })

watch(() => props.activeItem?.id || null, () => {
  removedContextItemId.value = null
})

watch(visibleMessages, () => {
  scrollToBottom(true)
}, { flush: 'post' })

const stopStreamingElapsedTimer = () => {
  if (!streamingElapsedTimer) return
  globalThis.clearInterval(streamingElapsedTimer)
  streamingElapsedTimer = null
}

watch(() => props.sending, (sending) => {
  stopStreamingElapsedTimer()
  streamingElapsed.value = 0
  if (!sending) return

  streamingElapsedTimer = globalThis.setInterval(() => {
    streamingElapsed.value += 1
  }, 1000)
}, { immediate: true })

onMounted(() => {
  startAutoScrollObservers()
  nextTick(() => scrollToBottom(true, true))
})

onBeforeUnmount(() => {
  stopStreamingElapsedTimer()
  stopAutoScrollObservers()
})

const handleSend = (payload) => {
  if (payload && typeof payload === 'object') {
    emit('send', {
      ...payload,
      currentViewContent: currentViewContent.value
    })
    return
  }

  emit('send', {
    text: payload,
    currentViewContent: currentViewContent.value
  })
}

const handleRemoveActiveContextFile = (file) => {
  if (file?.projectLibraryItemId === props.activeItem?.id) {
    removedContextItemId.value = props.activeItem.id
  }
}

const handleDownloadPreview = () => {
  if (!canDownloadPreview.value || typeof document === 'undefined') return

  const blob = new Blob([currentViewContent.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = downloadPreviewFileName.value
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const handleDownloadOriginalFile = () => {
  if (!props.activeItem?.filePath) return
  const url = buildFileDownloadUrl({ filePath: props.activeItem.filePath })
  downloadFileFromUrl(url, props.activeItem.originalName || props.activeItem.name)
}
</script>

<style scoped>
.project-library-content {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  height: 100%;
  margin-left: 10px;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--panel-radius);
  background: var(--panel-bg);
}

.content-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  min-height: 50px;
  flex-shrink: 0;
  padding: 0 12px 0 18px;
  border: 1px solid var(--panel-border);
  border-bottom: none;
  border-radius: var(--panel-radius) var(--panel-radius) 0 0;
  background: var(--panel-bg-subtle);
}

.content-header::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: var(--panel-border);
}

.title-block {
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.title-row h1 {
  margin: 0;
  color: var(--text-color);
  font-size: 15px;
  font-weight: 700;
}

.type-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  padding: 0 8px;
  border-radius: 5px;
  background: var(--selected-bg);
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 650;
}

.title-block p {
  margin: 3px 0 0;
  color: var(--text-color-secondary);
  font-size: 12px;
}

.header-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.header-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  background: var(--bg-color);
  color: var(--text-color-secondary);
  cursor: pointer;
}

.header-actions button:hover {
  border-color: var(--primary-color);
  background: var(--hover-bg);
  color: var(--primary-color);
}

.project-main-area {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--panel-border);
  border-top: none;
  border-radius: 0 0 var(--panel-radius) var(--panel-radius);
  background: var(--panel-bg);
}

.project-agent-container {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--panel-bg);
}

.messages-region {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}

.project-messages-list {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 0;
  background: var(--panel-bg);
}

.chat-scroll-controls {
  position: absolute;
  right: 18px;
  top: 50%;
  z-index: 8;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transform: translateY(-50%);
  pointer-events: none;
}

.chat-scroll-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
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
  background: var(--hover-bg);
  color: var(--primary-color);
}

.chat-scroll-btn:disabled {
  cursor: default;
  opacity: 0.42;
}

.folder-panel {
  margin: 0 auto;
  color: var(--text-color);
}

.file-asset-panel {
  display: flex;
  width: min(560px, calc(100% - 32px));
  margin: 0 auto;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
  padding: 28px;
  color: var(--text-color);
  text-align: center;
}

.file-asset-meta {
  display: grid;
  width: 100%;
  margin: 0;
  gap: 10px;
}

.file-asset-meta div {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: baseline;
  gap: 12px;
  border-top: 1px solid var(--border-color);
  padding-top: 10px;
  text-align: left;
}

.file-asset-meta dt {
  color: var(--text-color-muted);
  font-size: 12px;
}

.file-asset-meta dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--text-color);
  font-size: 13px;
}

.file-asset-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--hover-bg);
  padding: 8px 12px;
  color: var(--text-color);
  cursor: pointer;
}

.file-asset-action:hover {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.project-library-file-preview {
  height: min(760px, calc(100vh - 230px));
  min-height: 420px;
  margin: 0 16px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
}

.project-library-file-preview.is-maximized {
  height: calc(100vh - 150px);
  min-height: 560px;
}

.project-library-file-preview :deep(.file-preview) {
  height: 100%;
  border-top: none;
}

.project-brief {
  margin: 0 16px;
  box-sizing: border-box;
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel-bg);
  padding: 22px 22px 24px;
  box-shadow: 0 16px 28px rgba(15, 23, 42, 0.06);
}

.project-brief h1,
.project-brief :deep(h1),
.file-asset-panel h1,
.folder-panel h1 {
  margin: 0 0 14px;
  font-size: 18px;
  font-weight: 750;
}

.project-brief h2,
.project-brief :deep(h2) {
  margin: 24px 0 12px;
  font-size: 17px;
}

.project-brief h3,
.project-brief :deep(h3) {
  margin: 18px 0 8px;
  font-size: 15px;
}

.project-brief p,
.project-brief li,
.project-brief :deep(p),
.project-brief :deep(li),
.folder-panel p {
  font-size: 14px;
  line-height: 2;
}

.project-brief ul,
.project-brief :deep(ul),
.project-brief :deep(ol) {
  padding-left: 22px;
}

.folder-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 360px;
  text-align: center;
  color: var(--text-color-muted);
}

.history-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 6px 16px;
  border-top: 1px solid var(--border-color);
  background: var(--info-bg);
  color: var(--text-color-secondary);
  font-size: 12px;
}

.project-agent-container :deep(.chat-input-area) {
  flex-shrink: 0;
}

.empty-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-color-muted);
  text-align: center;
}

.empty-content h2 {
  margin: 0;
  color: var(--text-color);
}

.empty-content p {
  margin: 0;
  max-width: 380px;
}
</style>
