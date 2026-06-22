import { describe, expect, it, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useAgentPanel } from '../src/renderer/composables/useAgentPanel.js'
import { getPageUrl, requireMainPageAuth, redirectToMainPage } from '../src/renderer/utils/auth-navigation.js'

function readSource(relativePath) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

describe('useAgentPanel auth state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads current user and skips conversation loading when logged out', async () => {
    const listAgentSessions = vi.fn(async () => [{ id: 'hidden' }])
    vi.stubGlobal('window', {
      electronAPI: {
        authGetCurrentUser: vi.fn(async () => ({ success: true, user: null })),
        listAgentSessions
      }
    })

    const panel = useAgentPanel()
    await panel.loadCurrentUser()
    await panel.loadConversations()

    expect(panel.currentUser.value).toBe(null)
    expect(listAgentSessions).not.toHaveBeenCalled()
    expect(panel.conversations.value).toEqual([])
  })

  it('logs in and then loads conversations', async () => {
    const listAgentSessions = vi.fn(async () => [{ id: 'owned' }])
    vi.stubGlobal('window', {
      electronAPI: {
        authGetCurrentUser: vi.fn(async () => ({ success: true, user: null })),
        authLogin: vi.fn(async () => ({ success: true, user: { id: 1, phone: '15500000001', isAdmin: false } })),
        listAgentSessions
      }
    })

    const panel = useAgentPanel()
    const result = await panel.login({ phone: '15500000001', password: 'secret123' })

    expect(result.success).toBe(true)
    expect(panel.currentUser.value.phone).toBe('15500000001')
    expect(panel.conversations.value.map(conv => conv.id)).toEqual(['owned'])
  })
})

describe('renderer auth page navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds sibling page urls from the current renderer location', () => {
    const locationLike = {
      origin: 'http://localhost:5173',
      pathname: '/pages/main/index.html',
      search: ''
    }

    expect(getPageUrl('login', locationLike)).toBe('/pages/login/')
    expect(getPageUrl('main', locationLike)).toBe('/pages/main/')
  })

  it('builds packaged file urls for sibling renderer pages', () => {
    const locationLike = {
      protocol: 'file:',
      href: 'file:///C:/app/dist/pages/main/index.html',
      pathname: '/C:/app/dist/pages/main/index.html',
      search: ''
    }

    expect(getPageUrl('login', locationLike)).toBe('file:///C:/app/dist/pages/login/index.html')
  })

  it('redirects the main page to login when no user is logged in', async () => {
    const locationLike = {
      origin: 'http://localhost:5173',
      pathname: '/pages/main/',
      href: 'http://localhost:5173/pages/main/',
      assign: vi.fn()
    }

    const user = await requireMainPageAuth({
      electronAPI: {
        authGetCurrentUser: vi.fn(async () => ({ success: true, user: null }))
      },
      location: locationLike
    })

    expect(user).toBe(null)
    expect(locationLike.assign).toHaveBeenCalledWith('/pages/login/')
  })

  it('redirects to main page after login succeeds', () => {
    const locationLike = {
      origin: 'http://localhost:5173',
      pathname: '/pages/login/',
      href: 'http://localhost:5173/pages/login/',
      assign: vi.fn()
    }

    redirectToMainPage(locationLike)

    expect(locationLike.assign).toHaveBeenCalledWith('/pages/main/')
  })

  it('registers a standalone login page and removes sidebar login markup', () => {
    const viteConfig = readSource('vite.config.mjs')
    const sidebarSource = readSource('src/renderer/pages/main/components/agent/AgentLeftContent.vue')
    const loginHtml = readSource('src/renderer/pages/login/index.html')
    const loginSource = readSource('src/renderer/pages/login/App.vue')
    const polyfillSource = readSource('src/renderer/client-api/electron-polyfill.js')
    const apiSource = readSource('src/renderer/client-api/api.js')
    const serverSource = readSource('server/index.js')

    expect(viteConfig).toContain("'login'")
    expect(sidebarSource).not.toContain('agent-login-panel')
    expect(sidebarSource).not.toContain('agent-user-row')
    expect(sidebarSource).not.toContain('agent-logout-btn')
    expect(loginHtml).toContain('/pages/login/main.js')
    expect(loginHtml).toContain('<title>登录 - 舆情监控</title>')
    expect(loginSource).toContain('<h1>舆情监控</h1>')
    expect(loginSource).not.toContain('Jedi')
    expect(polyfillSource).toContain('authLogin')
    expect(polyfillSource).toContain('authGetCurrentUser')
    expect(polyfillSource).toContain('authLogout')
    expect(apiSource).toContain("api.post('/api/auth/login'")
    expect(serverSource).toContain("app.post('/api/auth/login'")
    expect(serverSource).toContain('agentSessionManager.list({ currentUser })')
    expect(serverSource).toContain('ownerUserId: currentUser.id')
    expect(serverSource).toContain('assertWebConversationAccess')
  })
})
