const crypto = require('crypto')

const ADMIN_PHONE = '15527109305'
const PHONE_PATTERN = /^1\d{10}$/
const CURRENT_USER_SETTING_KEY = 'currentUserId'

function normalizePhone(phone) {
  return typeof phone === 'string' ? phone.trim() : ''
}

function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    phone: user.phone,
    isAdmin: Boolean(user.isAdmin) || user.phone === ADMIN_PHONE,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return { hash, salt }
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(String(password), salt, 64)
  const expected = Buffer.from(String(expectedHash), 'hex')
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

class AuthManager {
  constructor({ sessionDatabase, configManager }) {
    this.sessionDatabase = sessionDatabase
    this.configManager = configManager
  }

  _setCurrentUserId(userId) {
    if (typeof this.configManager?.updateSettings === 'function') {
      this.configManager.updateSettings({ [CURRENT_USER_SETTING_KEY]: userId || null })
    }
  }

  _getCurrentUserId() {
    return this.configManager?.getConfig?.()?.settings?.[CURRENT_USER_SETTING_KEY] || null
  }

  login({ phone, password } = {}, { persistCurrentUser = true } = {}) {
    const normalizedPhone = normalizePhone(phone)
    const normalizedPassword = typeof password === 'string' ? password : ''
    if (!PHONE_PATTERN.test(normalizedPhone)) return { success: false, error: '请输入有效手机号' }
    if (!normalizedPassword) return { success: false, error: '请输入密码' }
    if (!this.sessionDatabase?.ensureDb?.()) return { success: false, error: '数据库不可用' }

    const existing = this.sessionDatabase.getUserByPhone(normalizedPhone)
    if (!existing) {
      const { hash, salt } = hashPassword(normalizedPassword)
      const user = this.sessionDatabase.createUser({
        phone: normalizedPhone,
        passwordHash: hash,
        passwordSalt: salt
      })
      if (persistCurrentUser) this._setCurrentUserId(user.id)
      return { success: true, user: publicUser(user), registered: true }
    }

    if (!verifyPassword(normalizedPassword, existing.passwordSalt, existing.passwordHash)) {
      return { success: false, error: '密码错误' }
    }

    const user = this.sessionDatabase.touchUserLogin(existing.id)
    if (persistCurrentUser) this._setCurrentUserId(user.id)
    return { success: true, user: publicUser(user), registered: false }
  }

  getCurrentUser() {
    const userId = this._getCurrentUserId()
    if (!userId || !this.sessionDatabase?.ensureDb?.()) return null
    const user = this.sessionDatabase.getUserById(userId)
    if (!user) {
      this._setCurrentUserId(null)
      return null
    }
    return publicUser(user)
  }

  requireCurrentUser() {
    const user = this.getCurrentUser()
    if (!user) {
      const error = new Error('请先登录')
      error.code = 'AUTH_REQUIRED'
      throw error
    }
    return user
  }

  logout() {
    this._setCurrentUserId(null)
    return { success: true }
  }

  canAccessConversation(sessionId, user = this.getCurrentUser()) {
    if (!user) return false
    return this.sessionDatabase.canAccessAgentConversation(sessionId, {
      userId: user.id,
      isAdmin: user.isAdmin
    })
  }
}

module.exports = { AuthManager, ADMIN_PHONE, normalizePhone, publicUser }
