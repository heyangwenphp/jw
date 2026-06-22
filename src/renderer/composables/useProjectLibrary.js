import { computed, onBeforeUnmount, ref } from 'vue'
import { buildAgentModelOptions, resolveAgentProfileModelId } from './useAgentChat'

const PROJECT_CONTEXT_INSTRUCTION = [
  '你正在项目库工作台中回答问题。',
  '请优先基于当前项目、当前文件和项目目录树进行分析。',
  '如果用户要求沉淀结论，建议写入项目内合适的 Markdown 文档。'
].join('\n')

function buildTreeText(items = []) {
  const byParent = new Map()
  for (const item of items) {
    const key = item.parentId || null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(item)
  }
  const lines = []
  const walk = (parentId = null, depth = 0) => {
    const children = byParent.get(parentId) || []
    for (const child of children) {
      lines.push(`${'  '.repeat(depth)}- ${child.name}${child.nodeType === 'folder' ? '/' : ''}`)
      if (child.nodeType === 'folder') walk(child.id, depth + 1)
    }
  }
  walk()
  return lines.join('\n')
}

function sortProjectWorkspaces(items = []) {
  return [...items].sort((left, right) => {
    const leftCreatedAt = Number(left?.createdAt || 0)
    const rightCreatedAt = Number(right?.createdAt || 0)
    if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt
    return Number(left?.id || 0) - Number(right?.id || 0)
  })
}

function buildProjectAgentMessage({ workspace, currentItem: rawCurrentItem, text, currentViewContent = '', contextFiles = [], files = [] }) {
  const selectedContextFiles = Array.isArray(contextFiles)
    ? contextFiles
      .filter(file => file && typeof file === 'object')
      .map(file => ({
        name: file.name || file.fileName || 'file',
        content: typeof file.content === 'string' ? file.content : '',
        contentBase64: typeof file.contentBase64 === 'string' ? file.contentBase64 : '',
        mimeType: file.mimeType || '',
        filePath: file.filePath || file.path || '',
        relativePath: file.relativePath || '',
        sizeBytes: Number.isFinite(file.sizeBytes) ? file.sizeBytes : 0,
        projectLibraryItemId: file.projectLibraryItemId || null
      }))
      .filter(file => file.name)
    : []
  const agentFiles = Array.isArray(files)
    ? files
      .filter(file => file && typeof file === 'object')
      .map(file => ({
        name: file.name || file.fileName || 'file',
        content: typeof file.content === 'string' ? file.content : '',
        contentBase64: file.contentBase64 || '',
        mimeType: file.mimeType || '',
        relativePath: file.relativePath || '',
        filePath: file.filePath || file.path || '',
        sizeBytes: Number.isFinite(file.sizeBytes) ? file.sizeBytes : 0
      }))
      .filter(file => file.name && (file.content || file.contentBase64 || file.filePath || file.relativePath))
    : []
  const shouldIncludeCurrentItemContent = Boolean(
    rawCurrentItem?.nodeType === 'markdown' &&
    selectedContextFiles.some(file => file.projectLibraryItemId === rawCurrentItem.id)
  )
  const currentItem = currentViewContent && rawCurrentItem && shouldIncludeCurrentItemContent
    ? { ...rawCurrentItem, content: currentViewContent }
    : rawCurrentItem
  const currentFileText = currentItem
    ? `当前选中：${currentItem.name}\n${currentItem.nodeType === 'markdown'
      ? (shouldIncludeCurrentItemContent ? `当前文件内容：\n${currentItem.content || '(空)'}` : '当前文件未加入本轮会话上下文。')
      : currentItem.nodeType === 'file'
        ? `当前选中的是原始文件。\n本地文件路径：${currentItem.filePath || '(无路径)'}`
        : '当前选中的是文件夹'}`
    : '当前未选中文件。'
  const contextFileText = selectedContextFiles.length > 0
    ? selectedContextFiles.map(file => {
      const fileContent = file.content ||
        (file.filePath ? `本地文件路径：${file.filePath}` : '') ||
        (file.relativePath ? `上传文件相对路径：${file.relativePath}` : '') ||
        (file.contentBase64 ? '上传文件已作为附件随本轮消息发送。' : '(空)')
      return `文件：${file.name}\n${fileContent}`
    }).join('\n\n')
    : '(无)'
  const promptText = [
    PROJECT_CONTEXT_INSTRUCTION,
    '',
    `项目：${workspace?.name || '未命名项目'}`,
    `项目类型：${workspace?.type || 'custom'}`,
    `项目描述：${workspace?.description || '暂无'}`,
    '',
    '项目目录树：',
    buildTreeText(workspace?.items || []) || '(空)',
    '',
    '已加入本轮会话的文件附件：',
    contextFileText,
    '',
    currentFileText,
    '',
    '用户问题：',
    text
  ].join('\n')
  return {
    text: promptText,
    displayText: text,
    ...(agentFiles.length > 0 ? { files: agentFiles } : {})
  }
}

export function useProjectLibrary() {
  const masterRecords = ref([])
  const workspaces = ref([])
  const activeWorkspace = ref(null)
  const activeItem = ref(null)
  const messages = ref([])
  const loading = ref(false)
  const sending = ref(false)
  const selectedModel = ref('')
  const modelOptions = ref([])
  const defaultApiProfileId = ref(null)
  const cleanupAgentResult = ref(null)
  const cleanupAgentMessage = ref(null)
  const cleanupAgentError = ref(null)
  const cleanupAgentStatus = ref(null)
  const activeSendingSessionId = ref(null)
  const syncedOutputFilePaths = ref(new Set())

  const activeWorkspaceId = computed(() => activeWorkspace.value?.id || null)
  const activeItemId = computed(() => activeItem.value?.id || null)
  const activeAgentSessionId = computed(() => {
    if (activeItem.value) return activeItem.value?.agentSessionId || null
    return activeWorkspace.value?.agentSessionId || null
  })
  const activeGeneratedParentId = computed(() => {
    if (!activeItem.value) return null
    if (activeItem.value.nodeType === 'folder') return activeItem.value.id
    return activeItem.value.parentId || null
  })

  const loadModelOptions = async () => {
    try {
      const config = await window.electronAPI?.getConfig?.()
      const profiles = Array.isArray(config?.apiProfiles) ? config.apiProfiles : []
      const profile = profiles.find(p => p.id === config?.defaultProfileId)
        || profiles.find(p => p.isDefault)
        || profiles[0]
      defaultApiProfileId.value = profile?.id || null
      modelOptions.value = buildAgentModelOptions(profile, config)
      selectedModel.value = resolveAgentProfileModelId(profile, config)
    } catch (err) {
      console.warn('[ProjectLibrary] Failed to load model options:', err)
      modelOptions.value = []
      selectedModel.value = 'kimi-for-coding'
      defaultApiProfileId.value = null
    }
  }

  const loadMasterRecords = async () => {
    masterRecords.value = await window.electronAPI.listProjectMasterRecords()
    return masterRecords.value
  }

  const loadWorkspaces = async () => {
    loading.value = true
    try {
      workspaces.value = sortProjectWorkspaces(await window.electronAPI.listProjectLibraryWorkspaces())
      if (!activeWorkspace.value && workspaces.value.length > 0) {
        await selectWorkspace(workspaces.value[0].id)
      }
      return workspaces.value
    } finally {
      loading.value = false
    }
  }

  const refreshWorkspace = async (workspaceId = activeWorkspaceId.value) => {
    if (!workspaceId) return null
    const workspace = await window.electronAPI.getProjectLibraryWorkspace(workspaceId)
    activeWorkspace.value = workspace
    workspaces.value = workspaces.value.map(item => item.id === workspace.id
      ? { ...item, ...workspace }
      : item
    )
    if (activeItem.value) {
      activeItem.value = workspace.items.find(item => item.id === activeItem.value.id) || null
    }
    return workspace
  }

  const loadMessages = async () => {
    const sessionId = activeAgentSessionId.value
    if (!sessionId || !window.electronAPI?.getAgentMessages) {
      messages.value = []
      return []
    }
    const rows = await window.electronAPI.getAgentMessages(sessionId)
    messages.value = Array.isArray(rows) ? rows : []
    return messages.value
  }

  const selectWorkspace = async (workspaceId) => {
    syncedOutputFilePaths.value = new Set()
    const workspace = await window.electronAPI.getProjectLibraryWorkspace(workspaceId)
    activeWorkspace.value = workspace
    activeItem.value = null
    await loadMessages()
    await syncAgentOutputMarkdownFiles(activeAgentSessionId.value).catch(err => {
      console.warn('[ProjectLibrary] Failed to sync agent output files:', err)
    })
  }

  const selectItem = async (item) => {
    activeItem.value = item
    syncedOutputFilePaths.value = new Set()
    await loadMessages()
    await syncAgentOutputMarkdownFiles(activeAgentSessionId.value).catch(err => {
      console.warn('[ProjectLibrary] Failed to sync agent output files:', err)
    })
  }

  const createWorkspace = async (payload = {}) => {
    const workspace = await window.electronAPI.createProjectLibraryWorkspace(payload)
    workspaces.value = sortProjectWorkspaces([...workspaces.value.filter(item => item.id !== workspace.id), workspace])
    activeWorkspace.value = workspace
    activeItem.value = null
    messages.value = []
    return workspace
  }

  const deleteWorkspace = async (id) => {
    if (!id) return null
    const result = await window.electronAPI.deleteProjectLibraryWorkspace(id)
    if (!result?.success) return result

    workspaces.value = sortProjectWorkspaces(workspaces.value.filter(item => item.id !== id))
    if (activeWorkspace.value?.id === id) {
      activeWorkspace.value = null
      activeItem.value = null
      messages.value = []
      if (workspaces.value.length > 0) {
        await selectWorkspace(workspaces.value[0].id)
      }
    }
    return result
  }

  const createItem = async ({ parentId = null, name, nodeType, content = '' }) => {
    if (!activeWorkspaceId.value) return null
    const item = await window.electronAPI.createProjectLibraryItem({
      workspaceId: activeWorkspaceId.value,
      parentId,
      name,
      nodeType,
      content
    })
    await refreshWorkspace(activeWorkspaceId.value)
    activeItem.value = item
    return item
  }

  const uploadFilesToProjectLibrary = async ({ workspaceId = activeWorkspaceId.value, parentId = null, files = [] } = {}) => {
    if (!workspaceId || !Array.isArray(files) || files.length === 0) return []
    const uploadedItems = []
    for (const file of files) {
      const item = await window.electronAPI.uploadProjectLibraryFile({
        workspaceId,
        parentId,
        file
      })
      if (item) uploadedItems.push(item)
    }

    if (uploadedItems.length > 0) {
      await refreshWorkspace(workspaceId)
      activeItem.value = uploadedItems[uploadedItems.length - 1]
    }
    return uploadedItems
  }

  const renameItem = async ({ id, name }) => {
    if (!id) return null
    const updated = await window.electronAPI.updateProjectLibraryItem({
      id,
      updates: { name }
    })
    await refreshWorkspace(activeWorkspaceId.value)
    if (activeItem.value?.id === id) {
      activeItem.value = updated
    }
    return updated
  }

  const deleteItem = async (id) => {
    if (!id) return null
    const result = await window.electronAPI.deleteProjectLibraryItem(id)
    await refreshWorkspace(activeWorkspaceId.value)
    if (activeItem.value?.id === id) {
      activeItem.value = null
      await loadMessages()
    }
    return result
  }

  const saveActiveItemContent = async (content) => {
    if (!activeItemId.value) return null
    const updated = await window.electronAPI.updateProjectLibraryItem({
      id: activeItemId.value,
      updates: { content }
    })
    await refreshWorkspace(activeWorkspaceId.value)
    activeItem.value = updated
    return updated
  }

  const syncAgentOutputMarkdownFiles = async (sessionId = activeAgentSessionId.value) => {
    if (!sessionId || !activeWorkspaceId.value) return []
    if (!window.electronAPI?.listAgentOutputFiles || !window.electronAPI?.readAbsolutePath) return []

    const files = await window.electronAPI.listAgentOutputFiles(sessionId)
    const markdownFiles = Array.isArray(files)
      ? files.filter(file => !file?.isDirectory && typeof file?.name === 'string' && file.name.endsWith('.md') && file.path)
      : []
    const importedItems = []

    for (const file of markdownFiles) {
      if (syncedOutputFilePaths.value.has(file.path)) continue
      syncedOutputFilePaths.value.add(file.path)

      const result = await window.electronAPI.readAbsolutePath({
        filePath: file.path,
        sessionId
      })
      const content = typeof result?.content === 'string'
        ? result.content
        : typeof result?.text === 'string'
          ? result.text
        : ''
      if (!content.trim()) continue

      const existingItem = activeWorkspace.value?.items?.find(item =>
        item.nodeType === 'markdown' &&
        item.name === file.name &&
        (item.parentId || null) === activeGeneratedParentId.value
      )

      let item = existingItem
      if (existingItem && existingItem.content !== content) {
        item = await window.electronAPI.updateProjectLibraryItem({
          id: existingItem.id,
          updates: { content }
        })
      } else if (!existingItem) {
        item = await window.electronAPI.createProjectLibraryItem({
          workspaceId: activeWorkspaceId.value,
          parentId: activeGeneratedParentId.value,
          name: file.name,
          nodeType: 'markdown',
          content
        })
      }

      if (item && (!existingItem || existingItem.content !== content)) {
        importedItems.push(item)
      }
    }

    if (importedItems.length > 0) {
      await refreshWorkspace(activeWorkspaceId.value)
      activeItem.value = importedItems[importedItems.length - 1]
    }

    return importedItems
  }

  const ensureAgentSession = async () => {
    if (!activeWorkspace.value) return null
    if (activeAgentSessionId.value) return activeAgentSessionId.value
    const session = await window.electronAPI.createAgentSession({
      type: 'chat',
      title: activeItem.value?.name ? `${activeWorkspace.value.name} / ${activeItem.value.name}` : activeWorkspace.value.name,
      source: 'project-library',
      apiProfileId: defaultApiProfileId.value,
      modelId: selectedModel.value || null,
      meta: {
        projectLibraryWorkspaceId: activeWorkspace.value.id,
        projectLibraryItemId: activeItem.value?.id || null
      }
    })
    if (!session?.id) throw new Error('创建项目会话失败')
    await bindActiveAgentSession(session.id)
    return session.id
  }

  const bindActiveAgentSession = async (sessionId) => {
    if (!activeWorkspace.value) return null
    if (activeItem.value?.id) {
      const updated = await window.electronAPI.bindProjectLibraryItemAgentSession({
        itemId: activeItem.value.id,
        sessionId
      })
      activeItem.value = {
        ...activeItem.value,
        agentSessionId: updated.agentSessionId
      }
      activeWorkspace.value = {
        ...activeWorkspace.value,
        items: (activeWorkspace.value.items || []).map(item => item.id === activeItem.value.id
          ? { ...item, agentSessionId: updated.agentSessionId }
          : item
        )
      }
      workspaces.value = workspaces.value.map(item => item.id === activeWorkspace.value.id
        ? { ...item, items: activeWorkspace.value.items }
        : item
      )
      return updated
    }

    const updated = await window.electronAPI.bindProjectLibraryAgentSession({
      workspaceId: activeWorkspace.value.id,
      sessionId
    })
    activeWorkspace.value = {
      ...activeWorkspace.value,
      agentSessionId: updated.agentSessionId
    }
    workspaces.value = workspaces.value.map(item => item.id === activeWorkspace.value.id
      ? { ...item, agentSessionId: updated.agentSessionId }
      : item
    )
    return updated
  }

  const finishActiveSend = (sessionId) => {
    if (!sessionId || sessionId !== activeSendingSessionId.value) return
    activeSendingSessionId.value = null
    sending.value = false
  }

  const sendProjectMessage = async (payload) => {
    const text = typeof payload === 'string' ? payload.trim() : String(payload?.text || '').trim()
    const currentViewContent = payload && typeof payload === 'object' && typeof payload.currentViewContent === 'string'
      ? payload.currentViewContent
      : ''
    const selectedContextFiles = Array.isArray(payload?.contextFiles)
      ? payload.contextFiles
      : []
    const uploadedFiles = Array.isArray(payload?.files)
      ? payload.files
        .filter(file => file && typeof file === 'object')
        .map(file => ({
          name: file.name || file.fileName || 'file',
          content: typeof file.content === 'string' ? file.content : '',
          contentBase64: file.contentBase64 || '',
          mimeType: file.mimeType || '',
          relativePath: file.relativePath || '',
          filePath: file.filePath || file.path || '',
          sizeBytes: Number.isFinite(file.sizeBytes) ? file.sizeBytes : 0
        }))
        .filter(file => file.name && (file.content || file.contentBase64 || file.filePath || file.relativePath))
      : []
    const projectContextFiles = [...selectedContextFiles, ...uploadedFiles]
    if (!text || !activeWorkspace.value) return
    syncedOutputFilePaths.value = new Set()
    const optimisticFiles = projectContextFiles.length > 0 ? projectContextFiles : null
    const optimisticMessage = {
      id: `project-library-pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      pending: true,
      ...(optimisticFiles ? { files: optimisticFiles } : {})
    }
    messages.value = [...messages.value, optimisticMessage]
    sending.value = true
    try {
      const sessionId = await ensureAgentSession()
      activeSendingSessionId.value = sessionId
      const message = buildProjectAgentMessage({
        workspace: activeWorkspace.value,
        currentItem: activeItem.value,
        text,
        currentViewContent,
        contextFiles: projectContextFiles,
        files: uploadedFiles
      })
      const result = await window.electronAPI.sendAgentMessage({
        sessionId,
        message,
        model: selectedModel.value || null,
        providerId: defaultApiProfileId.value || null
      })
      if (result?.error) {
        throw new Error(result.error)
      }
      await syncAgentOutputMarkdownFiles(sessionId).catch(err => {
        console.warn('[ProjectLibrary] Failed to sync agent output files:', err)
      })
      await loadMessages()
    } catch (err) {
      activeSendingSessionId.value = null
      sending.value = false
      messages.value = messages.value.filter(item => item.id !== optimisticMessage.id)
      throw err
    }
  }

  const setupAgentListeners = () => {
    cleanupAgentResult.value = window.electronAPI?.onAgentResult?.((data) => {
      if (data?.sessionId === activeAgentSessionId.value) {
        syncAgentOutputMarkdownFiles(data.sessionId).catch(err => {
          console.warn('[ProjectLibrary] Failed to sync agent output files:', err)
        })
        loadMessages()
      }
      finishActiveSend(data?.sessionId)
    }) || null
    cleanupAgentMessage.value = window.electronAPI?.onAgentMessage?.((data) => {
      if (data?.sessionId === activeAgentSessionId.value) {
        loadMessages()
      }
    }) || null
    cleanupAgentError.value = window.electronAPI?.onAgentError?.((data) => {
      finishActiveSend(data?.sessionId)
    }) || null
    cleanupAgentStatus.value = window.electronAPI?.onAgentStatusChange?.((data) => {
      if (data?.status === 'idle') {
        finishActiveSend(data?.sessionId)
      }
    }) || null
  }

  onBeforeUnmount(() => {
    cleanupAgentResult.value?.()
    cleanupAgentMessage.value?.()
    cleanupAgentError.value?.()
    cleanupAgentStatus.value?.()
  })

  return {
    masterRecords,
    workspaces,
    activeWorkspace,
    activeItem,
    activeAgentSessionId,
    messages,
    loading,
    sending,
    selectedModel,
    modelOptions,
    loadModelOptions,
    loadMasterRecords,
    loadWorkspaces,
    refreshWorkspace,
    selectWorkspace,
    selectItem,
    createWorkspace,
    deleteWorkspace,
    createItem,
    uploadFilesToProjectLibrary,
    renameItem,
    deleteItem,
    saveActiveItemContent,
    sendProjectMessage,
    setupAgentListeners
  }
}
