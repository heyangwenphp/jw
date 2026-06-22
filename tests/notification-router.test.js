import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { NotificationRouter } = require('../src/main/managers/notification-router')

function createFeishuBridge() {
  return {
    isNotificationConfigured: () => true,
    sendNotificationText: vi.fn(async ({ chatId, text }) => ({
      success: true,
      chatId: chatId || 'fallback-chat',
      text
    }))
  }
}

describe('NotificationRouter', () => {
  it('sends through Weixin when the primary channel is healthy', async () => {
    const weixinNotifyService = {
      sendText: vi.fn(async () => ({
        success: true,
        messageId: 'wx-1',
        target: { id: 'target-1', displayName: 'User' }
      }))
    }
    const feishuBridge = createFeishuBridge()
    const router = new NotificationRouter({ weixinNotifyService, feishuBridge })

    const result = await router.send({
      text: 'daily report',
      weixin: { targetId: 'target-1' }
    })

    expect(result.channel).toBe('weixin')
    expect(weixinNotifyService.sendText).toHaveBeenCalledWith({
      targetId: 'target-1',
      text: 'daily report'
    })
    expect(feishuBridge.sendNotificationText).not.toHaveBeenCalled()
  })

  it('falls back to Feishu and enters cooldown when Weixin fails', async () => {
    let currentTime = 1000
    const weixinNotifyService = {
      sendText: vi.fn(async () => {
        throw new Error('session timeout')
      })
    }
    const feishuBridge = createFeishuBridge()
    const router = new NotificationRouter({
      weixinNotifyService,
      feishuBridge,
      now: () => currentTime,
      weixinCooldownMs: 30000
    })

    const first = await router.send({
      text: 'daily report',
      taskName: 'Daily Task',
      weixin: { targetId: 'target-1' },
      feishu: { chatId: 'chat-1' }
    })
    currentTime += 1000
    const second = await router.send({
      text: 'second report',
      weixin: { targetId: 'target-1' },
      feishu: { chatId: 'chat-1' }
    })

    expect(first.channel).toBe('feishu')
    expect(first.weixinError).toBe('session timeout')
    expect(second.channel).toBe('feishu')
    expect(second.skippedWeixin).toBe(true)
    expect(weixinNotifyService.sendText).toHaveBeenCalledTimes(1)
    expect(feishuBridge.sendNotificationText).toHaveBeenCalledTimes(2)
    expect(feishuBridge.sendNotificationText.mock.calls[0][0].text).toContain('【飞书兜底通知】')
  })

  it('tries Weixin again after cooldown and marks it healthy on success', async () => {
    let currentTime = 1000
    const weixinNotifyService = {
      sendText: vi.fn()
        .mockRejectedValueOnce(new Error('session timeout'))
        .mockResolvedValueOnce({ success: true, messageId: 'wx-2' })
    }
    const feishuBridge = createFeishuBridge()
    const router = new NotificationRouter({
      weixinNotifyService,
      feishuBridge,
      now: () => currentTime,
      weixinCooldownMs: 30000
    })

    await router.send({
      text: 'first report',
      weixin: { targetId: 'target-1' },
      feishu: { chatId: 'chat-1' }
    })
    currentTime += 30001
    const recovered = await router.send({
      text: 'recovered report',
      weixin: { targetId: 'target-1' },
      feishu: { chatId: 'chat-1' }
    })

    expect(recovered.channel).toBe('weixin')
    expect(recovered.state.weixin.status).toBe('healthy')
    expect(weixinNotifyService.sendText).toHaveBeenCalledTimes(2)
    expect(feishuBridge.sendNotificationText).toHaveBeenCalledTimes(2)
    expect(recovered.recoveryNotice.text).toContain('【微信通道已恢复】')
  })
})
