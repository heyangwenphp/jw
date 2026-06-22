import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)

function touchFile(filePath, date) {
  writeFileSync(filePath, 'x')
  utimesSync(filePath, date, date)
}

function touchDir(dirPath, date) {
  utimesSync(dirPath, date, date)
}

describe('Aipin output cleanup', () => {
  it('removes Aipin agent and processed outputs older than the retention window', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-cleanup-data-'))
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-aipin-cleanup-output-'))
    try {
      const { cleanupAipinOutputs } = require('../server/aipin-output-cleanup.js')
      const processedOld = join(userDataPath, 'aipin-processed', '2026-06-01')
      const processedNew = join(userDataPath, 'aipin-processed', '2026-06-14')
      const agentOld = join(outputBaseDir, 'aipin-data', 'conv-old')
      const agentNew = join(outputBaseDir, 'aipin-data', 'conv-new')
      mkdirSync(processedOld, { recursive: true })
      mkdirSync(processedNew, { recursive: true })
      mkdirSync(agentOld, { recursive: true })
      mkdirSync(agentNew, { recursive: true })
      touchFile(join(processedOld, 'result.json'), new Date('2026-06-01T00:00:00.000Z'))
      touchFile(join(processedNew, 'result.json'), new Date('2026-06-14T00:00:00.000Z'))
      touchFile(join(agentOld, 'aipin-result.json'), new Date('2026-06-01T00:00:00.000Z'))
      touchFile(join(agentNew, 'aipin-result.json'), new Date('2026-06-14T00:00:00.000Z'))
      touchDir(agentOld, new Date('2026-06-01T00:00:00.000Z'))
      touchDir(agentNew, new Date('2026-06-14T00:00:00.000Z'))

      const result = await cleanupAipinOutputs({
        userDataPath,
        outputBaseDir,
        retentionDays: 7,
        now: () => new Date('2026-06-15T00:00:00.000Z').getTime()
      })

      expect(result.retentionDays).toBe(7)
      expect(result.processed.removed).toBe(1)
      expect(result.agent.removed).toBe(1)
      expect(existsSync(processedOld)).toBe(false)
      expect(existsSync(processedNew)).toBe(true)
      expect(existsSync(agentOld)).toBe(false)
      expect(existsSync(agentNew)).toBe(true)
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })
})
