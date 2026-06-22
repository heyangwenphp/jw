/**
 * Feishu Bridge
 * 飞书机器人桥接模块：通过 WebSocket 模式接收飞书消息，转发给 Agent 会话，回复结果到飞书
 */

const { Client, WSClient, EventDispatcher } = require('@larksuiteoapi/node-sdk')
const path = require('path')

// 飞书桥接翻译字典
const FEISHU_I18N = {
  'zh-CN': {
    sessionActivating: '会话恢复中，请等待信息返回后，即可开始聊天',
    sessionCreating: '会话创建中，请等待信息返回后，即可开始聊天',
    alreadyConnected: '您选择的是当前会话，无需重新连接，请继续聊天',
    sessionSwitched: '✅ 已切换到会话：{title}\n\n现在可以继续对话了',
    replyTitle: 'CC Agent 回复'
  },
  'en-US': {
    sessionActivating: 'Session activating, please wait for the response to start chatting',
    sessionCreating: 'Session creating, please wait for the response to start chatting',
    alreadyConnected: 'You selected the current session, no need to reconnect, please continue chatting',
    sessionSwitched: '✅ Switched to session: {title}\n\nYou can continue chatting now',
    replyTitle: 'CC Agent Reply'
  }
}

class FeishuBridge {
  /**
   * @param {Object} configManager - ConfigManager 实例
   * @param {Object} agentSessionManager - AgentSessionManager 实例
   * @param {BrowserWindow} mainWindow - 主窗口（用于通知前端）
   */
  constructor(configManager, agentSessionManager, mainWindow) {
    this.configManager = configManager
    this.agentSessionManager = agentSessionManager
    this.mainWindow = mainWindow

    this.client = null
    this.connected = false

    // 飞书用户+会话 → Agent 会话映射：{ "openId:chatId": sessionId }
    this.sessionMap = new Map()

    // 响应收集器：{ sessionId: { chunks, resolve, webhook } }
    this.responseCollectors = new Map()

    // 消息去重：记录最近处理过的 messageId，防止 SDK 重投导致重复处理
    this._processedMsgIds = new Map()
    this._MSG_ID_TTL = 10 * 60 * 1000 // 10 分钟后清理
    this._msgIdCleanupTimer = setInterval(() => {
      const cutoff = Date.now() - this._MSG_ID_TTL
      for (const [id, ts] of this._processedMsgIds) {
        if (ts < cutoff) this._processedMsgIds.delete(id)
      }
    }, 60 * 1000) // 每分钟扫一次

    // 每个会话的消息处理队列（Promise chain），确保串行处理
    this._sessionProcessQueues = new Map()

    // 待选择状态：用户发消息时有历史会话，等待用户选择继续或新建
    this._pendingChoices = new Map()
    this._CHOICE_TTL = 10 * 60 * 1000 // 10 分钟无响应则超时清除

    // 飞书 access token 缓存
    this._accessToken = null
    this._accessTokenExpiresAt = 0

    // CC 桌面介入同步：每个飞书会话最近一次的 webhook 信息（用于回传）
    this._sessionWebhooks = new Map()

    // CC 桌面介入时待发送的 Q&A 块
    this._desktopPendingBlocks = new Map()

    // 连接健康监控
    this._reconnectWatchdog = null

    // 用户信息缓存（openId -> nickname）
    this._userInfoCache = new Map()

    // 监听 AgentSessionManager 内部事件
    this._bindAgentEvents()
  }

  /**
   * 绑定 AgentSessionManager 内部事件
   */
  _bindAgentEvents() {
    const mgr = this.agentSessionManager

    this._listeners = {
      userMessage: ({ sessionId, sessionType, content, images, source }) => {
        // 非飞书来源 + 飞书类型会话 → CC 桌面介入，同步给飞书
        if (source !== 'feishu' && sessionType === 'feishu') {
          try { this.onUserMessage(sessionId, content, images) } catch (e) {
            console.error('[Feishu] onUserMessage threw:', e)
          }
        }
      },
      agentMessage: (sessionId, message) => {
        try { this.onAgentMessage(sessionId, message) } catch (e) {
          console.error('[Feishu] onAgentMessage threw:', e)
        }
      },
      agentResult: (sessionId) => {
        try { this.onAgentResult(sessionId) } catch (e) {
          console.error('[Feishu] onAgentResult threw:', e)
        }
      },
      agentError: (sessionId, error) => {
        try { this.onAgentError(sessionId, error) } catch (e) {
          console.error('[Feishu] onAgentError threw:', e)
        }
      }
    }

    for (const [event, fn] of Object.entries(this._listeners)) {
      mgr.on(event, fn)
    }
  }

  /**
   * 启动飞书桥接
   */
  async start() {
    const config = this.configManager.getConfig()
    const { enabled, appId, appSecret } = config.feishu || {}

    if (!enabled || !appId || !appSecret) {
      console.log('[Feishu] Bridge disabled or not configured')
      return false
    }

    try {
      await this._connect(appId, appSecret)
      return true
    } catch (err) {
      console.error('[Feishu] Failed to start:', err.message)
      this._notifyFrontend('feishu:error', { error: err.message })
      return false
    }
  }

  /**
   * 停止飞书桥接
   */
  async stop() {
    if (this._reconnectWatchdog) {
      clearTimeout(this._reconnectWatchdog)
      this._reconnectWatchdog = null
    }
    if (this.client) {
      try {
        this.client.disconnect()
      } catch (e) {
        // ignore
      }
      this.client = null
    }
    this.connected = false
    for (const collector of this.responseCollectors.values()) clearTimeout(collector.timer)
    this.responseCollectors.clear()
    if (this._msgIdCleanupTimer) {
      clearInterval(this._msgIdCleanupTimer)
      this._msgIdCleanupTimer = null
    }
    this._processedMsgIds.clear()
    this._sessionProcessQueues.clear()
    for (const choice of this._pendingChoices.values()) clearTimeout(choice.timer)
    this._pendingChoices.clear()
    this._sessionWebhooks.clear()
    this._desktopPendingBlocks.clear()
    console.log('[Feishu] Bridge stopped')
    this._notifyFrontend('feishu:statusChange', { connected: false })
  }

  /**
   * 重启（配置变更后调用）
   */
  async restart() {
    await this.stop()
    return this.start()
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      connected: this.connected,
      activeSessions: this.sessionMap.size,
      notificationConfigured: this.isNotificationConfigured()
    }
  }

  isNotificationConfigured() {
    const config = this.configManager.getConfig()
    const feishu = config.feishu || {}
    return Boolean(
      feishu.enabled &&
      feishu.appId &&
      feishu.appSecret &&
      (feishu.notificationChatId || process.env.FEISHU_NOTIFICATION_CHAT_ID)
    )
  }

  async sendNotificationText({ chatId, text } = {}) {
    const config = this.configManager.getConfig()
    const feishu = config.feishu || {}
    const targetChatId = String(chatId || feishu.notificationChatId || process.env.FEISHU_NOTIFICATION_CHAT_ID || '').trim()
    const normalizedText = String(text || '').trim()
    if (!targetChatId) throw new Error('Feishu notification chatId is not configured')
    if (!normalizedText) throw new Error('Feishu notification text is required')
    if (!feishu.enabled || !feishu.appId || !feishu.appSecret) {
      throw new Error('Feishu bridge is not enabled or configured')
    }
    return this._sendTextMessage(targetChatId, normalizedText)
  }

  /**
   * 销毁实例，解绑事件监听器
   */
  destroy() {
    this.stop()
    if (this.agentSessionManager && this._listeners) {
      for (const [event, fn] of Object.entries(this._listeners)) {
        this.agentSessionManager.off(event, fn)
      }
      this._listeners = null
    }
    console.log('[Feishu] Bridge destroyed, event listeners unbound')
  }

  // ==================== 内部方法 ====================

  /**
   * 获取翻译文本
   */
  _t(key) {
    const config = this.configManager.getConfig()
    const locale = config?.settings?.locale || 'zh-CN'
    return FEISHU_I18N[locale]?.[key] || FEISHU_I18N['zh-CN'][key]
  }

  /**
   * 建立 WebSocket 连接
   */
  async _connect(appId, appSecret) {
    this._accessToken = null
    this._accessTokenExpiresAt = 0
    await this._getAccessToken()

    const dispatcher = new EventDispatcher({
      encryptKey: '',
      verificationToken: ''
    })

    // 注册机器人消息回调
    dispatcher.register({
      'im.message.receive_v1': async (data) => {
        console.log('[Feishu] Raw message received:', JSON.stringify(data).substring(0, 800))
        try {
          await this._handleFeishuMessage(data)
        } catch (err) {
          console.error('[Feishu] Message handling error:', err)
        }
      },
      'im.chat.access_event.bot_p2p_chat_entered_v1': async (data) => {
        console.log('[Feishu] Bot joined p2p chat event:', JSON.stringify(data).substring(0, 300))
      }
    })

    this.client = new WSClient({
      appId: appId,
      appSecret: appSecret,
      loggerLevel: 1 // WARN level
    })

    // 连接（start 接收 eventDispatcher 作为参数，返回 void）
    this.client.start({ eventDispatcher: dispatcher })

    // SDK 连接是异步的，连接成功后会通过事件回调
    // 由于 start() 返回 void，我们直接标记为已连接，实际连接状态由事件决定
    this.connected = true
    console.log('[Feishu] Bridge connection started')
    this._notifyFrontend('feishu:statusChange', { connected: true })
  }

  /**
   * 处理飞书消息
   */
  async _handleFeishuMessage(data) {
    // 飞书 SDK 回调数据格式：sender 在顶层，message 在子层
    const message = data?.message || {}
    const { message_id, message_type, chat_id, content, create_time } = message
    const sender = data?.sender  // sender 在根层级，不在 message 内

    console.log('[Feishu] _handleFeishuMessage: msgId:', message_id, 'type:', message_type, 'chat:', chat_id)
    console.log('[Feishu] sender:', JSON.stringify(sender))

    // 消息去重
    if (message_id && this._processedMsgIds.has(message_id)) {
      console.log(`[Feishu] Duplicate message ${message_id}, skipping`)
      return
    }
    if (message_id) {
      this._processedMsgIds.set(message_id, Date.now())
    }

    // 处理所有非空消息，sender_type 为 bot 时仍处理（可能来自其他应用）
    if (!sender) {
      console.log('[Feishu] No sender info, skipping')
      return
    }

    const openId = sender?.sender_id?.open_id || ''
    const senderType = sender?.sender_type || ''

    // 异步获取用户昵称（缓存）
    let senderName = '飞书用户'
    if (openId && senderType === 'user') {
      const cachedName = this._userInfoCache.get(openId)
      if (cachedName) {
        senderName = cachedName
      } else {
        // 异步查询但不阻塞消息处理
        this._getUserInfo(openId).then(nickname => {
          if (nickname && nickname !== senderName) {
            // 更新通知中的发送者名称
            console.log(`[Feishu] Updated sender name: ${senderName} -> ${nickname}`)
          }
        })
      }
    } else if (senderType === 'bot') {
      senderName = '飞书机器人'
    } else {
      senderName = openId ? `飞书用户${openId.slice(-6)}` : '未知用户'
    }
    const mapKey = `${openId}:${chat_id || 'default'}`

    // 解析消息内容
    let messageContent
    try {
      messageContent = typeof content === 'string' ? JSON.parse(content) : content
    } catch (e) {
      messageContent = { text: content }
    }

    // 构建 Agent 消息
    let agentMessage = null
    let displayText = ''

    if (message_type === 'text') {
      const userText = (messageContent?.text || '').trim()
      if (!userText) return

      // 命令拦截
      if (userText.startsWith('/')) {
        await this._handleCommand(userText, chat_id, {
          openId, senderName, chatId: chat_id
        })
        return
      }

      agentMessage = userText
      displayText = userText
      console.log(`[Feishu] Text from ${senderName}(${openId}): ${userText.substring(0, 50)}`)
    } else if (message_type === 'image') {
      const imageKey = messageContent?.image_key
      if (!imageKey) return

      console.log(`[Feishu] Image from ${senderName}(${openId})`)
      try {
        const imageData = await this._downloadImage(imageKey)
        agentMessage = { text: '', images: [imageData] }
        displayText = '[图片]'
      } catch (err) {
        console.error(`[Feishu] Image download failed:`, err.message)
        return
      }
    } else if (message_type === 'post') {
      // 富文本消息
      const textParts = []
      const images = []

      const post = messageContent?.post || {}
      if (post.content) {
        for (const section of post.content) {
          if (section.tag === 'text' && section.text) {
            textParts.push(section.text)
          } else if (section.tag === 'img' && section.image_key) {
            try {
              const imageData = await this._downloadImage(section.image_key)
              images.push(imageData)
            } catch (err) {
              console.error(`[Feishu] Post image download failed:`, err.message)
            }
          }
        }
      }

      const combinedText = textParts.join('\n').trim()
      if (!combinedText && images.length === 0) return

      if (images.length > 0) {
        agentMessage = { text: combinedText, images }
        displayText = combinedText || `[图片x${images.length}]`
      } else {
        agentMessage = combinedText
        displayText = combinedText
      }
    } else {
      console.log(`[Feishu] Unsupported message type: ${message_type}`)
      return
    }

    // 如果有待选择状态，优先处理
    if (this._pendingChoices.has(mapKey)) {
      await this._handlePendingChoice(mapKey, displayText, chat_id, { openId, senderName, chatId: chat_id })
      return
    }

    // 查找或创建 Agent 会话
    const result = await this._ensureSession(openId, senderName, chat_id)

    // 有历史会话需要用户选择
    if (result && result.needsChoice) {
      this._setPendingChoice(mapKey, { sessions: result.sessions, originalMessage: agentMessage, openId })
      await this._sendChoiceMenu(chat_id, result.sessions)
      return
    }

    const sessionId = result

    // 通知前端
    const notification = { sessionId, senderNick: senderName, text: displayText }
    if (agentMessage && typeof agentMessage === 'object' && agentMessage.images) {
      notification.images = agentMessage.images.map(img => ({
        base64: img.base64,
        mediaType: img.mediaType
      }))
    }
    this._notifyFrontend('feishu:messageReceived', notification)

    // 消息入队
    this._enqueueMessage(sessionId, agentMessage, chat_id, senderName, { openId, chatId: chat_id })
  }

  /**
   * 处理单条消息
   */
  async _processOneMessage(sessionId, userMessage, chatId, senderName, { openId, chatId: targetChatId } = {}) {
    console.log(`[Feishu] _processOneMessage: sessionId=${sessionId}`)

    // 更新会话的 webhook 信息
    if (chatId) {
      this._sessionWebhooks.set(sessionId, { chatId, openId })
    }

    // 设置响应处理器
    const donePromise = this._setupResponseHandler(sessionId, chatId, { openId, chatId })

    // 发送到 Agent
    const meta = { source: 'feishu', senderNick: senderName, chatId }
    try {
      await this.agentSessionManager.sendMessage(sessionId, userMessage, { meta })
    } catch (err) {
      console.error(`[Feishu] sendMessage failed:`, err.message)
      if (err.message && err.message.includes('already streaming')) {
        await this._replyToFeishu(chatId, '⏳ 正在处理中，请稍候再试')
      } else {
        await this._replyToFeishu(chatId, `❌ 错误: ${err.message}`)
      }
      const failedCollector = this.responseCollectors.get(sessionId)
      if (failedCollector) clearTimeout(failedCollector.timer)
      this.responseCollectors.delete(sessionId)
      return
    }

    try {
      await donePromise
    } catch (err) {
      console.error(`[Feishu] Response handling failed:`, err.message)
    }
  }

  /**
   * 确保飞书用户+会话有对应的 Agent 会话
   */
  async _ensureSession(openId, nickname, chatId) {
    const mapKey = `${openId}:${chatId || 'default'}`
    let sessionId = this.sessionMap.get(mapKey)

    if (sessionId) {
      const db = this.agentSessionManager.sessionDatabase
      const row = db && db.getAgentConversation(sessionId)

      if (!row) {
        this._clearSessionState(sessionId, mapKey)
      } else if (row.status === 'closed') {
        this._clearSessionState(sessionId, mapKey)
      } else {
        const session = this.agentSessionManager.reopen(sessionId)
        if (session) {
          if (!session.meta) session.meta = {}
          session.meta.chatId = chatId
          return sessionId
        }
        this._clearSessionState(sessionId, mapKey)
      }
    }

    // 从 DB 查历史会话
    const db = this.agentSessionManager.sessionDatabase
    if (db && chatId && db.getFeishuSessions) {
      const limit = this.configManager.getConfig()?.feishu?.maxHistorySessions || 5
      const sessions = db.getFeishuSessions(openId, chatId, limit)
      if (sessions.length > 0) {
        return { needsChoice: true, sessions }
      }
    }

    // 无历史会话 → 新建
    return this._createNewSession(openId, nickname, chatId, mapKey)
  }

  /**
   * 新建 Agent 会话
   */
  async _createNewSession(openId, nickname, chatId, mapKey) {
    const title = chatId
      ? `飞书 · ${nickname || openId}`
      : `飞书 · ${nickname || openId}`

    const session = this.agentSessionManager.create({
      type: 'feishu',
      source: 'feishu',
      title,
      cwdSubDir: 'feishu',
      meta: { chatId },
      ownerUserId: this.configManager.getConfig()?.feishu?.ownerUserId || null
    })

    const sessionId = session.id
    this.sessionMap.set(mapKey, sessionId)

    const db = this.agentSessionManager.sessionDatabase
    if (db && chatId && db.updateFeishuMetadata) {
      db.updateFeishuMetadata(sessionId, openId, chatId)
    }

    console.log(`[Feishu] Created session ${sessionId} for ${nickname}(${openId}) in chat ${chatId}`)

    this._notifyFrontend('feishu:sessionCreated', {
      sessionId, openId, nickname, chatId, title: session.title
    })

    return sessionId
  }

  /**
   * 设置待选择状态
   */
  _setPendingChoice(mapKey, data) {
    const existing = this._pendingChoices.get(mapKey)
    if (existing) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      this._pendingChoices.delete(mapKey)
      console.log(`[Feishu] Pending choice expired for ${mapKey}`)
    }, this._CHOICE_TTL)

    this._pendingChoices.set(mapKey, { ...data, timer })
  }

  /**
   * 清除待选择状态
   */
  _clearPendingChoice(mapKey) {
    const pending = this._pendingChoices.get(mapKey)
    if (pending) clearTimeout(pending.timer)
    this._pendingChoices.delete(mapKey)
  }

  /**
   * 清理会话关联的所有内部状态
   */
  _clearSessionState(sessionId, mapKey) {
    this._sessionProcessQueues.delete(sessionId)
    if (mapKey) this.sessionMap.delete(mapKey)
    this._sessionWebhooks.delete(sessionId)
    this._desktopPendingBlocks.delete(sessionId)
  }

  /**
   * 将消息加入会话的串行处理队列
   */
  _enqueueMessage(sessionId, message, chatId, senderName, opts) {
    const prevTask = this._sessionProcessQueues.get(sessionId) || Promise.resolve()
    const currentTask = prevTask
      .catch(() => {})
      .then(() => this._processOneMessage(sessionId, message, chatId, senderName, opts))
      .catch(err => console.error('[Feishu] Queue processing error:', err))
    this._sessionProcessQueues.set(sessionId, currentTask)
  }

  /**
   * 获取当前活跃的 sessionId
   */
  _resolveActiveSessionId(mapKey) {
    const sessionId = this.sessionMap.get(mapKey)
    if (!sessionId) return null

    const session = this.agentSessionManager.sessions.get(sessionId)
    if (session) return sessionId

    const db = this.agentSessionManager.sessionDatabase
    const row = db && db.getAgentConversation(sessionId)
    if (!row || row.status === 'closed') {
      this._clearSessionState(sessionId, mapKey)
      return null
    }

    return sessionId
  }

  /**
   * 向飞书用户发送历史会话选择菜单
   */
  async _sendChoiceMenu(chatId, sessions, currentSessionId = null) {
    const MAX_SESSIONS = 10
    const displaySessions = sessions.slice(0, MAX_SESSIONS)
    const lines = ['您有以下历史会话，请回复数字选择：\n']
    displaySessions.forEach((row, i) => {
      const timeStr = this._formatRelativeTime(row.updated_at)
      const dir = row.cwd ? path.basename(row.cwd) : '-'
      const profileName = row.api_profile_id
        ? (this.configManager?.getAPIProfile(row.api_profile_id)?.name || '未知配置')
        : '默认配置'

      let marker = ''
      const session = this.agentSessionManager.sessions.get(row.session_id)
      if (currentSessionId && row.session_id === currentSessionId) {
        marker = '✅ '
      } else if (session && session.queryGenerator) {
        marker = '🔵 '
      } else {
        marker = '⭕ '
      }

      lines.push(`${i + 1}. ${marker}[${timeStr}] ${row.title} (${dir}) ${profileName}`)
    })
    if (sessions.length > MAX_SESSIONS) {
      lines.push(`\n（仅显示最近 ${MAX_SESSIONS} 条，共 ${sessions.length} 条）`)
    }
    lines.push('\n回复 0 开始全新会话')
    await this._replyToFeishu(chatId, lines.join('\n'))
  }

  /**
   * 处理用户的历史会话选择
   */
  async _handlePendingChoice(mapKey, choiceText, chatId, { openId, senderName }) {
    const pending = this._pendingChoices.get(mapKey)
    if (!pending) {
      console.warn(`[Feishu] Pending choice for ${mapKey} not found, ignoring`)
      return
    }
    const { sessions, originalMessage } = pending

    const choice = parseInt(choiceText)
    const isValid = !isNaN(choice) && choice >= 0 && choice <= sessions.length

    if (!isValid) {
      console.log(`[Feishu] Invalid choice "${choiceText}", re-sending menu`)
      const currentSessionId = this._resolveActiveSessionId(mapKey)
      await this._sendChoiceMenu(chatId, sessions, currentSessionId)
      return
    }

    this._clearPendingChoice(mapKey)

    const currentSessionId = this._resolveActiveSessionId(mapKey)

    let sessionId
    let needActivation = false
    let alreadySentPrompt = false
    let isNewSession = false

    if (choice === 0) {
      sessionId = await this._createNewSession(openId, senderName, chatId, mapKey)
      needActivation = true
      isNewSession = true
    } else {
      const selectedRow = sessions[choice - 1]

      if (currentSessionId === selectedRow.session_id) {
        const session = this.agentSessionManager.sessions.get(currentSessionId)
        if (session?.queryGenerator) {
          await this._replyToFeishu(chatId, this._t('alreadyConnected'))
          return
        }
      }

      const session = this.agentSessionManager.reopen(selectedRow.session_id)
      if (session) {
        if (!session.meta) session.meta = {}
        session.meta.chatId = chatId

        sessionId = selectedRow.session_id
        this.sessionMap.set(mapKey, sessionId)
        console.log(`[Feishu] Resumed session ${sessionId} for ${senderName}(${openId})`)
        this._notifyFrontend('feishu:sessionCreated', {
          sessionId, openId, nickname: senderName, chatId, title: selectedRow.title
        })

        if (!currentSessionId || currentSessionId !== selectedRow.session_id) {
          if (session.queryGenerator) {
            await this._replyToFeishu(chatId, '✅ 已切换到目标对话，可以继续聊天了')
            alreadySentPrompt = true
          } else {
            await this._replyToFeishu(chatId, this._t('sessionActivating'))
            alreadySentPrompt = true
          }
        }

        needActivation = !session.queryGenerator
      } else {
        sessionId = await this._createNewSession(openId, senderName, chatId, mapKey)
        needActivation = true
      }
    }

    if (originalMessage) {
      console.log(`[Feishu] _handlePendingChoice: will process message for sessionId=${sessionId}`)

      if (needActivation && !alreadySentPrompt) {
        const promptKey = isNewSession ? 'sessionCreating' : 'sessionActivating'
        await this._replyToFeishu(chatId, this._t(promptKey))
      }

      const displayText = typeof originalMessage === 'string'
        ? originalMessage
        : (originalMessage.text || '[图片]')
      const notification = { sessionId, senderNick: senderName, text: displayText }
      if (originalMessage && typeof originalMessage === 'object' && originalMessage.images) {
        notification.images = originalMessage.images.map(img => ({
          base64: img.base64,
          mediaType: img.mediaType
        }))
      }
      this._notifyFrontend('feishu:messageReceived', notification)

      this._enqueueMessage(sessionId, originalMessage, chatId, senderName, { openId, chatId })
    } else if (needActivation) {
      console.log(`[Feishu] _handlePendingChoice: auto-activating session ${sessionId} with "hello"`)

      if (!alreadySentPrompt) {
        const promptKey = isNewSession ? 'sessionCreating' : 'sessionActivating'
        await this._replyToFeishu(chatId, this._t(promptKey))
      }

      this._notifyFrontend('feishu:messageReceived', {
        sessionId,
        senderNick: senderName,
        text: 'hello'
      })

      this._enqueueMessage(sessionId, 'hello', chatId, senderName, { openId, chatId })
    }
  }

  /**
   * 格式化时间戳为相对时间描述
   */
  _formatRelativeTime(timestamp) {
    const diff = Date.now() - Number(timestamp)
    const min = 60 * 1000
    const hour = 60 * min
    const day = 24 * hour
    if (diff < hour) return `${Math.floor(diff / min)}分钟前`
    if (diff < day) return `${Math.floor(diff / hour)}小时前`
    if (diff < 7 * day) return `${Math.floor(diff / day)}天前`
    if (diff < 30 * day) return `${Math.floor(diff / (7 * day))}周前`
    return `${Math.floor(diff / (30 * day))}个月前`
  }

  /**
   * 设置响应处理器
   */
  _setupResponseHandler(sessionId, chatId, { openId, chatId: targetChatId } = {}) {
    return new Promise((resolve, reject) => {
      const collector = {
        chatId,
        openId,
        hasSent: false,
        imagePaths: new Set(),
        resolve,
        reject,
        timer: setTimeout(() => {
          this.responseCollectors.delete(sessionId)
          reject(new Error('Response timeout'))
        }, 30 * 60 * 1000)
      }
      this.responseCollectors.set(sessionId, collector)
    })
  }

  /**
   * 下载飞书图片
   */
  async _downloadImage(imageKey) {
    const config = this.configManager.getConfig()
    const { appId, appSecret } = config.feishu || {}

    // 获取 tenant access token
    const token = await this._getAccessToken()
    if (!token) throw new Error('Failed to get access token')

    // 下载图片
    const response = await globalThis.fetch(
      `https://open.feishu.cn/open-apis/im/v1/images/${imageKey}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    )

    if (!response.ok) {
      throw new Error(`Image download failed: ${response.status}`)
    }

    const buffer = await response.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const contentType = response.headers.get('content-type') || 'image/jpeg'

    return {
      base64,
      mediaType: contentType
    }
  }

  /**
   * 获取飞书用户信息（带缓存）
   */
  async _getUserInfo(openId) {
    if (!openId) return null
    if (this._userInfoCache.has(openId)) {
      return this._userInfoCache.get(openId)
    }

    try {
      const token = await this._getAccessToken()
      if (!token) return null

      const response = await globalThis.fetch(
        `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      )

      if (!response.ok) return null

      const result = await response.json()
      if (result?.data?.user) {
        const user = result.data.user
        const nickname = user.name || user.en_name || `飞书用户${openId.slice(-6)}`
        this._userInfoCache.set(openId, nickname)
        return nickname
      }
    } catch (err) {
      console.warn('[Feishu] _getUserInfo failed:', err.message)
    }
    return null
  }

  /**
   * 获取飞书 access token（带缓存）
   */
  async _getAccessToken() {
    if (this._accessToken && Date.now() < this._accessTokenExpiresAt) {
      return this._accessToken
    }

    const config = this.configManager.getConfig()
    const { appId, appSecret } = config.feishu || {}

    const response = await globalThis.fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    })

    const result = await response.json().catch(() => ({}))
    if (!response.ok || result.code !== 0 || !result.tenant_access_token) {
      const detail = result.msg || result.message || result.error || result.code || response.status
      throw new Error(`Get access token failed: ${detail}`)
    }

    this._accessToken = result.tenant_access_token
    this._accessTokenExpiresAt = Date.now() + (result.expire - 300) * 1000
    return this._accessToken
  }

  /**
   * 处理命令
   */
  async _handleCommand(rawText, chatId, { openId, senderName }) {
    console.log('[Feishu] _handleCommand:', rawText)
    // 暂不支持命令，提示用户
    await this._replyToFeishu(chatId, '飞书机器人当前版本暂不支持命令，请直接发送消息与 Agent 对话')
  }

  /**
   * 接收 AgentSessionManager 的消息事件
   */
  onAgentMessage(sessionId, message) {
    const collector = this.responseCollectors.get(sessionId)
    if (!collector) {
      const pending = this._desktopPendingBlocks.get(sessionId)
      if (!pending) return

      const blocks = message?.content || []
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          pending.textChunks.push(block.text)
        } else if (block.type === 'tool_use' && block.input) {
          this._extractImagePaths(block.input).forEach(p => pending.imagePaths.add(p))
        }
      }
      return
    }

    const blocks = message?.content || []
    const textParts = []
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text)
      } else if (block.type === 'tool_use' && block.input) {
        this._extractImagePaths(block.input).forEach(p => collector.imagePaths.add(p))
      }
    }

    if (textParts.length > 0) {
      const text = textParts.join('\n\n')
      collector.hasSent = true
      this._replyToFeishu(collector.chatId, text).catch(err => {
        console.error(`[Feishu] Immediate reply failed:`, err.message)
      })
    }
  }

  /**
   * 接收 CC 桌面端用户消息
   */
  onUserMessage(sessionId, userInput, inputImages = null) {
    if (!this._sessionWebhooks.has(sessionId)) return

    const isCurrentSession = [...this.sessionMap.values()].includes(sessionId)
    if (!isCurrentSession) {
      console.log(`[Feishu] Desktop intervention blocked for session ${sessionId}: not current connected session`)
      return
    }

    console.log(`[Feishu] Desktop intervention for session ${sessionId}: "${(userInput || '').substring(0, 50)}"${inputImages?.length ? ` + ${inputImages.length} image(s)` : ''}`)
    this._desktopPendingBlocks.set(sessionId, {
      userInput: userInput || '',
      inputImages: inputImages || [],
      textChunks: [],
      imagePaths: new Set()
    })
  }

  /**
   * 接收 Agent 一轮对话完成事件
   */
  onAgentResult(sessionId) {
    const collector = this.responseCollectors.get(sessionId)
    if (!collector) {
      const pending = this._desktopPendingBlocks.get(sessionId)
      if (!pending) return

      this._desktopPendingBlocks.delete(sessionId)

      const webhookInfo = this._sessionWebhooks.get(sessionId)
      if (!webhookInfo) return

      const responseText = pending.textChunks.join('\n\n')

      if (pending.userInput || responseText) {
        const lines = ['💻 桌面端介入：']
        if (pending.userInput) {
          const quotedInput = pending.userInput.split('\n').map(l => `> ${l}`).join('\n')
          lines.push(quotedInput)
        }
        if (responseText) {
          lines.push('')
          lines.push(responseText)
        }
        this._replyToFeishu(webhookInfo.chatId, lines.join('\n')).catch(err => {
          console.error('[Feishu] Desktop intervention reply failed:', err.message)
        })
      }

      if (pending.inputImages && pending.inputImages.length > 0) {
        this._sendBase64Images(pending.inputImages, webhookInfo).catch(err => {
          console.error('[Feishu] Desktop intervention input image forward failed:', err.message)
        })
      }

      if (pending.imagePaths.size > 0) {
        this._sendCollectedImages(pending.imagePaths, webhookInfo).catch(err => {
          console.error('[Feishu] Desktop intervention image forward failed:', err.message)
        })
      }

      return
    }

    clearTimeout(collector.timer)
    this.responseCollectors.delete(sessionId)

    if (!collector.hasSent) {
      this._replyToFeishu(collector.chatId, '（处理完成，无文本输出）').catch(() => {})
    }

    const { imagePaths, chatId, openId } = collector
    collector.resolve()

    if (imagePaths.size > 0) {
      this._sendCollectedImages(imagePaths, { chatId, openId }).catch(err => {
        console.error('[Feishu] Image forward failed:', err.message)
      })
    }
  }

  /**
   * 接收 Agent 错误事件
   */
  onAgentError(sessionId, error) {
    const collector = this.responseCollectors.get(sessionId)
    if (!collector) {
      this._desktopPendingBlocks.delete(sessionId)
      return
    }

    clearTimeout(collector.timer)
    this.responseCollectors.delete(sessionId)

    this._replyToFeishu(collector.chatId, `❌ ${error}`).catch(() => {})
    collector.resolve()
  }

  /**
   * 回复飞书消息
   */
  async _replyToFeishu(chatId, text) {
    console.log('[Feishu] _replyToFeishu called, text length:', text?.length, 'preview:', text?.substring(0, 100))
    if (!chatId) {
      console.warn('[Feishu] No chatId, cannot reply')
      return
    }

    const maxLen = 6000
    if (text && text.length > maxLen) {
      text = text.substring(0, maxLen) + '\n\n...（消息过长，已截断）'
    }

    try {
      const token = await this._getAccessToken()
      if (!token) throw new Error('Failed to get access token')

      // 发送消息到 chat
      const response = await globalThis.fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text })
        })
      })

      if (!response.ok) {
        console.error(`[Feishu] Reply failed: ${response.status} ${response.statusText}`)
      } else {
        console.log('[Feishu] _replyToFeishu: reply sent successfully')
      }
    } catch (err) {
      console.error('[Feishu] Reply error:', err.message)
    }
  }

  /**
   * 提取输入中的图片路径
   */
  async _sendTextMessage(chatId, text) {
    if (!chatId) {
      throw new Error('No Feishu chatId, cannot send message')
    }

    const maxLen = 6000
    if (text && text.length > maxLen) {
      text = text.substring(0, maxLen) + '\n\n...（消息过长，已截断）'
    }

    const token = await this._getAccessToken()
    if (!token) throw new Error('Failed to get access token')

    const response = await globalThis.fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text })
      })
    })
    const body = await response.json().catch(() => ({}))

    if (!response.ok || Number(body?.code || 0) !== 0) {
      const detail = body?.msg || body?.message || response.statusText || response.status
      throw new Error(`Feishu send message failed: ${detail}`)
    }

    return {
      success: true,
      chatId,
      messageId: body?.data?.message_id || null,
      response: body
    }
  }

  _extractImagePaths(input) {
    const paths = []
    if (!input) return paths

    const str = typeof input === 'string' ? input : JSON.stringify(input)
    const imgRegex = /!\[.*?\]\((file:\/\/.*?)\)/g
    let match
    while ((match = imgRegex.exec(str)) !== null) {
      paths.push(match[1])
    }
    return paths
  }

  /**
   * 发送 base64 图片
   */
  async _sendBase64Images(images, webhookInfo) {
    // TODO: 实现 base64 图片发送
  }

  /**
   * 发送收集到的图片
   */
  async _sendCollectedImages(imagePaths, webhookInfo) {
    // TODO: 实现图片发送
  }

  /**
   * 安全发送消息到前端
   */
  _notifyFrontend(channel, data) {
    try {
      if (this.mainWindow &&
          !this.mainWindow.isDestroyed() &&
          this.mainWindow.webContents &&
          !this.mainWindow.webContents.isDestroyed()) {
        this.mainWindow.webContents.send(channel, data)
      }
    } catch (e) {
      // ignore
    }
  }
}

module.exports = { FeishuBridge }
