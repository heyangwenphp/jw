<template>
  <div class="agent-left-content">
    <nav class="home-nav-area">
      <button
        type="button"
        class="home-nav-item"
        :class="{ active: isHomeActive }"
        @click="emit('home-request')"
      >
        <Icon name="home" :size="14" />
        <span>美的舆情推送监控</span>
      </button>
    </nav>

    <div class="new-session-area">
      <button class="new-session-btn" @click="handleNewConversation">
        <span class="icon">+</span>
        <span>{{ t('agent.newConversation') }}</span>
      </button>
    </div>

    <!-- 瀵硅瘽鍒楄〃 -->
    <div class="conversation-list">
      <template v-for="group in conversationGroups" :key="group.key">
        <div class="group-header">
          <span>{{ group.label }}</span>
        </div>
        <div
          v-for="conv in group.items"
          :key="conv.id"
          class="conversation-item"
          :class="{ active: activeSessionId === conv.id, closed: conv.status === 'closed' }"
          @click="$emit('select', conv)"
        >
          <div class="conv-info">
            <button
              v-if="getConversationSource(conv) === 'scheduled' && conv.taskId"
              class="conv-icon-btn"
              :title="t('rightPanel.tabs.scheduledTasks')"
              @click.stop="openScheduledTaskManager({ taskId: conv.taskId })"
            >
              <Icon :name="getConversationIcon(conv)" :size="12" class="conv-icon interactive" />
            </button>
            <Icon v-else :name="getConversationIcon(conv)" :size="12" class="conv-icon" />
            <span class="conv-title">{{ conv.title || t('agent.chat') }}</span>
          </div>
          <div class="conv-actions">
            <button class="action-btn delete-btn" :title="t('common.delete')" @click.stop="handleDelete(conv)">
              <Icon name="delete" :size="12" />
            </button>
          </div>
        </div>
      </template>

      <!-- 绌虹姸鎬?-->
      <div v-if="conversationGroups.length === 0 && !loading" class="empty-hint">
        <Icon name="robot" :size="32" style="margin-bottom: 8px; opacity: 0.5;" />
        <div>{{ t('agent.noConversations') }}</div>
      </div>
    </div>


    <n-modal v-model:show="showScheduledTaskManager" @after-leave="scheduledTaskId = null">
      <div class="scheduled-task-manager-modal">
        <ScheduledTaskDetailPanel
          v-if="showScheduledTaskManager && scheduledTaskId"
          :task-id="scheduledTaskId"
          :current-project="currentProject"
          @close="showScheduledTaskManager = false"
          @updated="loadConversations"
          @deleted="handleScheduledTaskDeleted"
        />
      </div>
    </n-modal>
  </div>
</template>

<script setup>
import { ref, computed, h, onMounted, onUnmounted } from 'vue'
import { useDialog } from 'naive-ui'
import { useLocale } from '@composables/useLocale'
import { useAgentPanel } from '@composables/useAgentPanel'
import Icon from '@components/icons/Icon.vue'
import ScheduledTaskDetailPanel from './ScheduledTaskDetailPanel.vue'

const { t } = useLocale()
const dialog = useDialog()
const props = defineProps({
  activeSessionId: {
    type: String,
    default: null
  },
  currentProject: {
    type: Object,
    default: null
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

const emit = defineEmits(['select', 'close', 'created', 'new-conversation-request', 'profile-updated', 'home-request'])

const {
  conversations,
  loading,
  currentUser,
  selectedCwd,
  selectedSource,
  availableCwds,
  groupedConversations,
  loadCurrentUser,
  logout,
  loadConversations,
  createConversation,
  closeConversation,
  deleteConversation,
  bumpConversation
} = useAgentPanel()

// 涓嬫媺閫夐」锛氱涓€椤?鍏ㄩ儴"锛屽悗璺熷悇鐩綍 basename
const cwdOptions = computed(() => {
  const dirs = availableCwds.value.map(cwd => {
    const basename = cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() || cwd
    return { label: basename, value: cwd }
  })
  return [{ label: t('agent.allDirectories'), value: null }, ...dirs]
})

const sourceOptions = computed(() => ([
  { label: t('agent.allSources'), value: 'all' },
  { label: t('agent.sourceManual'), value: 'manual' },
  { label: t('agent.sourceScheduled'), value: 'scheduled' },
  { label: t('agent.sourceDingtalk'), value: 'dingtalk' },
  { label: t('agent.sourceWeixin'), value: 'weixin' },
  { label: t('agent.sourceFeishu'), value: 'feishu' }
]))

// 娓叉煋閫夐」 label锛岄潪"鍏ㄩ儴"閫夐」鍔?title 鏄剧ず瀹屾暣璺緞
const renderCwdLabel = (option) => {
  if (!option.value) return h('span', option.label)
  return h('span', { title: option.value }, option.label)
}

// 鎸夋椂闂村垎缁勭殑瀵硅瘽鍒楄〃锛堟秷闄ゆā鏉块噸澶嶏級
const conversationGroups = computed(() => {
  const groups = []
  const g = groupedConversations.value
  if (g.today.length > 0) {
    groups.push({ key: 'today', label: t('common.today'), items: g.today })
  }
  if (g.yesterday.length > 0) {
    groups.push({ key: 'yesterday', label: t('common.yesterday'), items: g.yesterday })
  }
  if (g.older.length > 0) {
    groups.push({ key: 'older', label: t('common.older'), items: g.older })
  }
  return groups
})

const showScheduledTaskManager = ref(false)
const scheduledTaskId = ref(null)

const getConversationSource = (conv) => {
  if (conv.type === 'dingtalk') return 'dingtalk'
  if (conv.type === 'weixin') return 'weixin'
  if (conv.type === 'feishu') return 'feishu'
  return conv.source || 'manual'
}

const getConversationIcon = (conv) => {
  const source = getConversationSource(conv)
  if (source === 'scheduled') return 'clock'
  if (source === 'dingtalk') return 'dingtalk'
  if (source === 'weixin') return 'weixin'
  if (source === 'feishu') return 'feishu'
  return 'chat'
}

const openScheduledTaskManager = ({ taskId = null } = {}) => {
  if (!taskId) return
  scheduledTaskId.value = taskId
  showScheduledTaskManager.value = true
}

const handleScheduledTaskDeleted = async () => {
  showScheduledTaskManager.value = false
  scheduledTaskId.value = null
  await loadConversations()
}

const handleNewConversation = () => {
  emit('new-conversation-request')
}

const handleDelete = (conv) => {
  dialog.warning({
    title: t('agent.deleteConfirmTitle'),
    content: t('agent.deleteConfirmContent'),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      await deleteConversation(conv.id)
      // 閫氱煡鐖剁粍浠跺叧闂搴旂殑 Tab锛堝鏋滃凡鎵撳紑锛?
      emit('close', conv)
    }
  })
}

// 鐩戝惉閲嶅懡鍚嶄簨浠讹紙浠庡悗绔帹閫侊級
let cleanupRenamed = null
let cleanupAgentResult = null
let cleanupDingtalkSession = null
let cleanupDingtalkSessionClosed = null
let cleanupWeixinSession = null
let cleanupAgentStatus = null
let cleanupScheduledTask = null

onMounted(() => {
  loadCurrentUser().then(user => {
    if (user) loadConversations()
  })

  if (window.electronAPI?.onAgentRenamed) {
    cleanupRenamed = window.electronAPI.onAgentRenamed((data) => {
      const conv = conversations.value.find(c => c.id === data.sessionId)
      if (conv) {
        conv.title = data.title
      }
    })
  }

  // 姣忚疆瀵硅瘽瀹屾垚鏃跺皢璇ヤ細璇濅笂娴埌鍒楄〃鏈€鍓?
  if (window.electronAPI?.onAgentResult) {
    cleanupAgentResult = window.electronAPI.onAgentResult((data) => {
      if (!bumpConversation(data.sessionId)) {
        loadConversations()
      }
    })
  }

  if (window.electronAPI?.onAgentStatusChange) {
    cleanupAgentStatus = window.electronAPI.onAgentStatusChange((data) => {
      const conv = conversations.value.find(item => item.id === data.sessionId)
      if (conv) {
        conv.status = data.cliExited
          ? (data.cliExitWasError ? 'error' : 'closed')
          : data.status
        return
      }
      loadConversations()
    })
  }

  // 閽夐拤浼氳瘽鍒涘缓/鍏抽棴鏃惰嚜鍔ㄥ埛鏂板垪琛?
  if (window.electronAPI?.onDingTalkSessionCreated) {
    cleanupDingtalkSession = window.electronAPI.onDingTalkSessionCreated(() => {
      loadConversations()
    })
  }
  if (window.electronAPI?.onWeixinSessionCreated) {
    cleanupWeixinSession = window.electronAPI.onWeixinSessionCreated(() => {
      loadConversations()
    })
  }
  if (window.electronAPI?.onDingTalkSessionClosed) {
    cleanupDingtalkSessionClosed = window.electronAPI.onDingTalkSessionClosed(() => {
      loadConversations()
    })
  }

  if (window.electronAPI?.onScheduledTaskChanged) {
    cleanupScheduledTask = window.electronAPI.onScheduledTaskChanged(() => {
      loadConversations()
    })
  }
})

onUnmounted(() => {
  if (cleanupRenamed) cleanupRenamed()
  if (cleanupAgentResult) cleanupAgentResult()
  if (cleanupAgentStatus) cleanupAgentStatus()
  if (cleanupDingtalkSession) cleanupDingtalkSession()
  if (cleanupDingtalkSessionClosed) cleanupDingtalkSessionClosed()
  if (cleanupWeixinSession) cleanupWeixinSession()
  if (cleanupScheduledTask) cleanupScheduledTask()
})

defineExpose({
  currentUser,
  logout,
  loadConversations,
  createConversation,
  closeConversation,
  deleteConversation
})
</script>

<style scoped>
.agent-left-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  background: var(--panel-bg);
}

.home-nav-area {
  padding: 12px 16px 0;
  flex-shrink: 0;
}

.home-nav-item {
  width: 100%;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-color);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  transition: all 0.2s ease;
}

.home-nav-item + .home-nav-item {
  margin-top: 8px;
}

.home-nav-item:not(.active):hover {
  background: var(--panel-bg-subtle);
}

.home-nav-item.active {
  background: var(--selected-bg);
  border-color: var(--selected-border);
  color: var(--primary-color);
}

.new-session-area {
  padding: 8px 16px 12px;
  flex-shrink: 0;
}

.new-session-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin: 15px 0;
  padding: 10px 16px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.new-session-btn:hover {
  background: var(--primary-color-hover);
  transform: translateY(-1px);
  box-shadow: var(--primary-shadow);
}

.new-session-btn .icon {
  font-size: 16px;
  font-weight: bold;
}

.filter-area {
  padding: 0 16px 10px;
  flex-shrink: 0;
}

.scheduled-task-manager-modal {
  width: min(1180px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  margin: 24px auto;
  border-radius: 16px;
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.18);
}

.dir-filter-area {
  padding: 0 16px 10px;
  flex-shrink: 0;
}

.conversation-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 16px 16px;
}

.group-header {
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 12px 2px 8px;
}

.conversation-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.conversation-item:hover {
  background: var(--panel-bg-subtle);
}

.conversation-item.active {
  background: var(--selected-bg);
  border-color: var(--selected-border);
}

.conversation-item.closed {
  opacity: 0.55;
}

.conversation-item.closed .conv-icon {
  color: var(--text-color-muted);
}

.conv-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.conv-icon {
  color: var(--primary-color);
  flex-shrink: 0;
}

.conv-icon.interactive {
  transition: color 0.2s, transform 0.2s;
}

.conv-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
}

.conv-icon-btn:hover .conv-icon.interactive {
  color: var(--primary-color-hover);
  transform: scale(1.08);
}

.conv-title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-badge {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--primary-ghost);
  color: var(--primary-color);
  font-size: 11px;
  line-height: 18px;
}

.conv-actions {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
}

.conversation-item:hover .conv-actions {
  opacity: 1;
}

.action-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-color-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: var(--primary-ghost-hover);
  color: var(--primary-color);
}

.action-btn.delete-btn:hover {
  background: rgba(220, 38, 38, 0.1);
  color: var(--danger-color);
}

.empty-hint {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-color-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
}
</style>

