import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const AgentFileManager = require('../src/main/managers/agent-file-manager.js')
const { AgentSessionManager } = require('../src/main/agent-session-manager.js')

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

const withTempSession = async (fn) => {
  const cwd = mkdtempSync(join(tmpdir(), 'jedi-agent-files-'))
  try {
    await fn(cwd)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const createFileManager = (cwd) => new AgentFileManager({
  sessions: new Map([['session-1', { cwd }]]),
  sessionDatabase: null
})

describe('agent internal file visibility', () => {
  it('does not list the Radar sqlite file in the right-panel file tree', async () => {
    await withTempSession(async (cwd) => {
      writeFileSync(join(cwd, 'wechat_765.sqlite'), '')
      writeFileSync(join(cwd, 'analysis.sqlite'), '')
      writeFileSync(join(cwd, 'Radar_report.pdf'), '')

      const manager = createFileManager(cwd)

      const visible = await manager.listDir('session-1', '', false)
      const showHidden = await manager.listDir('session-1', '', true)

      expect(visible.entries.map(entry => entry.name)).toEqual(['Radar_report.pdf'])
      expect(showHidden.entries.map(entry => entry.name)).toEqual(['Radar_report.pdf'])
    })
  })

  it('does not return the Radar sqlite file from right-panel file search', async () => {
    await withTempSession(async (cwd) => {
      mkdirSync(join(cwd, 'nested'))
      writeFileSync(join(cwd, 'wechat_765.sqlite'), '')
      writeFileSync(join(cwd, 'nested', 'wechat_765.sqlite'), '')
      writeFileSync(join(cwd, 'nested', 'analysis.sqlite'), '')
      writeFileSync(join(cwd, 'wechat_notes.txt'), '')

      const manager = createFileManager(cwd)

      const result = await manager.searchFiles('session-1', 'wechat', true)

      expect(result.results.map(entry => entry.relativePath)).toEqual(['wechat_notes.txt'])
    })
  })

  it('does not include the Radar sqlite file in output file lists', async () => {
    await withTempSession(async (cwd) => {
      writeFileSync(join(cwd, 'wechat_765.sqlite'), '')
      writeFileSync(join(cwd, 'analysis.sqlite'), '')
      writeFileSync(join(cwd, 'Radar_report.pdf'), '')

      const manager = Object.create(AgentSessionManager.prototype)
      manager.sessions = new Map([['session-1', { cwd }]])
      manager.sessionDatabase = null

      const files = manager.listOutputFiles('session-1')

      expect(files.map(file => file.name)).toEqual(['Radar_report.pdf'])
    })
  })

  it('filters internal files in the right-panel renderer as a hot-reload safeguard', () => {
    const source = readSource('src/renderer/composables/useAgentFiles.js')

    expect(source).toContain("const INTERNAL_AGENT_FILE_NAMES = new Set(['wechat_765.sqlite'])")
    expect(source).toContain("normalizedName.toLowerCase().endsWith('.sqlite')")
    expect(source).toContain('const filterVisibleAgentEntries = (items = []) =>')
    expect(source).toContain('filterVisibleAgentEntries(result.entries || [])')
    expect(source).toContain('searchResults.value = filterVisibleAgentEntries(result.results || [])')
  })
})
