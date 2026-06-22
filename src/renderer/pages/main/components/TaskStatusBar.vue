<template>
  <div class="task-status-bar" :class="{ 'has-tasks': hasVisibleTasks, expanded: isExpanded }">
    <!-- Collapsed state: status indicator bar -->
    <div v-if="!isExpanded" class="status-bar-collapsed" @click="toggleExpand">
      <div class="status-left">
        <!-- 系统通知优先显示（如 API 重试） -->
        <div v-if="hasNotifications" class="status-indicator warning">
          <div class="warning-dot"></div>
          <span class="status-text">{{ latestNotification.message }}</span>
        </div>
        <div v-else-if="hasRunningTasks" class="status-indicator running">
          <div class="pulse-dot"></div>
          <span class="status-text">{{ runningTasks.length }} 个任务运行中</span>
        </div>
        <div v-else-if="hasFailedTasks" class="status-indicator failed">
          <div class="error-dot"></div>
          <span class="status-text">{{ failedTasks.length }} 个任务失败</span>
        </div>
        <div v-else-if="completedTasks.length > 0" class="status-indicator completed">
          <div class="success-dot"></div>
          <span class="status-text">最近 {{ completedTasks.length }} 个任务已完成</span>
        </div>
      </div>
      <div v-if="hasVisibleTasks" class="status-right">
        <span class="expand-hint">点击展开</span>
      </div>
    </div>

    <!-- Expanded state: task list panel -->
    <div v-else class="task-panel">
      <div class="task-panel-header">
        <span class="panel-title">后台任务</span>
        <div class="panel-actions">
          <button v-if="hasCompletedOrFailed" class="action-btn" @click="handleClear">
            清除已完成
          </button>
          <button class="action-btn close-btn" @click="toggleExpand">
            收起
          </button>
        </div>
      </div>

      <div class="task-list">
        <div
          v-for="task in recentTasks"
          :key="task.id"
          class="task-item"
          :class="task.status"
        >
          <div class="task-icon">
            <div v-if="task.status === 'running'" class="spinner"></div>
            <span v-else-if="task.status === 'completed'" class="status-icon success">&#x2713;</span>
            <span v-else-if="task.status === 'failed'" class="status-icon error">&#x2717;</span>
            <span v-else class="status-icon cancelled">&#x25CB;</span>
          </div>
          <div class="task-info">
            <div class="task-description">{{ task.description }}</div>
            <div class="task-meta">
              <span class="task-time">{{ formatTime(task.startTime) }}</span>
              <span class="task-duration">{{ formatDuration(task) }}</span>
              <span v-if="task.error" class="task-error" :title="task.error">{{ task.error }}</span>
            </div>
          </div>
          <div class="task-actions">
            <button
              v-if="task.status === 'running'"
              class="cancel-btn"
              @click="cancelTask(task.id)"
              title="取消任务"
            >
              &#x2715;
            </button>
          </div>
        </div>

        <div v-if="recentTasks.length === 0" class="task-empty">
          暂无后台任务
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useBackgroundTasks } from '@composables/useBackgroundTasks'
import { useSystemStatus } from '@composables/useSystemStatus'

const props = defineProps({
  isExpanded: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:isExpanded'])

const {
  runningTasks,
  completedTasks,
  failedTasks,
  hasRunningTasks,
  hasFailedTasks,
  recentTasks,
  cancelTask,
  clearCompleted,
  formatDuration,
  formatTime
} = useBackgroundTasks()

const {
  hasNotifications,
  latestNotification
} = useSystemStatus()

const hasVisibleTasks = computed(() =>
  hasNotifications.value || hasRunningTasks.value || hasFailedTasks.value || completedTasks.value.length > 0
)

const hasCompletedOrFailed = computed(() =>
  completedTasks.value.length > 0 || failedTasks.value.length > 0
)

const toggleExpand = () => {
  emit('update:isExpanded', !props.isExpanded)
}

const handleClear = async () => {
  await clearCompleted()
}
</script>

<style scoped>
.task-status-bar {
  flex-shrink: 0;
  transition: all 0.2s ease;
}

/* Collapsed state */
.status-bar-collapsed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 12px;
  background: var(--panel-bg, #fafaf8);
  border-top: 1px solid var(--panel-border, #e8e8e3);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-color-muted, #888);
  transition: background 0.15s ease;
}

.status-bar-collapsed:hover {
  background: var(--hover-bg, #f0f0ec);
}

.status-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-text {
  font-weight: 500;
}

.status-indicator.running .status-text {
  color: var(--success-color, #18a058);
}

.status-indicator.failed .status-text {
  color: var(--error-color, #d03050);
}

.status-indicator.completed .status-text {
  color: var(--text-color-muted, #888);
}

.status-indicator.warning .status-text {
  color: var(--warning-color, #f0a020);
}

.expand-hint {
  font-size: 11px;
  opacity: 0.6;
}

/* Pulse dot animation */
.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-color, #18a058);
  animation: pulse 1.5s ease-in-out infinite;
}

.error-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--error-color, #d03050);
}

.success-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success-color, #18a058);
  opacity: 0.6;
}

.warning-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning-color, #f0a020);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.2); }
}

/* Expanded panel */
.task-panel {
  background: var(--panel-bg, #fafaf8);
  border-top: 1px solid var(--panel-border, #e8e8e3);
  max-height: 280px;
  display: flex;
  flex-direction: column;
}

.task-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--panel-border, #e8e8e3);
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-color, #333);
}

.panel-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  font-size: 11px;
  padding: 3px 10px;
  border: 1px solid var(--panel-border, #e8e8e3);
  border-radius: 4px;
  background: var(--bg-color, #fff);
  color: var(--text-color-secondary, #666);
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: var(--hover-bg, #f0f0ec);
  border-color: var(--border-color, #d9d9d4);
}

.close-btn {
  font-weight: 500;
}

/* Task list */
.task-list {
  overflow-y: auto;
  padding: 4px 0;
  flex: 1;
}

.task-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  transition: background 0.1s ease;
}

.task-item:hover {
  background: var(--hover-bg, #f0f0ec);
}

.task-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-color-light, #e0e0db);
  border-top-color: var(--success-color, #18a058);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.status-icon {
  font-size: 13px;
  font-weight: bold;
}

.status-icon.success {
  color: var(--success-color, #18a058);
}

.status-icon.error {
  color: var(--error-color, #d03050);
}

.status-icon.cancelled {
  color: var(--text-color-muted, #aaa);
}

.task-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.task-description {
  font-size: 12px;
  color: var(--text-color, #333);
  line-height: 1.4;
  word-break: break-word;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-color-muted, #999);
}

.task-time {
  font-family: 'Ubuntu Mono', monospace;
}

.task-duration {
  font-family: 'Ubuntu Mono', monospace;
}

.task-error {
  color: var(--error-color, #d03050);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
}

.task-actions {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.task-item:hover .task-actions {
  opacity: 1;
}

.cancel-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-color-muted, #999);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}

.cancel-btn:hover {
  background: var(--error-bg, #fff0f0);
  color: var(--error-color, #d03050);
}

.task-empty {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: var(--text-color-muted, #aaa);
}

/* Hide when no tasks and not expanded */
.task-status-bar:not(.has-tasks):not(.expanded) {
  height: 0;
  overflow: hidden;
}
</style>
