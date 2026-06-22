/**
 * Agent 面板状态管理组合式函数
 * 管理 Agent 对话列表、创建、删除等操作
 */
import { ref, computed, watch } from 'vue'

// 模块级别的已关闭会话集合（跨组件共享）
// 用于在队列自动消费前检查会话是否已关闭
const closedSessionIds = new Set()

/**
 * 检查会话是否已关闭
 * @param {string} sessionId
 * @returns {boolean}
 */
export function isSessionClosed(sessionId) {
  return closedSessionIds.has(sessionId)
}

/**
 * 标记会话为已关闭（供内部使用）
 * @param {string} sessionId
 */
function markSessionClosed(sessionId) {
  closedSessionIds.add(sessionId)
  console.log('[useAgentPanel] 🚫 Marked session as closed:', sessionId)
}

/**
 * 移除会话的关闭标记（供重新打开使用）
 * @param {string} sessionId
 */
export function unmarkSessionClosed(sessionId) {
  closedSessionIds.delete(sessionId)
  console.log('[useAgentPanel] ✅ Unmarked session as closed:', sessionId)
}

export function useAgentPanel() {
  const conversations = ref([])
  const loading = ref(false)
  const currentUser = ref(null)
  const authLoading = ref(false)
  const authError = ref('')
  const selectedSource = ref('all')
  const getConversationSource = (conv) => {
    if (conv.type === 'dingtalk') return 'dingtalk'
    if (conv.type === 'weixin') return 'weixin'
    if (conv.type === 'feishu') return 'feishu'
    return conv.source || 'manual'
  }

  const hasConversationActivity = (conv) => {
    const messageCount = Number(conv?.messageCount || conv?.message_count || 0)
    if (messageCount > 0) return true

    const status = String(conv?.status || '').toLowerCase()
    return Boolean(status && status !== 'idle' && status !== 'closed')
  }

  const getReportConversationMode = (conv) => conv?.reportMode || conv?.report_mode || conv?.meta?.reportMode || null
  const isReportConversation = (conv) => conv?.source === 'report-followup' || Boolean(getReportConversationMode(conv))

  const shouldShowConversation = (conv) => {
    if (!conv) return false
    if (conv.source === 'project-library') return false
    if (isReportConversation(conv)) return true
    if (conv.type !== 'chat' || getConversationSource(conv) !== 'manual') return true
    return hasConversationActivity(conv)
  }

  const normalizeDedupeText = (value) => String(value || '').trim().replace(/\s+/g, ' ')

  const getReportConversationKey = (conv) => {
    const mode = getReportConversationMode(conv) || 'report'
    const reportPath = normalizeDedupeText(
      conv?.reportFilePath ||
      conv?.report_file_path ||
      conv?.filePath ||
      conv?.file_path ||
      conv?.meta?.reportFilePath
    )
    if (reportPath) return `${mode}:${reportPath}`

    const title = normalizeDedupeText(conv?.title)
    return title ? `${mode}:title:${title}` : `${mode}:session:${conv?.id || conv?.sessionId || ''}`
  }

  const dedupeReportConversations = (items) => {
    const seen = new Set()
    const result = []
    for (const conv of items) {
      if (!isReportConversation(conv)) {
        result.push(conv)
        continue
      }

      const key = getReportConversationKey(conv)
      if (seen.has(key)) continue
      seen.add(key)
      result.push(conv)
    }
    return result
  }

  /**
   * 加载对话列表（后端已合并活跃+历史）
   */
  const loadConversations = async () => {
    if (!window.electronAPI) return
    if (window.electronAPI.authGetCurrentUser && !currentUser.value) {
      conversations.value = []
      loading.value = false
      return
    }

    loading.value = true
    try {
      const list = await window.electronAPI.listAgentSessions()
      conversations.value = Array.isArray(list) ? list : []
    } catch (err) {
      console.error('[useAgentPanel] loadConversations error:', err)
      conversations.value = []
    } finally {
      loading.value = false
    }
  }

  const loadCurrentUser = async () => {
    if (!window.electronAPI?.authGetCurrentUser) return null
    authLoading.value = true
    try {
      const result = await window.electronAPI.authGetCurrentUser()
      currentUser.value = result?.user || null
      return currentUser.value
    } finally {
      authLoading.value = false
    }
  }

  const login = async ({ phone, password }) => {
    if (!window.electronAPI?.authLogin) return { success: false, error: '登录接口不可用' }
    authError.value = ''
    const result = await window.electronAPI.authLogin({ phone, password })
    if (!result?.success) {
      authError.value = result?.error || '登录失败'
      return result
    }
    currentUser.value = result.user
    await loadConversations()
    return result
  }

  const logout = async () => {
    if (window.electronAPI?.authLogout) {
      await window.electronAPI.authLogout()
    }
    currentUser.value = null
    conversations.value = []
  }

  /**
   * 创建新对话
   * @param {Object} options - { type, title, cwd, apiProfileId, modelId }
   * @returns {Object} 会话对象
   */
  const createConversation = async (options = {}) => {
    if (!window.electronAPI) return null

    try {
      const session = await window.electronAPI.createAgentSession({
        type: options.type || 'chat',
        title: options.title || '',
        cwd: options.cwd || null,
        apiProfileId: options.apiProfileId || null,
        modelId: options.modelId || null
      })

      if (session && !session.error) {
        conversations.value.unshift(session)
        return session
      } else {
        console.error('[useAgentPanel] create error:', session?.error)
        return null
      }
    } catch (err) {
      console.error('[useAgentPanel] createConversation error:', err)
      return null
    }
  }

  /**
   * 关闭对话（软关闭，标记为 closed）
   */
  const closeConversation = async (sessionId) => {
    if (!window.electronAPI) return

    // CRITICAL: 立即标记会话为已关闭，阻止队列自动消费
    markSessionClosed(sessionId)

    try {
      await window.electronAPI.closeAgentSession(sessionId)
      // 更新列表中的状态
      const conv = conversations.value.find(c => c.id === sessionId)
      if (conv) {
        conv.status = 'closed'
      }
    } catch (err) {
      console.error('[useAgentPanel] closeConversation error:', err)
    }
  }

  /**
   * 物理删除对话
   */
  const deleteConversation = async (sessionId) => {
    if (!window.electronAPI) return

    try {
      await window.electronAPI.deleteAgentConversation(sessionId)
      const index = conversations.value.findIndex(c => c.id === sessionId)
      if (index !== -1) {
        conversations.value.splice(index, 1)
      }

      // CRITICAL: 清理关闭标记，防止内存泄露
      closedSessionIds.delete(sessionId)
      console.log('[useAgentPanel] 🗑️ Removed closed mark for deleted session:', sessionId)
    } catch (err) {
      console.error('[useAgentPanel] deleteConversation error:', err)
    }
  }

  /**
   * 将指定会话上浮到列表最前（收到 agent:result 时调用）
   */
  const bumpConversation = (sessionId) => {
    const index = conversations.value.findIndex(c => c.id === sessionId)
    if (index > 0) {
      const [conv] = conversations.value.splice(index, 1)
      conv.updatedAt = new Date().toISOString()
      conv.messageCount = Math.max(Number(conv.messageCount || conv.message_count || 0), 1)
      conversations.value.unshift(conv)
      return true
    } else if (index === 0) {
      conversations.value[0].updatedAt = new Date().toISOString()
      conversations.value[0].messageCount = Math.max(Number(conversations.value[0].messageCount || conversations.value[0].message_count || 0), 1)
      return true
    }
    return false
  }

  /**
   * 重命名对话
   */
  const renameConversation = async (sessionId, title) => {
    if (!window.electronAPI) return

    try {
      await window.electronAPI.renameAgentSession({ sessionId, title })
      const conv = conversations.value.find(c => c.id === sessionId)
      if (conv) {
        conv.title = title
      }
    } catch (err) {
      console.error('[useAgentPanel] renameConversation error:', err)
    }
  }

  // 当前选中的目录筛选（null = 全部）
  const selectedCwd = ref(null)

  const sourceFilteredConversations = computed(() => {
    const visible = conversations.value.filter(conv => {
      if (!shouldShowConversation(conv)) return false
      return selectedSource.value === 'all' || getConversationSource(conv) === selectedSource.value
    })
    return dedupeReportConversations(visible)
  })

  /**
   * 从当前来源候选对话中提取所有不重复的 cwd，按字母排序
   */
  const availableCwds = computed(() => {
    const cwdSet = new Set()
    for (const conv of sourceFilteredConversations.value) {
      if (conv.cwd) cwdSet.add(conv.cwd)
    }
    return Array.from(cwdSet).sort()
  })

  watch(availableCwds, (nextCwds) => {
    if (selectedCwd.value && !nextCwds.includes(selectedCwd.value)) {
      selectedCwd.value = null
    }
  }, { immediate: true })

  /**
   * 按 selectedCwd 过滤后的对话列表
   */
  const filteredConversations = computed(() => {
    return sourceFilteredConversations.value.filter(conv => {
      return !selectedCwd.value || conv.cwd === selectedCwd.value
    })
  })

  /**
   * 按时间分组（今天、昨天、更早）
   */
  const groupedConversations = computed(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 86400000)

    const groups = {
      today: [],
      yesterday: [],
      older: []
    }

    for (const conv of filteredConversations.value) {
      const ts = new Date(conv.updatedAt || conv.createdAt)
      if (ts >= today) {
        groups.today.push(conv)
      } else if (ts >= yesterday) {
        groups.yesterday.push(conv)
      } else {
        groups.older.push(conv)
      }
    }

    return groups
  })

  return {
    conversations,
    loading,
    currentUser,
    authLoading,
    authError,
    selectedCwd,
    selectedSource,
    availableCwds,
    groupedConversations,
    loadCurrentUser,
    login,
    logout,
    loadConversations,
    createConversation,
    closeConversation,
    deleteConversation,
    bumpConversation,
    renameConversation
  }
}
