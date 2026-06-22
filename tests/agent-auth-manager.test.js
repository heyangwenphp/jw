import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { SessionDatabase } = require('../src/main/session-database.js')
const { AuthManager } = require('../src/main/auth-manager.js')

function createStore() {
  const state = {}
  return {
    getConfig: () => ({ settings: { ...state } }),
    updateSettings: (updates) => Object.assign(state, updates)
  }
}

describe('AuthManager', () => {
  it('registers a new phone and persists current user id', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-auth-manager-'))
    let database
    try {
      database = new SessionDatabase({ userDataPath })
      database.init()
      const configManager = createStore()
      const auth = new AuthManager({ sessionDatabase: database, configManager })

      const result = auth.login({ phone: '15500000001', password: 'secret123' })
      expect(result.success).toBe(true)
      expect(result.user.phone).toBe('15500000001')
      expect(result.user.isAdmin).toBe(false)
      expect(auth.getCurrentUser().phone).toBe('15500000001')
      expect(configManager.getConfig().settings.currentUserId).toBe(result.user.id)
    } finally {
      database?.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('rejects an existing phone with the wrong password', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-auth-wrong-'))
    let database
    try {
      database = new SessionDatabase({ userDataPath })
      database.init()
      const auth = new AuthManager({ sessionDatabase: database, configManager: createStore() })

      auth.login({ phone: '15500000001', password: 'secret123' })
      const result = auth.login({ phone: '15500000001', password: 'bad-password' })

      expect(result.success).toBe(false)
      expect(result.error).toBe('密码错误')
    } finally {
      database?.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('marks phone 15527109305 as admin', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-auth-admin-'))
    let database
    try {
      database = new SessionDatabase({ userDataPath })
      database.init()
      const auth = new AuthManager({ sessionDatabase: database, configManager: createStore() })

      const result = auth.login({ phone: '15527109305', password: 'admin-secret' })

      expect(result.success).toBe(true)
      expect(result.user.isAdmin).toBe(true)
    } finally {
      database?.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
