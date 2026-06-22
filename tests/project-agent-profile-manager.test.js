import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { ProjectAgentProfileManager } = require('../src/main/managers/project-agent-profile-manager')

function createManager() {
  return new ProjectAgentProfileManager({
    agentsManager: {
      getAllAgents: async () => ({
        project: [{ id: 'reviewer', name: 'Reviewer', source: 'project', description: 'Review code' }],
        user: [{ id: 'assistant', name: 'Assistant', source: 'user', description: 'General help' }],
        plugin: [],
        all: [
          { id: 'reviewer', name: 'Reviewer', source: 'project', description: 'Review code' },
          { id: 'assistant', name: 'Assistant', source: 'user', description: 'General help' }
        ]
      })
    },
    skillsManager: {
      getAllSkills: async () => ({
        project: [{ id: 'impact', name: 'Impact', source: 'project', description: 'Impact check' }],
        user: [],
        official: [],
        builtIn: [],
        all: [{ id: 'impact', name: 'Impact', source: 'project', description: 'Impact check' }]
      })
    }
  })
}

function createProjectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jedi-project-profile-'))
}

describe('ProjectAgentProfileManager', () => {
  it('saves, resolves, and invokes project profiles', async () => {
    const projectPath = createProjectDir()
    const manager = createManager()

    const saved = manager.saveProfile(projectPath, {
      name: 'Code Review',
      agent: 'reviewer',
      skills: ['impact']
    }, { setDefault: true })

    expect(saved.success).toBe(true)
    const resolved = await manager.resolve(projectPath)

    expect(resolved.success).toBe(true)
    expect(resolved.defaultProfile.name).toBe('Code Review')
    expect(resolved.defaultProfile.invocationRefs).toEqual([
      expect.objectContaining({ type: 'agent', id: 'reviewer' }),
      expect.objectContaining({ type: 'skill', id: 'impact' })
    ])
    expect(fs.existsSync(path.join(projectPath, '.claude', 'jedi-agent-profiles.json'))).toBe(true)
  })

  it('keeps missing references visible without crashing resolution', async () => {
    const projectPath = createProjectDir()
    const manager = createManager()

    manager.saveProfile(projectPath, {
      name: 'Missing Combo',
      agent: 'missing-agent',
      skills: ['impact', 'missing-skill']
    })

    const resolved = await manager.resolve(projectPath)
    const profile = resolved.profiles[0]

    expect(profile.missing).toBe(true)
    expect(profile.usable).toBe(false)
    expect(profile.missingRefs.map(ref => ref.id)).toEqual(['missing-agent', 'missing-skill'])
  })
})
