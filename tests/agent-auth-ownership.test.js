import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { AgentSessionManager } = require('../src/main/agent-session-manager.js')

function createManager(outputBaseDir, database) {
  const manager = new AgentSessionManager(null, {
    getConfig: () => ({ settings: { agent: { outputBaseDir } } }),
    getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null }),
    getAPIProfile: () => null
  })
  manager.setSessionDatabase({
    closeAllActiveAgentConversations: () => {},
    ...database
  })
  return manager
}

describe('AgentSessionManager auth ownership', () => {
  it('stores an owner user id when creating an Agent conversation', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-owner-create-'))
    try {
      const rows = new Map()
      const database = {
        createAgentConversation(payload) {
          rows.set(payload.sessionId, { id: 1, session_id: payload.sessionId, user_id: payload.userId })
          return { id: 1 }
        },
        canAccessAgentConversation: () => true
      }
      const manager = createManager(outputBaseDir, database)

      const session = manager.create({ type: 'chat', title: 'Owned', ownerUserId: 7 })

      expect(rows.get(session.id).user_id).toBe(7)
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('filters list results by current user', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-owner-list-'))
    try {
      const calls = []
      const database = {
        listAgentConversationsForUser(options) {
          calls.push(options)
          return [{ session_id: 'visible', id: 1, type: 'chat', title: 'Visible', status: 'idle', created_at: Date.now(), updated_at: Date.now(), message_count: 1 }]
        },
        getAgentQueue: () => [],
        canAccessAgentConversation: () => true
      }
      const manager = createManager(outputBaseDir, database)

      expect(manager.list({ currentUser: { id: 7, phone: '15500000001', isAdmin: false } }).map(session => session.id)).toEqual(['visible'])
      expect(calls[0]).toMatchObject({ userId: 7, isAdmin: false })
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('blocks message reads for conversations owned by another user', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-owner-block-'))
    try {
      const database = {
        canAccessAgentConversation: () => false,
        getAgentConversation: () => ({ id: 1, session_id: 'other-session', user_id: 99 }),
        getAgentMessagesByConversationId: () => [{ msg_id: 'leak', role: 'user', content: 'secret', timestamp: Date.now() }]
      }
      const manager = createManager(outputBaseDir, database)

      expect(() => manager.getMessages('other-session', { currentUser: { id: 7, phone: '15500000001', isAdmin: false } })).toThrow('无权访问该会话')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })
})
