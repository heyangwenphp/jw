import { describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { CapabilityManager } = require('../src/main/managers/capability-manager.js')

const writeSkill = (dir, id, description) => {
  mkdirSync(join(dir, id), { recursive: true })
  writeFileSync(join(dir, id, 'SKILL.md'), [
    '---',
    `name: ${id}`,
    `description: ${description}`,
    '---',
    '',
    `# ${id}`
  ].join('\n'))
}

describe('CapabilityManager project skills', () => {
  it('includes project .claude skills in fetched capabilities before global duplicates', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'jedi-capabilities-'))
    const projectPath = join(tempRoot, 'project')
    const globalSkillsDir = join(tempRoot, 'global-skills')

    try {
      writeSkill(join(projectPath, '.codex', 'skills'), 'early-investment-research', 'Project description')
      writeSkill(globalSkillsDir, 'early-investment-research', 'Global description')
      writeSkill(globalSkillsDir, 'global-only', 'Global only')

      const manager = new CapabilityManager({
        getConfig: () => ({}),
        save: () => {}
      }, null, null, null, null)

      manager.skillsDir = globalSkillsDir
      manager.agentsDir = join(tempRoot, 'agents')
      manager.installedPluginsPath = join(tempRoot, 'plugins', 'installed_plugins.json')

      const result = await manager.fetchCapabilities(projectPath)

      expect(result.success).toBe(true)
      expect(result.capabilities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'early-investment-research',
          type: 'skill',
          description: 'Project description'
        }),
        expect.objectContaining({
          id: 'global-only',
          type: 'skill',
          description: 'Global only'
        })
      ]))
      expect(result.capabilities.filter(cap => cap.id === 'early-investment-research')).toHaveLength(1)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
