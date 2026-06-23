<template>
  <div class="left-panel">
    <LeftPanelHeader />

    <!-- ========== Agent Mode Content (v-show 避免切换模式时 remount) ========== -->
    <AgentLeftContent
      ref="agentLeftContentRef"
      :active-session-id="activeAgentSessionId"
      :current-project="currentProject"
      :is-home-active="isHomeActive"
      :is-project-library-active="isProjectLibraryActive"
      @home-request="emit('home-request')"
      @created="handleAgentCreated"
      @select="handleAgentSelected"
      @close="handleAgentClosed"
      @profile-updated="emit('agent-profile-updated', $event)"
      @new-conversation-request="handleQuickNewConversation"
    />

    <!-- Agent 新建对话 Modal -->
    <!-- Notebook 创建 Modal -->
    <!-- 能力管理 Modal（仅 Agent 模式） -->
    <LeftPanelFooter
      :t="t"
      :settings-options="settingsOptions"
      :render-settings-label="renderSettingsLabel"
      :has-update-available="hasUpdateAvailable"
      :is-dark="isDark"
      :is-agent-mode="isAgentMode"
      :show-settings="showFooterSettings"
      @settings-select="handleSettingsSelect"
      @toggle-theme="$emit('toggle-theme')"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, h } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { useIPC } from '@composables/useIPC'
import { useLocale } from '@composables/useLocale'
import { useAppMode } from '@composables/useAppMode'
import Icon from '@components/icons/Icon.vue'
import LeftPanelHeader from './LeftPanelHeader.vue'
import LeftPanelFooter from './LeftPanelFooter.vue'
import AgentLeftContent from './agent/AgentLeftContent.vue'
import { redirectToLoginPage } from '@utils/auth-navigation'

const message = useMessage()
const dialog = useDialog()
const { invoke } = useIPC()
const { t, locale } = useLocale()
const { isAgentMode } = useAppMode()
const isDeveloperMode = computed(() => false)
const isNotebookMode = computed(() => false)
const developerModeEnabled = ref(false)
const switchMode = async () => {}
const AppMode = { NOTEBOOK: 'notebook' }

const renderModeIcon = (iconName) => () => h(Icon, { name: iconName, size: 16, style: 'margin-right: 8px; color: var(--primary-color)' })

const modeOptions = computed(() => {
  const options = []
  if (developerModeEnabled.value && !isDeveloperMode.value) {
    options.push({ label: t('mode.switchToDeveloper'), key: 'developer', icon: renderModeIcon('terminal') })
  }
  if (!isAgentMode.value) {
    options.push({ label: t('mode.switchToAgent'), key: 'agent', icon: renderModeIcon('robot') })
  }
  if (!isNotebookMode.value) {
    options.push({ label: t('mode.switchToNotebook'), key: 'notebook', icon: renderModeIcon('notebook') })
  }
  return options
})

const handleModeSelect = (key) => {
  if (key === 'notebook') {
    handleOpenNotebook()
    return
  }
  if (key === 'developer' || key === 'agent') {
    handleSwitchMode(key)
  }
}


// 切换到指定模式
const handleSwitchMode = async (mode) => {
  await switchMode(mode)
  emit('mode-changed', mode)
}

// 打开 Notebook 工作台（切换到 Notebook 模式）
const handleOpenNotebook = async () => {
  await switchMode(AppMode.NOTEBOOK)
  emit('mode-changed', AppMode.NOTEBOOK)
}

// ========================================
// Agent 模式事件处理
// ========================================

const handleAgentCreated = (session) => {
  activeAgentSessionId.value = session.id
  emit('agent-created', session)
}

const handleNewConvCreate = async ({ modelId } = {}) => {
  if (agentLeftContentRef.value) {
    const session = await agentLeftContentRef.value.createConversation({
      type: 'chat',
      modelId: modelId || null
    })
    if (session) {
      handleAgentCreated(session)
    }
  }
}

const handleQuickNewConversation = () => {
  return handleNewConvCreate({ modelId: null })
}

const handleAgentSelected = async (conv) => {
  // 非活跃会话（closed / 重启后的历史）先恢复到后端内存
  if (conv.status === 'closed' || conv.status === undefined) {
    try {
      const result = await window.electronAPI.reopenAgentSession(conv.id)
      if (result && !result.error) {
        conv.status = result.status || 'idle'
      } else if (result?.error) {
        // 显示实际错误信息
        message.error(`${t('agent.reopenFailed') || '恢复会话失败'}：${result.error}`)
      }
    } catch (err) {
      console.error('[LeftPanel] reopen agent session error:', err)
      message.error(`${t('agent.reopenError') || '恢复会话异常'}：${err.message}`)
    }
  }
  activeAgentSessionId.value = conv.id
  emit('agent-selected', conv)
}

const handleAgentClosed = async (conv) => {
  if (agentLeftContentRef.value) {
    await agentLeftContentRef.value.closeConversation(conv.id)
  }
  if (activeAgentSessionId.value === conv.id) {
    activeAgentSessionId.value = null
  }
  emit('agent-closed', conv)
}

// Notebook 模式事件处理
const loadNotebooks = async () => {
  try {
    notebooksLoading.value = true
    const data = await window.electronAPI.notebookList()
    notebooks.value = data || []
  } catch (err) {
    console.error('[LeftPanel] Failed to load notebooks:', err)
  } finally {
    notebooksLoading.value = false
  }
}

const handleNotebookSelect = (notebook) => {
  currentNotebookId.value = notebook.id
  currentNotebook.value = notebook
  emit('notebook-select', notebook)
  loadSources(notebook.id)
}

const loadSources = async (notebookId) => {
  if (!notebookId) {
    sources.value = []
    return
  }
  try {
    sources.value = await window.electronAPI.notebookListSources(notebookId)
  } catch (err) {
    console.error('[LeftPanel] Failed to load sources:', err)
  }
}

const handleAddSource = async () => {
  if (!currentNotebookId.value) return
  const filePaths = await window.electronAPI.selectFiles({
    title: t('notebook.source.add') || '添加来源',
    filters: [
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (filePaths && filePaths.length > 0) {
    try {
      await window.electronAPI.notebookImportFiles({
        notebookId: currentNotebookId.value,
        filePaths
      })
      loadSources(currentNotebookId.value)
      message.success(t('common.success') || '成功')
    } catch (err) {
      console.error('[LeftPanel] Failed to import files:', err)
      message.error(t('common.error') || '失败')
    }
  }
}

const handleDeleteSource = async (source) => {
  if (!currentNotebookId.value || !source?.id) return
  try {
    await window.electronAPI.notebookDeleteSources({
      notebookId: currentNotebookId.value,
      sourceIds: [source.id]
    })
    loadSources(currentNotebookId.value)
    message.success(t('common.deleteSuccess') || '删除成功')
  } catch (err) {
    console.error('[LeftPanel] Failed to delete source:', err)
    message.error(t('common.deleteFailed') || '删除失败')
  }
}

const handleToggleSource = async (source) => {
  if (!currentNotebookId.value || !source?.id) return
  const newSelected = !source.selected
  try {
    await window.electronAPI.notebookUpdateSource({
      notebookId: currentNotebookId.value,
      sourceId: source.id,
      updates: { selected: newSelected }
    })
    const src = sources.value.find(s => s.id === source.id)
    if (src) {
      src.selected = newSelected
    }
  } catch (err) {
    console.error('[LeftPanel] Failed to toggle source:', err)
  }
}

const handleNotebookCreated = (notebook) => {
  currentNotebookId.value = notebook.id
  currentNotebook.value = notebook
  emit('notebook-created', notebook)
  loadSources(notebook.id)
}

const handleNotebookRename = async ({ id, name }) => {
  try {
    const result = await window.electronAPI.notebookRename({ id, name })
    if (result?.success) {
      const notebook = notebooks.value.find(nb => nb.id === id)
      if (notebook) {
        notebook.name = name
      }
      emit('notebook-renamed', { id, name })
      message.success(t('notebook.renameSuccess') || '重命名成功')
    }
  } catch (err) {
    console.error('[LeftPanel] Failed to rename notebook:', err)
    message.error(t('common.saveFailed') || '保存失败')
  }
}

const handleNotebookDelete = (notebook) => {
  dialog.warning({
    title: t('notebook.deleteConfirmTitle', { name: notebook.name || t('notebook.defaultName') || 'Notebook' }),
    content: t('notebook.deleteConfirmContent') || '确定删除此笔记本？',
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        const result = await window.electronAPI.notebookDelete(notebook.id)
        if (result?.success) {
          notebooks.value = notebooks.value.filter(nb => nb.id !== notebook.id)
          if (currentNotebookId.value === notebook.id) {
            currentNotebookId.value = null
          }
          emit('notebook-deleted', notebook.id)
          message.success(t('common.deleteSuccess') || '删除成功')
        }
      } catch (err) {
        console.error('[LeftPanel] Failed to delete notebook:', err)
        message.error(t('common.deleteFailed') || '删除失败')
      }
    }
  })
}

// Props
const props = defineProps({
  projects: {
    type: Array,
    default: () => []
  },
  currentProject: {
    type: Object,
    default: null
  },
  agentCwd: {
    type: String,
    default: null
  },
  agentSessionId: {
    type: String,
    default: null
  },
  isDark: {
    type: Boolean,
    default: false
  },
  isHomeActive: {
    type: Boolean,
    default: false
  },
  isProjectLibraryActive: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits([
  'open-project',
  'select-project',
  'toggle-theme',
  'context-action',
  'session-created',
  'session-selected',
  'session-closed',
  'terminal-created',
  'mode-changed',
  'home-request',
  'agent-created',
  'agent-selected',
  'agent-closed',
  'agent-profile-updated',
  'notebook-select',
  'notebook-created',
  'notebook-renamed',
  'notebook-deleted'
])

// Developer mode removed — stub variables
const activeSessions = ref([])
const historySessions = ref([])
const focusedSessionId = ref(null)
const maxHistorySessions = computed(() => 0)
const showSubagentSessions = ref(false)
const showNewSessionDialog = ref(false)
const newSessionTitle = ref('')
const showRenameDialog = ref(false)
const renameTitle = ref('')
const renamingSession = ref(null)
const displayedHistorySessions = computed(() => [])
const loadActiveSessions = async () => {}
const loadHistorySessions = async () => {}
const loadConfig = async () => {}
const checkCanCreateSession = async () => ({ canCreate: false, maxSessions: 0 })
const openNewSessionDialog = () => {}
const closeNewSessionDialog = () => {}
const createSession = async () => {}
const selectSession = () => {}
const closeSession = async () => {}
const doOpenRenameDialog = () => {}
const closeRenameDialog = () => {}
const doConfirmRename = async () => {}
const resumeHistorySession = async () => {}
const deleteHistorySession = async () => {}
const doFormatSessionName = (s) => s?.name || ''
const doFormatDate = (d) => d || ''
const setupEventListeners = () => () => {}
const toggleSubagentSessions = () => {}


// Local state
const selectedProjectId = ref(null)
const isSyncing = ref(false)
const agentLeftContentRef = ref(null)
const activeAgentSessionId = ref(null)
const currentUser = ref(null)
const ADMIN_PHONE = '15527109305'
const normalizePhone = phone => String(phone || '').replace(/\D/g, '').slice(-11)
const isSuperAdmin = computed(() => normalizePhone(currentUser.value?.phone) === ADMIN_PHONE)

// Notebook 状态
const notebooks = ref([])
const notebooksLoading = ref(false)
const currentNotebookId = ref(null)
const showNotebookCreateModal = ref(false)
const sources = ref([])
const currentNotebook = ref(null)

// 更新红点状态
const hasUpdateAvailable = ref(false)

// History session rename (仅内存，不持久化)
const showHistoryRenameDialog = ref(false)
const historyRenameTitle = ref('')
const editingHistorySession = ref(null)

// Watch currentProject changes
watch(() => props.currentProject, (newProject) => {
  selectedProjectId.value = newProject?.id || null
}, { immediate: true })

// Project dropdown options
const projectOptions = computed(() => {
  return props.projects.map(project => ({
    label: `${project.icon || '📁'} ${project.name}`,
    value: project.id,
    disabled: !project.pathValid,
    path: project.path
  }))
})

// 渲染项目选项，显示完整路径 tooltip
const renderProjectLabel = (option) => {
  return h('span', { title: option.path, style: 'display: block; overflow: hidden; text-overflow: ellipsis;' }, option.label)
}

// Project settings menu options
const renderMenuIcon = (iconName) => () => h(Icon, { name: iconName, size: 16, style: 'margin-right: 8px; color: var(--primary-color)' })

const projectMenuOptions = computed(() => [
  { label: t('project.openFolder'), key: 'openFolder', icon: renderMenuIcon('folderOpen') },
  { label: t('terminal.openTerminal'), key: 'openTerminal', icon: renderMenuIcon('terminal') },
  { label: t('project.edit'), key: 'edit', icon: renderMenuIcon('edit') },
  { label: t('session.sync'), key: 'syncSessions', icon: renderMenuIcon('sync') },
  { type: 'divider', key: 'd1' },
  { label: t('project.openClaudeConfig'), key: 'openProjectConfig', icon: renderMenuIcon('fileText') },
  { label: t('settingsMenu.claudeSettings'), key: 'openClaudeSettings', icon: renderMenuIcon('settings') },
  { type: 'divider', key: 'd2' },
  { label: t('project.hide'), key: 'hide', icon: renderMenuIcon('eyeOff') }
])

// Settings dropdown options
const showFooterSettings = computed(() => !!currentUser.value)

const settingsOptions = computed(() => {
  const options = []

  if (currentUser.value) {
    options.push(
      {
        label: () => h('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            minWidth: '150px',
            lineHeight: '1.25'
          }
        }, [
          h('span', {
            style: {
              fontSize: '12px',
              color: 'var(--text-color-muted)'
            }
          }, '账号'),
          h('span', {
            style: {
              maxWidth: '170px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-color)'
            }
          }, currentUser.value.phone)
        ]),
        key: 'account-info',
        icon: renderMenuIcon('user'),
        disabled: true
      },
      { label: '退出登录', key: 'logout', icon: renderMenuIcon('close') }
    )
  }

  if (currentUser.value) {
    options.push({ type: 'divider', key: 'account-divider' })
  }

  if (isSuperAdmin.value) {
    options.push({ label: t('settingsMenu.model'), key: 'model-settings', icon: renderMenuIcon('settings') })
    options.push({ label: t('settingsMenu.imBots'), key: 'im-bot-settings', icon: renderMenuIcon('robot') })
  }

  if (currentUser.value) {
    options.push({ label: t('settingsMenu.capabilityWorkbench'), key: 'capability-settings', icon: renderMenuIcon('zap') })
  }

  return options
})

// 有更新时在 app-update 菜单项标签后追加红点
const renderSettingsLabel = (option) => {
  if (option.key === 'app-update' && hasUpdateAvailable.value) {
    return h('span', { style: 'display:inline-flex; align-items:center; gap:6px;' }, [
      String(option.label),
      h('span', { style: 'width:7px; height:7px; border-radius:50%; background:#ff4d4f; flex-shrink:0;' })
    ])
  }
  return typeof option.label === 'function' ? option.label() : option.label
}

// Handle project selection change
const handleProjectChange = async (projectId) => {
  selectedProjectId.value = projectId

  if (projectId === null) {
    emit('select-project', null)
    return
  }
  const project = props.projects.find(p => p.id === projectId)
  if (project) {
    // 更新最后打开时间（用于排序）
    try {
      await invoke('touchProject', projectId)
    } catch (err) {
      console.error('Failed to touch project:', err)
    }
    emit('select-project', project)
  }
}

// Handle project menu actions
const handleProjectMenuSelect = async (key) => {
  if (!props.currentProject) return

  // 同步会话直接在本组件处理
  if (key === 'syncSessions') {
    handleSyncSessions()
    return
  }

  // 打开终端直接在本组件处理
  if (key === 'openTerminal') {
    handleOpenTerminal()
    return
  }

  // 打开项目 Claude 配置目录
  if (key === 'openProjectConfig') {
    handleOpenProjectConfig()
    return
  }

  // 打开 Claude 全局配置文件
  if (key === 'openClaudeSettings') {
    handleOpenClaudeSettings()
    return
  }

  emit('context-action', { action: key, project: props.currentProject })
}

// 打开项目 Claude 配置文件 (settings.local.json)
const handleOpenProjectConfig = async () => {
  if (!props.currentProject?.path) return

  try {
    const result = await window.electronAPI.getProjectConfigPath(props.currentProject.path)
    // 检查是否返回错误对象
    if (result && result.success === false) {
      message.error(result.error || t('messages.operationFailed'))
      return
    }
    // result 是文件路径字符串
    const openResult = await window.electronAPI.openPath(result)
    if (!openResult.success) {
      message.error(openResult.error || t('messages.operationFailed'))
    }
  } catch (err) {
    console.error('Failed to open project config:', err)
    message.error(t('messages.operationFailed'))
  }
}

// Handle settings menu
const handleSettingsSelect = async (key) => {
  if (key === 'account-info') return
  if (key === 'logout') {
    await handleLogout()
    return
  }

  if (key === 'model-settings' && !isSuperAdmin.value) return
  if (key === 'im-bot-settings' && !isSuperAdmin.value) return
  if (!window.electronAPI) {
    console.error('Electron API not available')
    return
  }

  switch (key) {
    case 'model-settings':
      window.electronAPI.openModelSettings()
      break
    case 'im-bot-settings':
      window.electronAPI.openIMBotSettings()
      break
    case 'capability-settings':
      window.electronAPI.openSettingsWorkbench()
      break
  }
}

const loadCurrentUser = async () => {
  if (!window.electronAPI?.authGetCurrentUser) return
  try {
    const result = await window.electronAPI.authGetCurrentUser()
    currentUser.value = result?.user || null
  } catch (err) {
    currentUser.value = null
  }
}

const handleLogout = async () => {
  if (agentLeftContentRef.value?.logout) {
    await agentLeftContentRef.value.logout()
  } else if (window.electronAPI?.authLogout) {
    await window.electronAPI.authLogout()
  }
  currentUser.value = null
  redirectToLoginPage()
}

// 打开 Claude 全局配置文件
const handleOpenClaudeSettings = async () => {
  try {
    const settingsPath = await window.electronAPI.getClaudeSettingsPath()
    const result = await window.electronAPI.openPath(settingsPath)
    if (!result.success) {
      message.warning(t('settingsMenu.claudeSettingsNotFound') || 'Claude 配置文件不存在')
    }
  } catch (err) {
    console.error('Failed to open Claude settings:', err)
    message.error(t('messages.operationFailed'))
  }
}

// 查看更多历史会话
const handleViewMore = () => {
  if (window.electronAPI && props.currentProject) {
    window.electronAPI.openSessionManager({ projectPath: props.currentProject.path })
  }
}

// 手动同步会话
const handleSyncSessions = async () => {
  if (!props.currentProject || isSyncing.value) return

  isSyncing.value = true
  try {
    const result = await window.electronAPI.syncProjectSessions({
      projectPath: props.currentProject.path,
      projectName: props.currentProject.name
    })

    if (result.success) {
      await loadHistorySessions(props.currentProject)
      const synced = result.synced || 0
      if (synced > 0) {
        message.success(t('session.syncSuccess', { added: synced, updated: 0 }) || `同步完成：新增 ${synced}`)
      } else {
        message.info(t('session.syncNoChanges') || '已是最新，无需同步')
      }
    } else {
      message.warning(result.error || t('session.syncFailed') || '同步失败')
    }
  } catch (err) {
    console.error('Sync sessions failed:', err)
    message.error(t('session.syncFailed') || '同步失败')
  } finally {
    isSyncing.value = false
  }
}

// ========================================
// Wrapper functions using composable
// ========================================

// Formatters with locale
const formatSessionName = (session) => doFormatSessionName(session, t)
const formatDate = (dateStr) => doFormatDate(dateStr, t)

// New session
const handleNewSession = async () => {
  if (!props.currentProject) {
    message.warning(t('messages.pleaseSelectProject'))
    return
  }

  if (!props.currentProject.pathValid) {
    message.error(t('project.pathNotExist'))
    return
  }

  const { canCreate, maxSessions } = await checkCanCreateSession()
  if (!canCreate) {
    message.warning(t('session.maxSessionsReached', { max: maxSessions }))
    return
  }

  openNewSessionDialog()
}

// Open plain terminal (without starting claude)
const handleOpenTerminal = async () => {
  if (!props.currentProject) {
    message.warning(t('messages.pleaseSelectProject'))
    return
  }

  if (!props.currentProject.pathValid) {
    message.error(t('project.pathNotExist'))
    return
  }

  try {
    const result = await invoke('createActiveSession', {
      type: 'terminal',
      projectId: props.currentProject.id,
      projectPath: props.currentProject.path,
      projectName: props.currentProject.name,
      title: t('terminal.terminal'),
      apiProfileId: props.currentProject.api_profile_id
    })

    if (result.success) {
      emit('terminal-created', result.session)
    } else {
      message.error(result.error || t('terminal.createFailed'))
    }
  } catch (err) {
    console.error('Failed to open terminal:', err)
    message.error(t('terminal.createFailed'))
  }
}

// Confirm new session
const confirmNewSession = async () => {
  const result = await createSession(props.currentProject)
  if (result.success) {
    emit('session-created', result.session)
    message.success(t('messages.connectionSuccess'))
  } else {
    message.error(result.error || t('messages.connectionFailed'))
  }
}

// Select active session
const handleSelectSession = (session) => {
  selectSession(session)
  emit('session-selected', session)
}

// Open rename dialog
const openRenameDialog = (session) => {
  doOpenRenameDialog(session)
}

// Confirm rename (运行中会话)
// 后端 renameSession 会同时更新内存和数据库，前端只需调用一次
const confirmRename = async () => {
  const result = await doConfirmRename()
  if (result.success) {
    // 重新加载历史会话以保持同步（后端已更新数据库）
    await loadHistorySessions(props.currentProject)
    message.success(t('messages.saveSuccess'))
  } else if (result.error) {
    message.error(t('messages.saveFailed'))
  }
}

// Close active session
const handleCloseSession = async (session) => {
  const result = await closeSession(session.id)
  if (result.success) {
    emit('session-closed', session)
  } else {
    message.error(t('messages.operationFailed'))
  }
}

// Open history session
const handleOpenHistorySession = async (session) => {
  if (!props.currentProject) {
    message.warning(t('messages.pleaseSelectProject'))
    return
  }

  if (!props.currentProject.pathValid) {
    message.error(t('project.pathNotExist'))
    return
  }

  const result = await resumeHistorySession(props.currentProject, session, t)

  if (result.success) {
    if (result.alreadyRunning) {
      emit('session-selected', result.session)
    } else {
      emit('session-created', result.session)
      message.success(t('session.resumeSuccess') || '会话已恢复')
    }
  } else if (result.error === 'SESSION_IN_USE_BY_AGENT') {
    message.warning(t('session.sessionInUseByAgent'))
  } else if (result.error === 'maxSessionsReached') {
    message.warning(t('session.maxSessionsReached', { max: result.maxSessions }))
  } else if (result.error === 'pendingSessionClosed') {
    message.warning(t('session.pendingSessionClosed') || '该会话已关闭，无法恢复')
  } else {
    message.error(result.error || t('messages.connectionFailed'))
  }
}

// Edit history session name (仅内存，不恢复会话)
const handleEditHistorySession = (session) => {
  editingHistorySession.value = session
  historyRenameTitle.value = session.name || ''
  showHistoryRenameDialog.value = true
}

// Confirm history session rename (保存到数据库)
const confirmHistoryRename = async () => {
  if (!editingHistorySession.value) return

  const newName = historyRenameTitle.value.trim()
  if (!newName) {
    message.warning(t('session.nameRequired') || '请输入会话名称')
    return
  }

  try {
    // 保存到数据库
    const result = await invoke('updateSessionTitle', {
      sessionId: editingHistorySession.value.id,
      title: newName
    })

    if (result.success) {
      // 更新历史会话内存数据
      const historySession = historySessions.value.find(
        s => s.id === editingHistorySession.value.id
      )
      if (historySession) {
        historySession.name = newName
        historySession.title = newName
      }

      // 同步更新运行中会话（两种关联方式）
      // 1. 通过 resumeSessionId === session_uuid（恢复会话或已关联的新建会话）
      // 2. 通过 dbSessionId === id（新建会话，通过数据库 ID 关联）
      const activeSession = activeSessions.value.find(
        s => (s.resumeSessionId && s.resumeSessionId === editingHistorySession.value.session_uuid) ||
             (s.dbSessionId && s.dbSessionId === editingHistorySession.value.id)
      )
      if (activeSession) {
        activeSession.title = newName
        // 同步到后端内存（数据库已在上面更新）
        await invoke('renameActiveSession', {
          sessionId: activeSession.id,
          newTitle: newName
        })
      }

      message.success(t('messages.saveSuccess') || '已保存')
    } else {
      message.error(result.error || t('messages.saveFailed'))
    }
  } catch (err) {
    console.error('Failed to update session title:', err)
    message.error(t('messages.saveFailed'))
  }

  showHistoryRenameDialog.value = false
  editingHistorySession.value = null
}

// Delete history session
const handleDeleteHistorySession = (session) => {
  dialog.warning({
    title: t('session.deleteTitle'),
    content: `${t('session.deleteConfirm', { name: session.name || session.session_uuid?.slice(0, 8) })}\n\n${t('session.deleteWarning')}`,
    positiveText: t('common.confirm') || '确认',
    negativeText: t('common.cancel') || '取消',
    onPositiveClick: async () => {
      const result = await deleteHistorySession(props.currentProject, session)
      if (result.success) {
        message.success(t('session.deleted'))
      } else if (result.error === 'sessionIsRunning') {
        message.warning(t('session.cannotDeleteRunning'))
      } else {
        message.error(result.error || t('messages.operationFailed'))
      }
    }
  })
}

// Watch project change to reload sessions and start file watching
watch(() => props.currentProject, async (newProject) => {
  if (newProject) {
    await Promise.all([
      loadActiveSessions(),
      loadHistorySessions(newProject)
    ])
    // Start watching session files for this project
    if (window.electronAPI?.watchSessionFiles) {
      window.electronAPI.watchSessionFiles({
        projectPath: newProject.path,
        projectId: newProject.id
      })
    }
  } else {
    historySessions.value = []
    // Stop watching when no project selected
    if (window.electronAPI?.stopWatchingSessionFiles) {
      window.electronAPI.stopWatchingSessionFiles()
    }
  }
}, { immediate: true })

// Listen for session events
let cleanupFn = null
let fileWatcherCleanup = null
let sessionUpdatedCleanup = null
let updateAvailableCleanup = null

onMounted(async () => {
  await loadCurrentUser()
  await loadConfig()

  // 初始加载活动会话列表
  await loadActiveSessions()

  // 检查是否已有可用更新（应用启动时自动检查后留存的状态）
  if (window.electronAPI?.getUpdateStatus) {
    try {
      const status = await window.electronAPI.getUpdateStatus()
      if (status?.hasUpdate) {
        hasUpdateAvailable.value = true
      }
    } catch (err) {
      console.error('[LeftPanel] Failed to get update status:', err)
    }
  }

  // 监听更新事件，实时显示红点
  if (window.electronAPI?.onUpdateAvailable) {
    updateAvailableCleanup = window.electronAPI.onUpdateAvailable(() => {
      hasUpdateAvailable.value = true
    })
  }

  cleanupFn = setupEventListeners()

  // Listen for session file changes
  if (window.electronAPI?.onSessionFileChanged) {
    fileWatcherCleanup = window.electronAPI.onSessionFileChanged(async (data) => {
      // Reload history sessions when files change
      if (props.currentProject?.path === data.projectPath) {
        await loadHistorySessions(props.currentProject)
      }
    })
  }

  // Listen for session updates (e.g., when uuid is linked after file detection, visibility changed)
  if (window.electronAPI?.onSessionUpdated) {
    sessionUpdatedCleanup = window.electronAPI.onSessionUpdated(async (eventData) => {
      const { sessionId, session } = eventData || {}
      if (!sessionId || !session) return

      // 重新加载会话列表以确保UI同步
      await loadActiveSessions()

      // 强制 Vue 更新 DOM
      await nextTick()

      // 如果是当前项目的会话，同时更新历史会话列表（可能有 resumeSessionId 变化）
      if (props.currentProject && session.projectId === props.currentProject.id) {
        await loadHistorySessions(props.currentProject)
      }
    })
  }

})

onUnmounted(() => {
  if (cleanupFn) cleanupFn()
  if (fileWatcherCleanup) fileWatcherCleanup()
  if (sessionUpdatedCleanup) sessionUpdatedCleanup()
  if (updateAvailableCleanup) updateAvailableCleanup()
  // Stop file watching when component unmounts
  if (window.electronAPI?.stopWatchingSessionFiles) {
    window.electronAPI.stopWatchingSessionFiles()
  }
})

// Expose methods
defineExpose({
  loadActiveSessions,
  loadHistorySessions: () => loadHistorySessions(props.currentProject),
  reloadAgentConversations: () => agentLeftContentRef.value?.loadConversations?.(),
  loadNotebooks,
  focusedSessionId,
  activeAgentSessionId,
  currentNotebookId,
  handleNewSession,
  requestNewAgentConversation: handleQuickNewConversation
})
</script>

<style scoped>
.left-panel {
  width: 280px;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: all 0.3s ease;
}
</style>
