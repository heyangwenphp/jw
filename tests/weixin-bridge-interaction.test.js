import { EventEmitter } from 'events'
import { createRequire } from 'module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { WeixinBridge } = require('../src/main/managers/weixin-bridge')

function createNotifyService() {
  const emitter = new EventEmitter()
  return {
    on: (event, listener) => {
      emitter.on(event, listener)
      return () => emitter.off(event, listener)
    },
    emit: (event, payload) => emitter.emit(event, payload),
    sendText: vi.fn(async (payload) => ({ success: true, payload }))
  }
}

function createAgentSessionManager() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    sessions: new Map([
      ['session-1', {
        id: 'session-1',
        type: 'weixin',
        status: 'idle',
        messages: []
      }]
    ]),
    sendMessage: vi.fn(),
    resolveInteraction: vi.fn(),
    create: vi.fn(),
    reopen: vi.fn()
  })
}

describe('WeixinBridge interaction forwarding', () => {
  it('sends AskUserQuestion prompts to the bound Weixin target', async () => {
    const notifyService = createNotifyService()
    const agentSessionManager = createAgentSessionManager()
    const bridge = new WeixinBridge(null, agentSessionManager, notifyService, null)

    bridge.bindSessionToTarget('session-1', {
      accountId: 'account-1',
      targetId: 'target-1',
      displayName: 'Alice'
    })
    bridge.start()

    agentSessionManager.emit('interactionRequest', {
      sessionId: 'session-1',
      interaction: {
        interactionId: 'interaction-1',
        kind: 'ask_user_question',
        title: 'Need confirmation',
        questions: [
          {
            question: 'Continue?',
            options: [
              { label: 'Yes', description: 'Proceed' },
              { label: 'No', description: 'Stop' }
            ]
          }
        ]
      }
    })

    await Promise.resolve()

    expect(notifyService.sendText).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      targetId: 'target-1',
      sessionId: 'session-1',
      text: expect.stringContaining('Continue?')
    }))
    expect(bridge.pendingInteractions.get('session-1')?.interactionId).toBe('interaction-1')
  })

  it('uses the next Weixin text reply as the pending interaction answer', async () => {
    const notifyService = createNotifyService()
    const agentSessionManager = createAgentSessionManager()
    const bridge = new WeixinBridge(null, agentSessionManager, notifyService, null)

    bridge.bindSessionToTarget('session-1', {
      accountId: 'account-1',
      targetId: 'target-1',
      displayName: 'Alice'
    })
    bridge.pendingInteractions.set('session-1', {
      interactionId: 'interaction-1',
      questions: [
        {
          question: 'Continue?',
          options: [
            { label: 'Yes', description: 'Proceed' },
            { label: 'No', description: 'Stop' }
          ]
        }
      ],
      target: {
        accountId: 'account-1',
        targetId: 'target-1',
        displayName: 'Alice'
      }
    })

    await bridge._enqueueInboundMessage({
      accountId: 'account-1',
      targetId: 'target-1',
      from: 'user-1',
      text: '1'
    })

    expect(agentSessionManager.sendMessage).not.toHaveBeenCalled()
    expect(agentSessionManager.resolveInteraction).toHaveBeenCalledWith(
      'session-1',
      'interaction-1',
      expect.objectContaining({
        behavior: 'allow',
        answers: [{ question: 'Continue?', answer: 'Yes' }],
        annotations: expect.objectContaining({ source: 'weixin' })
      })
    )
    expect(bridge.pendingInteractions.has('session-1')).toBe(false)
  })
})
