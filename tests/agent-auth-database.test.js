import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { SessionDatabase } = require('../src/main/session-database.js')

describe('agent auth database schema and operations', () => {
  it('creates users and stores agent conversation owner ids', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-auth-db-'))
    let database
    try {
      database = new SessionDatabase({ userDataPath })
      database.init()

      const user = database.createUser({
        phone: '15500000001',
        passwordHash: 'hash-1',
        passwordSalt: 'salt-1'
      })
      expect(user.id).toEqual(expect.any(Number))
      expect(database.getUserByPhone('15500000001').id).toBe(user.id)

      const conversation = database.createAgentConversation({
        sessionId: 'session-owned',
        type: 'chat',
        title: 'Owned',
        cwd: userDataPath,
        cwdAuto: true,
        userId: user.id
      })

      const row = database.getAgentConversation('session-owned')
      expect(row.user_id).toBe(user.id)
      expect(conversation.userId).toBe(user.id)
    } finally {
      database?.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('filters conversations by owner and lets admin include unowned rows', () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-auth-filter-'))
    let database
    try {
      database = new SessionDatabase({ userDataPath })
      database.init()
      const userA = database.createUser({ phone: '15500000001', passwordHash: 'h1', passwordSalt: 's1' })
      const userB = database.createUser({ phone: '15500000002', passwordHash: 'h2', passwordSalt: 's2' })

      database.createAgentConversation({ sessionId: 'a-1', type: 'chat', title: 'A', cwd: userDataPath, cwdAuto: true, userId: userA.id })
      database.createAgentConversation({ sessionId: 'b-1', type: 'chat', title: 'B', cwd: userDataPath, cwdAuto: true, userId: userB.id })
      database.createAgentConversation({ sessionId: 'legacy-1', type: 'chat', title: 'Legacy', cwd: userDataPath, cwdAuto: true })

      expect(database.listAgentConversationsForUser({ userId: userA.id, isAdmin: false }).map(row => row.session_id)).toEqual(['a-1'])
      expect(database.listAgentConversationsForUser({ userId: userB.id, isAdmin: false }).map(row => row.session_id)).toEqual(['b-1'])
      expect(database.listAgentConversationsForUser({ userId: userA.id, isAdmin: true }).map(row => row.session_id)).toEqual(['legacy-1', 'b-1', 'a-1'])
    } finally {
      database?.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
