/**
 * Background Tasks Composable
 * Manages background task state in the renderer process.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'

const tasks = ref([])
const cleanupFn = ref(null)

export function useBackgroundTasks() {
  const runningTasks = computed(() =>
    tasks.value.filter(t => t.status === 'running')
  )

  const completedTasks = computed(() =>
    tasks.value.filter(t => t.status === 'completed')
  )

  const failedTasks = computed(() =>
    tasks.value.filter(t => t.status === 'failed')
  )

  const hasRunningTasks = computed(() => runningTasks.value.length > 0)
  const hasFailedTasks = computed(() => failedTasks.value.length > 0)
  const taskCount = computed(() => tasks.value.length)

  const recentTasks = computed(() => {
    // Show running first, then failed, then completed
    const sorted = [...tasks.value].sort((a, b) => {
      const statusOrder = { running: 0, failed: 1, completed: 2, cancelled: 3 }
      const orderDiff = statusOrder[a.status] - statusOrder[b.status]
      if (orderDiff !== 0) return orderDiff
      return b.startTime - a.startTime
    })
    return sorted.slice(0, 20) // Limit to 20 most recent
  })

  const loadTasks = async () => {
    if (!window.electronAPI?.getBackgroundTasks) return
    try {
      const result = await window.electronAPI.getBackgroundTasks()
      tasks.value = result || []
    } catch (err) {
      console.error('[useBackgroundTasks] Failed to load tasks:', err)
    }
  }

  const cancelTask = async (taskId) => {
    if (!window.electronAPI?.cancelBackgroundTask) return
    try {
      await window.electronAPI.cancelBackgroundTask(taskId)
    } catch (err) {
      console.error('[useBackgroundTasks] Failed to cancel task:', err)
    }
  }

  const clearCompleted = async () => {
    if (!window.electronAPI?.clearCompletedBackgroundTasks) return
    try {
      await window.electronAPI.clearCompletedBackgroundTasks()
    } catch (err) {
      console.error('[useBackgroundTasks] Failed to clear completed:', err)
    }
  }

  const formatDuration = (task) => {
    const end = task.endTime || Date.now()
    const duration = end - task.startTime
    if (duration < 1000) return '< 1s'
    if (duration < 60000) return `${Math.floor(duration / 1000)}s`
    const minutes = Math.floor(duration / 60000)
    const seconds = Math.floor((duration % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  const setupListener = () => {
    if (!window.electronAPI?.onBackgroundTasksUpdate) return

    cleanupFn.value = window.electronAPI.onBackgroundTasksUpdate((updatedTasks) => {
      tasks.value = updatedTasks || []
    })
  }

  onMounted(() => {
    loadTasks()
    setupListener()
  })

  onUnmounted(() => {
    if (cleanupFn.value) {
      cleanupFn.value()
      cleanupFn.value = null
    }
  })

  return {
    tasks,
    runningTasks,
    completedTasks,
    failedTasks,
    hasRunningTasks,
    hasFailedTasks,
    taskCount,
    recentTasks,
    loadTasks,
    cancelTask,
    clearCompleted,
    formatDuration,
    formatTime
  }
}
