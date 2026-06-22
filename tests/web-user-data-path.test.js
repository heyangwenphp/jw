import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { resolveWebUserDataPath } = require('../server/user-data-path')

describe('web user data path resolution', () => {
  it('keeps the default path stable even when deploy-local data exists', () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'jedi-web-project-'))
    const dataDir = path.join(projectRoot, 'data', 'jedi-web')

    try {
      mkdirSync(dataDir, { recursive: true })

      const resolved = resolveWebUserDataPath({
        env: { HOME: '/home/jedi' },
        homeDir: '/home/jedi',
        platform: 'linux',
        projectRoot
      })

      expect(resolved).toBe(path.posix.join('/home/jedi', '.local', 'share', 'jedi-web'))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it('uses deploy-local data only when explicitly enabled', () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'jedi-web-project-'))
    const dataDir = path.join(projectRoot, 'data', 'jedi-web')

    try {
      mkdirSync(dataDir, { recursive: true })

      const resolved = resolveWebUserDataPath({
        env: { HOME: '/home/jedi', JEDI_WEB_USE_PROJECT_DATA_DIR: '1' },
        homeDir: '/home/jedi',
        platform: 'linux',
        projectRoot
      })

      expect(resolved).toBe(dataDir)
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it('defaults outside the deploy project root on Linux servers when no deploy-local data exists', () => {
    const projectRoot = path.resolve('C:/workspace/jedi_web')

    const resolved = resolveWebUserDataPath({
      env: { HOME: '/home/jedi' },
      homeDir: '/home/jedi',
      platform: 'linux',
      projectRoot
    })

    expect(resolved).toBe(path.posix.join('/home/jedi', '.local', 'share', 'jedi-web'))
    expect(resolved.startsWith(projectRoot)).toBe(false)
  })

  it('allows JEDI_WEB_DATA_DIR to override the default path', () => {
    const projectRoot = path.resolve('C:/workspace/jedi_web')
    const dataDir = path.resolve('D:/jedi-data')

    expect(resolveWebUserDataPath({
      env: { JEDI_WEB_DATA_DIR: dataDir },
      projectRoot
    })).toBe(dataDir)
  })
})
