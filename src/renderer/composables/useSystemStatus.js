/**
 * System Status Notifications Composable
 * Manages transient system-level notifications (e.g., API retries, rate limits)
 * that should not clutter the chat conversation.
 */

import { ref, computed } from 'vue'

const activeNotifications = ref([])

export function useSystemStatus() {
  const addNotification = (notification) => {
    const id = notification.id || `notify-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    // 如果同 ID 的通知已存在，先移除（更新场景）
    const existingIdx = activeNotifications.value.findIndex(n => n.id === id)
    if (existingIdx !== -1) {
      activeNotifications.value.splice(existingIdx, 1)
    }

    const item = {
      id,
      message: notification.message,
      type: notification.type || 'info',
      timestamp: Date.now(),
      duration: notification.duration || 8000
    }
    activeNotifications.value.push(item)

    // 自动清除
    setTimeout(() => {
      removeNotification(id)
    }, item.duration)

    return id
  }

  const removeNotification = (id) => {
    const idx = activeNotifications.value.findIndex(n => n.id === id)
    if (idx !== -1) {
      activeNotifications.value.splice(idx, 1)
    }
  }

  const clearAll = () => {
    activeNotifications.value = []
  }

  const hasNotifications = computed(() => activeNotifications.value.length > 0)
  const latestNotification = computed(() =>
    activeNotifications.value[activeNotifications.value.length - 1]
  )

  return {
    activeNotifications,
    hasNotifications,
    latestNotification,
    addNotification,
    removeNotification,
    clearAll
  }
}
