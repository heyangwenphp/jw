<template>
  <div class="file-preview">
    <!-- Header -->
    <div class="preview-header">
      <span class="preview-filename" :title="preview?.name">{{ preview?.name || '' }}</span>
      <div class="preview-actions">
        <!-- 最大化/还原按钮 -->
        <button
          class="preview-toggle"
          @click="$emit('toggle-maximize')"
          :title="maximized ? t('agent.files.restorePreview') : t('agent.files.maximizePreview')"
        >
          <Icon :name="maximized ? 'restore' : 'maximize'" :size="12" />
        </button>
        <!-- 工具栏显隐开关 -->
        <button
          v-if="hasToolbar"
          class="preview-toggle"
          @click="toggleToolbar"
          :title="showToolbar ? t('agent.files.hideToolbar') : t('agent.files.showToolbar')"
        >
          <Icon :name="showToolbar ? 'chevronUp' : 'chevronDown'" :size="12" />
        </button>
        <!-- 关闭按钮 -->
        <button
          v-if="canDownloadPreview"
          class="preview-toggle"
          @click="downloadCurrentFile"
          :title="t('agent.files.download')"
        >
          <Icon name="download" :size="12" />
        </button>
        <button class="preview-close" @click="$emit('close')">
          <Icon name="close" :size="12" />
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="preview-body">
      <!-- Loading -->
      <div v-if="loading" class="preview-placeholder">
        <span>{{ t('common.loading') }}</span>
      </div>

      <!-- Error -->
      <div v-else-if="preview?.error" class="preview-placeholder preview-error">
        <Icon name="warning" :size="16" />
        <span>{{ preview.error }}</span>
      </div>

      <!-- Too Large -->
      <div v-else-if="preview?.tooLarge" class="preview-placeholder">
        <Icon name="fileText" :size="24" />
        <span>{{ t('agent.files.tooLarge') }}</span>
        <span class="preview-meta">{{ formatFileSize(preview.size) }}</span>
      </div>

      <!-- Text -->
      <div v-else-if="preview?.type === 'text'" class="preview-text">
        <!-- Text Toolbar -->
        <div v-if="showToolbar" class="text-toolbar">
          <!-- Markdown 源码/预览切换 -->
          <button
            v-if="isMarkdown"
            class="toolbar-btn"
            @click="markdownPreviewMode = !markdownPreviewMode"
            :title="markdownPreviewMode ? t('agent.files.previewSource') : t('agent.files.previewRendered')"
          >
            <svg v-if="!markdownPreviewMode" width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor"><path d="M289.28 758.4a32.64 32.64 0 0 1-21.12-8.32L15.36 522.24a30.72 30.72 0 0 1-10.88-23.68 35.84 35.84 0 0 1 10.88-23.68l256-222.72a32 32 0 1 1 42.24 48l-228.48 198.4L311.04 704a32 32 0 0 1 0 45.44 32 32 0 0 1-21.76 8.96zM731.52 758.4a32.64 32.64 0 0 1-23.68-10.88 32.64 32.64 0 0 1 0-45.44l225.92-203.52-223.36-198.4a32 32 0 0 1 0-45.44 31.36 31.36 0 0 1 44.8 0l256 222.72a31.36 31.36 0 0 1 0 47.36l-252.16 227.84a35.2 35.2 0 0 1-27.52 5.76zM441.6 866.56h-5.12a32.64 32.64 0 0 1-26.24-34.56L522.88 145.28a32.64 32.64 0 0 1 37.12-26.24 31.36 31.36 0 0 1 26.24 36.48L473.6 840.32a32 32 0 0 1-32 26.24z"/></svg>
            <Icon v-else name="eye" :size="14" />
          </button>
          <button
            v-if="!markdownPreviewMode"
            class="toolbar-btn"
            @click="saveText"
            :disabled="!isTextDirty || savingText"
            :title="t('agent.files.save')"
          >
            <Icon name="check" :size="14" />
          </button>
          <span v-if="!markdownPreviewMode && isTextDirty" class="toolbar-status">{{ t('agent.files.unsaved') }}</span>
          <span v-else-if="!markdownPreviewMode && saveSuccess" class="toolbar-status success">{{ t('agent.files.saved') }}</span>
          <span class="toolbar-tips">{{ isMarkdown && markdownPreviewMode ? '' : t('agent.files.textTips') }}</span>
          <button
            v-if="preview?.filePath"
            class="toolbar-btn"
            @click="$emit('insert-path', preview.filePath)"
            :title="t('agent.files.insertPath')"
          >
            <Icon name="send" :size="14" />
          </button>
        </div>

        <!-- Text Editor (源码模式) -->
        <CodeEditor
          v-if="!isMarkdown || !markdownPreviewMode"
          v-model="editableText"
          :fileName="preview?.name || ''"
          :readOnly="false"
          class="text-editor"
          @save="saveText"
          @cancel="$emit('close')"
        />

        <!-- Markdown 渲染预览 -->
        <div
          v-if="isMarkdown && markdownPreviewMode"
          class="markdown-preview jedi-markdown-preview"
          v-html="renderedMarkdown"
        />
      </div>

      <!-- HTML/URL Preview -->
      <div v-else-if="preview?.type === 'html' || preview?.type === 'url'" class="preview-html">
        <!-- Toolbar -->
        <div v-if="showToolbar" class="html-toolbar">
          <!-- 源码/预览切换（仅本地 HTML） -->
          <button
            v-if="preview?.type === 'html'"
            class="toolbar-btn"
            @click="toggleHtmlSource"
            :title="htmlSourceMode ? t('agent.files.previewRendered') : t('agent.files.previewSource')"
          >
            <svg v-if="!htmlSourceMode" width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor"><path d="M289.28 758.4a32.64 32.64 0 0 1-21.12-8.32L15.36 522.24a30.72 30.72 0 0 1-10.88-23.68 35.84 35.84 0 0 1 10.88-23.68l256-222.72a32 32 0 1 1 42.24 48l-228.48 198.4L311.04 704a32 32 0 0 1 0 45.44 32 32 0 0 1-21.76 8.96zM731.52 758.4a32.64 32.64 0 0 1-23.68-10.88 32.64 32.64 0 0 1 0-45.44l225.92-203.52-223.36-198.4a32 32 0 0 1 0-45.44 31.36 31.36 0 0 1 44.8 0l256 222.72a31.36 31.36 0 0 1 0 47.36l-252.16 227.84a35.2 35.2 0 0 1-27.52 5.76zM441.6 866.56h-5.12a32.64 32.64 0 0 1-26.24-34.56L522.88 145.28a32.64 32.64 0 0 1 37.12-26.24 31.36 31.36 0 0 1 26.24 36.48L473.6 840.32a32 32 0 0 1-32 26.24z"/></svg>
            <Icon v-else name="eye" :size="14" />
          </button>
          <span v-if="htmlSourceMode && isHtmlDirty" class="toolbar-status">{{ t('agent.files.unsaved') }}</span>
          <span v-else-if="htmlSourceMode && htmlSaveSuccess" class="toolbar-status success">{{ t('agent.files.saved') }}</span>
          <span class="toolbar-tips">{{ t('agent.files.webviewTips') }}</span>
          <button v-if="htmlSourceMode" class="toolbar-btn" @click="saveHtml" :disabled="!isHtmlDirty || savingHtml" :title="t('agent.files.save')">
            <Icon name="check" :size="14" />
          </button>
          <button v-if="!htmlSourceMode" class="toolbar-btn" @click="refreshHTML" :title="t('agent.files.refresh')">
            <Icon name="refresh" :size="14" />
          </button>
        </div>

        <!-- 源码编辑模式（仅本地 HTML） -->
        <CodeEditor
          v-if="htmlSourceMode"
          v-model="editableHtmlContent"
          language="html"
          :fileName="preview?.name || ''"
          :readOnly="false"
          class="html-source-editor"
          @save="saveHtml"
          @cancel="htmlSourceMode = false"
        />

        <!-- 渲染预览模式 -->
        <iframe
          v-if="isWeb"
          :key="htmlRefreshKey"
          :src="getWebviewSrc()"
          class="html-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        />
        <webview
          v-else
          ref="webviewRef"
          :key="htmlRefreshKey"
          :src="getWebviewSrc()"
          partition="persist:webview-preview"
          class="html-iframe"
          @dom-ready="handleWebviewReady"
        />
      </div>

      <!-- Image Enhanced -->
      <div v-else-if="preview?.type === 'image'" class="preview-image-enhanced">
        <!-- Image Toolbar -->
        <div v-if="showToolbar" class="image-toolbar">
          <button class="toolbar-btn" @click="zoomIn" :title="t('agent.files.zoomIn')">
            <Icon name="add" :size="14" />
          </button>
          <span class="zoom-level">{{ Math.round(imageZoom * 100) }}%</span>
          <button class="toolbar-btn" @click="zoomOut" :title="t('agent.files.zoomOut')">
            <Icon name="minus" :size="14" />
          </button>
          <button class="toolbar-btn" @click="resetZoom" :title="t('agent.files.resetZoom')">
            <Icon name="refresh" :size="14" />
          </button>
          <button class="toolbar-btn" @click="downloadImage" :title="t('agent.files.download')">
            <Icon name="download" :size="14" />
          </button>
          <button
            v-if="preview?.filePath"
            class="toolbar-btn"
            @click="$emit('insert-path', preview.filePath)"
            :title="t('agent.files.insertPath')"
          >
            <Icon name="send" :size="14" />
          </button>
        </div>

        <!-- Image Container -->
        <div
          class="image-container"
          ref="imageContainerRef"
          @wheel.prevent="handleWheel"
        >
          <img
            :src="preview.content"
            :alt="preview.name"
            :style="{ transform: `scale(${imageZoom})` }"
            @load="handleImageLoad"
          />
        </div>

        <!-- Image Info -->
        <div v-if="imageInfo" class="image-info">
          <span>{{ imageInfo.width }} × {{ imageInfo.height }}</span>
          <span class="info-separator">·</span>
          <span>{{ formatFileSize(preview.size || 0) }}</span>
        </div>
      </div>

      <!-- Video -->
      <div v-else-if="preview?.type === 'video'" class="preview-video">
        <!-- Video Toolbar -->
        <div v-if="showToolbar" class="video-toolbar">
          <span class="toolbar-tips">{{ t('agent.files.videoTips') }}</span>
          <button
            v-if="preview?.filePath"
            class="toolbar-btn"
            @click="$emit('insert-path', preview.filePath)"
            :title="t('agent.files.insertPath')"
          >
            <Icon name="send" :size="14" />
          </button>
        </div>

        <!-- Video Player -->
        <div class="video-container" @wheel.prevent="handleVideoWheel">
          <video
            ref="videoRef"
            :src="preview.content"
            :key="preview?.filePath || preview?.name"
            controls
            autoplay
            class="video-player"
            @loadedmetadata="handleVideoLoad"
            @dblclick="toggleVideoFullscreen"
          >
            {{ t('agent.files.videoNotSupported') }}
          </video>
        </div>

        <!-- Video Info -->
        <div v-if="videoInfo" class="video-info">
          <span>{{ videoInfo.width }} × {{ videoInfo.height }}</span>
          <span class="info-separator">·</span>
          <span>{{ formatDuration(videoInfo.duration) }}</span>
          <span class="info-separator">·</span>
          <span>{{ formatFileSize(preview.size || 0) }}</span>
        </div>
      </div>

      <!-- Audio -->
      <div v-else-if="preview?.type === 'audio'" class="preview-audio">
        <!-- Audio Toolbar -->
        <div v-if="showToolbar" class="audio-toolbar">
          <span class="toolbar-tips">{{ t('agent.files.audioTips') }}</span>
          <button
            v-if="preview?.filePath"
            class="toolbar-btn"
            @click="$emit('insert-path', preview.filePath)"
            :title="t('agent.files.insertPath')"
          >
            <Icon name="send" :size="14" />
          </button>
        </div>

        <!-- Audio Player -->
        <div class="audio-container">
          <audio
            ref="audioRef"
            :src="preview.content"
            :key="preview?.filePath || preview?.name"
            controls
            autoplay
            class="audio-player"
          >
            {{ t('agent.files.audioNotSupported') }}
          </audio>
        </div>

        <!-- Audio Info -->
        <div v-if="audioInfo" class="audio-info">
          <span>{{ formatDuration(audioInfo.duration) }}</span>
          <span class="info-separator">·</span>
          <span>{{ formatFileSize(preview.size || 0) }}</span>
        </div>
      </div>

      <!-- PDF -->
      <div v-else-if="preview?.type === 'pdf'" class="preview-pdf">
        <div v-if="showToolbar" class="pdf-toolbar">
          <div class="pdf-page-controls">
            <button
              class="toolbar-btn"
              @click="goToPreviousPdfPage"
              :disabled="!canGoPreviousPdfPage || pdfRendering"
              title="上一页"
            >
              <Icon name="chevronLeft" :size="14" />
            </button>
            <span class="pdf-page-status">
              {{ pdfPageCount ? `${pdfPageNumber} / ${pdfPageCount}` : 'PDF' }}
            </span>
            <button
              class="toolbar-btn"
              @click="goToNextPdfPage"
              :disabled="!canGoNextPdfPage || pdfRendering"
              title="下一页"
            >
              <Icon name="chevronRight" :size="14" />
            </button>
          </div>
          <div class="pdf-zoom-controls">
            <button
              class="toolbar-btn"
              @click="zoomOutPdf"
              :disabled="pdfZoom <= PDF_MIN_ZOOM || pdfRendering"
              :title="t('agent.files.zoomOut')"
            >
              <Icon name="minus" :size="14" />
            </button>
            <span class="zoom-level pdf-zoom-level">{{ Math.round(pdfZoom * 100) }}%</span>
            <button
              class="toolbar-btn"
              @click="zoomInPdf"
              :disabled="pdfZoom >= PDF_MAX_ZOOM || pdfRendering"
              :title="t('agent.files.zoomIn')"
            >
              <Icon name="add" :size="14" />
            </button>
            <button
              class="toolbar-btn"
              @click="resetPdfZoom"
              :disabled="isPdfZoomAtDefault || pdfRendering"
              :title="t('agent.files.resetZoom')"
            >
              <Icon name="refresh" :size="14" />
            </button>
          </div>
          <button
            v-if="preview?.filePath"
            class="toolbar-btn"
            @click="$emit('insert-path', preview.filePath)"
            :title="t('agent.files.insertPath')"
          >
            <Icon name="send" :size="14" />
          </button>
          <button
            v-if="canDownloadCurrentFile"
            class="toolbar-btn"
            @click="downloadCurrentFile"
            :title="t('agent.files.download')"
          >
            <Icon name="download" :size="14" />
          </button>
        </div>
        <div class="pdf-container">
          <div v-if="pdfLoadingDocument" class="preview-placeholder pdf-status">
            <span>{{ t('common.loading') }}</span>
          </div>
          <div v-else-if="pdfError" class="preview-placeholder preview-error pdf-status">
            <Icon name="warning" :size="16" />
            <span>{{ pdfError }}</span>
          </div>
          <div ref="pdfViewerContainerRef" class="pdf-viewer-container">
            <div ref="pdfViewerRef" class="pdfViewer"></div>
          </div>
        </div>
      </div>

      <!-- Word (.docx) -->
      <div v-else-if="preview?.type === 'word'" class="preview-word">
        <div class="word-toolbar">
          <span class="toolbar-tips">Word</span>
          <button
            v-if="preview?.filePath"
            class="toolbar-btn"
            @click="$emit('insert-path', preview.filePath)"
            :title="t('agent.files.insertPath')"
          >
            <Icon name="send" :size="14" />
          </button>
        </div>
        <div class="word-container" v-html="wordContent"></div>
      </div>

      <!-- Office (Word/Excel) -->
      <div v-else-if="preview?.type === 'office'" class="preview-office">
        <div class="office-toolbar">
          <span class="toolbar-tips">{{ t('agent.files.officeTips') }}</span>
          <button
            v-if="preview?.filePath"
            class="toolbar-btn"
            @click="$emit('insert-path', preview.filePath)"
            :title="t('agent.files.insertPath')"
          >
            <Icon name="send" :size="14" />
          </button>
        </div>
        <div class="office-container" v-html="officeContent"></div>
      </div>

      <!-- Notebook (Jupyter) -->
      <div v-else-if="preview?.type === 'notebook'" class="preview-notebook">
        <div class="notebook-toolbar">
          <span class="toolbar-tips">{{ t('agent.files.notebookTips') }}</span>
          <button
            v-if="preview?.filePath"
            class="toolbar-btn"
            @click="$emit('insert-path', preview.filePath)"
            :title="t('agent.files.insertPath')"
          >
            <Icon name="send" :size="14" />
          </button>
        </div>
        <div class="notebook-container" v-html="notebookContent"></div>
      </div>

      <!-- Binary -->
      <div v-else-if="preview?.type === 'binary'" class="preview-placeholder">
        <Icon name="fileText" :size="24" />
        <span>{{ t('agent.files.cannotPreview') }}</span>
        <span class="preview-meta">{{ preview.ext }} · {{ formatFileSize(preview.size) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useLocale } from '@composables/useLocale'
import { formatFileSize } from '@composables/useAgentFiles'
import Icon from '@components/icons/Icon.vue'
import CodeEditor from '@components/CodeEditor.vue'
import { renderCodeBlockWithLines, renderMarkdownWithHighlight } from '@utils/highlight-utils'
import {
  buildFileDownloadUrl,
  buildFilePreviewUrl,
  buildWebRawFileUrl,
  downloadFileFromUrl
} from '@utils/file-preview-url-utils'
import mammoth from 'mammoth'
import 'pdfjs-dist/legacy/web/pdf_viewer.css'

const { t } = useLocale()

const props = defineProps({
  preview: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  maximized: { type: Boolean, default: false },
  pdfInitialView: { type: String, default: '' }
})

const emit = defineEmits(['close', 'toggle-maximize', 'insert-path'])

// 判断是否为 Web 版本
const isWeb = computed(() => window.electronAPI?.platform === 'web')
const canDownloadCurrentFile = computed(() => Boolean(buildFileDownloadUrl(props.preview)))
const canDownloadPreview = computed(() => isWeb.value && canDownloadCurrentFile.value)

// Markdown 预览
const isMarkdown = computed(() => {
  const name = props.preview?.name || ''
  return /\.(md|markdown)$/i.test(name) && props.preview?.type === 'text'
})
const markdownPreviewMode = ref(false)
const renderedMarkdown = ref('')

// 图片预览增强
const imageZoom = ref(1)
const imageInfo = ref(null)
const imageContainerRef = ref(null)

// HTML 预览刷新
const htmlRefreshKey = ref(0)

// PDF 预览状态
const PDF_MIN_ZOOM = 0.25
const PDF_MAX_ZOOM = 3
const PDF_ZOOM_STEP = 0.25
const PDF_DEFAULT_SCALE_VALUE = 'page-width'
const pdfViewerContainerRef = ref(null)
const pdfViewerRef = ref(null)
const pdfViewerInstance = shallowRef(null)
const pdfEventBus = shallowRef(null)
const pdfLinkService = shallowRef(null)
const pdfDoc = shallowRef(null)
const pdfPageNumber = ref(1)
const pdfPageCount = ref(0)
const pdfZoom = ref(1)
const pdfDefaultZoom = ref(1)
const pdfDefaultScaleValue = ref(PDF_DEFAULT_SCALE_VALUE)
const pdfLoadingDocument = ref(false)
const pdfRendering = ref(false)
const pdfError = ref('')
let pdfLoadSeq = 0
let pdfLoadingTask = null

// HTML 源码编辑相关
const htmlSourceMode = ref(false)
const editableHtmlContent = ref('')
const originalHtmlContent = ref('')
const isHtmlDirty = ref(false)
const savingHtml = ref(false)
const htmlSaveSuccess = ref(false)

const toggleHtmlSource = () => {
  htmlSourceMode.value = !htmlSourceMode.value
  if (htmlSourceMode.value) {
    editableHtmlContent.value = props.preview?.content || ''
    originalHtmlContent.value = props.preview?.content || ''
    isHtmlDirty.value = false
    htmlSaveSuccess.value = false
  } else {
    htmlRefreshKey.value++
  }
}

watch(editableHtmlContent, (val) => {
  isHtmlDirty.value = val !== originalHtmlContent.value
  if (isHtmlDirty.value) htmlSaveSuccess.value = false
})

const saveHtml = async () => {
  if (props.preview?.type !== 'html' || !props.preview?.filePath || !isHtmlDirty.value || savingHtml.value) return

  savingHtml.value = true
  const snapshot = {
    filePath: props.preview.filePath,
    sessionId: props.preview.sessionId,
    relativePath: props.preview.relativePath,
    isExternalFile: props.preview.isExternalFile,
    content: editableHtmlContent.value
  }

  try {
    let result
    if (!snapshot.isExternalFile && snapshot.sessionId && snapshot.relativePath) {
      result = await window.electronAPI.saveAgentFile({
        sessionId: snapshot.sessionId,
        relativePath: snapshot.relativePath,
        content: snapshot.content
      })
    } else {
      result = await window.electronAPI.saveAbsoluteFile({
        filePath: snapshot.filePath,
        content: snapshot.content
      })
    }
    if (result.error) {
      console.error('Save HTML failed:', result.error)
      return
    }
    if (props.preview?.filePath === snapshot.filePath) {
      originalHtmlContent.value = snapshot.content
      isHtmlDirty.value = false
      htmlSaveSuccess.value = true
      setTimeout(() => { htmlSaveSuccess.value = false }, 3000)
    }
  } catch (err) {
    console.error('Save HTML error:', err)
  } finally {
    savingHtml.value = false
  }
}

// 视频预览
const videoRef = ref(null)
const videoInfo = ref(null)

// 音频预览
const audioRef = ref(null)
const audioInfo = ref(null)

// webview 相关（统一 HTML 和 URL）
const webviewRef = ref(null)

// Word 文档内容
const wordContent = ref('')

// Office 文档内容
const officeContent = ref('')

// Notebook 文档内容
const notebookContent = ref('')

// 工具栏显隐控制
const showToolbar = ref(true) // 默认显示

// 判断当前类型是否有工具栏
const hasToolbar = computed(() => {
  const type = props.preview?.type
  return type === 'image' || type === 'video' || type === 'audio' || type === 'html' || type === 'url' || type === 'text' || type === 'office' || type === 'pdf' || type === 'word'
})

const canGoPreviousPdfPage = computed(() => pdfPageNumber.value > 1)
const canGoNextPdfPage = computed(() => pdfPageCount.value > 0 && pdfPageNumber.value < pdfPageCount.value)
const isPdfZoomAtDefault = computed(() => Math.abs(pdfZoom.value - pdfDefaultZoom.value) < 0.005)

// 切换工具栏显示
const toggleToolbar = () => {
  showToolbar.value = !showToolbar.value
}

// 文本编辑相关
const editableText = ref('')
const originalText = ref('')
const isTextDirty = ref(false)
const savingText = ref(false)
const saveSuccess = ref(false)

// 监听文本变更，更新 dirty 状态
watch(editableText, (val) => {
  isTextDirty.value = val !== originalText.value
  if (isTextDirty.value) saveSuccess.value = false
})

// 保存文本
const saveText = async () => {
  if (props.preview?.type !== 'text' || !props.preview?.filePath || !isTextDirty.value || savingText.value) return

  savingText.value = true

  // 快照：防止异步保存期间用户切换文件导致写入目标错误
  const snapshot = {
    filePath: props.preview.filePath,
    sessionId: props.preview.sessionId,
    relativePath: props.preview.relativePath,
    isExternalFile: props.preview.isExternalFile,
    content: editableText.value
  }

  try {
    let result
    if (!snapshot.isExternalFile && snapshot.sessionId && snapshot.relativePath) {
      // cwd 内文件：通过 sessionId + relativePath 保存
      result = await window.electronAPI.saveAgentFile({
        sessionId: snapshot.sessionId,
        relativePath: snapshot.relativePath,
        content: snapshot.content
      })
    } else {
      // cwd 外文件：直接通过绝对路径保存
      result = await window.electronAPI.saveAbsoluteFile({
        filePath: snapshot.filePath,
        content: snapshot.content
      })
    }

    if (result.error) {
      console.error('Save failed:', result.error)
      return
    }

    // 保存成功（仅当用户未切换文件时更新 dirty 状态）
    if (props.preview?.filePath === snapshot.filePath) {
      originalText.value = snapshot.content
      isTextDirty.value = false
      saveSuccess.value = true
      setTimeout(() => { saveSuccess.value = false }, 3000)
    }
  } catch (err) {
    console.error('Save error:', err)
  } finally {
    savingText.value = false
  }
}

// 加载 Word 文档预览
const loadWordPreview = async () => {
  try {
    if (!isWeb.value && window.electronAPI?.readOfficeFile && props.preview?.filePath) {
      const result = await window.electronAPI.readOfficeFile({ filePath: props.preview.filePath, ext: 'docx' })
      if (result.error) throw new Error(result.error)
      wordContent.value = result.content || '<div class="word-empty">文档内容为空</div>'
      return
    }

    const url = buildWebRawFileUrl(props.preview)
    if (!url) throw new Error('无法获取文件预览地址')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()
    const result = await mammoth.convertToHtml({ arrayBuffer })
    wordContent.value = result.value || '<div class="word-empty">文档内容为空</div>'
  } catch (err) {
    wordContent.value = `<div class="word-error">无法预览 Word 文档: ${err.message}</div>`
  }
}

// 加载 Office 文档预览
const loadOfficePreview = async (filePath, ext) => {
  try {
    if (isWeb.value) {
      await loadWebOfficePreview(ext)
      return
    }

    const result = await window.electronAPI.readOfficeFile({ filePath, ext: ext.replace('.', '') })
    if (result.error) {
      officeContent.value = `<div class="office-error">${result.error}</div>`
      return
    }
    if (result.type === 'html' || result.type === 'word') {
      officeContent.value = result.content
    } else if (result.type === 'excel') {
      officeContent.value = renderExcelToTable(result.content, result.meta)
    } else if (result.type === 'pdf') {
      officeContent.value = `<div class="office-pdf-hint">${t('agent.files.pdfPreviewHint')}<br/><span class="file-path">${filePath}</span></div>`
    } else {
      officeContent.value = `<div class="office-unsupported">${t('agent.files.officeUnsupported')}</div>`
    }
  } catch (err) {
    officeContent.value = `<div class="office-error">${err.message}</div>`
  }
}

const loadWebOfficePreview = async (ext) => {
  const normalizedExt = String(ext || '').replace(/^\./, '').toLowerCase()
  const url = buildWebRawFileUrl(props.preview)
  if (!url) {
    officeContent.value = '<div class="office-error">无法获取文件预览地址</div>'
    return
  }

  if (normalizedExt === 'doc') {
    officeContent.value = '<div class="office-unsupported">.doc 格式暂不支持预览，请使用 .docx 格式</div>'
    return
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const arrayBuffer = await response.arrayBuffer()

  if (normalizedExt === 'docx') {
    const result = await mammoth.convertToHtml({ arrayBuffer })
    officeContent.value = result.value || '<div class="word-empty">文档内容为空</div>'
    return
  }

  if (normalizedExt === 'xlsx' || normalizedExt === 'xls') {
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
    const sheetsData = {}
    for (const sheetName of workbook.SheetNames) {
      sheetsData[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 })
    }
    officeContent.value = renderExcelToTable(JSON.stringify(sheetsData), { sheetNames: workbook.SheetNames })
    return
  }

  officeContent.value = `<div class="office-unsupported">${t('agent.files.officeUnsupported')}</div>`
}

// 渲染 Excel 数据为 HTML 表格
const renderExcelToTable = (jsonContent, meta) => {
  try {
    const data = JSON.parse(jsonContent)
    if (!data || typeof data !== 'object') return '<div class="office-error">Invalid data</div>'
    let html = '<div class="excel-container">'
    const sheetNames = meta?.sheetNames || Object.keys(data)
    sheetNames.forEach((sheetName, idx) => {
      html += `<div class="excel-sheet"><div class="sheet-name">${sheetName}</div>`
      const rows = data[sheetName]
      if (Array.isArray(rows) && rows.length > 0) {
        html += '<table class="excel-table"><thead><tr>'
        const headers = rows[0] || []
        headers.forEach(h => { html += `<th>${h != null ? h : ''}</th>` })
        html += '</tr></thead><tbody>'
        for (let i = 1; i < rows.length; i++) {
          html += '<tr>'
          rows[i].forEach(cell => { html += `<td>${cell != null ? cell : ''}</td>` })
          html += '</tr>'
        }
        html += '</tbody></table>'
      } else {
        html += '<div class="no-data">No data</div>'
      }
      html += '</div>'
    })
    html += '</div>'
    return html
  } catch (err) {
    return `<div class="office-error">${err.message}</div>`
  }
}

// 重置状态（当切换文件时）
watch(() => props.preview, async (newPreview) => {
  imageZoom.value = 1
  imageInfo.value = null
  videoInfo.value = null
  htmlRefreshKey.value = 0
  showToolbar.value = true // 重置工具栏为显示状态
  officeContent.value = ''
  notebookContent.value = ''
  wordContent.value = ''
  markdownPreviewMode.value = isMarkdown.value
  renderedMarkdown.value = ''

  // 初始化文本编辑器
  if (newPreview?.type === 'text' && newPreview?.content) {
    htmlSourceMode.value = false
editableHtmlContent.value = ''
originalHtmlContent.value = ''
isHtmlDirty.value = false
savingHtml.value = false
htmlSaveSuccess.value = false

editableText.value = newPreview.content
    originalText.value = newPreview.content
    isTextDirty.value = false
    saveSuccess.value = false

    // 预渲染 Markdown 内容
    if (isMarkdown.value) {
      try {
        renderedMarkdown.value = renderMarkdownWithHighlight(newPreview.content)
      } catch (err) {
        renderedMarkdown.value = `<div class="markdown-error">${err.message}</div>`
      }
    }
  }

  // Office 文档预览
  if (newPreview?.type === 'office' && newPreview?.filePath && newPreview?.ext) {
    await loadOfficePreview(newPreview.filePath, newPreview.ext)
  }

  // Word 文档预览
  if (newPreview?.type === 'word') {
    await loadWordPreview()
  }

  // Notebook 文档预览
  if (newPreview?.type === 'notebook' && newPreview?.content) {
    notebookContent.value = renderNotebookToHtml(newPreview.content)
  }

}, { immediate: true })

// 放大
const zoomIn = () => {
  imageZoom.value = Math.min(imageZoom.value + 0.25, 5)
}

// 缩小
const zoomOut = () => {
  imageZoom.value = Math.max(imageZoom.value - 0.25, 0.25)
}

// 重置缩放
const resetZoom = () => {
  imageZoom.value = 1
}

// 鼠标滚轮缩放
const handleWheel = (e) => {
  const delta = e.deltaY > 0 ? -0.1 : 0.1
  imageZoom.value = Math.max(0.25, Math.min(5, imageZoom.value + delta))
}

// 图片加载完成，获取尺寸信息
const handleImageLoad = (e) => {
  const img = e.target
  imageInfo.value = {
    width: img.naturalWidth,
    height: img.naturalHeight
  }
}

// 下载图片
const downloadImage = () => {
  if (!props.preview?.content) return

  const link = document.createElement('a')
  link.href = props.preview.content
  link.download = props.preview.name || 'image'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// 在默认应用中打开图片
const downloadCurrentFile = () => {
  const url = buildFileDownloadUrl(props.preview)
  if (!url) return

  downloadFileFromUrl(url, props.preview?.name || 'download')
}

// 视频加载完成，获取元数据
const handleVideoLoad = (e) => {
  const video = e.target
  videoInfo.value = {
    width: video.videoWidth,
    height: video.videoHeight,
    duration: video.duration
  }
}

// 格式化时长（秒 → mm:ss）
const formatDuration = (seconds) => {
  if (!seconds || !isFinite(seconds)) return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// 滚轮调节音量
const handleVideoWheel = (e) => {
  if (!videoRef.value) return
  const delta = e.deltaY > 0 ? -0.05 : 0.05
  videoRef.value.volume = Math.max(0, Math.min(1, videoRef.value.volume + delta))
}

// 双击全屏
const toggleVideoFullscreen = () => {
  if (!videoRef.value) return
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    videoRef.value.requestFullscreen()
  }
}

// 刷新 HTML/URL 预览
const refreshHTML = () => {
  htmlRefreshKey.value++
}

// 获取 webview 的 src（统一处理 HTML 文件和 URL）
const getWebviewSrc = () => {
  return buildFilePreviewUrl(props.preview, { isWeb: isWeb.value })
}

// PDF 文件 URL
const pdfFileUrl = computed(() => {
  return buildFilePreviewUrl(props.preview, {
    isWeb: isWeb.value,
    pdfInitialView: props.pdfInitialView
  })
})

const clampPdfZoom = (zoom) => {
  return Math.min(PDF_MAX_ZOOM, Math.max(PDF_MIN_ZOOM, zoom))
}

const getPdfInitialPage = () => {
  const match = String(props.pdfInitialView || '').match(/(?:^|[&#])page=(\d+)/)
  const page = match ? Number.parseInt(match[1], 10) : 1
  return Number.isFinite(page) && page > 0 ? page : 1
}

const getPdfInitialZoom = () => {
  const match = String(props.pdfInitialView || '').match(/(?:^|[&#])zoom=(\d+)/)
  if (!match) return null
  const zoom = Number.parseInt(match[1], 10) / 100
  return Number.isFinite(zoom) ? clampPdfZoom(zoom) : null
}

const normalizePdfZoom = (zoom, fallback = 1) => {
  return Number.isFinite(zoom) && zoom > 0 ? zoom : fallback
}

const syncPdfViewerZoom = () => {
  const viewer = pdfViewerInstance.value
  pdfZoom.value = normalizePdfZoom(viewer?.currentScale, pdfZoom.value)
}

const clearPdfViewerDom = () => {
  pdfViewerRef.value?.replaceChildren?.()
}

const resetPdfPreview = () => {
  pdfLoadSeq++
  if (pdfLoadingTask?.destroy) {
    try { pdfLoadingTask.destroy() } catch {}
  }
  pdfLoadingTask = null
  if (pdfViewerInstance.value?.setDocument) {
    try { pdfViewerInstance.value.setDocument(null) } catch {}
  }
  if (pdfLinkService.value?.setDocument) {
    try { pdfLinkService.value.setDocument(null) } catch {}
  }
  if (pdfDoc.value?.destroy) {
    try { pdfDoc.value.destroy() } catch {}
  }
  pdfViewerInstance.value = null
  pdfEventBus.value = null
  pdfLinkService.value = null
  pdfDoc.value = null
  pdfPageNumber.value = 1
  pdfPageCount.value = 0
  pdfZoom.value = 1
  pdfDefaultZoom.value = 1
  pdfDefaultScaleValue.value = PDF_DEFAULT_SCALE_VALUE
  pdfLoadingDocument.value = false
  pdfRendering.value = false
  pdfError.value = ''
  clearPdfViewerDom()
}

const applyPdfInitialView = async () => {
  const viewer = pdfViewerInstance.value
  if (!viewer) return

  const initialZoom = getPdfInitialZoom()
  if (initialZoom !== null) {
    pdfDefaultScaleValue.value = String(initialZoom)
    viewer.currentScaleValue = String(initialZoom)
  } else {
    pdfDefaultScaleValue.value = PDF_DEFAULT_SCALE_VALUE
    pdfViewerInstance.value.currentScaleValue = 'page-width'
  }

  await nextTick()
  const defaultZoom = normalizePdfZoom(viewer.currentScale)
  pdfDefaultZoom.value = defaultZoom
  pdfZoom.value = defaultZoom

  const initialPage = Math.min(getPdfInitialPage(), pdfPageCount.value || 1)
  if (initialPage > 1) {
    viewer.currentPageNumber = initialPage
  } else {
    pdfPageNumber.value = normalizePdfPageNumber(viewer.currentPageNumber)
  }
}

const normalizePdfPageNumber = (pageNumber) => {
  return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1
}

const loadPdfPreview = async () => {
  const url = pdfFileUrl.value
  if (!url) return

  const loadSeq = ++pdfLoadSeq
  pdfLoadingDocument.value = true
  pdfRendering.value = true
  pdfError.value = ''
  pdfZoom.value = getPdfInitialZoom() ?? 1
  await nextTick()

  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { EventBus, PDFLinkService, PDFViewer } = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString()
    const loadingTask = pdfjsLib.getDocument({ url })
    pdfLoadingTask = loadingTask
    const doc = await loadingTask.promise
    if (loadSeq !== pdfLoadSeq) {
      doc.destroy?.()
      return
    }

    const container = pdfViewerContainerRef.value
    const viewerElement = pdfViewerRef.value
    if (!container || !viewerElement) {
      throw new Error('PDF viewer container not mounted')
    }

    clearPdfViewerDom()
    pdfDoc.value = doc
    pdfPageCount.value = doc.numPages || 0
    pdfPageNumber.value = Math.min(getPdfInitialPage(), pdfPageCount.value || 1)
    pdfLoadingDocument.value = false
    await nextTick()

    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const viewer = new PDFViewer({
      container,
      viewer: viewerElement,
      eventBus,
      linkService
    })

    linkService.setViewer(viewer)
    pdfEventBus.value = eventBus
    pdfLinkService.value = linkService
    pdfViewerInstance.value = viewer

    eventBus.on('pagesinit', async () => {
      if (loadSeq !== pdfLoadSeq) return
      await applyPdfInitialView()
      if (loadSeq === pdfLoadSeq) {
        pdfRendering.value = false
      }
    })
    eventBus.on('pagechanging', ({ pageNumber }) => {
      if (loadSeq !== pdfLoadSeq) return
      pdfPageNumber.value = normalizePdfPageNumber(pageNumber)
    })
    eventBus.on('scalechanging', ({ scale }) => {
      if (loadSeq !== pdfLoadSeq) return
      pdfZoom.value = normalizePdfZoom(scale, pdfZoom.value)
    })

    viewer.setDocument(doc)
    linkService.setDocument(doc, null)
  } catch (err) {
    if (loadSeq === pdfLoadSeq) {
      pdfError.value = err?.message || 'PDF load failed'
    }
  } finally {
    if (loadSeq === pdfLoadSeq) {
      pdfLoadingDocument.value = false
      if (pdfError.value) {
        pdfRendering.value = false
      }
    }
  }
}

const goToPreviousPdfPage = () => {
  if (!canGoPreviousPdfPage.value || pdfRendering.value) return
  const viewer = pdfViewerInstance.value
  if (!viewer) return
  pdfViewerInstance.value.currentPageNumber = viewer.currentPageNumber - 1
}

const goToNextPdfPage = () => {
  if (!canGoNextPdfPage.value || pdfRendering.value) return
  const viewer = pdfViewerInstance.value
  if (!viewer) return
  pdfViewerInstance.value.currentPageNumber = viewer.currentPageNumber + 1
}

const setPdfZoom = (zoom) => {
  const viewer = pdfViewerInstance.value
  if (!viewer || pdfRendering.value) return
  const nextZoom = clampPdfZoom(Math.round(zoom * 100) / 100)
  viewer.currentScaleValue = String(nextZoom)
  syncPdfViewerZoom()
}

const zoomOutPdf = () => setPdfZoom(pdfZoom.value - PDF_ZOOM_STEP)
const zoomInPdf = () => setPdfZoom(pdfZoom.value + PDF_ZOOM_STEP)
const resetPdfZoom = () => {
  const viewer = pdfViewerInstance.value
  if (!viewer || pdfRendering.value) return
  viewer.currentScaleValue = pdfDefaultScaleValue.value
  syncPdfViewerZoom()
}

watch(() => props.preview, async (newPreview) => {
  resetPdfPreview()
  if (newPreview?.type === 'pdf') {
    await loadPdfPreview()
  }
}, { immediate: true })

// 渲染 Notebook 为 HTML
const renderNotebookToHtml = (nb) => {
  if (!nb || !nb.cells || !Array.isArray(nb.cells)) {
    return '<div class="notebook-error">Invalid notebook format</div>'
  }
  let html = '<div class="nb-container">'
  html += '<div class="nb-header">'
  if (nb.metadata?.kernelspec) {
    html += `<span class="nb-kernel">${nb.metadata.kernelspec.display_name}</span>`
  }
  if (nb.cells.length) {
    html += `<span class="nb-cell-count">${nb.cells.length} cells</span>`
  }
  html += '</div>'

  nb.cells.forEach((cell, idx) => {
    const cellType = cell.cell_type
    const source = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '')
    const outputs = cell.outputs || []

    html += `<div class="nb-cell nb-cell-${cellType}" id="cell-${idx}">`
    html += `<div class="nb-cell-header"><span class="nb-cell-type">${cellType === 'code' ? 'Code' : 'Markdown'}</span></div>`
    html += `<div class="nb-cell-content">`

    if (cellType === 'markdown') {
      html += `<div class="nb-markdown">${renderMarkdownWithHighlight(source)}</div>`
    } else if (cellType === 'code') {
      const kernelLang = nb.metadata?.kernelspec?.language || 'python'
      html += renderCodeBlockWithLines(source, kernelLang)
      if (outputs.length > 0) {
        html += `<div class="nb-outputs">`
        outputs.forEach(output => {
          if (output.output_type === 'stream') {
            html += `<div class="nb-output nb-stream">${escapeHtml(output.text.join(''))}</div>`
          } else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
            const data = output.data || {}
            if (data['text/plain']) {
              html += `<div class="nb-output nb-text">${escapeHtml(data['text/plain'].join ? data['text/plain'].join('') : data['text/plain'])}</div>`
            }
            if (data['image/png']) {
              html += `<div class="nb-output nb-image"><img src="data:image/png;base64,${data['image/png']}" /></div>`
            }
          } else if (output.output_type === 'error') {
            html += `<div class="nb-output nb-error">${escapeHtml(output.ename + ': ' + output.evalue)}</div>`
          }
        })
        html += `</div>`
      }
    }

    html += `</div></div>`
  })
  html += '</div>'
  return html
}

const escapeHtml = (str) => {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// webview 加载完成后处理
const handleWebviewReady = () => {
  // 暂时不做任何处理，保持网页原始内容
  // 等待进一步讨论如何优化显示
}

// ESC 键关闭预览（全局，非文本编辑区域）
const handleKeyDown = (e) => {
  if (e.key === 'Escape' && props.preview?.type !== 'text') {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  resetPdfPreview()
})
</script>

<style scoped>
.file-preview {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-color);
  min-height: 0;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.preview-filename {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.preview-toggle,
.preview-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--text-color-muted);
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.preview-toggle:hover,
.preview-close:hover {
  background: var(--hover-bg);
  color: var(--text-color);
}

.preview-body {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.preview-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--text-color-muted);
  font-size: 12px;
}

.preview-error {
  color: var(--error-color, #e53e3e);
}

.preview-meta {
  font-size: 11px;
  color: var(--text-color-muted);
  opacity: 0.7;
}

.preview-text {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.text-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.toolbar-status {
  font-size: 11px;
  color: var(--text-color-muted);
  user-select: none;
}

.toolbar-status.success {
  color: var(--success-color, #10b981);
}

.text-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Markdown 渲染预览 */
.markdown-preview {
  flex: 1;
  overflow: auto;
  padding: 16px 20px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-color);
  background: var(--bg-color);
}

/* 图片预览增强 */
.preview-image-enhanced {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.image-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-color-muted);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.toolbar-btn:hover {
  background: var(--hover-bg);
  color: var(--primary-color);
}

.toolbar-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.toolbar-btn:disabled:hover {
  background: transparent;
  color: var(--text-color-muted);
}

.zoom-level {
  font-size: 11px;
  color: var(--text-color-muted);
  min-width: 40px;
  text-align: center;
  user-select: none;
}

.image-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 8px;
  cursor: move;
}

.image-container img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  transition: transform 0.2s ease;
  transform-origin: center center;
}

.image-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-top: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-color-muted);
  flex-shrink: 0;
}

.info-separator {
  opacity: 0.5;
}

/* HTML 预览 */
.preview-html {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.html-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.toolbar-tips {
  flex: 1;
  font-size: 11px;
  color: var(--text-color-muted);
  user-select: none;
  opacity: 0.7;
  text-align: right;
}

.html-iframe {
  flex: 1;
  width: 100%;
  border: none;
  background: white;
}

.html-source-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* 视频预览 */
.preview-video {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.video-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.video-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #000;
}

.video-player {
  max-width: 100%;
  max-height: 100%;
  outline: none;
}

.video-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-top: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-color-muted);
  flex-shrink: 0;
}

/* Audio 预览 */
.preview-audio {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.audio-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.audio-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--bg-color);
  padding: 16px;
}

.audio-player {
  width: 100%;
  max-width: 600px;
  outline: none;
}

.audio-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-top: 1px solid var(--border-color);
  font-size: 11px;
  color: var(--text-color-muted);
  flex-shrink: 0;
}

/* PDF 预览 */
.preview-pdf {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.pdf-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.pdf-page-controls,
.pdf-zoom-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.pdf-page-controls {
  margin-right: auto;
}

.pdf-page-status {
  min-width: 54px;
  text-align: center;
  font-size: 11px;
  color: var(--text-color);
  user-select: none;
  white-space: nowrap;
}

.pdf-zoom-level {
  min-width: 42px;
}

.pdf-container {
  flex: 1;
  position: relative;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-color-tertiary);
}

.pdf-viewer-container {
  position: absolute;
  inset: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.pdf-viewer-container :deep(.pdfViewer) {
  --page-border: 1px solid rgba(0, 0, 0, 0.12);
  padding: 12px 0 24px;
}

.pdf-viewer-container :deep(.pdfViewer .page) {
  margin: 0 auto 12px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.16);
}

.pdf-viewer-container :deep(.textLayer) {
  opacity: 1;
}

.pdf-status {
  position: absolute;
  inset: 0;
  z-index: 2;
  min-height: 0;
  background: var(--bg-color-tertiary);
}

.pdf-webview {
  width: 100%;
  height: 100%;
}

/* Office 预览 */
.preview-office {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.office-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.office-container {
  flex: 1;
  overflow: auto;
  padding: 12px;
  background: var(--bg-color);
}

.office-container :deep(.excel-container) {
  font-size: 12px;
}

.office-container :deep(.excel-sheet) {
  margin-bottom: 16px;
}

.office-container :deep(.sheet-name) {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-color);
  padding: 6px 0 4px;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 8px;
}

.office-container :deep(.excel-table) {
  border-collapse: collapse;
  width: 100%;
}

.office-container :deep(.excel-table th),
.office-container :deep(.excel-table td) {
  border: 1px solid var(--border-color);
  padding: 4px 8px;
  text-align: left;
  white-space: nowrap;
}

.office-container :deep(.excel-table thead th) {
  background: var(--bg-color-secondary);
  font-weight: 600;
}

.office-container :deep(.excel-table tbody tr:hover) {
  background: var(--hover-bg);
}

.office-container :deep(.no-data) {
  color: var(--text-color-muted);
  padding: 12px;
  text-align: center;
}

.office-container :deep(.office-error) {
  color: var(--error-color, #e53e3e);
  padding: 24px;
  text-align: center;
}

.office-container :deep(.office-unsupported) {
  color: var(--text-color-muted);
  padding: 24px;
  text-align: center;
}

.office-container :deep(.office-pdf-hint) {
  color: var(--text-color-muted);
  padding: 24px;
  text-align: center;
  line-height: 1.8;
}

.office-container :deep(.file-path) {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 11px;
  opacity: 0.7;
}

/* Notebook 预览 */
.preview-notebook {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.notebook-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.notebook-container {
  flex: 1;
  overflow: auto;
  padding: 0;
  background: var(--bg-color);
}

.notebook-container :deep(.nb-container) {
  min-height: 100%;
}

.notebook-container :deep(.nb-header) {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-color-secondary);
  font-size: 11px;
}

.notebook-container :deep(.nb-kernel) {
  font-weight: 600;
  color: var(--primary-color);
}

.notebook-container :deep(.nb-cell-count) {
  color: var(--text-color-muted);
}

.notebook-container :deep(.nb-cell) {
  border-bottom: 1px solid var(--border-color);
}

.notebook-container :deep(.nb-cell-header) {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
}

.notebook-container :deep(.nb-cell-type) {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-color-muted);
  letter-spacing: 0.5px;
}

.notebook-container :deep(.nb-cell-code .nb-cell-header) {
  background: #f5f5f5;
}

.notebook-container :deep(.nb-cell-markdown .nb-cell-header) {
  background: #fafafa;
}

.notebook-container :deep(.nb-cell-content) {
  padding: 8px 12px;
}

/* 代码块使用 hljs-code-wrapper 样式，此处只覆盖 margin */
.notebook-container :deep(.hljs-code-wrapper) {
  margin: 0;
  font-size: 12px;
}
.notebook-container :deep(.hljs-code-wrapper pre) {
  font-size: 12px;
}

.notebook-container :deep(.nb-markdown) {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-color);
}

.notebook-container :deep(.nb-markdown h1) { font-size: 1.5em; margin: 0.5em 0; }
.notebook-container :deep(.nb-markdown h2) { font-size: 1.3em; margin: 0.5em 0; }
.notebook-container :deep(.nb-markdown h3) { font-size: 1.1em; margin: 0.5em 0; }
/* 行内代码保持原有样式，代码块由 hljs-code-wrapper 处理 */
.notebook-container :deep(.nb-markdown code:not(pre code)) {
  background: var(--bg-color-tertiary);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 0.9em;
}
.notebook-container :deep(.nb-markdown pre) {
  margin: 8px 0;
}

.notebook-container :deep(.nb-outputs) {
  margin-top: 8px;
  padding: 0 8px;
}

.notebook-container :deep(.nb-output) {
  padding: 4px 0;
  font-size: 12px;
}

.notebook-container :deep(.nb-stream) {
  font-family: 'Consolas', 'Monaco', monospace;
  color: var(--text-color);
}

.notebook-container :deep(.nb-text) {
  font-family: 'Consolas', 'Monaco', monospace;
  color: var(--text-color);
}

.notebook-container :deep(.nb-image) {
  margin: 4px 0;
}

.notebook-container :deep(.nb-image img) {
  max-width: 100%;
  border-radius: 4px;
}

.notebook-container :deep(.nb-error) {
  color: var(--error-color, #e53e3e);
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
}

.notebook-container :deep(.notebook-error) {
  color: var(--error-color, #e53e3e);
  padding: 24px;
  text-align: center;
}

/* PDF iframe (web version) */
.pdf-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: var(--bg-color-tertiary);
}

/* Word 预览 */
.preview-word {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.word-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: var(--bg-color-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.word-container {
  flex: 1;
  overflow: auto;
  padding: 20px 24px;
  background: var(--bg-color);
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-color);
}

.word-container :deep(p) { margin: 0.5em 0; }
.word-container :deep(h1) { font-size: 1.6em; font-weight: 700; margin: 0.8em 0 0.4em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
.word-container :deep(h2) { font-size: 1.4em; font-weight: 700; margin: 0.8em 0 0.4em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.2em; }
.word-container :deep(h3) { font-size: 1.2em; font-weight: 600; margin: 0.6em 0 0.3em; }
.word-container :deep(h4) { font-size: 1.1em; font-weight: 600; margin: 0.5em 0 0.2em; }
.word-container :deep(ul), .word-container :deep(ol) { margin: 0.5em 0; padding-left: 2em; }
.word-container :deep(li) { margin: 0.2em 0; }
.word-container :deep(table) { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 13px; }
.word-container :deep(th), .word-container :deep(td) { border: 1px solid var(--border-color); padding: 6px 12px; text-align: left; }
.word-container :deep(th) { background: var(--bg-color-secondary); font-weight: 600; }
.word-container :deep(tr:nth-child(even)) { background: var(--bg-color-secondary); }
.word-container :deep(img) { max-width: 100%; border-radius: 4px; margin: 0.5em 0; }
.word-container :deep(a) { color: var(--primary-color); text-decoration: none; }
.word-container :deep(a:hover) { text-decoration: underline; }
.word-container :deep(strong) { font-weight: 600; }
.word-container :deep(em) { font-style: italic; }

.word-container :deep(.word-error) {
  color: var(--error-color, #e53e3e);
  padding: 24px;
  text-align: center;
}

.word-container :deep(.word-empty) {
  color: var(--text-color-muted);
  padding: 24px;
  text-align: center;
}
</style>
