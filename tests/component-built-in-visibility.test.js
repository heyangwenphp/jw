import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

describe('built-in component visibility', () => {
  it('keeps built-in agent and skill groups visible for non-admin users', () => {
    const {
      filterBuiltInComponentGroups
    } = require('../server/component-visibility.js')

    const groups = {
      builtIn: [{ id: 'internal-only', source: 'built-in' }],
      official: [{ id: 'official-skill', source: 'official' }],
      plugin: [{ id: 'plugin-agent', source: 'plugin' }],
      user: [{ id: 'user-skill', source: 'user' }],
      project: [{ id: 'project-skill', source: 'project' }],
      all: [
        { id: 'project-skill', source: 'project' },
        { id: 'user-skill', source: 'user' },
        { id: 'plugin-agent', source: 'plugin' },
        { id: 'official-skill', source: 'official' },
        { id: 'internal-only', source: 'built-in' }
      ]
    }

    const filtered = filterBuiltInComponentGroups(groups, {
      id: 7,
      phone: '15500000001',
      isAdmin: false
    })

    expect(filtered.builtIn.map(item => item.id)).toEqual(['internal-only'])
    expect(filtered.official.map(item => item.id)).toEqual(['official-skill'])
    expect(filtered.plugin.map(item => item.id)).toEqual(['plugin-agent'])
    expect(filtered.user.map(item => item.id)).toEqual(['user-skill'])
    expect(filtered.project.map(item => item.id)).toEqual(['project-skill'])
    expect(filtered.all.map(item => item.id)).toEqual([
      'project-skill',
      'user-skill',
      'plugin-agent',
      'official-skill',
      'internal-only'
    ])
  })

  it('keeps built-in groups visible for admin users', () => {
    const {
      filterBuiltInComponentGroups
    } = require('../server/component-visibility.js')

    const groups = {
      builtIn: [{ id: 'internal-only', source: 'built-in' }],
      user: [],
      project: [],
      all: [{ id: 'internal-only', source: 'built-in' }]
    }

    const filtered = filterBuiltInComponentGroups(groups, {
      id: 1,
      phone: '15500000009',
      isAdmin: true
    })

    expect(filtered.builtIn.map(item => item.id)).toEqual(['internal-only'])
    expect(filtered.all.map(item => item.id)).toEqual(['internal-only'])
  })

  it('guards direct built-in reads and copies while leaving other sources open', () => {
    const {
      canAccessBuiltInComponents,
      assertBuiltInComponentAccess
    } = require('../server/component-visibility.js')

    const normalUser = { id: 7, phone: '15500000001', isAdmin: false }
    const adminUser = { id: 1, phone: '15500000009', isAdmin: true }

    expect(canAccessBuiltInComponents(normalUser)).toBe(false)
    expect(canAccessBuiltInComponents(adminUser)).toBe(true)
    expect(() => assertBuiltInComponentAccess({ source: 'built-in' }, normalUser)).toThrow('Access denied')
    expect(() => assertBuiltInComponentAccess({ fromSource: 'built-in' }, normalUser)).toThrow('Access denied')
    expect(() => assertBuiltInComponentAccess({ source: 'user' }, normalUser)).not.toThrow()
    expect(() => assertBuiltInComponentAccess({ source: 'built-in' }, adminUser)).not.toThrow()
  })

  it('wires web API filtering without locking capability management', () => {
    const serverSource = readFileSync(join(process.cwd(), 'server/index.js'), 'utf8')

    expect(serverSource).toContain('app.get(\'/api/skills\'')
    expect(serverSource).toContain('app.get(\'/api/agents\'')
    expect(serverSource).toContain('source: \'built-in\'')
    expect(serverSource).toContain('filterBuiltInComponentGroups')
    expect(serverSource).toContain('assertBuiltInComponentAccess(req.body || {}, currentUser)')
    expect(serverSource).toContain('const currentUser = webAuthSession.getCurrentUser(req)')
  })
})
