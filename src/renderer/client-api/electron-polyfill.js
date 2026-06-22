/**
 * Electron API Polyfill for Web Version
 * Provides window.electronAPI compatibility so existing components work without changes.
 */

import {
  getConfig, saveConfig, updateSettings,
  getDingTalkStatus, startDingTalk, stopDingTalk, restartDingTalk, updateDingTalkConfig,
  onDingTalkStatusChange, onDingTalkError, onDingTalkMessageReceived, onDingTalkSessionCreated, onDingTalkSessionClosed,
  getFeishuStatus, startFeishu, stopFeishu, restartFeishu, updateFeishuConfig,
  onFeishuStatusChange, onFeishuError, onFeishuMessageReceived, onFeishuSessionCreated,
  authLogin, authGetCurrentUser, authLogout,
  listProjects,
  listProjectMasterRecords, createProjectMasterRecord, updateProjectMasterRecord, deleteProjectMasterRecord,
  listProjectLibraryWorkspaces, createProjectLibraryWorkspace, getProjectLibraryWorkspace,
  deleteProjectLibraryWorkspace, createProjectLibraryItem, uploadProjectLibraryFile, updateProjectLibraryItem, deleteProjectLibraryItem, bindProjectLibraryAgentSession, bindProjectLibraryItemAgentSession,
  listAPIProfiles, getAPIProfile, addAPIProfile, updateAPIProfile as apiUpdateAPIProfile, deleteAPIProfile,
  listProviders, addProvider, updateProvider, deleteProvider,
  testConnection,
  createAgentSession, sendAgentMessage, cancelAgentGeneration, closeAgentSession,
  reopenAgentSession, switchAgentApiProfile, getAgentSession, listAgentSessions,
  renameAgentSession, getAgentMessages, deleteAgentConversation,
  uploadAgentAttachment,
  createAgentConversationComponent,
  compactAgentConversation, clearAndRecreateAgentSession,
  respondAgentInteraction, cancelAgentInteraction,
  setAgentModel, getAgentSupportedModels, getAgentSupportedCommands,
  getAgentAccountInfo, getAgentMcpServerStatus, getAgentInitResult,
  getAgentOutputDir, listAgentOutputFiles,
  readAbsolutePath, readReportText,
  listWelcomeReports, listGeneratedReports, hideGeneratedReport,
  listMideaYqPushes, listMideaYqItems, getMideaYqPushDetail, getMideaYqItemDetail, retryMideaYqTask, processMideaYqTask, processMideaYqPush, processMideaYqItem, pushMideaYqItem,
  startWeixinNotifyLogin, waitWeixinNotifyLogin,
  listWeixinNotifyAccounts, listWeixinNotifyTargets,
  updateWeixinNotifyTarget, deleteWeixinNotifyTarget,
  pollWeixinNotifyOnce, sendWeixinNotifyText,
  bindSessionToWeixinTarget, unbindSessionWeixinTarget, getSessionWeixinBinding,
  onWeixinMessageReceived, onWeixinSessionCreated,
  listAgentDir, readAgentFile, saveAgentFile, createAgentFile,
  renameAgentFile, deleteAgentFile, searchAgentFiles,
  listSkillsAll,
  getSkillRawContent, createSkillRaw, updateSkillRaw, updateSkillVisibility, toggleSkillDisabled,
  deleteSkill, copySkill,
  validateSkillImport, importSkills, exportSkill, exportSkillsBatch,
  listAgentsAll,
  createAgentRaw, updateAgentRaw, getAgentRawContent, updateAgentVisibility, toggleAgentDisabled,
  deleteAgent, copyAgent, renameAgent,
  validateAgentImport, importAgents, exportAgent, exportAgentsBatch,
  resolveProjectAgentProfiles, saveProjectAgentProfile, deleteProjectAgentProfile,
  setDefaultProjectAgentProfile, toggleProjectAgentPinned,
  saveCapabilityProject, deleteCapabilityProject, selectCapabilityProject,
  onAgentInit, onAgentMessage, onAgentStream, onAgentResult,
  onAgentError, onAgentCliError, onAgentStatusChange,
  onAgentToolProgress, onAgentSystemStatus, onAgentOtherMessage,
  onAgentRenamed, onAgentCompacted, onAgentUsage,
  onAgentInteractionRequest, onAgentInteractionResolved,
  onAgentAllSessionsClosed,
  shell, dialog, notification, windowAPI
} from './api.js'

// No-op for features not available in web version
const noop = () => Promise.resolve({ success: true })
const noopArray = () => Promise.resolve([])
const noopCleanup = () => {}
const noopWithCallback = (...args) => {
  const last = args[args.length - 1]
  if (typeof last === 'function') last({ success: true })
  return Promise.resolve({ success: true })
}
const getMaxHistorySessions = async () => {
  const config = await getConfig()
  return config?.settings?.maxHistorySessions || 10
}
const updateMaxHistorySessions = maxHistorySessions => (
  updateSettings({ maxHistorySessions })
)
const updateAPIProfileBridge = (payload, maybeUpdates) => {
  const profileId = payload && typeof payload === 'object' ? payload.profileId : payload
  const updates = payload && typeof payload === 'object' ? payload.updates : maybeUpdates
  return apiUpdateAPIProfile(profileId, updates)
}

export function installElectronPolyfill() {
  if (window.electronAPI) {
    console.log('[Polyfill] window.electronAPI already exists, skipping')
    return
  }

  window.electronAPI = {
    // Bootstrap
    bootstrap: {
      theme: 'light',
      colorScheme: 'ocean',
      locale: 'zh-CN'
    },
    platform: 'web',
    supportsIMBridge: true,

    // Config
    getConfig,
    saveConfig,
    updateSettings,
    getConfigPath: noop,
    getMaxHistorySessions,
    updateMaxHistorySessions,
    authLogin,
    authGetCurrentUser,
    authLogout,

    // Service Providers
    getServiceProviders: listProviders,

    // API Profiles
    listAPIProfiles,
    getAPIProfile,
    addAPIProfile,
    updateAPIProfile: updateAPIProfileBridge,
    deleteAPIProfile,
    setDefaultProfile: noop,
    getCurrentProfile: noop,

    // Connection Test
    testConnection,
    fetchOfficialModels: noop,

    // Providers
    listProviders,
    addProvider,
    updateProvider,
    deleteProvider,

    // Agent Sessions
    createAgentSession,
    sendAgentMessage,
    cancelAgentGeneration,
    closeAgentSession,
    reopenAgentSession,
    switchAgentApiProfile,
    getAgentSession,
    listAgentSessions,
    renameAgentSession,
    getAgentMessages,
    deleteAgentConversation,
    uploadAgentAttachment,
    createAgentConversationComponent,
    compactAgentConversation,
    clearAndRecreateAgentSession,

    // Agent Interactions
    respondAgentInteraction,
    cancelAgentInteraction,

    // Agent Streaming Control
    setAgentModel,
    getAgentSupportedModels,
    getAgentSupportedCommands,
    getAgentAccountInfo,
    getAgentMcpServerStatus,
    getAgentInitResult,

    // Agent Output
    getAgentOutputDir,
    openAgentOutputDir: noop,
    listAgentOutputFiles,
    listWelcomeReports,
    listGeneratedReports,
    hideGeneratedReport,
    listMideaYqPushes,
    listMideaYqItems,
    getMideaYqPushDetail,
    getMideaYqItemDetail,
    retryMideaYqTask,
    processMideaYqTask,
    processMideaYqPush,
    processMideaYqItem,
    pushMideaYqItem,

    // Agent File Operations
    listAgentDir,
    readAgentFile,
    saveAgentFile,
    createAgentFile,
    renameAgentFile,
    deleteAgentFile,
    searchAgentFiles,
    openAgentFile: noop,
    readAbsolutePath,
    readReportText,
    saveAbsoluteFile: noop,

    // Shell
    openExternal: shell.openExternal,
    openPath: shell.openPath,
    resolvePath: noop,
    pathExists: noop,

    // Dialog
    selectFolder: dialog.selectFolder,
    selectDirectory: dialog.selectDirectory,
    selectFile: dialog.selectFile,
    selectFiles: dialog.selectFiles,
    saveFile: dialog.saveFile,
    saveImage: dialog.saveImage,
    showNotification: notification.show,

    // Window (no-op in web, but emit events for web version)
    openProfileManager: windowAPI.openProfileManager,
    openGlobalSettings: () => {
      window.dispatchEvent(new CustomEvent('web:open-settings', { detail: { type: 'global' } }))
      return Promise.resolve({ success: true })
    },
    openAppearanceSettings: () => {
      window.dispatchEvent(new CustomEvent('web:open-settings', { detail: { type: 'appearance' } }))
      return Promise.resolve({ success: true })
    },
    openSettingsWorkbench: (options = {}) => {
      window.dispatchEvent(new CustomEvent('web:open-settings', { detail: { type: 'capability', tab: options?.tab } }))
      return Promise.resolve({ success: true })
    },
    openIMBotSettings: () => {
      window.dispatchEvent(new CustomEvent('web:open-settings', { detail: { type: 'im' } }))
      return Promise.resolve({ success: true })
    },
    openProviderManager: windowAPI.openProviderManager,
    openSessionManager: windowAPI.openSessionManager,
    openUpdateManager: windowAPI.openUpdateManager,
    openDingTalkSettings: windowAPI.openDingTalkSettings,
    openNotebookWorkspace: windowAPI.openNotebookWorkspace,
    openModelSettings: () => {
      window.dispatchEvent(new CustomEvent('web:open-settings', { detail: { type: 'model' } }))
      return Promise.resolve({ success: true })
    },
    openProjectManagement: () => {
      window.dispatchEvent(new CustomEvent('web:open-settings', { detail: { type: 'project' } }))
      return Promise.resolve({ success: true })
    },
    closeWindow: windowAPI.closeWindow,
    focusMainWindow: windowAPI.focusMainWindow,
    setMainWindowTitleByMode: windowAPI.setMainWindowTitleByMode,

    // Agent Event Listeners
    onAgentInit,
    onAgentMessage,
    onAgentStream,
    onAgentResult,
    onAgentError,
    onAgentCliError,
    onAgentStatusChange,
    onAgentToolProgress,
    onAgentSystemStatus,
    onAgentOtherMessage,
    onAgentRenamed,
    onAgentCompacted,
    onAgentUsage,
    onAgentInteractionRequest,
    onAgentInteractionResolved,
    onAgentAllSessionsClosed,

    // DingTalk
    getDingTalkStatus,
    startDingTalk,
    stopDingTalk,
    restartDingTalk,
    updateDingTalkConfig,
    onDingTalkStatusChange,
    onDingTalkError,
    onDingTalkMessageReceived,
    onDingTalkSessionCreated,
    onDingTalkSessionClosed,

    // Weixin
    onWeixinMessageReceived,
    onWeixinSessionCreated,

    // Feishu
    getFeishuStatus,
    startFeishu,
    stopFeishu,
    restartFeishu,
    updateFeishuConfig,
    onFeishuStatusChange,
    onFeishuError,
    onFeishuMessageReceived,
    onFeishuSessionCreated,

    // Terminal (not available in web)
    startTerminal: noop,
    writeTerminal: noop,
    resizeTerminal: noop,
    killTerminal: noop,
    getTerminalStatus: noop,
    getTerminalSettings: noop,
    saveTerminalSettings: noop,
    onTerminalData: noopCleanup,
    onTerminalExit: noopCleanup,
    onTerminalError: noopCleanup,

    // Active Session (not available in web)
    createActiveSession: noop,
    closeActiveSession: noop,
    disconnectActiveSession: noop,
    listActiveSessions: noopArray,
    getActiveSession: noop,
    getActiveSessionsByProject: noopArray,
    writeActiveSession: noop,
    resizeActiveSession: noop,
    focusActiveSession: noop,
    getFocusedActiveSession: noop,
    setActiveSessionVisible: noop,
    getRunningSessionCount: noop,
    getSessionLimits: noop,
    renameActiveSession: noop,
    onSessionData: noopCleanup,
    onSessionStarted: noopCleanup,
    onSessionExit: noopCleanup,
    onSessionError: noopCleanup,
    onSessionUpdated: noopCleanup,

    // Notebook (not available in web)
    notebookCreate: noop,
    notebookList: noopArray,
    notebookGet: noop,
    notebookRename: noop,
    notebookDelete: noop,
    notebookBindSession: noop,
    notebookUpdateApiProfile: noop,
    notebookUpdateSelectedModel: noop,
    notebookRestartSession: noop,
    notebookListSources: noopArray,
    notebookAddSource: noop,
    notebookImportFiles: noop,
    notebookUpdateSource: noop,
    notebookDeleteSource: noop,
    notebookDeleteSources: noop,
    notebookListAchievements: noopArray,
    notebookAddAchievement: noop,
    notebookUpdateAchievement: noop,
    notebookDeleteAchievement: noop,
    notebookDeleteAchievements: noop,
    notebookAddAchievementToSource: noop,
    notebookExportAchievement: noop,
    notebookReadFileContent: noop,
    notebookWriteFileContent: noop,
    notebookCopyImageToClipboard: noop,
    notebookSaveChatImageToSource: noop,
    notebookSaveChatImageToAchievement: noop,
    notebookSaveChatMarkdownToSource: noop,
    notebookSaveChatMarkdownToAchievement: noop,
    notebookFinalizeAchievementText: noop,
    notebookSetCopySourceFiles: noop,
    notebookSanitizeIndexes: noop,
    notebookAddPathToSource: noop,
    notebookAddPathToAchievement: noop,
    notebookExportSource: noop,
    notebookListTools: noopArray,
    notebookUpdateTool: noop,
    notebookAddTool: noop,
    notebookDeleteTool: noop,
    notebookFetchRemoteTools: noop,
    notebookFetchPromptTemplateContent: noop,
    notebookPrepareGeneration: noop,
    notebookPreviewGeneration: noop,
    notebookInstallTool: noop,
    notebookUninstallTool: noop,

    // Plugin (not available in web)
    listPlugins: noopArray,
    getPluginDetails: noop,
    setPluginEnabled: noop,
    openPluginsFolder: noop,
    openInstalledPluginsJson: noop,
    openSettingsJson: noop,
    pluginCliListAvailable: noop,
    pluginCliInstall: noop,
    pluginCliUninstall: noop,
    pluginCliUpdate: noop,
    pluginCliListMarketplaces: noop,
    pluginCliAddMarketplace: noop,
    pluginCliRemoveMarketplace: noop,
    pluginCliUpdateMarketplace: noop,

    // Skills
    listSkillsGlobal: noopArray,
    listSkillsProject: noopArray,
    listSkillsAll,
    deleteSkill,
    copySkill,
    getSkillRawContent,
    createSkillRaw,
    updateSkillRaw,
    updateSkillVisibility,
    toggleSkillDisabled,
    openSkillsFolder: noop,
    validateSkillImport,
    checkSkillConflicts: noop,
    importSkills,
    exportSkill,
    exportSkillsBatch,
    fetchMarketIndex: noop,
    installMarketSkill: noop,
    installMarketSkillForce: noop,
    checkMarketUpdates: noop,
    updateMarketSkill: noop,
    listMarketInstalled: noopArray,

    // Agents (not available in web)
    listAgentsUser: noopArray,
    listAgentsProject: noopArray,
    listAgentsPlugin: noopArray,
    listAgentsAll,
    getAgentRawContent,
    createAgentRaw,
    updateAgentRaw,
    updateAgentVisibility,
    toggleAgentDisabled,
    deleteAgent,
    copyAgent,
    renameAgent,
    openAgentsFolder: noop,
    validateAgentImport,
    checkAgentConflicts: noop,
    importAgents,
    exportAgent,
    exportAgentsBatch,
    installMarketAgent: noop,
    installMarketAgentForce: noop,
    listMarketInstalledAgents: noopArray,
    checkAgentMarketUpdates: noop,
    updateMarketAgent: noop,

    // Hooks (not available in web)
    listHooksGlobal: noopArray,
    listHooksProject: noopArray,
    listHooksAll: noopArray,
    getHooksSchema: noop,
    createHook: noop,
    updateHook: noop,
    deleteHook: noop,
    copyHook: noop,
    getHooksJson: noop,
    saveHooksJson: noop,

    // MCP (not available in web)
    listMcpAll: noopArray,
    listMcpUser: noopArray,
    listMcpLocal: noopArray,
    listMcpProject: noopArray,
    listMcpPlugin: noopArray,
    createMcp: noop,
    updateMcp: noop,
    deleteMcp: noop,
    installMarketMcp: noop,
    installMarketMcpForce: noop,
    previewMarketMcpConfig: noop,
    updateMarketMcp: noop,
    getMcpProxyConfig: noop,
    updateMcpProxyConfig: noop,
    ensureProxySupport: noop,
    applyProxyToAllMcps: noop,

    // Claude Settings (not available in web)
    getClaudeSettings: noop,
    getClaudePermissions: noop,
    addClaudePermission: noop,
    updateClaudePermission: noop,
    removeClaudePermission: noop,
    getClaudeEnv: noop,
    setClaudeEnv: noop,
    removeClaudeEnv: noop,
    getClaudeSettingsRaw: noop,
    saveClaudeSettingsRaw: noop,
    getClaudeSettingsPath: noop,
    getProjectConfigPath: noop,

    // File Operations (not available in web)
    openFileInEditor: noop,
    readJsonFile: noop,
    writeJsonFile: noop,
    readFile: noop,
    writeFile: noop,

    // Session History (not available in web)
    syncSessions: noop,
    forceFullSync: noop,
    getSyncStatus: noop,
    clearInvalidSessions: noop,
    getSessionProjects: noopArray,
    getProjectSessions: noopArray,
    getSessionMessages: noopArray,
    getFileBasedSessions: noopArray,
    deleteSessionFile: noop,
    getProjectSessionsFromDb: noopArray,
    syncProjectSessions: noop,
    updateSessionTitle: noop,
    deleteSessionWithFile: noop,
    searchSessions: noop,
    exportSession: noop,
    getSessionStats: noop,

    // Tags (not available in web)
    createTag: noop,
    getAllTags: noopArray,
    deleteTag: noop,
    addTagToSession: noop,
    removeTagFromSession: noop,
    getSessionTags: noopArray,
    getSessionsByTag: noopArray,
    addTagToMessage: noop,
    removeTagFromMessage: noop,
    getMessageTags: noopArray,
    getMessagesByTag: noopArray,
    getSessionTaggedMessages: noopArray,

    // Prompts (not available in web)
    listPrompts: noopArray,
    getPrompt: noop,
    getPromptByMarketId: noop,
    createPrompt: noop,
    updatePrompt: noop,
    deletePrompt: noop,
    incrementPromptUsage: noop,
    togglePromptFavorite: noop,
    installMarketPrompt: noop,
    installMarketPromptForce: noop,
    listMarketInstalledPrompts: noopArray,
    updateMarketPrompt: noop,
    listPromptTags: noopArray,
    createPromptTag: noop,
    updatePromptTag: noop,
    deletePromptTag: noop,
    addTagToPrompt: noop,
    removeTagFromPrompt: noop,

    // Favorites (not available in web)
    addFavorite: noop,
    removeFavorite: noop,
    checkFavorite: noop,
    getAllFavorites: noopArray,
    updateFavoriteNote: noop,

    // Queue (not available in web)
    getQueue: noopArray,
    addToQueue: noop,
    updateQueueItem: noop,
    deleteQueueItem: noop,
    clearQueue: noop,
    swapQueueOrder: noop,

    // Quick Commands (not available in web)
    getQuickCommands: noopArray,
    addQuickCommand: noop,
    updateQuickCommand: noop,
    deleteQuickCommand: noop,

    // Project (not available in web)
    getProjects: listProjects,
    listProjectMasterRecords,
    createProjectMasterRecord,
    updateProjectMasterRecord,
    deleteProjectMasterRecord,
    listProjectLibraryWorkspaces,
    createProjectLibraryWorkspace,
    getProjectLibraryWorkspace,
    deleteProjectLibraryWorkspace,
    createProjectLibraryItem,
    uploadProjectLibraryFile,
    updateProjectLibraryItem,
    deleteProjectLibraryItem,
    bindProjectLibraryAgentSession,
    bindProjectLibraryItemAgentSession,
    getHiddenProjects: noopArray,
    getProjectById: noop,
    createProject: noop,
    openProject: noop,
    updateProject: noop,
    duplicateProject: noop,
    hideProject: noop,
    unhideProject: noop,
    deleteProject: noop,
    toggleProjectPinned: noop,
    touchProject: noop,
    openFolder: noop,
    checkPath: noop,
    newProjectSession: noop,
    openProjectSession: noop,

    // Project Files (not available in web)
    listProjectDir: noopArray,
    readProjectFile: noop,
    readOfficeFile: noop,
    saveProjectFile: noop,
    createProjectFile: noop,
    renameProjectFile: noop,
    deleteProjectFile: noop,
    searchProjectFiles: noop,

    // Capabilities
    fetchCapabilities: async (projectPath = null) => {
      try {
        const [skillsResult, agentsResult] = await Promise.all([
          listSkillsAll(projectPath),
          listAgentsAll(projectPath)
        ])
        const skills = [
          ...(skillsResult?.project || []),
          ...(skillsResult?.user || []),
          ...(skillsResult?.public || []),
          ...(skillsResult?.official || []),
          ...(skillsResult?.builtIn || [])
        ]
        const agents = [
          ...(agentsResult?.project || []),
          ...(agentsResult?.user || []),
          ...(agentsResult?.public || []),
          ...(agentsResult?.plugin || []),
          ...(agentsResult?.builtIn || [])
        ]
        return {
          success: true,
          capabilities: [
            ...agents.map(agent => ({
              type: 'agent',
              installed: true,
              disabled: Boolean(agent.disabled),
              source: agent.source,
              componentId: agent.id,
              id: agent.id,
              name: agent.name || agent.id,
              description: agent.description || ''
            })),
            ...skills.map(skill => ({
              type: 'skill',
              installed: true,
              disabled: Boolean(skill.disabled),
              source: skill.source,
              componentId: skill.id,
              id: skill.id,
              name: skill.name || skill.id,
              description: skill.description || ''
            }))
          ]
        }
      } catch (err) {
        console.error('[Polyfill] fetchCapabilities error:', err)
        return { success: true, capabilities: [] }
      }
    },
    getPluginDetails: noop,
    installCapability: noop,
    uninstallCapability: noop,
    enableCapability: noop,
    disableCapability: noop,
    toggleComponentDisabled: async (type, id, disabled) => {
      if (type === 'skill') {
        return toggleSkillDisabled({ skillId: id, disabled })
      }
      if (type === 'agent') {
        return toggleAgentDisabled({ agentId: id, disabled })
      }
      return { success: false, error: `Unsupported component type: ${type}` }
    },
    checkCapabilityInstalled: noop,
    getCapabilitiesUpdateStatus: noop,
    clearCapabilitiesUpdateBadge: noop,
    checkComponentsBatchStatus: noopArray,
    onCapabilitiesUpdateAvailable: noopCleanup,

    // Project Agent Profiles
    resolveProjectAgentProfiles,
    saveProjectAgentProfile,
    deleteProjectAgentProfile,
    setDefaultProjectAgentProfile,
    toggleProjectAgentPinned,
    saveCapabilityProject,
    deleteCapabilityProject,
    selectCapabilityProject,

    // Update (not available in web)
    checkForUpdates: noop,
    downloadUpdate: noop,
    quitAndInstall: noop,
    getAppVersion: noop,
    getUpdateStatus: noop,
    getInstallError: noop,
    onUpdateChecking: noopCleanup,
    onUpdateAvailable: noopCleanup,
    onUpdateNotAvailable: noopCleanup,
    onUpdateDownloadProgress: noopCleanup,
    onUpdateDownloaded: noopCleanup,
    onUpdateError: noopCleanup,
    onUpdateNeedRedownload: noopCleanup,
    onUpdateInstallFailed: noopCleanup,

    // Weixin Notify
    startWeixinNotifyLogin,
    waitWeixinNotifyLogin,
    listWeixinNotifyAccounts,
    listWeixinNotifyTargets,
    updateWeixinNotifyTarget,
    deleteWeixinNotifyTarget,
    pollWeixinNotifyOnce,
    sendWeixinNotifyText,
    bindSessionToWeixinTarget,
    unbindSessionWeixinTarget,
    getSessionWeixinBinding,

    // Scheduled Tasks (not available in web)
    listScheduledTasks: noopArray,
    createScheduledTask: noop,
    updateScheduledTask: noop,
    deleteScheduledTask: noop,
    runScheduledTaskNow: noop,
    listScheduledTaskRuns: noopArray,
    onScheduledTaskChanged: noopCleanup,

    // Background Tasks (not available in web)
    getBackgroundTasks: noopArray,
    getRunningBackgroundTasks: noopArray,
    cancelBackgroundTask: noop,
    clearCompletedBackgroundTasks: noop,
    onBackgroundTasksUpdate: noopCleanup,

    // Session Watcher (not available in web)
    watchSessionFiles: noop,
    stopWatchingSessionFiles: noop,
    onSessionFileChanged: noopCleanup,

    // Settings broadcast (no-op in web)
    broadcastSettings: noop,
    onSettingsChanged: noopCleanup,
    onSwitchSettingsTab: noopCleanup,

    // Queue persistence (not available in web)
    saveAgentQueue: noop,
    getAgentQueue: noop,

    // Claude Code executable (not available in web)
    getClaudeExecutablePath: noop,

    // App
    clearAllData: noop,
    getHomedir: () => '',
  }

  console.log('[Polyfill] window.electronAPI installed for web version')
}
