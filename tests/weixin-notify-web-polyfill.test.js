import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('weixin notify web polyfill', () => {
  const source = readSource('src/renderer/client-api/electron-polyfill.js')
  const apiSource = readSource('src/renderer/client-api/api.js')
  const serverSource = readSource('server/index.js')

  it('routes Weixin Notify operations through the web API client', () => {
    expect(apiSource).toContain('startWeixinNotifyLogin')
    expect(apiSource).toContain("api.post('/api/weixin-notify/login/start'")
    expect(apiSource).toContain('waitWeixinNotifyLogin')
    expect(apiSource).toContain("api.post('/api/weixin-notify/login/wait'")
    expect(apiSource).toContain('listWeixinNotifyAccounts')
    expect(apiSource).toContain("api.get('/api/weixin-notify/accounts')")
    expect(apiSource).toContain('sendWeixinNotifyText')
    expect(apiSource).toContain("api.post('/api/weixin-notify/send-text'")

    expect(source).toContain('startWeixinNotifyLogin, waitWeixinNotifyLogin,')
    expect(source).toContain('listWeixinNotifyAccounts, listWeixinNotifyTargets,')
    expect(source).toContain('updateWeixinNotifyTarget, deleteWeixinNotifyTarget,')
    expect(source).toContain('pollWeixinNotifyOnce, sendWeixinNotifyText,')
    expect(source).toContain('bindSessionToWeixinTarget, unbindSessionWeixinTarget, getSessionWeixinBinding,')
    expect(source).toContain('startWeixinNotifyLogin,')
    expect(source).not.toContain('unsupportedWeixinNotify')
    expect(source).not.toContain('startWeixinNotifyLogin: noop')
  })

  it('exposes Weixin Notify routes on the web server for the admin account only', () => {
    expect(serverSource).toContain("const { WeixinNotifyService } = require('../src/main/managers/weixin-notify-service')")
    expect(serverSource).toContain("const { WeixinBridge } = require('../src/main/managers/weixin-bridge')")
    expect(serverSource).toContain('const weixinNotifyService = new WeixinNotifyService(configManager)')
    expect(serverSource).toContain('agentSessionManager.weixinNotifyService = weixinNotifyService')
    expect(serverSource).toContain('const weixinBridge = new WeixinBridge(configManager, agentSessionManager, weixinNotifyService, null)')
    expect(serverSource).toContain('function requireWeixinNotifyAdmin(req)')
    expect(serverSource).toContain("currentUser.phone !== '15527109305'")
    expect(serverSource).toContain("app.post('/api/weixin-notify/login/start'")
    expect(serverSource).toContain("app.post('/api/weixin-notify/login/wait'")
    expect(serverSource).toContain("app.get('/api/weixin-notify/accounts'")
    expect(serverSource).toContain("app.get('/api/weixin-notify/targets'")
    expect(serverSource).toContain("app.post('/api/weixin-notify/send-text'")
  })
})
