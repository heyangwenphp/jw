/**
 * 应用模式管理组合式函数
 * 纯 Agent 模式
 */
import { ref, computed, readonly } from 'vue'

export const AppMode = {
  AGENT: 'agent',
  DEVELOPER: 'developer',
  NOTEBOOK: 'notebook'
}

const appMode = ref(AppMode.AGENT)
const initialized = ref(false)
let _settingsCleanup = null

export function useAppMode() {
  const isDeveloperMode = computed(() => false)
  const isAgentMode = computed(() => true)
  const isNotebookMode = computed(() => false)
  const developerModeEnabled = ref(false)

  const initMode = async () => {
    if (initialized.value) return

    try {
      if (window.electronAPI) {
        appMode.value = AppMode.AGENT
        await window.electronAPI.setMainWindowTitleByMode(AppMode.AGENT)
      }
    } catch (err) {
      console.error('[useAppMode] Failed to init:', err)
    }

    initialized.value = true
  }

  const switchMode = async () => {}

  const toggleMode = async () => {}

  const listenForChanges = () => {
    if (_settingsCleanup) return
    if (window.electronAPI?.onSettingsChanged) {
      _settingsCleanup = window.electronAPI.onSettingsChanged(async () => {
        appMode.value = AppMode.AGENT
      })
    }
  }

  listenForChanges()

  return {
    appMode: readonly(appMode),
    developerModeEnabled: readonly(developerModeEnabled),
    isDeveloperMode,
    isAgentMode,
    isNotebookMode,
    initMode,
    switchMode,
    toggleMode
  }
}
