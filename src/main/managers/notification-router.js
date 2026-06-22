const DEFAULT_WEIXIN_COOLDOWN_MS = 30 * 60 * 1000
const DEFAULT_RECOVERY_DUPLICATE_MS = 5 * 60 * 1000

function nowMs(now) {
  const value = typeof now === 'function' ? now() : Date.now()
  if (value instanceof Date) return value.getTime()
  const number = Number(value)
  return Number.isFinite(number) ? number : Date.now()
}

function errorMessage(err) {
  return err?.message || String(err || '')
}

function buildFeishuFallbackText({ text, reason, taskName }) {
  const lines = [
    '【飞书兜底通知】',
    '原计划通过微信推送，但微信通道当前不可用，已自动切换到飞书。'
  ]
  if (taskName) lines.push(`任务：${taskName}`)
  if (reason) lines.push(`微信失败原因：${reason}`)
  lines.push('', text)
  return lines.join('\n')
}

function buildFeishuRecoveryText({ text, taskName }) {
  const lines = [
    '【微信通道已恢复】',
    '系统已成功通过微信发送通知，本条为恢复确认。后续将恢复优先使用微信。'
  ]
  if (taskName) lines.push(`任务：${taskName}`)
  lines.push('', text)
  return lines.join('\n')
}

class NotificationRouter {
  constructor({
    weixinNotifyService = null,
    feishuBridge = null,
    now = Date.now,
    weixinCooldownMs = DEFAULT_WEIXIN_COOLDOWN_MS,
    recoveryDuplicateMs = DEFAULT_RECOVERY_DUPLICATE_MS
  } = {}) {
    this.weixinNotifyService = weixinNotifyService
    this.feishuBridge = feishuBridge
    this.now = now
    this.weixinCooldownMs = weixinCooldownMs
    this.recoveryDuplicateMs = recoveryDuplicateMs
    this.weixinState = {
      status: 'healthy',
      failureCount: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      cooldownUntil: null,
      recoveredAt: null,
      lastError: null
    }
  }

  getState() {
    return {
      weixin: { ...this.weixinState },
      feishu: {
        configured: Boolean(this.feishuBridge?.isNotificationConfigured?.())
      }
    }
  }

  async send({
    text,
    taskName = '',
    weixin = {},
    feishu = {},
    fallbackToFeishu = true
  } = {}) {
    const normalizedText = String(text || '').trim()
    if (!normalizedText) throw new Error('Notification text is required')

    const attemptedWeixin = this._shouldAttemptWeixin()
    if (!attemptedWeixin) {
      return this._sendFeishuFallback({
        text: normalizedText,
        taskName,
        feishu,
        reason: this.weixinState.lastError || 'Weixin is cooling down',
        skippedWeixin: true
      })
    }

    try {
      const weixinResult = await this._sendWeixin({ ...weixin, text: normalizedText })
      const wasUnavailable = this.weixinState.status === 'unavailable'
      this._markWeixinSuccess()
      const result = {
        success: true,
        channel: 'weixin',
        weixin: weixinResult,
        state: this.getState()
      }

      if (fallbackToFeishu && wasUnavailable && this._withinRecoveryDuplicateWindow()) {
        result.recoveryNotice = await this._sendFeishu({
          ...feishu,
          text: buildFeishuRecoveryText({ text: normalizedText, taskName })
        })
      }

      return result
    } catch (err) {
      const reason = errorMessage(err)
      this._markWeixinFailure(reason)
      if (!fallbackToFeishu) throw err
      return this._sendFeishuFallback({
        text: normalizedText,
        taskName,
        feishu,
        reason,
        weixinError: reason
      })
    }
  }

  resetCooldown() {
    const wasCooling = this.weixinState.cooldownUntil != null
    this.weixinState.cooldownUntil = null
    if (wasCooling && this.weixinState.status === 'unavailable') {
      this.weixinState.status = 'healthy'
    }
  }

  _shouldAttemptWeixin() {
    if (!this.weixinNotifyService?.sendText) return false
    const current = nowMs(this.now)
    return !this.weixinState.cooldownUntil || current >= this.weixinState.cooldownUntil
  }

  async _sendWeixin(args) {
    return this.weixinNotifyService.sendText(args)
  }

  async _sendFeishu(args) {
    if (!this.feishuBridge?.sendNotificationText) {
      throw new Error('Feishu notification fallback is not available')
    }
    return this.feishuBridge.sendNotificationText(args)
  }

  async _sendFeishuFallback({ text, taskName, feishu, reason, skippedWeixin = false, weixinError = null }) {
    const feishuResult = await this._sendFeishu({
      ...feishu,
      text: buildFeishuFallbackText({ text, reason, taskName })
    })
    return {
      success: true,
      channel: 'feishu',
      fallback: true,
      skippedWeixin,
      weixinError,
      feishu: feishuResult,
      state: this.getState()
    }
  }

  _markWeixinSuccess() {
    const current = nowMs(this.now)
    const wasUnavailable = this.weixinState.status === 'unavailable'
    this.weixinState.status = 'healthy'
    this.weixinState.failureCount = 0
    this.weixinState.lastSuccessAt = current
    this.weixinState.cooldownUntil = null
    this.weixinState.lastError = null
    this.weixinState.recoveredAt = wasUnavailable ? current : this.weixinState.recoveredAt
  }

  _markWeixinFailure(message) {
    const current = nowMs(this.now)
    this.weixinState.status = 'unavailable'
    this.weixinState.failureCount += 1
    this.weixinState.lastFailureAt = current
    this.weixinState.cooldownUntil = current + this.weixinCooldownMs
    this.weixinState.lastError = message
  }

  _withinRecoveryDuplicateWindow() {
    if (!this.weixinState.recoveredAt) return false
    return nowMs(this.now) - this.weixinState.recoveredAt <= this.recoveryDuplicateMs
  }
}

module.exports = {
  NotificationRouter,
  buildFeishuFallbackText,
  buildFeishuRecoveryText
}
