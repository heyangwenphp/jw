import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readSource(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('project library content layout', () => {
  it('renders only a functional download action in the project content header', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(source).toContain('<div v-if="canDownloadPreview" class="header-actions">')
    expect(source).toContain('title="下载"')
    expect(source).toContain('@click="handleDownloadPreview"')
    expect(source).toContain('name="download"')
    expect(source).toContain('const canDownloadPreview = computed(() =>')
    expect(source).toContain('const handleDownloadPreview = () =>')
    expect(source).toContain('URL.createObjectURL')
    expect(source).not.toContain('title="刷新"')
    expect(source).not.toContain('title="历史"')
    expect(source).not.toContain('title="更多"')
    expect(source).not.toContain('name="moreHorizontal"')
  })

  it('omits the update time from the project context summary', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(source).toContain('当前上下文：{{ workspace.name }}')
    expect(source).toContain('关联线索 8')
    expect(source).not.toContain('更新于')
  })

  it('does not cap project content panel widths', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(source).not.toContain('.project-brief,\n.markdown-editor,\n.folder-panel')
    expect(source).not.toMatch(/\.markdown-editor,\s*\.folder-panel\s*\{[^}]*\bwidth:/)
    expect(source).not.toMatch(/\.project-brief\s*\{[^}]*\bwidth:/)
  })

  it('renders project markdown files like brief content without file metadata header', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(source).toContain("v-else-if=\"isMarkdownContentView && hasMarkdownContent\"")
    expect(source).toContain('class="project-brief markdown-document-view jedi-markdown-preview"')
    expect(source).toContain('v-html="renderedMarkdown"')
    expect(source).toContain("v-else-if=\"activeItem.nodeType !== 'markdown' && !isMarkdownFileAsset\"")
    expect(source).toContain("import { renderMarkdownWithHighlight } from '@utils/highlight-utils'")
    expect(source).toContain('const hasMarkdownContent = computed(() =>')
    expect(source).toContain("currentViewContent.value.trim().length > 0")
    expect(source).not.toContain('class="markdown-editor"')
    expect(source).not.toContain('class="editor-header"')
    expect(source).not.toContain('<p>Markdown 文档</p>')
  })

  it('previews legacy uploaded markdown file assets as markdown content', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(source).toContain('const markdownFileAssetContent = ref')
    expect(source).toContain('const isMarkdownFileAsset = computed(() =>')
    expect(source).toContain("normalizedMime === 'text/markdown'")
    expect(source).toContain("normalizedName.endsWith('.md')")
    expect(source).toContain("normalizedName.endsWith('.markdown')")
    expect(source).toContain("v-else-if=\"isMarkdownContentView && hasMarkdownContent\"")
    expect(source).toContain("v-else-if=\"activeItem.nodeType === 'file' && !isMarkdownFileAsset\"")
    expect(source).toContain('window.electronAPI?.readAbsolutePath')
    expect(source).toContain('loadMarkdownFileAssetContent(item)')
  })

  it('uses the agent message bubble for project history messages', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(source).toContain("import MessageBubble from '../agent/MessageBubble.vue'")
    expect(source).toContain("import ToolCallCard from '../agent/ToolCallCard.vue'")
    expect(source).toContain("import { isVisibleAgentMessage } from '@utils/agent-message-visibility'")
    expect(source).toContain('<MessageBubble')
    expect(source).toContain('<ToolCallCard')
    expect(source).toContain('visibleMessages')
    expect(source).not.toContain('class="message-row"')
    expect(source).not.toContain('.message-row')
    expect(source).not.toContain('class="message-history"')
    expect(source).not.toContain('.message-history')
  })

  it('shows the capability selector entry in the project library chat input', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(source).toContain(':project-path="workspace?.path || null"')
    expect(source).toContain(':show-capability-button="true"')
    expect(source).not.toContain(':show-capability-button="false"')
  })

  it('wires floating top and bottom scroll buttons in the project content panel', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(source).toContain("import { useAutoScrollToBottom } from '@composables/useAutoScrollToBottom'")
    expect(source).toContain('@scroll="onContainerScroll"')
    expect(source).toContain('class="chat-scroll-controls"')
    expect(source).toContain('aria-label="消息滚动导航"')
    expect(source).toContain(':disabled="userAtTop"')
    expect(source).toContain(':disabled="userAtBottom"')
    expect(source).toContain('scrollToTop(false)')
    expect(source).toContain('scrollToBottom(false, true)')
    expect(source).toContain('canScrollMessages')
    expect(source).toContain('arrowUp')
    expect(source).toContain('arrowDown')
  })

  it('pins the selected markdown file as a removable chat context attachment', () => {
    const contentSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')
    const librarySource = readSource('src/renderer/composables/useProjectLibrary.js')
    const chatInputSource = readSource('src/renderer/pages/main/components/agent/ChatInput.vue')

    expect(contentSource).toContain(':context-files="activeContextFiles"')
    expect(contentSource).toContain('@remove-context-file="handleRemoveActiveContextFile"')
    expect(contentSource).toContain('const removedContextItemId = ref(null)')
    expect(contentSource).toContain('const activeContextFiles = computed(() =>')
    expect(contentSource).toContain('projectLibraryItemId: props.activeItem.id')
    expect(contentSource).toContain('const handleRemoveActiveContextFile = (file) =>')

    expect(chatInputSource).toContain('const contextFilePayloads = computed(() =>')
    expect(chatInputSource).toContain('contextFiles: contextFilePayloads.value')
    expect(chatInputSource).toContain('const hasContextFiles = contextFilePayloads.value.length > 0')
    expect(chatInputSource).toContain('hasAttachments || hasSelectedCapabilities || hasContextFiles')

    expect(librarySource).toContain('contextFiles = []')
    expect(librarySource).toContain('const selectedContextFiles = Array.isArray(payload?.contextFiles)')
    expect(librarySource).toContain('contextFiles: projectContextFiles')
    expect(librarySource).toContain('shouldIncludeCurrentItemContent')
  })

  it('merges files uploaded from the project chat input into the agent context', () => {
    const librarySource = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(librarySource).toContain('const uploadedFiles = Array.isArray(payload?.files)')
    expect(librarySource).toContain('const projectContextFiles = [...selectedContextFiles, ...uploadedFiles]')
    expect(librarySource).toContain('contextFiles: projectContextFiles')
    expect(librarySource).toContain("filePath: file.filePath || file.path || ''")
    expect(librarySource).toContain("contentBase64: file.contentBase64 || ''")
  })

  it('shows the same streaming elapsed indicator used by regular agent chats', () => {
    const contentSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(contentSource).toContain("import StreamingIndicator from '../agent/StreamingIndicator.vue'")
    expect(contentSource).toContain('<StreamingIndicator')
    expect(contentSource).toContain(':visible="sending"')
    expect(contentSource).toContain(':elapsed="streamingElapsed"')
    expect(contentSource).toContain('const streamingElapsed = ref(0)')
    expect(contentSource).toContain('watch(() => props.sending')
  })

  it('keeps project chat in executing state until agent lifecycle events finish', () => {
    const librarySource = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(librarySource).toContain('const cleanupAgentError = ref(null)')
    expect(librarySource).toContain('const cleanupAgentStatus = ref(null)')
    expect(librarySource).toContain('const finishActiveSend = (sessionId) =>')
    expect(librarySource).toContain('window.electronAPI?.onAgentError?.((data) =>')
    expect(librarySource).toContain('window.electronAPI?.onAgentStatusChange?.((data) =>')
    expect(librarySource).toContain("data?.status === 'idle'")
    expect(librarySource).not.toContain('finally {\n      sending.value = false\n    }')
  })

  it('shows uploaded files on the optimistic project user message immediately', () => {
    const librarySource = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(librarySource).toContain('const optimisticFiles = projectContextFiles.length > 0 ? projectContextFiles : null')
    expect(librarySource).toContain('...(optimisticFiles ? { files: optimisticFiles } : {})')
    expect(librarySource).toMatch(/const optimisticFiles[\s\S]*const optimisticMessage/)
  })

  it('wires original file uploads into the project library tree', () => {
    const treeSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryTree.vue')
    const workbenchSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryWorkbench.vue')
    const librarySource = readSource('src/renderer/composables/useProjectLibrary.js')
    const preloadSource = readSource('src/preload/preload.js')
    const ipcSource = readSource('src/main/ipc-handlers/project-library-handlers.js')

    expect(treeSource).toContain("'upload-file'")
    expect(treeSource).toContain("title: '上传文件'")
    expect(treeSource).toContain("nodeType: 'file'")
    expect(workbenchSource).toContain('ref="projectFileInputRef"')
    expect(workbenchSource).toContain('@change="handleProjectFileUpload"')
    expect(workbenchSource).toContain('@upload-file="openProjectFileUpload"')
    expect(librarySource).toContain('const uploadFilesToProjectLibrary = async')
    expect(librarySource).toContain('window.electronAPI.uploadProjectLibraryFile')
    expect(librarySource).toContain('activeItem.value = uploadedItems[uploadedItems.length - 1]')
    expect(preloadSource).toContain('uploadProjectLibraryFile: async')
    expect(preloadSource).toContain('readFileAsBase64Payload(file)')
    expect(preloadSource).toContain("ipcRenderer.invoke('projectLibrary:uploadFile'")
    expect(ipcSource).toContain("ipcMain.handle('projectLibrary:uploadFile'")
    expect(ipcSource).toContain("nodeType: 'file'")
    expect(ipcSource).toContain('project-library-files')
  })

  it('shows project tree action menus only when hovering the trailing dots and opens them to the right', () => {
    const treeSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryTree.vue')
    const leftPanelSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryLeftPanel.vue')

    expect(treeSource).toContain('<RowActionMenu :actions="workspaceActions(workspace)" />')
    expect(treeSource).toContain("class: 'row-action-trigger'")
    expect(treeSource).toContain("class: 'project-tree-action-menu row-action-menu'")
    expect(treeSource).toContain("'project-tree-action-menu-item'")
    expect(treeSource).toContain('const triggerRef = ref(null)')
    expect(treeSource).toContain('const menuRef = ref(null)')
    expect(treeSource).toContain('const isHoveringActionSurface = () =>')
    expect(treeSource).toContain("matches?.(':hover')")
    expect(treeSource).toContain("h(Teleport, { to: 'body' }")
    expect(treeSource).toContain('getBoundingClientRect()')
    expect(treeSource).toContain('left: `${rect.right}px`')
    expect(treeSource).toContain('top: `${rect.top}px`')
    expect(treeSource).toContain('const MENU_CLOSE_DELAY_MS = 160')
    expect(treeSource).toContain('}, MENU_CLOSE_DELAY_MS)')
    expect(treeSource).toContain('if (isHoveringActionSurface()) return')
    expect(treeSource).toContain('.project-tree-action-menu {')
    expect(treeSource).toContain('.project-tree-action-menu::before')
    expect(treeSource).toContain('width: 16px')
    expect(treeSource).toContain('position: fixed')
    expect(treeSource).not.toContain('.tree-row:hover .row-action-menu')
    expect(treeSource).not.toContain('.tree-row:hover .mini-btn')
    expect(leftPanelSource).toContain('overflow: visible')
    expect(leftPanelSource).toContain('overflow-y: auto')
  })

  it('renders original file nodes with file metadata and pins them as chat context', () => {
    const contentSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')
    const librarySource = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(contentSource).toContain("activeItem.nodeType === 'file'")
    expect(contentSource).toContain('class="file-asset-panel"')
    expect(contentSource).toContain('activeFileSizeText')
    expect(contentSource).toContain('props.activeItem.filePath')
    expect(contentSource).toContain("nodeType === 'file'")
    expect(contentSource).toContain('filePath: props.activeItem.filePath')
    expect(contentSource).toContain('content: markdownContent || props.activeItem.filePath')
    expect(librarySource).toContain('filePath: file.filePath ||')
    expect(librarySource).toContain('file.filePath ?')
  })

  it('previews uploaded Word, Excel and PDF files inside the project library content view', () => {
    const contentSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(contentSource).toContain("import FilePreview from '../AgentRightPanel/FilePreview.vue'")
    expect(contentSource).toContain('v-else-if="activeOriginalFilePreview"')
    expect(contentSource).toContain(':preview="activeOriginalFilePreview"')
    expect(contentSource).toContain('const getPreviewableOriginalFileType = (item = {}) =>')
    expect(contentSource).toContain("normalizedMime === 'application/pdf'")
    expect(contentSource).toContain("ext === '.pdf'")
    expect(contentSource).toContain("ext === '.docx'")
    expect(contentSource).toContain("['.doc', '.xls', '.xlsx'].includes(ext)")
    expect(contentSource).toContain('const activeOriginalFilePreview = computed(() =>')
    expect(contentSource).toContain('type,')
    expect(contentSource).toContain('filePath: props.activeItem.filePath')
    expect(contentSource).toContain('.project-library-file-preview')
    expect(contentSource).toContain('.project-library-file-preview :deep(.file-preview)')
  })

  it('wires project file downloads into the project library tree action menu', () => {
    const treeSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryTree.vue')
    const leftPanelSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryLeftPanel.vue')
    const workbenchSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryWorkbench.vue')

    expect(treeSource).toContain("'download-file'")
    expect(treeSource).toContain('isDownloadableItem(props.item)')
    expect(treeSource).toContain("const isDownloadableItem = (item) => ['file', 'markdown'].includes(item?.nodeType)")
    expect(treeSource).toContain("icon: 'download'")
    expect(treeSource).toContain("label: '下载', title: '下载'")
    expect(treeSource).toContain("stopAndEmit(event, 'download-file', props.item)")
    expect(leftPanelSource).toContain('@download-file="$emit(\'download-file\', $event)"')
    expect(workbenchSource).toContain('@download-file="handleDownloadItemFile"')
    expect(workbenchSource).toContain("import { buildFileDownloadUrl, downloadFileFromUrl } from '@utils/file-preview-url-utils'")
    expect(workbenchSource).toContain('const handleDownloadItemFile = (item) =>')
    expect(workbenchSource).toContain("if (item.nodeType === 'markdown')")
    expect(workbenchSource).toContain('downloadMarkdownItem(item)')
    expect(workbenchSource).toContain('URL.createObjectURL')
    expect(workbenchSource).toContain('buildFileDownloadUrl({ filePath: item.filePath })')
    expect(workbenchSource).toContain('downloadFileFromUrl(url, item.originalName || item.name)')
  })

  it('shows only the user question for legacy project prompt messages', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')

    expect(source).toContain('const getProjectMessageContent = (message = {}) => {')
    expect(source).toContain('content.match(/用户问题[：:]\\s*([\\s\\S]*)$/)')
    expect(source).toContain('content: getProjectMessageContent(message)')
  })

  it('sends project context as agent text while preserving a short display text', () => {
    const source = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(source).toContain('const promptText = [')
    expect(source).toContain('text: promptText')
    expect(source).toContain('displayText: text')
  })

  it('passes the displayed project content into the project agent context', () => {
    const contentSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')
    const librarySource = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(contentSource).toContain('const projectBriefText = computed(() =>')
    expect(contentSource).toContain('@send="handleSend"')
    expect(contentSource).toContain('currentViewContent')
    expect(librarySource).toContain('currentViewContent')
    expect(librarySource).toContain('currentItem: rawCurrentItem')
    expect(librarySource).toContain('content: currentViewContent')
  })

  it('shows project messages optimistically and keeps the transcript scrolled to the latest message', () => {
    const contentSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')
    const librarySource = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(librarySource).toContain('const optimisticMessage = {')
    expect(librarySource).toContain("role: 'user'")
    expect(librarySource).toContain('messages.value = [...messages.value, optimisticMessage]')
    expect(librarySource).toContain('messages.value = messages.value.filter(item => item.id !== optimisticMessage.id)')

    expect(contentSource).toContain('ref="messagesListRef"')
    expect(contentSource).toContain('ref="scrollAnchorRef"')
    expect(contentSource).toContain("import { useAutoScrollToBottom } from '@composables/useAutoScrollToBottom'")
    expect(contentSource).toContain('} = useAutoScrollToBottom({')
    expect(contentSource).toContain('anchorRef: scrollAnchorRef')
    expect(contentSource).toContain('watch(visibleMessages, () => {')
    expect(contentSource).toContain('scrollToBottom(true)')
  })

  it('syncs markdown files generated in the agent output directory back into the project library tree', () => {
    const source = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(source).toContain('const syncedOutputFilePaths = ref(new Set())')
    expect(source).toContain('const syncAgentOutputMarkdownFiles = async')
    expect(source).toContain('window.electronAPI?.listAgentOutputFiles')
    expect(source).toContain("file.name.endsWith('.md')")
    expect(source).toContain('window.electronAPI?.readAbsolutePath')
    expect(source).toContain('window.electronAPI.readAbsolutePath')
    expect(source).toContain('existingItem')
    expect(source).toContain('window.electronAPI.updateProjectLibraryItem')
    expect(source).toContain('window.electronAPI.createProjectLibraryItem')
    expect(source).toContain('await refreshWorkspace(activeWorkspaceId.value)')
    expect(source).toContain('await syncAgentOutputMarkdownFiles(sessionId)')
  })

  it('routes project library messages through the selected root, folder, or file session', () => {
    const source = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(source).toContain('const activeAgentSessionId = computed(() =>')
    expect(source).toContain('return activeItem.value?.agentSessionId || null')
    expect(source).toContain('return activeWorkspace.value?.agentSessionId || null')
    expect(source).toContain('const bindActiveAgentSession = async (sessionId) =>')
    expect(source).toContain('window.electronAPI.bindProjectLibraryItemAgentSession')
    expect(source).toContain('projectLibraryItemId: activeItem.value?.id || null')
    expect(source).toContain('if (data?.sessionId === activeAgentSessionId.value)')
  })

  it('passes the selected node session id into the project library chat input', () => {
    const workbenchSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryWorkbench.vue')
    const contentSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryContent.vue')
    const librarySource = readSource('src/renderer/composables/useProjectLibrary.js')

    expect(librarySource).toContain('activeAgentSessionId,')
    expect(workbenchSource).toContain(':active-session-id="activeAgentSessionId"')
    expect(contentSource).toContain('activeSessionId: {')
    expect(contentSource).toContain(':session-id="activeSessionId || null"')
    expect(contentSource).not.toContain(':session-id="workspace.agentSessionId || null"')
  })
})
