/**
 * Weixin Bridge
 * Receives inbound Weixin notify messages and displays them in desktop Agent sessions.
 */

const path = require('path')

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp)$/i
const IMAGE_PATH_MAX_DEPTH = 10

class WeixinBridge {
  constructor(configManager, agentSessionManager, weixinNotifyService, mainWindow) {
    this.configManager = configManager
    this.agentSessionManager = agentSessionManager
    this.weixinNotifyService = weixinNotifyService
    this.mainWindow = mainWindow
    this.sessionMap = new Map()
    this.knownTargets = new Map()
    this.sessionTargets = new Map()
    this.pendingReplies = new Map()
    this.replySendQueues = new Map()
    this.desktopPendingBlocks = new Map()
    this.pendingInteractions = new Map()
    this.inboundMessageQueues = new Map()
    this.inboundCompletionWaiters = new Map()
    this._unbindMessage = null
    this._unbindSent = null
    this._agentListeners = null
  }

  start() {
    if (!this.weixinNotifyService || this._unbindMessage) return false
    this._unbindMessage = this.weixinNotifyService.on('message', (message) => {
      this._enqueueInboundMessage(message)
    })
    this._unbindSent = this.weixinNotifyService.on('sent', (message) => {
      this._rememberSentSession(message)
    })
    this._bindAgentEvents()
    return true
  }

  stop() {
    if (this._unbindMessage) {
      this._unbindMessage()
      this._unbindMessage = null
    }
    if (this._unbindSent) {
      this._unbindSent()
      this._unbindSent = null
    }
    this._unbindAgentEvents()
    this.pendingReplies.clear()
    this.replySendQueues.clear()
    this.desktopPendingBlocks.clear()
    this.pendingInteractions.clear()
    this.inboundMessageQueues.clear()
    this._resolveInboundCompletionWaiters()
  }

  _enqueueInboundMessage(message) {
    const mapKey = this._getMapKey(message)
    if (this._findPendingInteractionForMessage(message)) {
      return this._handleMessageAndWait(message).catch(err => {
        console.error('[WeixinBridge] Interaction response handling error:', err)
      })
    }

    const previous = this.inboundMessageQueues.get(mapKey) || Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(() => this._handleMessageAndWait(message))
      .catch(err => {
        console.error('[WeixinBridge] Message handling error:', err)
      })
      .finally(() => {
        if (this.inboundMessageQueues.get(mapKey) === next) {
          this.inboundMessageQueues.delete(mapKey)
        }
      })
    this.inboundMessageQueues.set(mapKey, next)
    return next
  }

  async _handleMessageAndWait(message) {
    const sessionId = await this._handleMessage(message)
    if (!sessionId) return null
    return this._waitForAgentCompletion(sessionId)
  }

  _waitForAgentCompletion(sessionId) {
    if (!sessionId) return Promise.resolve()
    const session = this.agentSessionManager?.sessions?.get(sessionId)
    if (!session || session.status !== 'streaming') return Promise.resolve()

    return new Promise(resolve => {
      const waiters = this.inboundCompletionWaiters.get(sessionId) || []
      waiters.push(resolve)
      this.inboundCompletionWaiters.set(sessionId, waiters)
    })
  }

  _resolveInboundCompletionWaiters(sessionId = null) {
    if (sessionId) {
      const waiters = this.inboundCompletionWaiters.get(sessionId) || []
      this.inboundCompletionWaiters.delete(sessionId)
      waiters.forEach(resolve => resolve())
      return
    }

    for (const waiters of this.inboundCompletionWaiters.values()) {
      waiters.forEach(resolve => resolve())
    }
    this.inboundCompletionWaiters.clear()
  }

  async _handleMessage(message) {
    const text = String(message?.text || '').trim()
    const images = Array.isArray(message?.images) ? message.images : []
    if (!text && images.length === 0) return null

    const session = this._ensureSession(message)
    const senderNick = this._getTargetDisplayName(message)
    this._rememberSessionTarget(session.id, message)

    if (this.pendingInteractions.has(session.id)) {
      await this._handleInteractionResponse(session.id, message, text)
      this._notifyFrontend('weixin:messageReceived', {
        sessionId: session.id,
        accountId: message.accountId,
        targetId: message.targetId,
        from: message.from,
        text: text || '[互动回复]',
        images,
        senderNick,
        timestamp: Date.now(),
        messageId: null
      })
      return session.id
    }

    const userMessage = images.length > 0 ? { text, images } : text
    await this.agentSessionManager.sendMessage(session.id, userMessage, {
      meta: {
        source: 'weixin',
        senderNick,
        accountId: message.accountId,
        targetId: message.targetId,
        from: message.from,
        contextToken: message.contextToken || null,
        createTimeMs: message.createTimeMs || null
      }
    })

    const storedMessage = [...(this.agentSessionManager.sessions.get(session.id)?.messages || [])]
      .reverse()
      .find(item => item.role === 'user' && item.source === 'weixin' && item.content === (text || '[图片]'))

    this._notifyFrontend('weixin:messageReceived', {
      sessionId: session.id,
      accountId: message.accountId,
      targetId: message.targetId,
      from: message.from,
      text: text || '[图片]',
      images,
      senderNick,
      timestamp: storedMessage?.timestamp || Date.now(),
      messageId: storedMessage?.id || null
    })

    return session.id
  }

  _bindAgentEvents() {
    if (this._agentListeners || !this.agentSessionManager?.on) return

    this._agentListeners = {
      userMessage: ({ sessionId, sessionType, content, images, source }) => {
        const hasBinding = this.sessionTargets.has(sessionId)
        if (source !== 'weixin' && (sessionType === 'weixin' || hasBinding)) {
          try { this._recordDesktopIntervention(sessionId, content, images) } catch (err) {
            console.error('[WeixinBridge] Record desktop intervention failed:', err)
          }
        }
      },
      agentMessage: (sessionId, message) => {
        try { this._collectAgentReply(sessionId, message) } catch (err) {
          console.error('[WeixinBridge] Collect agent reply failed:', err)
        }
      },
      agentResult: (sessionId) => {
        this._flushAgentReply(sessionId).catch(err => {
          console.error('[WeixinBridge] Flush agent reply failed:', err)
        }).finally(() => {
          this._resolveInboundCompletionWaiters(sessionId)
        })
      },
      agentError: (sessionId) => {
        this.pendingReplies.delete(sessionId)
        this.pendingInteractions.delete(sessionId)
        this._resolveInboundCompletionWaiters(sessionId)
      },
      interactionRequest: ({ sessionId, interaction }) => {
        this._sendInteractionRequest(sessionId, interaction).catch(err => {
          console.error('[WeixinBridge] Send interaction request failed:', err)
        })
      },
      interactionResolved: ({ sessionId, interactionId }) => {
        const pending = this.pendingInteractions.get(sessionId)
        if (pending?.interactionId === interactionId) {
          this.pendingInteractions.delete(sessionId)
        }
      }
    }

    for (const [eventName, listener] of Object.entries(this._agentListeners)) {
      this.agentSessionManager.on(eventName, listener)
    }
  }

  _unbindAgentEvents() {
    if (!this._agentListeners || !this.agentSessionManager?.off) return

    for (const [eventName, listener] of Object.entries(this._agentListeners)) {
      this.agentSessionManager.off(eventName, listener)
    }
    this._agentListeners = null
  }

  _collectAgentReply(sessionId, message) {
    if (this.pendingInteractions.has(sessionId)) return

    const desktopPending = this.desktopPendingBlocks.get(sessionId)
    if (desktopPending) {
      this._collectTextChunks(desktopPending, message)
      this._collectImagePaths(desktopPending, message, sessionId)
      return
    }

    const target = this.sessionTargets.get(sessionId)
    if (!target) return

    const text = this._extractTextFromMessage(message)
    if (text) {
      this._queueAgentTextReply(sessionId, target, text)
    }

    const pending = this.pendingReplies.get(sessionId) || { imagePaths: new Set() }
    this._collectImagePaths(pending, message, sessionId)
    if (pending.imagePaths?.size > 0) {
      this.pendingReplies.set(sessionId, pending)
    }
  }

  _extractTextFromMessage(message) {
    const blocks = Array.isArray(message?.content) ? message.content : []
    const textParts = blocks
      .filter(block => block?.type === 'text' && block.text)
      .map(block => block.text)

    return textParts.join('\n\n').trim()
  }

  _queueAgentTextReply(sessionId, target, text) {
    const previous = this.replySendQueues.get(sessionId) || Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(() => this.weixinNotifyService.sendText({
        accountId: target.accountId,
        targetId: target.targetId,
        text,
        sessionId
      }))
      .catch(err => {
        console.error('[WeixinBridge] Immediate agent reply failed:', err.message)
      })
      .finally(() => {
        if (this.replySendQueues.get(sessionId) === next) {
          this.replySendQueues.delete(sessionId)
        }
      })

    this.replySendQueues.set(sessionId, next)
    return next
  }

  _collectTextChunks(pending, message) {
    const blocks = Array.isArray(message?.content) ? message.content : []
    const textParts = blocks
      .filter(block => block?.type === 'text' && block.text)
      .map(block => block.text)

    if (!textParts.length) return
    pending.textChunks.push(textParts.join('\n\n'))
  }

  _collectImagePaths(pending, message, sessionId) {
    const blocks = Array.isArray(message?.content) ? message.content : []
    if (!pending.imagePaths) pending.imagePaths = new Set()
    for (const block of blocks) {
      if (block?.type === 'tool_use' && block.input) {
        this._extractImagePaths(block.input, sessionId).forEach(filePath => pending.imagePaths.add(filePath))
      }
    }
  }

  async _flushAgentReply(sessionId) {
    if (this.desktopPendingBlocks.has(sessionId)) {
      return this._flushDesktopIntervention(sessionId)
    }

    const target = this.sessionTargets.get(sessionId)
    const pending = this.pendingReplies.get(sessionId)
    this.pendingReplies.delete(sessionId)

    const imagePaths = [...(pending?.imagePaths || [])]
    if (!target || imagePaths.length === 0) return null

    const pendingTextSend = this.replySendQueues.get(sessionId)
    if (pendingTextSend) {
      await pendingTextSend.catch(() => {})
    }

    if (imagePaths.length > 0 && this.weixinNotifyService.sendImages) {
      return this.weixinNotifyService.sendImages({
        accountId: target.accountId,
        targetId: target.targetId,
        text: '',
        imagePaths,
        sessionId
      })
    }
  }

  _recordDesktopIntervention(sessionId, userInput, inputImages = null) {
    const target = this._getKnownTarget(sessionId)
    if (!target) return

    this.desktopPendingBlocks.set(sessionId, {
      userInput: String(userInput || ''),
      inputImages: Array.isArray(inputImages) ? inputImages : [],
      textChunks: [],
      imagePaths: new Set()
    })
  }

  async _flushDesktopIntervention(sessionId) {
    const pending = this.desktopPendingBlocks.get(sessionId)
    this.desktopPendingBlocks.delete(sessionId)

    const target = this._getKnownTarget(sessionId)
    if (!target || !pending) return null

    const responseText = pending.textChunks.join('\n\n').trim()
    if (!pending.userInput && !responseText) return null

    const lines = ['桌面端介入：']
    if (pending.userInput) {
      lines.push(pending.userInput.split('\n').map(line => `> ${line}`).join('\n'))
    }
    if (responseText) {
      lines.push('')
      lines.push(responseText)
    }

    const text = lines.join('\n')
    const imagePaths = [...(pending.imagePaths || [])]
    if ((pending.inputImages.length > 0 || imagePaths.length > 0) && this.weixinNotifyService.sendImages) {
      return this.weixinNotifyService.sendImages({
        accountId: target.accountId,
        targetId: target.targetId,
        text,
        images: pending.inputImages,
        imagePaths,
        sessionId
      })
    }

    return this.weixinNotifyService.sendText({
      accountId: target.accountId,
      targetId: target.targetId,
      text,
      sessionId
    })
  }

  async _sendInteractionRequest(sessionId, interaction = {}) {
    if (!sessionId || interaction?.kind !== 'ask_user_question') return null

    const target = this._getKnownTarget(sessionId)
    if (!target) return null

    const questions = Array.isArray(interaction.questions) ? interaction.questions : []
    const text = this._formatInteractionText(interaction)
    if (!text) return null

    this.pendingInteractions.set(sessionId, {
      interactionId: interaction.interactionId,
      messageId: interaction.messageId || null,
      questions,
      target,
      createdAt: Date.now()
    })

    return this.weixinNotifyService.sendText({
      accountId: target.accountId,
      targetId: target.targetId,
      text,
      sessionId
    })
  }

  async _handleInteractionResponse(sessionId, message, text) {
    const pending = this.pendingInteractions.get(sessionId)
    if (!pending) return false

    const answerText = String(text || '').trim()
    if (!answerText) {
      await this.weixinNotifyService.sendText({
        accountId: pending.target.accountId,
        targetId: pending.target.targetId,
        text: '请用文字回复这个问题。',
        sessionId
      })
      return true
    }

    this.pendingInteractions.delete(sessionId)
    const questions = pending.questions || []
    const answers = this._buildInteractionAnswers(questions, answerText)
    this.agentSessionManager.resolveInteraction(sessionId, pending.interactionId, {
      answers,
      questions,
      behavior: 'allow',
      annotations: {
        source: 'weixin',
        accountId: message.accountId || pending.target.accountId,
        targetId: message.targetId || pending.target.targetId,
        from: message.from || null
      }
    })
    return true
  }

  _formatInteractionText(interaction = {}) {
    const lines = []
    const title = String(interaction.title || interaction.displayName || '需要你确认').trim()
    if (title) lines.push(title)
    if (interaction.description) lines.push(String(interaction.description).trim())

    const questions = Array.isArray(interaction.questions) ? interaction.questions : []
    questions.forEach((question, index) => {
      const questionText = String(question?.question || question?.header || `问题 ${index + 1}`).trim()
      lines.push('')
      lines.push(`${index + 1}. ${questionText}`)
      const options = Array.isArray(question?.options) ? question.options : []
      options.forEach((option, optionIndex) => {
        const label = String(option?.label || option?.value || '').trim()
        const description = String(option?.description || '').trim()
        if (!label && !description) return
        const prefix = `${optionIndex + 1})`
        lines.push(description ? `${prefix} ${label} - ${description}` : `${prefix} ${label}`)
      })
    })

    lines.push('')
    lines.push(questions.length > 1
      ? '请按顺序回复，每个答案单独一行。'
      : '请直接回复答案。')
    return lines.map(line => line.trimEnd()).join('\n').trim()
  }

  _buildInteractionAnswers(questions, answerText) {
    const list = Array.isArray(questions) ? questions : []
    if (list.length === 0) {
      return [{ question: 'answer', answer: answerText }]
    }

    const parts = list.length > 1
      ? answerText.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
      : [answerText]

    return list.map((question, index) => ({
      question: question?.question || question?.header || `question_${index + 1}`,
      answer: this._normalizeInteractionAnswer(question, parts[index] || parts[parts.length - 1] || answerText)
    }))
  }

  _normalizeInteractionAnswer(question, rawAnswer) {
    const answer = String(rawAnswer || '').trim()
    const options = Array.isArray(question?.options) ? question.options : []
    if (!options.length) return answer

    const matched = options.find((option, index) => {
      const label = String(option?.label || '').trim()
      const value = String(option?.value || '').trim()
      return answer === String(index + 1) || answer === label || (value && answer === value)
    })
    return matched?.label || matched?.value || answer
  }

  _findPendingInteractionForMessage(message) {
    const mapKey = this._getMapKey(message)
    const sessionId = this.sessionMap.get(mapKey)
    return sessionId ? this.pendingInteractions.get(sessionId) : null
  }

  _extractImagePaths(obj, sessionId, depth = 0) {
    if (depth > IMAGE_PATH_MAX_DEPTH) return []
    const paths = []
    if (typeof obj === 'string') {
      if (IMAGE_EXTENSIONS.test(obj) && (obj.startsWith('/') || /^[A-Z]:[/\\]/.test(obj))) {
        const normalizedPath = this._normalizePath(obj)
        if (this._isAllowedSessionImagePath(normalizedPath, sessionId)) {
          paths.push(normalizedPath)
        }
      }
    } else if (obj && typeof obj === 'object') {
      for (const value of Object.values(obj)) {
        paths.push(...this._extractImagePaths(value, sessionId, depth + 1))
      }
    }
    return paths
  }

  _isAllowedSessionImagePath(filePath, sessionId) {
    const session = sessionId ? this._resolveSession(sessionId) : null
    if (!session?.cwd) return false

    const cwd = path.resolve(session.cwd)
    const resolvedPath = path.resolve(filePath)
    const normalizedCwd = cwd.toLowerCase()
    const normalizedPath = resolvedPath.toLowerCase()
    return normalizedPath === normalizedCwd || normalizedPath.startsWith(`${normalizedCwd}${path.sep}`)
  }

  _normalizePath(filePath) {
    const msysMatch = filePath.match(/^\/([a-zA-Z])\/(.*)$/)
    if (msysMatch) {
      return `${msysMatch[1].toUpperCase()}:/${msysMatch[2]}`
    }
    return filePath
  }

  _ensureSession(message) {
    const mapKey = this._getMapKey(message)
    const existingSessionId = this.sessionMap.get(mapKey)
    if (existingSessionId) {
      const existingSession = this._resolveSession(existingSessionId)
      if (existingSession) return existingSession
      this.sessionMap.delete(mapKey)
    }

    const senderNick = this._getTargetDisplayName(message)
    const session = this.agentSessionManager.create({
      type: 'weixin',
      source: 'weixin',
      title: `微信 · ${senderNick}`,
      cwdSubDir: 'weixin',
      meta: {
        accountId: message.accountId,
        targetId: message.targetId,
        from: message.from
      }
    })

    this.sessionMap.set(mapKey, session.id)
    this._notifyFrontend('weixin:sessionCreated', {
      sessionId: session.id,
      accountId: message.accountId,
      targetId: message.targetId,
      from: message.from,
      senderNick,
      title: session.title
    })

    return session
  }

  _rememberSentSession(message) {
    const sessionId = message?.sessionId
    if (!sessionId) return

    const session = this._resolveSession(sessionId)
    if (!session) return

    const mapKey = this._getMapKey(message)
    this.sessionMap.set(mapKey, session.id)
    this._rememberKnownTarget(session.id, message)
  }

  _rememberSessionTarget(sessionId, message) {
    if (!sessionId || !message?.targetId) return
    const target = this._rememberKnownTarget(sessionId, message)
    if (target) {
      this.sessionTargets.set(sessionId, target)
    }
  }

  _rememberKnownTarget(sessionId, message) {
    if (!sessionId || !message?.targetId) return null
    const target = {
      accountId: message.accountId || message.target?.accountId || null,
      targetId: message.targetId,
      displayName: this._getTargetDisplayName(message)
    }
    this.knownTargets.set(sessionId, target)
    return target
  }

  _getKnownTarget(sessionId) {
    return this.knownTargets.get(sessionId) || this.sessionTargets.get(sessionId) || null
  }

  _resolveSession(sessionId) {
    const inMemory = this.agentSessionManager.sessions.get(sessionId)
    if (inMemory) return inMemory

    const db = this.agentSessionManager.sessionDatabase
    const row = db && db.getAgentConversation(sessionId)
    if (!row || row.status === 'closed') return null

    const reopened = this.agentSessionManager.reopen(sessionId)
    return reopened || null
  }

  _getMapKey(message) {
    return message?.targetId || `${message?.accountId || 'unknown'}:${message?.from || 'unknown'}`
  }

  _getTargetDisplayName(message) {
    return message?.target?.displayName || message?.from || message?.targetId || '未知用户'
  }

  /**
   * 将普通 chat 会话绑定到微信目标，建立双向通道
   */
  bindSessionToTarget(sessionId, { accountId, targetId, displayName } = {}) {
    if (!sessionId || !accountId || !targetId) {
      throw new Error('sessionId, accountId 和 targetId 不能为空')
    }
    const session = this._resolveSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} 不存在或已关闭`)
    }
    for (const [mapKey, mappedSessionId] of this.sessionMap.entries()) {
      if (mappedSessionId === sessionId && mapKey !== targetId) {
        this.sessionMap.delete(mapKey)
      }
    }
    const previousSessionId = this.sessionMap.get(targetId)
    if (previousSessionId && previousSessionId !== sessionId) {
      this.knownTargets.delete(previousSessionId)
      this.sessionTargets.delete(previousSessionId)
      this.pendingReplies.delete(previousSessionId)
      this.replySendQueues.delete(previousSessionId)
      this.desktopPendingBlocks.delete(previousSessionId)
      this.pendingInteractions.delete(previousSessionId)
      for (const [mapKey, mappedSessionId] of this.sessionMap.entries()) {
        if (mappedSessionId === previousSessionId && mapKey === targetId) {
          this.sessionMap.delete(mapKey)
        }
      }
    }

    const target = { accountId, targetId, displayName: displayName || targetId }
    this.sessionMap.set(targetId, sessionId)
    this.knownTargets.set(sessionId, target)
    this.sessionTargets.set(sessionId, target)
    this.pendingReplies.delete(sessionId)
    this.desktopPendingBlocks.delete(sessionId)
    this.pendingInteractions.delete(sessionId)
    console.log(`[WeixinBridge] Bound session ${sessionId} to target ${targetId} (${displayName || targetId})`)
    return { success: true, target }
  }

  /**
   * 解除会话与微信目标的绑定
   */
  unbindSessionTarget(sessionId) {
    if (!sessionId) return { success: false, error: 'sessionId 不能为空' }
    const target = this.knownTargets.get(sessionId) || this.sessionTargets.get(sessionId)
    if (target?.targetId && this.sessionMap.get(target.targetId) === sessionId) {
      this.sessionMap.delete(target.targetId)
    }
    for (const [mapKey, mappedSessionId] of this.sessionMap.entries()) {
      if (mappedSessionId === sessionId) {
        this.sessionMap.delete(mapKey)
      }
    }
    this.knownTargets.delete(sessionId)
    this.sessionTargets.delete(sessionId)
    this.pendingReplies.delete(sessionId)
    this.replySendQueues.delete(sessionId)
    this.desktopPendingBlocks.delete(sessionId)
    this.pendingInteractions.delete(sessionId)
    console.log(`[WeixinBridge] Unbound session ${sessionId}`)
    return { success: true }
  }

  /**
   * 获取会话的微信绑定信息
   */
  getSessionBinding(sessionId) {
    if (!sessionId) return null
    const target = this.knownTargets.get(sessionId) || this.sessionTargets.get(sessionId) || null
    if (!target) return null
    return {
      accountId: target.accountId,
      targetId: target.targetId,
      displayName: target.displayName
    }
  }

  _notifyFrontend(channel, data) {
    const targetWindow = this.mainWindow || this.agentSessionManager?.mainWindow
    if (!targetWindow || targetWindow.isDestroyed?.()) return
    targetWindow.webContents?.send(channel, data)
  }
}

module.exports = { WeixinBridge }
