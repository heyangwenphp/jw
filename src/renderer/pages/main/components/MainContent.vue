<template>
  <div class="app-container" :class="{ 'dark-theme': isDark }" :style="cssVars">
    <!-- Left Panel (Project Selector + Sessions) -->
    <LeftPanel
      v-if="showLeftPanel && !isProjectLibraryActive"
      ref="leftPanelRef"
      :projects="projects"
      :current-project="currentProject"
      :agent-cwd="activeAgentCwd"
      :agent-session-id="activeAgentSessionId"
      :is-home-active="activeTabId === 'welcome' && !isProjectLibraryActive"
      :is-project-library-active="isProjectLibraryActive"
      :is-dark="isDark"
      @home-request="handleHomeRequest"
      @open-project="handleOpenProject"
      @select-project="selectProject"
      @toggle-theme="handleToggleTheme"
      @context-action="handleContextAction"
      @session-created="onSessionCreated"
      @session-selected="handleSessionSelected"
      @session-closed="onSessionClosed"
      @terminal-created="onTerminalCreated"
      @agent-created="handleAgentCreated"
      @agent-selected="handleAgentSelected"
      @agent-closed="handleAgentClosed"
      @agent-profile-updated="handleAgentProfileUpdated"
    />

    <!-- Main Content Area -->
    <div
      class="main-content"
      :class="{
        'right-panel-collapsed': !effectiveShowRightPanel,
        'project-library-main-content': isProjectLibraryActive
      }"
    >
      <div
        v-if="showWechatBrowserGuide"
        class="wechat-browser-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wechat-browser-title"
      >
        <section class="wechat-browser-card">
          <div class="wechat-browser-mark">
            <Icon name="externalLink" :size="30" />
          </div>
          <h2 id="wechat-browser-title">请在浏览器中打开</h2>
          <p class="wechat-browser-desc">
            微信内置浏览器可能导致文件预览、下载和本地路径打开不可用。请切换到系统浏览器获得完整体验。
          </p>
          <ol class="wechat-browser-steps">
            <li>点击右上角「...」菜单</li>
            <li>选择「在浏览器打开」或「用默认浏览器打开」</li>
          </ol>
          <div class="wechat-browser-actions">
            <button class="wechat-primary-btn" type="button" @click="handleCopyWechatBrowserLink">
              <Icon name="copy" :size="14" />
              <span>复制当前链接</span>
            </button>
          </div>
        </section>
      </div>

      <!-- Tab Bar -->
      <TabBar
        v-if="!isProjectLibraryActive && activeTabId !== 'welcome'"
        :tabs="currentModeTabs"
        :active-tab-id="activeTabId"
        :current-project="currentProject"
        :show-new-button="false"
        :show-right-toggle="activeTabId !== 'welcome' && !showRightPanel"
        @select-tab="handleSelectTab"
        @close-tab="handleCloseTab"
        @open-right-panel="showRightPanel = true"
      />

      <!-- Main Area -->
      <div
        class="main-area"
        :class="{
          'project-library-main-area': isProjectLibraryActive,
          'home-main-area': !isProjectLibraryActive && activeTabId === 'welcome'
        }"
      >
        <ProjectLibraryWorkbench
          v-if="isProjectLibraryActive"
          :is-dark="isDark"
          @home-request="handleHomeRequest"
          @toggle-theme="handleToggleTheme"
        />

        <!-- Developer Mode Content (v-show 保持组件活跃，避免终端 buffer 丢失) -->
        <!-- Agent Mode Content (v-show 保持组件活跃，避免 IPC 监听丢失和重复加载) -->
        <div v-show="!isProjectLibraryActive" class="mode-content">
          <!-- Agent Welcome -->
          <div
            v-show="!hasAgentTabs || activeTabId === 'welcome'"
            class="midea-home-state"
          >
            <MideaYqMonitorContent />
          </div>

          <!-- Agent Chat Tabs Container -->
          <div v-show="hasAgentTabs && activeTabId !== 'welcome'" class="agent-container">
            <AgentChatTab
              v-for="tab in agentTabs"
              :key="tab.id"
              :ref="el => { if (el) agentChatTabRefs[tab.id] = el }"
              :session-id="tab.sessionId"
              :session-type="tab.sessionType"
              :session-cwd="tab.cwd"
              :fallback-project-path="currentProject?.path || null"
              :api-profile-id="tab.apiProfileId"
              :model-id="tab.modelId"
              :preserve-initial-title="tab.preserveTitle"
              :show-inline-report-preview="!tab.keepReportFollowupConversationVisible"
              :visible="activeTabId === tab.id"
              @ready="handleAgentTabReady"
              @request-clear-session="handleAgentClearSession(tab.sessionId)"
              @preview-image="handlePreviewImage"
              @preview-link="handlePreviewLink"
              @preview-path="handlePreviewPath"
              @run-command="handleRunCommand"
              @agent-done="handleAgentDone"
              @profile-changed="handleAgentProfileUpdated"
            />
          </div>
        </div>

      </div>

      <!-- Background Task Status Bar -->
      <TaskStatusBar v-model:is-expanded="taskPanelExpanded" />
    </div>

    <!-- Resize Handle -->
    <div
      v-if="effectiveShowRightPanel"
      class="resize-handle"
      @mousedown="startResize"
      :title="t('panel.dragToResize')"
    />

    <!-- Right Panel: Developer 模式用配置面板，Agent 模式用文件浏览面板 -->
    <template v-if="effectiveShowRightPanel">
      <AgentRightPanel
        ref="agentRightPanelRef"
        :style="{ width: rightPanelWidth }"
        :session-id="activeAgentSessionId"
        :selected-report-mode="selectedReportMode"
        :generated-reports="generatedReports"
        :generated-reports-loading="generatedReportsLoading"
        :selected-generated-report="selectedGeneratedReport"
        @collapse="showRightPanel = false"
        @insert-path="handleInsertPath"
        @select-generated-report="handleGeneratedReportSelected"
        @delete-generated-report="handleGeneratedReportDeleted"
        @refresh-generated-reports="refreshGeneratedReports"
        @switch-generated-report-mode="handleSelectReportMode"
      />
    </template>

    <!-- Settings Overlay -->
    <div
      v-if="showGlobalSettings"
      class="settings-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div class="settings-modal-backdrop" @click="showGlobalSettings = false" />
      <div class="settings-modal">
        <div class="settings-modal-header">
          <h2>{{ settingsOverlayTitle }}</h2>
          <n-button @click="showGlobalSettings = false">{{ t('common.close') }}</n-button>
        </div>
        <div class="settings-modal-body">
          <ModelSettingsContent v-if="settingsActiveTab === 'model'" />
          <IMTab v-if="settingsActiveTab === 'im'" />
          <SettingsWorkbenchContent v-if="settingsActiveTab === 'capability'" :initial-tab="settingsWorkbenchInitialTab" />
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { useTheme } from '@composables/useTheme'
import { useLocale } from '@composables/useLocale'
import { useProjects } from '@composables/useProjects'
import { useTabManagement } from '@composables/useTabManagement'
import { useAppMode, AppMode } from '@composables/useAppMode'
import { useIPC } from '@composables/useIPC'
import { isValidSessionEvent } from '@composables/useValidation'
import { useReportIndex } from '@composables/useReportIndex.js'
import { buildAgentModelOptions, resolveAgentProfileModelId } from '@composables/useAgentChat'
import { copyTextToClipboard } from '@utils/clipboard-utils'
import LeftPanel from './LeftPanel.vue'
import AgentRightPanel from './AgentRightPanel/index.vue'
import TabBar from './TabBar.vue'
import AgentChatTab from './AgentChatTab.vue'
import ChatInput from './agent/ChatInput.vue'
import ReportWelcome from './agent/ReportWelcome.vue'
import ReportTimeline from './agent/ReportTimeline.vue'
import TaskStatusBar from './TaskStatusBar.vue'
import ProjectLibraryWorkbench from './project-library/ProjectLibraryWorkbench.vue'
import Icon from '@components/icons/Icon.vue'
import ModelSettingsContent from '@/pages/model-settings/components/ModelSettingsContent.vue'
import IMTab from '@/pages/settings-workbench/components/IMTab.vue'
import SettingsWorkbenchContent from '@/pages/settings-workbench/components/SettingsWorkbenchContent.vue'
import MideaYqMonitorContent from './settings/MideaYqMonitorContent.vue'

const message = useMessage()
const dialog = useDialog()
const { isDark, cssVars, toggleTheme } = useTheme()
const { t, initLocale } = useLocale()
const { invoke } = useIPC()
const { isDeveloperMode, isAgentMode, isNotebookMode, appMode, initMode, switchMode } = useAppMode()
const { reports, touchReport, loadWelcomeReports, listGeneratedReports, hideGeneratedReport } = useReportIndex()
const selectedReportMode = ref(null)
const generatedReports = ref([])
const generatedReportsLoading = ref(false)
const selectedGeneratedReport = ref(null)
const generatedReportsRequestId = ref(0)
const generatedReportSelectionId = ref(0)
const generatedReportModeSyncId = ref(0)
const reportTimelineInputRef = ref(null)
const reportTimelineRef = ref(null)
const reportTimelineChatRefreshKey = ref(0)
const reportFollowupInFlight = ref(false)
const standaloneReportChatSessionId = ref('')
const standaloneReportChatSessionCwd = ref(null)
const standaloneReportChatApiProfileId = ref(null)
const standaloneReportChatModelId = ref(null)
const standaloneReportChatSelectionKey = ref('')

// Notebook 模式状态
const currentNotebook = ref(null)

// Use composables
const {
  projects,
  currentProject,
  showProjectModal,
  editingProject,
  loadProjects,
  selectProject: doSelectProject,
  openProject,
  openFolder,
  togglePin,
  hideProject,
  openEditModal,
  closeEditModal,
  saveProject,
  selectFirstProject
} = useProjects()

const {
  tabs,
  allTabs,  // 所有 TerminalTab 组件（包括后台的）
  activeTabId,
  ensureSessionTab,
  selectTab,
  closeTab,
  handleSessionCreated,
  handleSessionSelected: doHandleSessionSelected,
  handleSessionClosed,
  updateTabStatus,
  updateTabTitle,
  findTabBySessionId,
  ensureAgentTab,
  closeAgentTab,
  closeAgentTabFully
} = useTabManagement()

// Computed: 按模式过滤
const agentTabs = computed(() => allTabs.value.filter(t => t.type === 'agent-chat'))
const hasAgentTabs = computed(() => agentTabs.value.length > 0)

// TabBar 只显示当前模式的 tabs（隔离三种模式，防止跨模式误操作）
const currentModeTabs = computed(() => {
  const agentModeTabs = tabs.value.filter(t => t.type === 'agent-chat')
  if (!isStandaloneReportModeSelected.value) return agentModeTabs

  return [
    {
      id: 'welcome',
      type: 'agent-chat',
      sessionType: 'report',
      title: standaloneGeneratedReportTitle.value,
      status: 'running',
      closable: false
    },
    ...agentModeTabs
  ]
})

// Agent 模式下当前活动会话的 sessionId（用于 AgentRightPanel）
const activeAgentSessionId = computed(() => {
  if (activeTabId.value === 'welcome') return null
  const tab = allTabs.value.find(t => t.id === activeTabId.value)
  return (tab?.type === 'agent-chat') ? tab.sessionId : null
})

// Agent 模式下当前活动会话的工作目录（用于 MCP 启闭）
const activeAgentCwd = computed(() => {
  if (activeTabId.value === 'welcome') return null
  const tab = allTabs.value.find(t => t.id === activeTabId.value)
  return (tab?.type === 'agent-chat') ? (tab.cwd || null) : null
})

// 计算当前活动的目录（Agent会话优先使用cwd，否则使用当前项目路径）
const activeTabCwd = computed(() => {
  if (activeTabId.value === 'welcome') return currentProject.value?.path || null
  const tab = allTabs.value.find(t => t.id === activeTabId.value)
  if (tab?.type === 'agent-chat' && tab.cwd) return tab.cwd
  return currentProject.value?.path || null
})

// 各模式最后的 activeTabId，切换模式时保存/恢复
let lastDeveloperTabId = 'welcome'
let lastAgentTabId = 'welcome'
let lastMode = AppMode.AGENT

/**
 * 确保 activeTabId 指向当前模式内的 tab
 * 所有可能改变 activeTabId 的操作后调用（关闭 tab、切换模式、会话关闭等）
 */
const ensureActiveTabInCurrentMode = () => {
  if (activeTabId.value === 'welcome') return
  const tab = allTabs.value.find(t => t.id === activeTabId.value)
  if (!tab) {
    activeTabId.value = 'welcome'
    return
  }
  const isAgentTab = tab.type === 'agent-chat'
  if (isDeveloperMode.value && isAgentTab) {
    const devTabs = tabs.value.filter(t => t.type !== 'agent-chat')
    activeTabId.value = devTabs.length > 0 ? devTabs[devTabs.length - 1].id : 'welcome'
  } else if (isAgentMode.value && !isAgentTab) {
    const agTabs = tabs.value.filter(t => t.type === 'agent-chat')
    activeTabId.value = agTabs.length > 0 ? agTabs[agTabs.length - 1].id : 'welcome'
  } else if (isNotebookMode.value) {
    activeTabId.value = 'welcome'
  }
}

// Refs
const leftPanelRef = ref(null)
const rightPanelRef = ref(null)
const agentRightPanelRef = ref(null)
const agentChatTabRefs = ref({})
const agentTabReadySessionIds = ref(new Set())
const pendingAgentTabReadyResolvers = ref(new Map())
const welcomeChatInputRef = ref(null)
const welcomeModelOptions = ref([])
const welcomeSelectedModel = ref('')
const welcomeApiProfileId = ref(null)
const welcomeSendInFlight = ref(false)
const terminalRefs = ref({})
const notebookWorkspaceRef = ref(null)
const terminalFontSize = ref(14)
const terminalFontFamily = ref('"Ubuntu Mono", monospace')
const terminalDarkBackground = ref(true)
const terminalBusy = ref(false)
const currentSessionUuid = ref('')
const taskPanelExpanded = ref(false)

// 当前活动会话的 sessionUuid（用于消息队列等功能）
const updateCurrentSessionUuid = async () => {
  if (activeTabId.value === 'welcome') {
    currentSessionUuid.value = ''
    return
  }
  const activeTab = tabs.value.find(t => t.id === activeTabId.value)
  if (!activeTab) {
    currentSessionUuid.value = ''
    return
  }
  try {
    const session = await window.electronAPI.getActiveSession(activeTab.sessionId)
    currentSessionUuid.value = session?.resumeSessionId || ''
  } catch (err) {
    console.error('Failed to get session uuid:', err)
    currentSessionUuid.value = ''
  }
}

// 监听 activeTabId 变化
watch(activeTabId, updateCurrentSessionUuid, { immediate: true })

// 监听 activeTabId 变化，同步左侧列表焦点
watch(activeTabId, (newTabId) => {
  if (!newTabId || newTabId === 'welcome') return
  const tab = allTabs.value.find(t => t.id === newTabId)
  if (!tab) return

  // 更新 currentProject，以便 RightPanel (FilesTab) 能随当前会话切换
  if (tab.projectId && tab.projectId !== currentProject.value?.id) {
    const targetProject = projects.value.find(p => p.id === tab.projectId)
    if (targetProject) {
      currentProject.value = targetProject
    }
  } else if (tab.type === 'agent-chat' && tab.cwd && tab.cwd !== currentProject.value?.path) {
    const targetProject = projects.value.find(p => p.path === tab.cwd)
    if (targetProject) {
      currentProject.value = targetProject
    }
  }

  // 同步左侧面板焦点（按 tab 类型区分）
  if (tab.type === 'agent-chat') {
    if (leftPanelRef.value?.activeAgentSessionId !== undefined) {
      leftPanelRef.value.activeAgentSessionId = tab.sessionId
    }
    if (!tab.keepReportFollowupConversationVisible) {
      syncGeneratedReportModeForConversation(tab, { refresh: !generatedReportsLoading.value })
    }
  } else {
    if (leftPanelRef.value?.focusedSessionId !== undefined) {
      leftPanelRef.value.focusedSessionId = tab.sessionId
    }
  }
})

// Panel visibility
const showLeftPanel = ref(true)
const showRightPanel = ref(false)
const activePrimaryView = ref('agent')
const isProjectLibraryActive = computed(() => activePrimaryView.value === 'project-library')
const effectiveShowRightPanel = computed(() => !isProjectLibraryActive.value && showRightPanel.value && (activeTabId.value !== 'welcome' || !!selectedReportMode.value))
const isWeChatBrowser = computed(() => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const bridgePlatform = window.electronAPI?.platform
  if (bridgePlatform && bridgePlatform !== 'web') return false
  return /MicroMessenger/i.test(navigator.userAgent || '')
})
const showWechatBrowserGuide = computed(() => isWeChatBrowser.value)
const showGlobalSettings = ref(false)
const settingsActiveTab = ref('model')
const settingsWorkbenchInitialTab = ref('skills')
const validSettingsTabs = ['model', 'im', 'capability']
const ADMIN_PHONE = '15527109305'
const settingsTitleKeys = {
  model: 'settingsMenu.model',
  im: 'settingsMenu.imBots',
  capability: 'settingsMenu.capabilityWorkbench'
}
const normalizePhone = phone => String(phone || '').replace(/\D/g, '').slice(-11)
const isAdminPhoneValue = phone => normalizePhone(phone) === ADMIN_PHONE
const getSettingsTabLabel = key => t(settingsTitleKeys[key] || settingsTitleKeys.model)
const settingsOverlayTitle = computed(() => getSettingsTabLabel(settingsActiveTab.value))

const resetGeneratedReportMode = () => {
  generatedReportsRequestId.value += 1
  generatedReportSelectionId.value += 1
  selectedReportMode.value = null
  generatedReports.value = []
  generatedReportsLoading.value = false
  selectedGeneratedReport.value = null
  clearStandaloneReportChatSession()
}

const handleHomeRequest = () => {
  activePrimaryView.value = 'agent'
  activeTabId.value = 'welcome'
  showRightPanel.value = false
  resetGeneratedReportMode()
}

const handleProjectLibraryRequest = () => {
  activePrimaryView.value = 'project-library'
  showRightPanel.value = false
  resetGeneratedReportMode()
}

const handleCopyWechatBrowserLink = async () => {
  const url = typeof window !== 'undefined' ? window.location.href : ''
  if (!url) return

  try {
    await copyTextToClipboard(url)
    message.success('链接已复制，请到系统浏览器中粘贴打开')
  } catch (err) {
    console.warn('[MainContent] Failed to copy WeChat browser link:', err)
    message.error('复制失败，请手动复制地址栏链接')
  }
}

// ========================================
// Right Panel Resize
// ========================================
const defaultRightPanelWidth = 24
const minRightPanelWidth = 20
const rightPanelWidth = ref(`${defaultRightPanelWidth}%`)
const isResizing = ref(false)
const startX = ref(0)
const startWidth = ref(0)

const normalizeRightPanelWidth = (width) => {
  const parsed = parseFloat(width)
  if (!Number.isFinite(parsed)) {
    return `${defaultRightPanelWidth}%`
  }
  return `${Math.max(minRightPanelWidth, Math.min(50, parsed)).toFixed(1)}%`
}

// 加载保存的宽度配置
const loadRightPanelWidth = async () => {
  try {
    const config = await window.electronAPI.getConfig()
    const savedWidth = config?.ui?.rightPanelWidth
    if (savedWidth) {
      rightPanelWidth.value = normalizeRightPanelWidth(savedWidth)
    }
  } catch (err) {
    console.error('Failed to load right panel width:', err)
  }
}

// 保存宽度配置
const saveRightPanelWidth = async (width) => {
  try {
    await window.electronAPI.saveConfig({
      ui: { rightPanelWidth: width }
    })
  } catch (err) {
    console.error('Failed to save right panel width:', err)
  }
}

// 开始拖动
const startResize = (e) => {
  isResizing.value = true
  startX.value = e.clientX

  // 获取当前宽度（百分比转像素）
  const containerWidth = document.querySelector('.app-container').offsetWidth
  const currentPercent = parseFloat(rightPanelWidth.value)
  startWidth.value = (containerWidth * currentPercent) / 100

  document.addEventListener('mousemove', handleResize)
  document.addEventListener('mouseup', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// 拖动中
const handleResize = (e) => {
  if (!isResizing.value) return

  const containerWidth = document.querySelector('.app-container').offsetWidth
  const deltaX = startX.value - e.clientX  // 向左拖动为正，向右拖动为负
  const newWidth = startWidth.value + deltaX

  // 转换为百分比
  let newPercent = (newWidth / containerWidth) * 100

  // 限制范围：24% ~ 50%
  newPercent = Math.max(minRightPanelWidth, Math.min(50, newPercent))

  rightPanelWidth.value = `${newPercent.toFixed(1)}%`
}

// 停止拖动
const stopResize = async () => {
  if (!isResizing.value) return

  isResizing.value = false
  document.removeEventListener('mousemove', handleResize)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''

  // 保存配置
  await saveRightPanelWidth(rightPanelWidth.value)
}

// Set terminal ref
const setTerminalRef = (tabId, el) => {
  if (el) {
    terminalRefs.value[tabId] = el
  } else {
    delete terminalRefs.value[tabId]
  }
}

// Initialize
const getCurrentUser = async () => {
  if (!window.electronAPI?.authGetCurrentUser) return null
  try {
    const result = await window.electronAPI.authGetCurrentUser()
    return result?.user || null
  } catch {
    return null
  }
}

const handleOpenSettings = async (event) => {
  const currentUser = await getCurrentUser()
  const requestedTab = event.detail?.type
  const requestedWorkbenchTab = event.detail?.tab
  if (!currentUser) return
  const isAdminPhone = isAdminPhoneValue(currentUser.phone)
  if (requestedTab === 'model' && !isAdminPhone) return
  if (requestedTab === 'im' && !isAdminPhone) return
  settingsWorkbenchInitialTab.value = requestedWorkbenchTab || 'skills'
  settingsActiveTab.value = validSettingsTabs.includes(requestedTab) ? requestedTab : 'capability'
  showGlobalSettings.value = true
}

const loadWelcomeModelOptions = async () => {
  try {
    const config = await window.electronAPI?.getConfig?.()
    const profiles = Array.isArray(config?.apiProfiles) ? config.apiProfiles : []
    if (!profiles.length) {
      welcomeModelOptions.value = []
      welcomeSelectedModel.value = ''
      welcomeApiProfileId.value = null
      return
    }

    const profile = profiles.find(p => p.id === config.defaultProfileId)
      || profiles.find(p => p.isDefault)
      || profiles[0]
    welcomeModelOptions.value = buildAgentModelOptions(profile, config)
    welcomeSelectedModel.value = resolveAgentProfileModelId(profile, config)
    welcomeApiProfileId.value = profile?.id || null
  } catch (err) {
    console.warn('[MainContent] Failed to load welcome model options:', err)
    welcomeModelOptions.value = []
    welcomeSelectedModel.value = ''
    welcomeApiProfileId.value = null
  }
}

onMounted(async () => {
  await initLocale()
  await initMode()
  await loadWelcomeModelOptions()
  await loadProjects()
  selectFirstProject()
  setupSessionListeners()
  loadWelcomeReports()
  loadRightPanelWidth()  // 加载右侧面板宽度配置
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('web:open-settings', handleOpenSettings)

  // Load terminal settings
})

// Cleanup listeners
let cleanupFns = []

// Keyboard shortcuts handler
const handleKeyDown = (event) => {
  // Ctrl+N: New session
  if (event.ctrlKey && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    if (leftPanelRef.value) {
      // 触发左侧面板的新建会话
      leftPanelRef.value.requestNewAgentConversation?.()
    }
    return
  }
}

onUnmounted(() => {
  cleanupFns.forEach(fn => fn && fn())
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('web:open-settings', handleOpenSettings)
})

// Setup session event listeners
const setupSessionListeners = () => {
  if (!window.electronAPI) return

  // 监听会话数据
  cleanupFns.push(
    window.electronAPI.onSessionData((eventData) => {
      if (!isValidSessionEvent(eventData)) return
      const { sessionId, data } = eventData
      const tab = findTabBySessionId(sessionId)
      if (tab && terminalRefs.value[tab.id]) {
        terminalRefs.value[tab.id].write(data)
      }
    })
  )

  // 监听会话退出
  cleanupFns.push(
    window.electronAPI.onSessionExit((eventData) => {
      if (!isValidSessionEvent(eventData)) return
      const { sessionId } = eventData
      updateTabStatus(sessionId, 'exited')
    })
  )

  // 监听会话错误
  cleanupFns.push(
    window.electronAPI.onSessionError((eventData) => {
      if (!isValidSessionEvent(eventData)) return
      const { sessionId, error } = eventData
      updateTabStatus(sessionId, 'error')
      message.error(t('messages.terminalError') + ': ' + (error || 'Unknown error'))
    })
  )

  // 监听会话更新（如重命名、UUID关联）
  cleanupFns.push(
    window.electronAPI.onSessionUpdated((eventData) => {
      if (!isValidSessionEvent(eventData)) return
      const { sessionId, session } = eventData
      if (session) {
        updateTabTitle(sessionId, session.title || '')
        // 如果当前活动会话的 UUID 被更新，刷新 currentSessionUuid
        const activeTab = tabs.value.find(t => t.id === activeTabId.value)
        if (activeTab && activeTab.sessionId === sessionId && session.resumeSessionId) {
          currentSessionUuid.value = session.resumeSessionId
        }
      }
    })
  )

  // 监听 Agent 会话重命名 → 同步更新 Tab 标题
  if (window.electronAPI.onAgentRenamed) {
    cleanupFns.push(
      window.electronAPI.onAgentRenamed((data) => {
        if (data?.sessionId && data?.title) {
          updateTabTitle(data.sessionId, data.title)
        }
      })
    )
  }

  // 钉钉会话关闭时，关闭对应 Tab
  if (window.electronAPI?.onDingTalkSessionClosed) {
    cleanupFns.push(
      window.electronAPI.onDingTalkSessionClosed((data) => {
        if (data?.sessionId) {
          handleSessionClosed({ id: data.sessionId })
          ensureActiveTabInCurrentMode()
        }
      })
    )
  }

  // Agent CLI 进程退出时，关闭对应 Tab
  if (window.electronAPI?.onAgentStatusChange) {
    cleanupFns.push(
      window.electronAPI.onAgentStatusChange((data) => {
        if (data?.sessionId && data?.cliExited && !data?.cliExitWasError) {
          console.log(`[MainContent] CLI exited for session ${data.sessionId}, closing tab`)
          const tab = allTabs.value.find(t => t.sessionId === data.sessionId && t.type === 'agent-chat')
          if (tab) {
            closeAgentTabFully(tab)
            ensureActiveTabInCurrentMode()
          }
        }
      })
    )
  }

  // 钉钉会话创建时，自动切换到 Agent 模式并打开 Tab
  if (window.electronAPI.onDingTalkSessionCreated) {
    cleanupFns.push(
      window.electronAPI.onDingTalkSessionCreated(async (data) => {
        if (data?.sessionId) {
          // 如果当前在 Developer 模式，自动切换到 Agent 模式
          if (isDeveloperMode.value) {
            await switchMode(AppMode.AGENT)
          }
          const tab = ensureAgentTab({
            id: data.sessionId,
            type: 'dingtalk',
            title: data.title || (data.nickname ? `钉钉 · ${data.nickname}` : 'DingTalk'),
          })
          if (tab) {
            activeTabId.value = tab.id
          }
        }
      })
    )
  }

  if (window.electronAPI.onWeixinSessionCreated) {
    cleanupFns.push(
      window.electronAPI.onWeixinSessionCreated(async (data) => {
        if (data?.sessionId) {
          if (isDeveloperMode.value) {
            await switchMode(AppMode.AGENT)
          }
          const tab = ensureAgentTab({
            id: data.sessionId,
            type: 'weixin',
            title: data.title || (data.senderNick ? `微信 · ${data.senderNick}` : '微信'),
          })
          if (tab) {
            activeTabId.value = tab.id
          }
        }
      })
    )
  }

  // 监听设置变化（终端字体大小、字体类型等）
  if (window.electronAPI.onSettingsChanged) {
    cleanupFns.push(
      window.electronAPI.onSettingsChanged((settings) => {
        if (settings.terminalFontSize !== undefined) {
          terminalFontSize.value = settings.terminalFontSize
        }
        if (settings.terminalFontFamily !== undefined) {
          terminalFontFamily.value = settings.terminalFontFamily
        }
        if (settings.terminalDarkBackground !== undefined) {
          terminalDarkBackground.value = settings.terminalDarkBackground
        }
      })
    )
  }
}

// ========================================
// Project management wrapper functions
// ========================================

const selectProject = async (project) => {
  await doSelectProject(project, {
    onPathInvalid: () => message.warning(t('project.pathNotExist'))
  })
}

const handleOpenProject = async () => {
  try {
    const result = await openProject()
    if (result.canceled) return

    // 路径包含可能导致同步问题的字符时，弹确认对话框（后端未创建记录）
    if (result.pathWarning) {
      dialog.warning({
        title: t('project.pathWarningTitle'),
        content: t('project.pathWarningContent', { path: result.path }),
        positiveText: t('project.pathWarningContinue'),
        negativeText: t('project.pathWarningCancel'),
        onPositiveClick: async () => {
          // 用户确认风险
          try {
            if (result.alreadyExists && result.existingId) {
              // 已存在的项目（可能是隐藏的）：恢复显示
              console.log(`[MainContent] Unhiding existing project id=${result.existingId} for path=${result.path}`)
              await invoke('unhideProject', result.existingId)
            } else {
              // 新项目：创建记录（skipPathCheck 绕过二次检测）
              console.log(`[MainContent] Creating project for path=${result.path}, name=${result.name}`)
              await invoke('createProject', { path: result.path, name: result.name, skipPathCheck: true })
            }
            await loadProjects()
            console.log(`[MainContent] After loadProjects, projects count=${projects.value.length}, paths=${projects.value.map(p => p.path).join(', ')}`)
            const project = projects.value.find(p => p.path === result.path)
            if (project) {
              currentProject.value = project
              console.log(`[MainContent] Selected project id=${project.id}`)
            } else {
              console.warn(`[MainContent] Project not found after loadProjects for path=${result.path}`)
            }
            message.success(t('messages.projectAdded') + ': ' + result.name)
          } catch (err) {
            console.error('[MainContent] Failed to add project:', err)
            message.error(err.message || t('messages.operationFailed'))
          }
        }
        // 取消：无需处理，后端本来就没创建记录
      })
      return
    }

    if (result.restored) {
      message.success(t('messages.projectRestored') + ': ' + result.name)
    } else if (result.alreadyExists) {
      message.info(t('messages.projectOpened') + ': ' + result.name)
    } else {
      message.success(t('messages.projectAdded') + ': ' + result.name)
    }
  } catch (err) {
    message.error(err.message || t('messages.operationFailed'))
  }
}

const handleContextAction = async ({ action, project }) => {
  try {
    switch (action) {
      case 'openFolder':
        await openFolder(project)
        break
      case 'pin':
        const { wasPinned } = await togglePin(project)
        message.success(wasPinned ? t('messages.projectUnpinned') : t('messages.projectPinned'))
        break
      case 'edit':
        await openEditModal(project)
        break
      case 'hide':
        await hideProject(project)
        message.success(t('messages.projectHidden'))
        break
    }
  } catch (err) {
    message.error(t('messages.operationFailed'))
  }
}

// ========================================
// Project edit modal wrapper
// ========================================

const handleProjectSave = async (updates) => {
  try {
    const result = await saveProject(updates)

    if (result.success) {
      if (result.apiProfileBlocked) {
        dialog.warning({
          title: t('project.apiProfileBlockedTitle') || 'API 配置未修改',
          content: t('project.apiProfileBlockedContent') || '运行中的历史会话，不能修改 API 配置，可能会导致签名错误，无法持续！如需修改，请在启动新会话之前修改 API 配置！',
          positiveText: t('common.ok') || '知道了'
        })
      } else {
        message.success(t('messages.projectUpdated'))
      }
    }
  } catch (err) {
    message.error(t('messages.operationFailed'))
  }
}

// ========================================
// Tab management wrapper functions
// ========================================

const handleSelectTab = (tab) => {
  selectTab(tab, {
    onProjectSwitch: (projectId) => {
      if (projectId !== currentProject.value?.id) {
        const targetProject = projects.value.find(p => p.id === projectId)
        if (targetProject) {
          currentProject.value = targetProject
        }
      }
    },
    onTerminalFocus: (focusedTab) => {
      nextTick(() => {
        if (terminalRefs.value[focusedTab.id]) {
          terminalRefs.value[focusedTab.id].fit()
        }
      })
    }
  })

  // 同步左侧面板焦点（按 tab 类型区分）
  if (tab.id === 'welcome') return
  if (tab.type === 'agent-chat') {
    if (leftPanelRef.value?.activeAgentSessionId !== undefined) {
      leftPanelRef.value.activeAgentSessionId = tab.sessionId
    }
    syncGeneratedReportModeForConversation(tab)
  } else {
    if (leftPanelRef.value?.focusedSessionId !== undefined) {
      leftPanelRef.value.focusedSessionId = tab.sessionId
    }
  }
}

const handleCloseTab = async (tab) => {
  if (tab.type === 'agent-chat') {
    closeAgentTab(tab)
  } else {
    await closeTab(tab)
  }
  // closeTab/closeAgentTab 的 fallback 从混合 tabs 选，可能选到跨模式 tab
  ensureActiveTabInCurrentMode()
}

// ========================================
// Session events wrapper functions
// ========================================

const onSessionCreated = (session) => {
  handleSessionCreated(session)
}

const handleSessionSelected = (session) => {
  doHandleSessionSelected(session, {
    onProjectSwitch: (projectId) => {
      if (projectId !== currentProject.value?.id) {
        const targetProject = projects.value.find(p => p.id === projectId)
        if (targetProject) {
          currentProject.value = targetProject
        }
      }
    }
  })
}

const onSessionClosed = (session) => {
  handleSessionClosed(session)
  ensureActiveTabInCurrentMode()
}

// 终端创建事件（纯终端，不启动 claude）
const onTerminalCreated = (session) => {
  // 复用会话创建逻辑，终端也是一种会话（type='terminal'）
  handleSessionCreated(session)
}

// Terminal ready event
const handleTerminalReady = ({ sessionId }) => {
  // 终端就绪，无需额外处理
}

// Send to terminal without executing, then focus terminal
const handleRunCommand = (command) => {
  handleSendToTerminal(command + '\n')
}

const handleSendToTerminal = (command) => {
  const activeTab = tabs.value.find(t => t.id === activeTabId.value)
  if (!activeTab || activeTab.id === 'welcome') {
    message.warning(t('messages.noActiveTerminal'))
    return
  }

  if (window.electronAPI) {
    window.electronAPI.writeActiveSession({
      sessionId: activeTab.sessionId,
      data: command
    })
  }

  // 聚焦终端
  nextTick(() => {
    if (terminalRefs.value[activeTab.id]) {
      terminalRefs.value[activeTab.id].focus()
    }
  })
}

// 模式切换：保存当前模式 tab 并恢复目标模式 tab
watch(appMode, (mode) => {
  if (mode === lastMode) return
  resetGeneratedReportMode()

  if (lastMode === AppMode.DEVELOPER) {
    lastDeveloperTabId = activeTabId.value
  } else if (lastMode === AppMode.AGENT) {
    lastAgentTabId = activeTabId.value
  }

  if (mode === AppMode.DEVELOPER) {
    activeTabId.value = lastDeveloperTabId
    showLeftPanel.value = true
    showRightPanel.value = false
  } else if (mode === AppMode.AGENT) {
    activeTabId.value = lastAgentTabId
    showLeftPanel.value = true
    showRightPanel.value = false
  } else if (mode === AppMode.NOTEBOOK) {
    activeTabId.value = 'welcome'
    showLeftPanel.value = true
    showRightPanel.value = false
  }

  lastMode = mode
  ensureActiveTabInCurrentMode()
})

// ========================================
// Agent event handlers
// ========================================

const handleAgentCreated = (session) => {
  activePrimaryView.value = 'agent'
  const tab = ensureAgentTab(session)
  if (tab) {
    activeTabId.value = tab.id
  }
}

const getWelcomeConversationTitle = (payload) => {
  const text = typeof payload === 'string' ? payload : payload?.text
  const fallback = typeof payload === 'object'
    ? payload?.files?.[0]?.name || t('agent.chat')
    : t('agent.chat')
  const title = String(text || fallback).replace(/\s+/g, ' ').trim()
  return title.length > 32 ? `${title.slice(0, 32)}...` : title
}

const getAgentTabRef = async (sessionId) => {
  const tabId = `agent-${sessionId}`
  for (let i = 0; i < 5; i++) {
    const tabRef = agentChatTabRefs.value[tabId]
    if (tabRef) return tabRef
    await nextTick()
  }
  return agentChatTabRefs.value[tabId] || null
}

const waitForAgentTabReady = async (sessionId) => {
  if (!sessionId) return false
  if (agentTabReadySessionIds.value.has(sessionId)) return true

  return await new Promise(resolve => {
    let timer = null
    const finish = (ready) => {
      if (timer) clearTimeout(timer)
      const resolvers = pendingAgentTabReadyResolvers.value.get(sessionId) || []
      const remaining = resolvers.filter(item => item !== finish)
      if (remaining.length > 0) {
        pendingAgentTabReadyResolvers.value.set(sessionId, remaining)
      } else {
        pendingAgentTabReadyResolvers.value.delete(sessionId)
      }
      resolve(ready)
    }

    const resolvers = pendingAgentTabReadyResolvers.value.get(sessionId) || []
    pendingAgentTabReadyResolvers.value.set(sessionId, [...resolvers, finish])
    timer = setTimeout(() => finish(false), 3000)
  })
}

const ensureReportConversation = async (source = {}) => {
  if (activeAgentSessionId.value) return activeAgentSessionId.value
  if (!window.electronAPI?.createAgentSession) return null

  const session = await window.electronAPI.createAgentSession({
    type: 'chat',
    title: source?.name || source?.title || t('agent.chat'),
    apiProfileId: source.apiProfileId || welcomeApiProfileId.value || null,
    modelId: source.modelId || welcomeSelectedModel.value || null
  })
  if (!session || session.error) {
    message.error(session?.error || t('messages.operationFailed'))
    return null
  }

  handleAgentCreated(session)
  await leftPanelRef.value?.reloadAgentConversations?.()
  await nextTick()
  return session.id
}

const handleWelcomeSend = async (payload) => {
  activePrimaryView.value = 'agent'
  if (welcomeSendInFlight.value) return
  const text = typeof payload === 'string' ? payload.trim() : String(payload?.text || '').trim()
  const hasFiles = typeof payload === 'object' && Array.isArray(payload?.files) && payload.files.length > 0
  const hasImages = typeof payload === 'object' && Array.isArray(payload?.images) && payload.images.length > 0
  if (!text && !hasFiles && !hasImages) return

  welcomeSendInFlight.value = true
  try {
    const sessionId = await ensureReportConversation({
      title: getWelcomeConversationTitle(payload)
    })
    if (!sessionId) return

    let tabRef = await getAgentTabRef(sessionId)
    if (!tabRef?.sendInitialMessage) {
      await waitForAgentTabReady(sessionId)
      tabRef = await getAgentTabRef(sessionId)
      if (!tabRef?.sendInitialMessage) {
        message.error(t('messages.operationFailed'))
        return
      }
    }

    await tabRef.sendInitialMessage(payload)
    tabRef.focus?.()
  } finally {
    welcomeSendInFlight.value = false
  }
}

const isGeneratedReportSelectionStale = (mode, requestId, selectionId) => {
  if (selectionId != null && selectionId !== generatedReportSelectionId.value) return true
  if (requestId != null && requestId !== generatedReportsRequestId.value) return true
  if (mode && selectedReportMode.value !== mode) return true
  return false
}

const STANDALONE_REPORT_CHAT_STORAGE_KEY = 'jedi:standalone-report-chat-sessions'

const getStandaloneReportConversationKey = (report, mode = selectedReportMode.value) => {
  const filePath = typeof report === 'string' ? report : report?.filePath
  if (!mode || !filePath) return ''
  return `${mode}:${String(filePath).trim()}`
}

const readStandaloneReportConversationMap = () => {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STANDALONE_REPORT_CHAT_STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const saveStandaloneReportConversationMap = (nextMap) => {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STANDALONE_REPORT_CHAT_STORAGE_KEY, JSON.stringify(nextMap || {}))
  } catch {}
}

const removeStandaloneReportConversationForSession = (sessionId) => {
  const targetSessionId = String(sessionId || '').trim()
  if (!targetSessionId) return

  const mapping = readStandaloneReportConversationMap()
  let changed = false
  for (const [key, stored] of Object.entries(mapping)) {
    if (getStoredStandaloneReportChatSessionId(stored) !== targetSessionId) continue
    delete mapping[key]
    changed = true
  }
  if (changed) {
    saveStandaloneReportConversationMap(mapping)
  }
  if (standaloneReportChatSessionId.value === targetSessionId) {
    clearStandaloneReportChatSession()
  }
}

const applyStandaloneReportChatSession = (session, key) => {
  standaloneReportChatSelectionKey.value = key || ''
  standaloneReportChatSessionId.value = session?.id || ''
  standaloneReportChatSessionCwd.value = session?.cwd || null
  standaloneReportChatApiProfileId.value = session?.apiProfileId || null
  standaloneReportChatModelId.value = session?.modelId || null
}

const clearStandaloneReportChatSession = () => {
  applyStandaloneReportChatSession(null, '')
}

const getStoredStandaloneReportChatSessionId = (stored) => {
  if (typeof stored === 'string') return stored
  if (stored && typeof stored === 'object') return stored.sessionId || ''
  return ''
}

const getStandaloneReportBindingForSessionId = (sessionId) => {
  const targetSessionId = String(sessionId || '').trim()
  if (!targetSessionId) return null

  const mapping = readStandaloneReportConversationMap()
  for (const [key, stored] of Object.entries(mapping)) {
    if (getStoredStandaloneReportChatSessionId(stored) !== targetSessionId) continue
    const separatorIndex = key.indexOf(':')
    if (separatorIndex <= 0) continue
    const mode = key.slice(0, separatorIndex)
    const filePath = key.slice(separatorIndex + 1).trim()
    if (isStandaloneGeneratedReportMode(mode) && filePath) {
      return { mode, filePath, key }
    }
  }
  return null
}

const restoreStandaloneReportConversation = async (key) => {
  const mapping = readStandaloneReportConversationMap()
  const sessionId = getStoredStandaloneReportChatSessionId(mapping[key])
  if (!sessionId || !window.electronAPI?.reopenAgentSession) return null

  const session = await window.electronAPI.reopenAgentSession(sessionId)
  if (session && !session.error) return session

  delete mapping[key]
  saveStandaloneReportConversationMap(mapping)
  return null
}

const readStandaloneReportMarkdown = async (report = selectedGeneratedReport.value) => {
  if (!report?.filePath) throw new Error('Missing report file path')
  const fileData = await window.electronAPI?.readAbsolutePath?.({
    filePath: report.filePath,
    sessionId: report.sessionId || null,
    confirmed: true
  })
  if (!fileData || fileData.error) {
    throw new Error(fileData?.error || t('agent.files.errorLoading'))
  }
  return {
    name: fileData.name || report.name || report.filePath.split(/[\\/]/).pop() || 'report.md',
    content: String(fileData.content || ''),
    filePath: report.filePath,
    sizeBytes: Number(fileData.size || fileData.sizeBytes || 0)
  }
}

const STANDALONE_REPORT_FOLLOWUP_CHAT_INSTRUCTION = [
  '请基于当前 Markdown 报告直接回答这次追问。',
  '除非用户明确要求生成、重新生成、保存或导出文件，否则不要创建、修改或导出任何 Markdown、PDF、HTML 或其他文件；只输出对话回复，适合继续讨论和头脑风暴。'
].join('\n')

const buildStandaloneReportFollowupPayload = async (payload, report = selectedGeneratedReport.value) => {
  const rawText = typeof payload === 'string' ? payload.trim() : String(payload?.text || '').trim()
  const markdownFile = await readStandaloneReportMarkdown(report)
  const instruction = [
    rawText,
    '',
    `当前上下文报告：《${report?.name || markdownFile.name}》。`,
    STANDALONE_REPORT_FOLLOWUP_CHAT_INSTRUCTION,
    '',
    `--- 当前报告 Markdown 开始：${markdownFile.name} ---`,
    markdownFile.content || '',
    `--- 当前报告 Markdown 结束：${markdownFile.name} ---`
  ].filter(Boolean).join('\n')

  if (payload && typeof payload === 'object') {
    return {
      ...payload,
      text: instruction,
      displayText: typeof payload.displayText === 'string' ? payload.displayText : rawText,
      files: Array.isArray(payload.files) ? payload.files : []
    }
  }

  return {
    text: instruction,
    displayText: rawText,
    files: []
  }
}

const refreshStandaloneReportChatMessages = (options = {}) => {
  reportTimelineChatRefreshKey.value += 1
  void nextTick(() => {
    reportTimelineRef.value?.reloadMessages?.(options)
    if (options?.scrollToBottom) {
      reportTimelineRef.value?.scrollToBottom?.(true, true)
    }
  })
}

const handleStandaloneReportStreamingChange = ({ sessionId, streaming } = {}) => {
  if (!sessionId || sessionId !== standaloneReportChatSessionId.value) return
  reportFollowupInFlight.value = Boolean(streaming)
}

const ensureStandaloneReportConversation = async (report, mode = selectedReportMode.value) => {
  if (!isStandaloneGeneratedReportMode(mode) || !report?.filePath) return null

  const key = getStandaloneReportConversationKey(report, mode)
  if (!key) return null
  if (standaloneReportChatSelectionKey.value === key && standaloneReportChatSessionId.value) {
    return standaloneReportChatSessionId.value
  }

  let session = await restoreStandaloneReportConversation(key)
  if (!session) {
    if (!window.electronAPI?.createAgentSession) return null
    session = await window.electronAPI.createAgentSession({
      type: 'chat',
      title: report.name || standaloneGeneratedReportTitle.value,
      apiProfileId: report.apiProfileId || welcomeApiProfileId.value || null,
      modelId: report.modelId || welcomeSelectedModel.value || null,
      source: 'report-followup',
      meta: {
        reportMode: mode,
        reportFilePath: report.filePath
      }
    })
    if (!session || session.error) {
      message.error(session?.error || t('messages.operationFailed'))
      return null
    }

    const mapping = readStandaloneReportConversationMap()
    mapping[key] = { sessionId: session.id }
    saveStandaloneReportConversationMap(mapping)
  }

  applyStandaloneReportChatSession(session, key)
  return session.id
}

const handleGeneratedReportSelected = async (report, options = {}) => {
  const selectionMode = options.mode || report?.mode || selectedReportMode.value
  const selectionId = ++generatedReportSelectionId.value
  if (isGeneratedReportSelectionStale(selectionMode, options.requestId, selectionId)) return

  if (isStandaloneGeneratedReportMode(selectionMode)) {
    activeTabId.value = 'welcome'
    selectedGeneratedReport.value = report
    const sessionId = await ensureStandaloneReportConversation(report, selectionMode)
    if (sessionId) {
      await leftPanelRef.value?.reloadAgentConversations?.()
    }
    return
  }

  if (!report?.sessionId) {
    console.warn('[MainContent] Generated report is missing sessionId:', report)
    message.error(t('messages.operationFailed'))
    return
  }

  const tab = ensureAgentTab({
    id: report.sessionId,
    title: report.conversationTitle || report.name || t('agent.chat'),
    type: 'chat',
    cwd: report.cwd || null,
    apiProfileId: report.apiProfileId || null,
    modelId: report.modelId || null
  })
  if (isGeneratedReportSelectionStale(selectionMode, options.requestId, selectionId)) return
  if (!tab) return

  activeTabId.value = tab.id
  await nextTick()
  if (isGeneratedReportSelectionStale(selectionMode, options.requestId, selectionId)) return

  const isReady = await waitForAgentTabReady(report.sessionId)
  if (isGeneratedReportSelectionStale(selectionMode, options.requestId, selectionId)) return

  const tabRef = await getAgentTabRef(report.sessionId)
  if (!isReady || !tabRef?.openReportInline) {
    console.warn('[MainContent] Failed to open generated report inline:', {
      sessionId: report.sessionId,
      isReady,
      hasTabRef: !!tabRef
    })
    message.error(t('messages.operationFailed'))
    return
  }

  if (isGeneratedReportSelectionStale(selectionMode, options.requestId, selectionId)) return
  const opened = await tabRef.openReportInline(report)
  if (isGeneratedReportSelectionStale(selectionMode, options.requestId, selectionId)) return
  if (!opened) {
    console.warn('[MainContent] Generated report inline preview failed:', report)
    message.error(t('messages.operationFailed'))
    return
  }

  selectedGeneratedReport.value = report
}

const handleStandaloneReportFollowupSend = async (payload) => {
  if (reportFollowupInFlight.value) return
  const report = selectedGeneratedReport.value
  const text = typeof payload === 'string' ? payload.trim() : String(payload?.text || '').trim()
  const hasFiles = typeof payload === 'object' && Array.isArray(payload?.files) && payload.files.length > 0
  const hasImages = typeof payload === 'object' && Array.isArray(payload?.images) && payload.images.length > 0
  if (!report?.filePath || (!text && !hasFiles && !hasImages)) return

  reportFollowupInFlight.value = true
  let dispatched = false
  try {
    const mode = report.mode || selectedReportMode.value
    const sessionId = await ensureStandaloneReportConversation(report, mode)
    if (!sessionId) return

    const tab = ensureAgentTab({
      id: sessionId,
      title: report.name || standaloneGeneratedReportTitle.value,
      type: 'chat',
      cwd: standaloneReportChatSessionCwd.value || null,
      apiProfileId: standaloneReportChatApiProfileId.value || null,
      modelId: standaloneReportChatModelId.value || null,
      source: 'report-followup',
      reportMode: mode,
      reportFilePath: report.filePath,
      preserveTitle: true,
      keepReportFollowupConversationVisible: true
    })
    if (!tab) return

    activeTabId.value = 'welcome'
    await nextTick()
    const isReady = await waitForAgentTabReady(sessionId)
    const tabRef = await getAgentTabRef(sessionId)
    if (!isReady || !tabRef?.sendInitialMessage) {
      message.error(t('messages.operationFailed'))
      return
    }

    const outgoingMessage = await buildStandaloneReportFollowupPayload(payload, report)
    await tabRef.sendInitialMessage(outgoingMessage)
    dispatched = true
    refreshStandaloneReportChatMessages({ scrollToBottom: true })
    window.setTimeout?.(() => {
      reportTimelineRef.value?.reloadMessages?.({ scrollToBottom: true })
    }, 400)
    reportTimelineInputRef.value?.focus?.()
  } catch (err) {
    console.error('[MainContent] Failed to send standalone report followup:', err)
    message.error(err?.message || t('messages.operationFailed'))
  } finally {
    if (!dispatched) {
      reportFollowupInFlight.value = false
    }
  }
}

const refreshGeneratedReports = async (mode = selectedReportMode.value, options = {}) => {
  if (!mode) {
    generatedReportsRequestId.value += 1
    generatedReports.value = []
    selectedGeneratedReport.value = null
    clearStandaloneReportChatSession()
    return []
  }

  const requestId = ++generatedReportsRequestId.value
  generatedReportsLoading.value = true
  try {
    const reportsResult = await listGeneratedReports({ mode })
    if (requestId !== generatedReportsRequestId.value || selectedReportMode.value !== mode) {
      return generatedReports.value
    }

    const nextReports = Array.isArray(reportsResult) ? reportsResult : []
    generatedReports.value = nextReports

    if (options.selectFirst && nextReports.length > 0) {
      await handleGeneratedReportSelected(getLatestGeneratedReport(generatedReports.value, mode), { mode, requestId })
    } else if (!nextReports.some(report => report.id === selectedGeneratedReport.value?.id)) {
      selectedGeneratedReport.value = null
      clearStandaloneReportChatSession()
    }

    return generatedReports.value
  } catch (err) {
    if (requestId !== generatedReportsRequestId.value || selectedReportMode.value !== mode) {
      return generatedReports.value
    }
    console.error('[MainContent] Failed to load generated reports:', err)
    message.error(t('messages.operationFailed'))
    generatedReports.value = []
    selectedGeneratedReport.value = null
    clearStandaloneReportChatSession()
    return []
  } finally {
    if (requestId === generatedReportsRequestId.value) {
      generatedReportsLoading.value = false
    }
  }
}

const STANDALONE_REPORT_CANONICAL_NAME_PATTERNS = {
  [DAILY_LEAD_REPORT_MODE]: /^\u65e5\u62a5\(/,
  [WEEKLY_REPORT_MODE]: /^\u5468\u62a5\(/,
  [MONTHLY_REPORT_MODE]: /^\u6708\u62a5\(/
}

const getReportDisplayNameForSort = (report = {}) => String(
  report?.name ||
  String(report?.filePath || '').split(/[\\/]/).filter(Boolean).pop()?.replace(/\.(?:md|pdf)$/i, '') ||
  ''
).trim()

const isCanonicalStandaloneReportName = (report, mode) => {
  const pattern = STANDALONE_REPORT_CANONICAL_NAME_PATTERNS[mode]
  return pattern ? pattern.test(getReportDisplayNameForSort(report)) : false
}

const getLatestGeneratedReport = (reports = [], mode = null) => {
  const sortedReports = [...(Array.isArray(reports) ? reports : [])]
    .sort((a, b) => Number(b?.updatedAt || b?.createdAt || 0) - Number(a?.updatedAt || a?.createdAt || 0))

  if (isStandaloneGeneratedReportMode(mode)) {
    return sortedReports.find(report => isCanonicalStandaloneReportName(report, mode)) || sortedReports[0] || null
  }

  return sortedReports[0] || null
}

const handleSelectReportMode = async (reportMode) => {
  const mode = typeof reportMode === 'string' ? reportMode : reportMode?.mode
  if (!isValidGeneratedReportMode(mode)) return

  generatedReportSelectionId.value += 1
  selectedReportMode.value = mode
  selectedGeneratedReport.value = null
  clearStandaloneReportChatSession()
  generatedReports.value = []
  if (isStandaloneGeneratedReportMode(mode)) {
    activeTabId.value = 'welcome'
  } else {
    showRightPanel.value = true
  }
  if (isProjectLeadReportMode(mode)) {
    selectedReportMode.value = null
    generatedReportsRequestId.value += 1
    generatedReportsLoading.value = false
    return
  }
  const shouldSelectFirst = isStandaloneGeneratedReportMode(mode)
  void refreshGeneratedReports(mode, { selectFirst: shouldSelectFirst })
}

const handleGeneratedReportDeleted = async (report) => {
  const filePath = typeof report === 'string' ? report : report?.filePath
  const reportMode = typeof report === 'object' && report?.mode ? report.mode : selectedReportMode.value
  if (!selectedReportMode.value || !filePath) return

  const reportName = typeof report === 'object' && report?.name ? report.name : filePath

  dialog.warning({
    title: t('common.confirmDelete'),
    content: `${t('agent.files.deleteConfirm')} "${reportName}"？`,
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        const result = await hideGeneratedReport({ mode: reportMode, filePath })
        if (result === false || result?.success === false) {
          const isReferencedReport = result?.error === 'report is referenced by conversation'
          message.warning(isReferencedReport ? '该报告已被会话引用，不能删除' : (result?.error || t('messages.operationFailed')))
          return
        }
        if (selectedGeneratedReport.value?.filePath === filePath) {
          selectedGeneratedReport.value = null
        }
        await refreshGeneratedReports(selectedReportMode.value, { selectFirst: true })
      } catch (err) {
        console.error('[MainContent] Failed to hide generated report:', err)
        message.error(t('messages.operationFailed'))
      }
    }
  })
}

const PROJECT_LEAD_REPORT_MODE = 'chat'
const DAILY_LEAD_REPORT_MODE = 'lead-report'
const WEEKLY_REPORT_MODE = 'weekly-report'
const MONTHLY_REPORT_MODE = 'monthly-report'
const STANDALONE_GENERATED_REPORT_MODES = new Set([DAILY_LEAD_REPORT_MODE, WEEKLY_REPORT_MODE, MONTHLY_REPORT_MODE])
const CURRENT_DAILY_LEAD_REPORT_PROMPT = '请根据前一天 00:00 至 23:59:59 期间的采集资料，按项目线索日报模板发现并核验清华系早期投资机会线索。请优先筛选前一天信号最强、清华系关联最明确、具备创业/成果转化/商业化早期迹象的高置信度早期投资信号，以前一天线索最多或置信度最高的方向作为主赛道，围绕最终选定的线索生成报告。'
const LEGACY_DAILY_LEAD_REPORT_PROMPT = '请根据当天采集资料，按项目线索日报模板发现并核验清华系早期投资机会线索。请优先筛选当天信号最强、清华系关联最明确、具备创业/成果转化/商业化早期迹象的主体，以当天线索最多或置信度最高的方向作为主赛道，生成最新日报。'
const DAILY_LEAD_REPORT_PROMPTS = [
  CURRENT_DAILY_LEAD_REPORT_PROMPT,
  LEGACY_DAILY_LEAD_REPORT_PROMPT
]

const isValidGeneratedReportMode = (mode) => mode === PROJECT_LEAD_REPORT_MODE || mode === 'clue' || STANDALONE_GENERATED_REPORT_MODES.has(mode)
const isProjectLeadReportMode = (mode) => mode === PROJECT_LEAD_REPORT_MODE
const isStandaloneGeneratedReportMode = (mode) => STANDALONE_GENERATED_REPORT_MODES.has(mode)
const getConversationReportMode = (conversation) => (
  conversation?.reportMode ||
  conversation?.report_mode ||
  conversation?.meta?.reportMode ||
  getStandaloneReportBindingForSessionId(getConversationSessionId(conversation))?.mode ||
  null
)

const isStandaloneReportModeSelected = computed(() => isStandaloneGeneratedReportMode(selectedReportMode.value) && activeTabId.value === 'welcome')

const standaloneGeneratedReportTitle = computed(() => {
  if (selectedReportMode.value === WEEKLY_REPORT_MODE) return '周报'
  if (selectedReportMode.value === MONTHLY_REPORT_MODE) return '月报'
  return '日报'
})

const standaloneReportInputPlaceholder = computed(() => {
  if (!selectedGeneratedReport.value) return `暂无${standaloneGeneratedReportTitle.value}可追问`
  return `基于当前${standaloneGeneratedReportTitle.value}追问`
})

const standaloneReportContextFiles = computed(() => {
  const report = selectedGeneratedReport.value
  if (!isStandaloneReportModeSelected.value || !report?.filePath) return []
  return [{
    id: report.id || report.filePath,
    name: report.name || report.filePath.split(/[\\/]/).pop() || `${standaloneGeneratedReportTitle.value}.md`,
    filePath: report.filePath,
    sizeText: 'Markdown'
  }]
})

const handleRemoveStandaloneReportContext = () => {
  // Standalone report follow-up always uses the currently previewed report as context.
}

const parseGeneratedReportMessageJson = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

const getGeneratedReportMessageFiles = (message) => {
  if (!message || typeof message !== 'object') return []
  if (Array.isArray(message.files) && message.files.length > 0) return message.files

  const parsed = parseGeneratedReportMessageJson(message.content)
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.files)) {
    return parsed.files
  }

  return []
}

const compactGeneratedReportText = (value) => String(value || '').replace(/\s+/g, '')

const containsDailyLeadReportPrompt = (value) => {
  const text = compactGeneratedReportText(value)
  return DAILY_LEAD_REPORT_PROMPTS
    .some(prompt => text.includes(compactGeneratedReportText(prompt)))
}

const isDailyLeadReportConversation = (conversation, messages = []) => {
  if (getConversationReportMode(conversation) === DAILY_LEAD_REPORT_MODE) return true
  if (conversation?.source !== 'scheduled') return false
  if (String(conversation?.title || '').includes('线索报告')) return true

  return (Array.isArray(messages) ? messages : []).some(message => (
    containsDailyLeadReportPrompt(message?.content) ||
    containsDailyLeadReportPrompt(message?.input) ||
    containsDailyLeadReportPrompt(message?.output)
  ))
}

const classifyGeneratedReportModeFromMessages = (messages = []) => {
  const firstUserMessage = (Array.isArray(messages) ? messages : []).find(item => item?.role === 'user')
  return getGeneratedReportMessageFiles(firstUserMessage).length > 0 ? 'clue' : 'chat'
}

const getConversationSessionId = (conversation) => {
  return conversation?.sessionId || conversation?.id || null
}

const getConversationReportFilePath = (conversation) => {
  const storedBinding = getStandaloneReportBindingForSessionId(getConversationSessionId(conversation))
  return String(
    conversation?.reportFilePath ||
    conversation?.report_file_path ||
    conversation?.filePath ||
    conversation?.file_path ||
    conversation?.meta?.reportFilePath ||
    storedBinding?.filePath ||
    ''
  ).trim()
}

const normalizeGeneratedReportPath = (filePath) => String(filePath || '').trim().replace(/\\/g, '/').toLowerCase()

const findGeneratedReportByPath = (reports, filePath) => {
  const targetPath = normalizeGeneratedReportPath(filePath)
  if (!targetPath) return null
  return (Array.isArray(reports) ? reports : []).find(report => normalizeGeneratedReportPath(report?.filePath) === targetPath) || null
}

const getGeneratedReportBaseName = (filePath) => String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || ''

const normalizeGeneratedReportName = (value) => String(value || '')
  .trim()
  .replace(/\.(?:md|pdf)$/i, '')
  .replace(/\s+/g, '')
  .toLowerCase()

const getConversationReportNameCandidates = (conversation) => {
  const candidates = [
    conversation?.title,
    conversation?.name,
    conversation?.reportName,
    conversation?.report_name,
    conversation?.meta?.reportName,
    getGeneratedReportBaseName(getConversationReportFilePath(conversation))
  ]
    .map(normalizeGeneratedReportName)
    .filter(Boolean)

  return [...new Set(candidates)]
}

const findGeneratedReportForConversation = (reports, conversation, filePath) => {
  const byPath = findGeneratedReportByPath(reports, filePath)
  if (byPath) return byPath

  const titleCandidates = getConversationReportNameCandidates(conversation)
  if (titleCandidates.length === 0) return null

  return (Array.isArray(reports) ? reports : []).find(report => {
    const reportNames = [
      report?.name,
      getGeneratedReportBaseName(report?.filePath)
    ].map(normalizeGeneratedReportName).filter(Boolean)

    return reportNames.some(name => titleCandidates.includes(name))
  }) || null
}

const buildConversationGeneratedReport = (conversation, mode, filePath) => {
  if (!filePath) return null
  return {
    id: `${mode}:${filePath}`,
    mode,
    filePath,
    name: conversation?.title || filePath.split(/[\\/]/).pop() || standaloneGeneratedReportTitle.value,
    sessionId: null,
    cwd: conversation?.cwd || null,
    apiProfileId: conversation?.apiProfileId || conversation?.api_profile_id || null,
    modelId: conversation?.modelId || conversation?.model_id || null,
    updatedAt: conversation?.updatedAt || conversation?.updated_at || Date.now(),
    createdAt: conversation?.createdAt || conversation?.created_at || Date.now()
  }
}

const restoreStandaloneGeneratedReportForConversation = async (conversation, mode, syncId, options = {}) => {
  const filePath = getConversationReportFilePath(conversation)

  if (options.refresh !== false) {
    await refreshGeneratedReports(mode)
  }
  if (syncId !== generatedReportModeSyncId.value || selectedReportMode.value !== mode) return true

  const report = findGeneratedReportForConversation(generatedReports.value, conversation, filePath) ||
    (filePath ? buildConversationGeneratedReport(conversation, mode, filePath) : null)
  if (!report) {
    selectedGeneratedReport.value = null
    clearStandaloneReportChatSession()
    return false
  }

  const reportFilePath = report.filePath || filePath
  if (options.activateWelcome !== false) {
    activeTabId.value = 'welcome'
  }
  selectedGeneratedReport.value = {
    ...report,
    mode,
    filePath: reportFilePath
  }
  applyStandaloneReportChatSession(
    {
      id: getConversationSessionId(conversation),
      cwd: conversation?.cwd || null,
      apiProfileId: conversation?.apiProfileId || conversation?.api_profile_id || null,
      modelId: conversation?.modelId || conversation?.model_id || null
    },
    getStandaloneReportConversationKey(reportFilePath, mode)
  )
  return true
}

const resolveGeneratedReportModeForConversation = async (conversation) => {
  const reportMode = getConversationReportMode(conversation)
  if (isValidGeneratedReportMode(reportMode)) {
    return reportMode
  }

  if (isDailyLeadReportConversation(conversation)) {
    return DAILY_LEAD_REPORT_MODE
  }

  const sessionId = getConversationSessionId(conversation)
  if (!sessionId || !window.electronAPI?.getAgentMessages) {
    return 'chat'
  }

  try {
    const messages = await window.electronAPI.getAgentMessages(sessionId)
    if (isDailyLeadReportConversation(conversation, messages)) {
      return DAILY_LEAD_REPORT_MODE
    }
    return classifyGeneratedReportModeFromMessages(messages)
  } catch (err) {
    console.warn('[MainContent] Failed to resolve generated report mode:', err)
    return 'chat'
  }
}

const syncGeneratedReportModeForConversation = async (conversation, options = {}) => {
  const sessionId = getConversationSessionId(conversation)
  if (!sessionId) return null

  const syncId = ++generatedReportModeSyncId.value
  const mode = await resolveGeneratedReportModeForConversation(conversation)
  if (syncId !== generatedReportModeSyncId.value || !isValidGeneratedReportMode(mode)) {
    return null
  }

  const activeTab = allTabs.value.find(tab => tab.sessionId === sessionId && tab.type === 'agent-chat')
  if (activeTab) {
    activeTab.reportMode = mode
  }

  if (isStandaloneGeneratedReportMode(mode)) {
    selectedReportMode.value = mode
    const restored = await restoreStandaloneGeneratedReportForConversation(conversation, mode, syncId, options)
    return restored ? mode : null
  }

  const modeChanged = selectedReportMode.value !== mode
  selectedReportMode.value = mode
  if (modeChanged) {
    selectedGeneratedReport.value = null
    generatedReports.value = []
  }

  if (isProjectLeadReportMode(mode)) {
    selectedReportMode.value = null
    generatedReportsRequestId.value += 1
    generatedReportsLoading.value = false
    return mode
  }

  if (options.refresh !== false) {
    await refreshGeneratedReports(mode)
  }

  return mode
}

const handleWelcomeOpenReport = async (report) => {
  if (!report?.filePath) return

  const sessionId = await ensureReportConversation(report)
  if (!sessionId) return

  touchReport(report.id || report.filePath)
  const tabRef = await getAgentTabRef(sessionId)
  await tabRef?.openReportInline?.(report)
}

const restoreReportFollowupConversationTab = async (conv) => {
  const sessionId = getConversationSessionId(conv)
  if (!sessionId) return false

  const mode = await syncGeneratedReportModeForConversation(conv)
  if (!isStandaloneGeneratedReportMode(mode)) return false

  activeTabId.value = 'welcome'
  await nextTick()
  reportTimelineInputRef.value?.focus?.()
  return true
}

const handleAgentSelected = async (conv) => {
  activePrimaryView.value = 'agent'
  if (conv?.source === 'report-followup' || isStandaloneGeneratedReportMode(getConversationReportMode(conv))) {
    const restored = await restoreReportFollowupConversationTab(conv)
    if (restored) return
  }

  const tab = ensureAgentTab(conv)
  if (tab) {
    activeTabId.value = tab.id
    syncGeneratedReportModeForConversation(conv)
  }
}

const handleAgentClosed = (conv) => {
  removeStandaloneReportConversationForSession(conv?.id || conv?.sessionId)
  const tab = allTabs.value.find(t => t.id === `agent-${conv.id}`)
  if (!tab) return

  closeAgentTabFully(tab)
  ensureActiveTabInCurrentMode()
}

const handleAgentProfileUpdated = ({ sessionId, apiProfileId, modelId }) => {
  if (!sessionId) return
  const tab = allTabs.value.find(item => item.sessionId === sessionId && item.type === 'agent-chat')
  if (!tab) return
  tab.apiProfileId = apiProfileId || null
  tab.modelId = modelId || null
}

// Notebook 模式事件处理
const handleNotebookSelect = (notebook) => {
  if (notebookWorkspaceRef.value?.loadNotebook) {
    notebookWorkspaceRef.value.loadNotebook(notebook)
  }
  currentNotebook.value = notebook
}

const handleNotebookCreated = (notebook) => {
  currentNotebook.value = notebook
  if (notebookWorkspaceRef.value?.handleNotebookCreated) {
    notebookWorkspaceRef.value.handleNotebookCreated(notebook)
  }
}

const handleNotebookRenamed = ({ id, name }) => {
  if (notebookWorkspaceRef.value?.handleRenamed) {
    notebookWorkspaceRef.value.handleRenamed({ id, name })
  }
}

const handleNotebookDeleted = (id) => {
  if (notebookWorkspaceRef.value?.handleDeleted) {
    notebookWorkspaceRef.value.handleDeleted(id)
  }
  if (currentNotebook.value?.id === id) {
    currentNotebook.value = null
  }
}

const handleAgentTabReady = ({ sessionId }) => {
  if (!sessionId) return
  agentTabReadySessionIds.value.add(sessionId)
  const resolvers = pendingAgentTabReadyResolvers.value.get(sessionId)
  if (!resolvers) return
  pendingAgentTabReadyResolvers.value.delete(sessionId)
  resolvers.forEach(resolve => resolve(true))
}

const handleAgentClearSession = async (sessionId) => {
  if (!sessionId || !window.electronAPI?.clearAndRecreateAgentSession) return

  try {
    const result = await window.electronAPI.clearAndRecreateAgentSession({ sessionId })
    if (!result?.success || !result.session) {
      throw new Error(result?.error || 'Failed to recreate session')
    }

    const oldTab = allTabs.value.find(t => t.sessionId === sessionId && t.type === 'agent-chat')
    if (oldTab) {
      closeAgentTabFully(oldTab)
    }

    const newTab = ensureAgentTab(result.session)
    if (newTab) {
      activeTabId.value = newTab.id
    }

    if (leftPanelRef.value?.activeAgentSessionId !== undefined) {
      leftPanelRef.value.activeAgentSessionId = result.session.id
    }

    await leftPanelRef.value?.reloadAgentConversations?.()
  } catch (err) {
    console.error('[MainContent] Failed to clear agent session:', err)
    message.error(t('messages.operationFailed') + ': ' + err.message)
  }
}

// 处理路径插入请求（Ctrl+点击文件）
const handleInsertPath = (relativePath) => {
  if (!activeTabId.value) return

  if (isDeveloperMode.value) {
    if (rightPanelRef.value && rightPanelRef.value.insertToInput) {
      rightPanelRef.value.insertToInput(relativePath)
    }
  } else if (isAgentMode.value) {
    const activeTabRef = agentChatTabRefs.value[activeTabId.value]
    if (activeTabRef && activeTabRef.insertText) {
      activeTabRef.insertText(relativePath + '\n')
    }
  }
}

// 处理图片预览请求
const handlePreviewImage = (previewData) => {
  // 确保右侧面板可见
  if (!showRightPanel.value) {
    showRightPanel.value = true
  }

  // 调用 AgentRightPanel 的预览方法并刷新文件树
  nextTick(() => {
    if (agentRightPanelRef.value) {
      if (agentRightPanelRef.value.previewImage) {
        agentRightPanelRef.value.previewImage(previewData)
      }
      if (agentRightPanelRef.value.refreshFiles) {
        agentRightPanelRef.value.refreshFiles()
      }
    }
  })
}

// 处理链接预览请求（URL）
const handlePreviewLink = (linkData) => {
  // 确保右侧面板可见
  if (!showRightPanel.value) {
    showRightPanel.value = true
  }

  // 调用 AgentRightPanel 的预览方法
  nextTick(() => {
    if (agentRightPanelRef.value && agentRightPanelRef.value.previewImage) {
      agentRightPanelRef.value.previewImage(linkData)
    }
  })
}

// 处理文件路径预览请求（仅响应当前激活会话，避免跨会话串台）
const handlePreviewPath = async (payload) => {
  const filePath = typeof payload === 'string' ? payload : payload?.filePath
  const sourceSessionId = typeof payload === 'string' ? activeAgentSessionId.value : payload?.sessionId

  if (!filePath || !sourceSessionId) return
  if (sourceSessionId !== activeAgentSessionId.value) return

  // 请求后端读取文件（只读预览，直接 confirmed=true，不弹安全确认框）
  try {
    const fileData = await window.electronAPI.readAbsolutePath({
      filePath,
      sessionId: sourceSessionId,
      confirmed: true
    })

    // 检查错误
    if (fileData.error) {
      message.error(fileData.error)
      return
    }

    // 如果是目录，直接打开文件夹
    const effectivePath = fileData.path || fileData.filePath || filePath

    if (fileData.type === 'directory') {
      await window.electronAPI.openPath(effectivePath)
      return
    }

    // 如果是文件，确保右侧面板可见并预览
    if (!showRightPanel.value) {
      showRightPanel.value = true
    }

    // 调用 AgentRightPanel 展示预览
    nextTick(async () => {
      if (!agentRightPanelRef.value) return
      // 优先尝试在文件树中定位（仅对 cwd 内的文件有效）
      const revealed = await agentRightPanelRef.value.revealInTree?.(effectivePath, { preview: true })
      // 如果文件不在 cwd 内（revealInTree 返回 false/undefined），直接展示预览
      if (!revealed) {
        agentRightPanelRef.value.previewImage?.({ ...fileData, isExternalFile: true })
      }
    })
  } catch (err) {
    console.error('Failed to preview file:', err)
    message.error(t('agent.files.errorLoading'))
  }
}

// Agent 完成：仅当前激活会话刷新文件树，并自动预览本轮最后一个文件
const handleAgentDone = async (payload = {}) => {
  const sourceSessionId = payload?.sessionId
  const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : []
  const payloadReportTitle = String(payload?.reportName || payload?.reportTitle || '').replace(/\s+/g, ' ').trim()

  if (!sourceSessionId) return
  const isStandaloneReportChatSource = (
    sourceSessionId === standaloneReportChatSessionId.value &&
    isStandaloneReportModeSelected.value
  )
  if (!isStandaloneReportChatSource && sourceSessionId !== activeAgentSessionId.value) return

  if (isStandaloneReportChatSource) {
    reportFollowupInFlight.value = false
    refreshStandaloneReportChatMessages({ scrollToBottom: true })
  }

  if (!filePaths.length) {
    return
  }

  const sourceTab = allTabs.value.find(tab => tab.sessionId === sourceSessionId && tab.type === 'agent-chat')
  const reportMode = isStandaloneReportChatSource
    ? selectedReportMode.value
    : await syncGeneratedReportModeForConversation(sourceTab || { id: sourceSessionId }, { refresh: false })
  let refreshedReports = []
  if (reportMode) {
    refreshedReports = await refreshGeneratedReports(reportMode, { selectFirst: true })
  }

  const matchingReport = refreshedReports.find(report => (
    report?.sessionId === sourceSessionId &&
    (!filePaths.length || filePaths.includes(report.filePath))
  )) || refreshedReports.find(report => report?.sessionId === sourceSessionId)
  const nextSessionTitle = payloadReportTitle || String(matchingReport?.name || '').replace(/\s+/g, ' ').trim()
  if (nextSessionTitle) {
    updateTabTitle(sourceSessionId, nextSessionTitle)
    try {
      await window.electronAPI?.renameAgentSession?.({
        sessionId: sourceSessionId,
        title: nextSessionTitle
      })
    } catch {}
    if (!isStandaloneReportChatSource) {
      await leftPanelRef.value?.reloadAgentConversations?.()
    }
  }

  if (isStandaloneReportChatSource) {
    return
  }

  if (!showRightPanel.value || !agentRightPanelRef.value) return

  await agentRightPanelRef.value.refreshFiles()

  for (let i = 0; i < filePaths.length; i++) {
    const isLast = i === filePaths.length - 1
    const revealed = await agentRightPanelRef.value.revealInTree(filePaths[i], { preview: isLast })
    // 如果文件不在 cwd 内（revealInTree 返回 false），且是最后一个，通过 handlePreviewPath 展示
    if (!revealed && isLast) {
      await handlePreviewPath({ filePath: filePaths[i], sessionId: sourceSessionId })
    }
  }
}

// Theme toggle handler
const handleToggleTheme = async () => {
  await toggleTheme()
}

// Open API Profile Manager
</script>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  width: 100vw;
  box-sizing: border-box;
  padding: 10px 12px 12px;
  background: var(--bg-color);
  color: var(--text-color);
  transition: all 0.3s ease;
  overflow: hidden;
}

/* Main Content */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--panel-bg);
  border-radius: var(--panel-radius);
  padding: 0;
  margin: 0 8px;
}

.main-content.right-panel-collapsed {
  margin-right: 0;
}

.main-content.notebook-main-content {
  margin: 0 0 0 8px;
}

.main-content.project-library-main-content {
  background: transparent;
  border-radius: 0;
  margin: 0;
}

.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 24px;
  box-sizing: border-box;
}

.settings-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(17, 24, 39, 0.42);
  backdrop-filter: blur(3px);
}

.settings-modal {
  position: relative;
  z-index: 1;
  width: 95%;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  background: var(--panel-bg);
  color: var(--text-color);
  box-shadow: 0 24px 72px rgba(0, 0, 0, 0.28);
}

.settings-modal-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 50px;
  padding: 0 20px 0 24px;
  border-bottom: 1px solid var(--border-color);
  background: var(--panel-bg);
}

.settings-modal-header h2 {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
  font-weight: 600;
}

.settings-modal-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--bg-color);
}

.settings-modal-body :deep(.model-settings) {
  height: 100%;
  min-height: 560px;
}

.settings-modal-body :deep(.settings-workbench) {
  min-height: 560px;
}

@media (max-width: 720px) {
  .settings-overlay {
    align-items: stretch;
    padding: 8px 12px;
  }

  .settings-modal {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 16px);
  }

  .settings-modal-header {
    padding: 0 12px 0 16px;
  }
}

.wechat-browser-overlay {
  position: fixed;
  inset: 0;
  z-index: 1600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(17, 24, 39, 0.78);
  backdrop-filter: blur(6px);
}

.wechat-browser-card {
  width: min(440px, 100%);
  box-sizing: border-box;
  padding: 28px;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  background: var(--panel-bg);
  color: var(--text-color);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.32);
}

.wechat-browser-mark {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-color);
  background: rgba(22, 163, 74, 0.12);
  border: 1px solid rgba(22, 163, 74, 0.24);
  margin-bottom: 18px;
}

.wechat-browser-card h2 {
  margin: 0;
  font-size: 24px;
  line-height: 1.25;
  font-weight: 700;
  color: var(--text-color);
}

.wechat-browser-desc {
  margin: 12px 0 0;
  color: var(--text-color-secondary);
  font-size: 14px;
  line-height: 1.65;
}

.wechat-browser-steps {
  margin: 18px 0 0;
  padding: 14px 16px 14px 34px;
  border-radius: 8px;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 14px;
  line-height: 1.7;
}

.wechat-browser-steps li + li {
  margin-top: 4px;
}

.wechat-browser-actions {
  display: flex;
  gap: 10px;
  margin-top: 22px;
}

.wechat-primary-btn {
  min-height: 40px;
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.wechat-primary-btn {
  flex: 1;
  background: var(--primary-color);
  color: #ffffff;
}

.wechat-primary-btn:hover {
  background: var(--primary-color-hover);
  border-color: var(--primary-color-hover);
  color: #ffffff;
}

@media (max-width: 520px) {
  .wechat-browser-overlay {
    padding: 16px;
    align-items: flex-start;
    overflow: auto;
  }

  .wechat-browser-card {
    padding: 22px;
    margin-top: 24px;
  }

  .wechat-browser-actions {
    flex-direction: column;
  }

  .wechat-primary-btn {
    width: 100%;
  }
}

.main-area {
  flex: 1;
  overflow: hidden;
  position: relative;
  background: var(--panel-bg);
  border: 1px solid var(--panel-border);
  border-top: none;
  border-radius: 0 0 var(--panel-radius) var(--panel-radius);
  box-shadow: none;
  margin-bottom: 0;
}

.main-area.project-library-main-area {
  background: transparent;
  border: 0;
  border-radius: 0;
}

.main-area.home-main-area {
  border-top: 1px solid var(--panel-border);
  border-radius: var(--panel-radius);
}

.notebook-main-area {
  background: transparent;
  border: none;
  border-radius: 0;
  margin-bottom: 0;
  padding: 0;
}

/* Empty State */
.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
  overflow: hidden;
}

.midea-home-state {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: var(--bg-color);
}

.midea-home-state :deep(.midea-monitor-content) {
  height: 100%;
}

.welcome-center {
  flex: 1;
  min-height: 0;
  width: min(720px, calc(100% - 72px));
  margin: 0 auto;
  padding: 36px 0 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.welcome-input-shell {
  flex-shrink: 0;
  width: 100%;
}

.welcome-input-shell :deep(.chat-input-area) {
  border-top-color: var(--panel-border);
}

.empty-state.lead-report-state {
  justify-content: stretch;
  text-align: initial;
}

.lead-report-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
}

.standalone-report-timeline {
  flex: 1;
  min-height: 0;
}

.standalone-report-input-shell {
  flex-shrink: 0;
  width: 100%;
}

.standalone-report-input-shell :deep(.chat-input-area) {
  border-top-color: var(--panel-border);
}

.standalone-report-input-shell :deep(.input-toolbar) {
  margin-bottom: 6px;
}

.pixel-mascot {
  margin-bottom: 24px;
  animation: float 3s ease-in-out infinite;
  color: var(--primary-color);
  opacity: 0.72;
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

.welcome-message {
  margin-bottom: 24px;
  text-align: center;
}

.welcome-message h2 {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text-color);
}

.welcome-message p {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-color-muted);
  max-width: 420px;
  margin: 0 auto;
}

.warning-box {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 20px;
  background: var(--warning-bg);
  border: 1px solid var(--border-color-light);
  border-radius: var(--panel-radius);
  margin-top: 24px;
  text-align: left;
}

.warning-icon {
  color: var(--warning-color);
  font-size: 20px;
  flex-shrink: 0;
}

.warning-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-color-secondary);
}

/* Mode Content Wrapper (v-show 切换，保持子组件活跃) */
.mode-content {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.notebook-mode-content {
  background: var(--bg-color);
}

.notebook-mode-content :deep(.notebook-workspace) {
  height: 100%;
  background: var(--bg-color);
}

/* Terminal Container */
.terminal-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden !important;
}

/* Agent Container */
.agent-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 4px;
}

/* Resize Handle */
.resize-handle {
  width: 1px;
  background: transparent;
  cursor: col-resize;
  flex-shrink: 0;
  position: relative;
}

.resize-handle::before {
  content: '';
  position: absolute;
  top: 0;
  left: -2px;
  right: -2px;
  bottom: 0;
  /* 扩大点击区域，方便拖动 */
}
</style>
