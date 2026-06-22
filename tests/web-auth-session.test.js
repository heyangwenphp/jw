import { describe, expect, it, vi, afterEach } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function createResponse() {
  return {
    cookies: [],
    cleared: [],
    redirects: [],
    cookie(name, value, options) {
      this.cookies.push({ name, value, options })
    },
    clearCookie(name, options) {
      this.cleared.push({ name, options })
    },
    redirect(status, url) {
      this.redirects.push({ status, url })
    }
  }
}

describe('web auth session cookies', () => {
  it('protects every page except the login page', () => {
    const { createWebAuthSession } = require('../server/web-auth-session.js')
    const auth = createWebAuthSession({
      sessionSecret: 'test-secret',
      authManager: { sessionDatabase: { getUserById: () => null } }
    })

    const loginNext = vi.fn()
    auth.requirePageAuth({ path: '/pages/login/' }, createResponse(), loginNext)
    expect(loginNext).toHaveBeenCalled()

    const mainRes = createResponse()
    const mainNext = vi.fn()
    auth.requirePageAuth({ path: '/pages/main/' }, mainRes, mainNext)
    expect(mainNext).not.toHaveBeenCalled()
    expect(mainRes.redirects).toEqual([{ status: 302, url: '/pages/login/' }])
  })

  it('uses the request cookie and does not fall back to the locally persisted current user', () => {
    const { createWebAuthSession } = require('../server/web-auth-session.js')
    const users = new Map([
      [7, { id: 7, phone: '15500000001' }],
      [9, { id: 9, phone: '15500000002' }]
    ])
    const auth = createWebAuthSession({
      sessionSecret: 'test-secret',
      authManager: {
        getCurrentUser: () => ({ id: 9, phone: '15500000002' }),
        sessionDatabase: {
          ensureDb: () => true,
          getUserById: id => users.get(Number(id)) || null
        }
      }
    })

    const res = createResponse()
    auth.setUserCookie(res, 7)
    const cookie = `${res.cookies[0].name}=${res.cookies[0].value}`

    expect(auth.getCurrentUser({ headers: { cookie } })).toEqual(expect.objectContaining({
      id: 7,
      phone: '15500000001'
    }))
    expect(auth.getCurrentUser({ headers: {} })).toBeNull()
  })
})

describe('web API client auth cookies', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends browser credentials with HTTP API requests', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, user: null })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { authGetCurrentUser } = await import('../src/renderer/client-api/api.js')
    await authGetCurrentUser()

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/auth/current-user'), expect.objectContaining({
      credentials: 'include'
    }))
  })
})
