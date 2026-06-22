const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { publicUser } = require('../src/main/auth-manager')

const DEFAULT_COOKIE_NAME = 'jedi_web_session'
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function base64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

function parseCookies(header) {
  const cookies = {}
  String(header || '').split(';').forEach(part => {
    const index = part.indexOf('=')
    if (index <= 0) return
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name) cookies[name] = decodeURIComponent(value)
  })
  return cookies
}

function loadSessionSecret({ sessionSecret, userDataPath }) {
  if (sessionSecret) return String(sessionSecret)
  if (process.env.JEDI_WEB_SESSION_SECRET) return process.env.JEDI_WEB_SESSION_SECRET
  if (!userDataPath) return crypto.randomBytes(32).toString('hex')

  const secretPath = path.join(userDataPath, 'web-session-secret')
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim()
      if (existing) return existing
    }
    fs.mkdirSync(userDataPath, { recursive: true })
    const next = crypto.randomBytes(32).toString('hex')
    fs.writeFileSync(secretPath, next, { mode: 0o600 })
    return next
  } catch {
    return crypto.randomBytes(32).toString('hex')
  }
}

function createAuthRequiredError() {
  const error = new Error('请先登录')
  error.code = 'AUTH_REQUIRED'
  return error
}

function isLoginPagePath(pathname) {
  return pathname === '/pages/login' || pathname.startsWith('/pages/login/')
}

function isProtectedPagePath(pathname) {
  return pathname === '/' || pathname === '/index.html' || (pathname.startsWith('/pages/') && !isLoginPagePath(pathname))
}

function createWebAuthSession({
  authManager,
  userDataPath = null,
  sessionSecret = null,
  cookieName = DEFAULT_COOKIE_NAME,
  secureCookie = false
} = {}) {
  const secret = loadSessionSecret({ sessionSecret, userDataPath })
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(secureCookie),
    path: '/',
    maxAge: DEFAULT_MAX_AGE_MS
  }

  function createToken(userId) {
    const payload = base64Url(JSON.stringify({ userId, iat: Date.now() }))
    return `${payload}.${signPayload(payload, secret)}`
  }

  function verifyToken(token) {
    const [payload, signature] = String(token || '').split('.')
    if (!payload || !signature) return null
    const expected = signPayload(payload, secret)
    if (!timingSafeEqualString(signature, expected)) return null
    try {
      const parsed = JSON.parse(fromBase64Url(payload))
      return parsed.userId || null
    } catch {
      return null
    }
  }

  function getTokenFromRequest(req) {
    return parseCookies(req?.headers?.cookie || '')[cookieName] || null
  }

  function getCurrentUser(req) {
    const userId = verifyToken(getTokenFromRequest(req))
    if (!userId) return null
    if (typeof authManager?.sessionDatabase?.ensureDb === 'function' && !authManager.sessionDatabase.ensureDb()) return null
    const user = authManager?.sessionDatabase?.getUserById?.(userId)
    return publicUser(user)
  }

  function requireUser(req) {
    const user = getCurrentUser(req)
    if (!user) throw createAuthRequiredError()
    return user
  }

  function setUserCookie(res, userId) {
    res.cookie(cookieName, createToken(userId), cookieOptions)
  }

  function clearUserCookie(res) {
    res.clearCookie(cookieName, { path: '/' })
  }

  function requirePageAuth(req, res, next) {
    const pathname = req.path || String(req.url || '').split('?')[0] || '/'
    if (!isProtectedPagePath(pathname)) return next()
    if (getCurrentUser(req)) return next()
    return res.redirect(302, '/pages/login/')
  }

  return {
    cookieName,
    getCurrentUser,
    requireUser,
    setUserCookie,
    clearUserCookie,
    requirePageAuth,
    _createToken: createToken,
    _verifyToken: verifyToken
  }
}

module.exports = {
  createWebAuthSession,
  isProtectedPagePath,
  isLoginPagePath
}
