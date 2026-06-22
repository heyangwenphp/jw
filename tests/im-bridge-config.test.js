import { describe, it, expect, vi, afterEach } from 'vitest'

function createIpcMain() {
  const handlers = new Map()
  return {
    handlers,
    handle: vi.fn((channel, handler) => handlers.set(channel, handler))
  }
}

function createConfigManager(initialConfig) {
  const config = JSON.parse(JSON.stringify(initialConfig))
  return {
    getConfig: vi.fn(() => config),
    save: vi.fn(async nextConfig => {
      Object.assign(config, nextConfig)
      return true
    })
  }
}

function createAgentSessionManager() {
  return {
    on: vi.fn(),
    off: vi.fn()
  }
}

describe('IM bridge config handlers', () => {
  it('persists enabled DingTalk config without starting the bridge', async () => {
    const { setupDingTalkHandlers } = require('../src/main/ipc-handlers/dingtalk-handlers')
    const ipcMain = createIpcMain()
    const bridge = { restart: vi.fn(), stop: vi.fn() }
    const configManager = createConfigManager({ dingtalk: {} })

    setupDingTalkHandlers(ipcMain, bridge, configManager)

    const result = await ipcMain.handlers.get('dingtalk:updateConfig')(null, {
      appKey: 'app-key',
      appSecret: 'app-secret',
      enabled: true,
      maxHistorySessions: 8
    })

    expect(result).toBe(true)
    expect(configManager.getConfig().dingtalk).toMatchObject({
      appKey: 'app-key',
      appSecret: 'app-secret',
      enabled: true,
      maxHistorySessions: 8
    })
    expect(bridge.restart).not.toHaveBeenCalled()
    expect(bridge.stop).not.toHaveBeenCalled()
  })

  it('persists enabled Feishu config without starting the bridge', async () => {
    const { setupFeishuHandlers } = require('../src/main/ipc-handlers/feishu-handlers')
    const ipcMain = createIpcMain()
    const bridge = { restart: vi.fn(), stop: vi.fn() }
    const configManager = createConfigManager({ feishu: {} })

    setupFeishuHandlers(ipcMain, bridge, configManager)

    const result = await ipcMain.handlers.get('feishu:updateConfig')(null, {
      appId: 'cli_a',
      appSecret: 'app-secret',
      enabled: true,
      maxHistorySessions: 6
    })

    expect(result).toBe(true)
    expect(configManager.getConfig().feishu).toMatchObject({
      appId: 'cli_a',
      appSecret: 'app-secret',
      enabled: true,
      maxHistorySessions: 6
    })
    expect(bridge.restart).not.toHaveBeenCalled()
    expect(bridge.stop).not.toHaveBeenCalled()
  })
})

describe('IM bridge credential validation', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('does not mark DingTalk connected when token validation fails', async () => {
    const { DingTalkBridge } = require('../src/main/managers/dingtalk-bridge')
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 'InvalidAppSecret', message: 'invalid app secret' })
    }))

    const bridge = new DingTalkBridge(
      { getConfig: () => ({ dingtalk: { enabled: true, appKey: 'bad', appSecret: 'bad' } }) },
      createAgentSessionManager(),
      null
    )

    const result = await bridge.start()

    expect(result).toBe(false)
    expect(bridge.getStatus().connected).toBe(false)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.dingtalk.com/v1.0/oauth2/accessToken',
      expect.objectContaining({ method: 'POST' })
    )
    await bridge.stop()
  })

  it('does not mark Feishu connected when token validation fails', async () => {
    const { FeishuBridge } = require('../src/main/managers/feishu-bridge')
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 99991663, msg: 'app secret invalid' })
    }))

    const bridge = new FeishuBridge(
      { getConfig: () => ({ feishu: { enabled: true, appId: 'bad', appSecret: 'bad' } }) },
      createAgentSessionManager(),
      null
    )

    const result = await bridge.start()

    expect(result).toBe(false)
    expect(bridge.getStatus().connected).toBe(false)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      expect.objectContaining({ method: 'POST' })
    )
    await bridge.stop()
  })
})

describe('IM bridge web session ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('assigns DingTalk-created sessions to the configured web owner', async () => {
    const { DingTalkBridge } = require('../src/main/managers/dingtalk-bridge')
    const create = vi.fn(() => ({ id: 'dt-session', title: 'DingTalk session' }))
    const bridge = new DingTalkBridge(
      { getConfig: () => ({ dingtalk: { ownerUserId: 'user-1' } }) },
      { ...createAgentSessionManager(), create, sessionDatabase: null },
      null
    )

    await bridge._createNewSession('staff-1', 'Alice', 'conv-1', 'Group', 'staff-1:conv-1')

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dingtalk',
      ownerUserId: 'user-1'
    }))
    await bridge.stop()
  })

  it('assigns Feishu-created sessions to the configured web owner', async () => {
    const { FeishuBridge } = require('../src/main/managers/feishu-bridge')
    const create = vi.fn(() => ({ id: 'fs-session', title: 'Feishu session' }))
    const bridge = new FeishuBridge(
      { getConfig: () => ({ feishu: { ownerUserId: 'user-2' } }) },
      { ...createAgentSessionManager(), create, sessionDatabase: null },
      null
    )

    await bridge._createNewSession('open-1', 'Bob', 'chat-1', 'open-1:chat-1')

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'feishu',
      ownerUserId: 'user-2'
    }))
    await bridge.stop()
  })
})
