import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)

describe('AipinProcessingQueue', () => {
  it('creates and loads a pending task with the default skill', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-queue-'))
    try {
      const { AipinProcessingQueue } = require('../server/aipin-processing-queue.js')
      const queue = new AipinProcessingQueue({
        userDataPath,
        now: () => new Date('2026-06-10T02:03:04.000Z'),
        randomHex: () => 'abcd1234'
      })

      const task = await queue.createTask({
        requestId: 'aipin_20260610_020304_abcd1234',
        sourceFile: 'aipin-inbound/2026-06-10/aipin_20260610_020304_abcd1234.txt',
        receivedCount: 2
      })

      expect(task).toMatchObject({
        taskId: 'aipin_task_20260610_020304_abcd1234',
        requestId: 'aipin_20260610_020304_abcd1234',
        sourceFile: 'aipin-inbound/2026-06-10/aipin_20260610_020304_abcd1234.txt',
        receivedCount: 2,
        skillId: 'midea-yq-alert',
        status: 'pending',
        sessionId: null,
        error: null
      })

      expect(existsSync(join(userDataPath, 'aipin-processing', 'tasks.jsonl'))).toBe(true)
      expect(await queue.getTask(task.taskId)).toMatchObject(task)
      expect(await queue.listTasks()).toHaveLength(1)
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('claims the oldest pending task and persists status transitions', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-queue-'))
    try {
      const { AipinProcessingQueue } = require('../server/aipin-processing-queue.js')
      let tick = 0
      const queue = new AipinProcessingQueue({
        userDataPath,
        now: () => new Date(`2026-06-10T02:03:0${tick++}.000Z`),
        randomHex: () => `abcd123${tick}`
      })

      const first = await queue.createTask({ requestId: 'first', sourceFile: 'aipin-inbound/2026-06-10/first.txt', receivedCount: 1 })
      const second = await queue.createTask({ requestId: 'second', sourceFile: 'aipin-inbound/2026-06-10/second.txt', receivedCount: 1 })
      const claimed = await queue.claimTask()

      expect(claimed.taskId).toBe(first.taskId)
      expect(claimed.status).toBe('processing')
      expect((await queue.getTask(second.taskId)).status).toBe('pending')

      await queue.completeTask(first.taskId, {
        sessionId: 'session-1',
        outputDir: 'output/desktop/conv-session',
        resultFile: 'aipin-processed/2026-06-10/task/result.json'
      })

      expect(await queue.getTask(first.taskId)).toMatchObject({
        status: 'completed',
        sessionId: 'session-1',
        outputDir: 'output/desktop/conv-session',
        resultFile: 'aipin-processed/2026-06-10/task/result.json',
        error: null
      })

      const lines = readFileSync(join(userDataPath, 'aipin-processing', 'tasks.jsonl'), 'utf-8').trim().split('\n')
      expect(lines.length).toBe(4)
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('migrates the previous early investment default skill to midea-yq-alert', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-queue-'))
    try {
      const configDir = join(userDataPath, 'aipin-processing')
      mkdirSync(configDir, { recursive: true })
      writeFileSync(join(configDir, 'config.json'), JSON.stringify({
        enabled: true,
        autoProcess: false,
        defaultSkillId: 'early-investment-research',
        maxItemsPerTask: 100
      }, null, 2), 'utf-8')

      const { AipinProcessingQueue } = require('../server/aipin-processing-queue.js')
      const queue = new AipinProcessingQueue({
        userDataPath,
        now: () => new Date('2026-06-10T02:03:04.000Z'),
        randomHex: () => 'abcd1234'
      })

      const task = await queue.createTask({
        requestId: 'migrate-default',
        sourceFile: 'aipin-inbound/2026-06-10/migrate-default.txt',
        receivedCount: 1
      })
      const config = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))

      expect(task.skillId).toBe('midea-yq-alert')
      expect(config.defaultSkillId).toBe('midea-yq-alert')
      expect(config.autoProcess).toBe(false)
      expect(config.structuredResultWaitMs).toBe(600000)
      expect(config.structuredResultPollMs).toBe(500)
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('compacts the task log to the latest task snapshots when it grows too large', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-queue-'))
    try {
      const { AipinProcessingQueue } = require('../server/aipin-processing-queue.js')
      const queue = new AipinProcessingQueue({
        userDataPath,
        now: () => new Date('2026-06-10T02:03:04.000Z'),
        randomHex: () => 'abcd1234',
        maxTaskLogBytes: 1
      })

      const task = await queue.createTask({
        requestId: 'compact-me',
        sourceFile: 'aipin-sqlite:batch:compact-me',
        receivedCount: 1
      })
      await queue.completeTask(task.taskId, {
        sessionId: 'session-compact',
        outputDir: 'output/compact',
        resultFile: 'result.json'
      })

      const lines = readFileSync(join(userDataPath, 'aipin-processing', 'tasks.jsonl'), 'utf-8').trim().split('\n')
      expect(lines).toHaveLength(1)
      expect(await queue.getTask(task.taskId)).toMatchObject({
        status: 'completed',
        sessionId: 'session-compact'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('fails and retries a task', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-queue-'))
    try {
      const { AipinProcessingQueue } = require('../server/aipin-processing-queue.js')
      const queue = new AipinProcessingQueue({
        userDataPath,
        now: () => new Date('2026-06-10T02:03:04.000Z'),
        randomHex: () => 'abcd1234'
      })

      const task = await queue.createTask({ requestId: 'bad', sourceFile: 'aipin-inbound/2026-06-10/bad.txt', receivedCount: 1 })
      await queue.failTask(task.taskId, new Error('source file missing'))

      expect(await queue.getTask(task.taskId)).toMatchObject({
        status: 'failed',
        error: 'source file missing'
      })

      await queue.retryTask(task.taskId)
      expect(await queue.getTask(task.taskId)).toMatchObject({
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        error: null
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('recovers interrupted processing tasks back to pending', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-queue-'))
    try {
      const { AipinProcessingQueue } = require('../server/aipin-processing-queue.js')
      const queue = new AipinProcessingQueue({
        userDataPath,
        now: () => new Date('2026-06-10T02:03:04.000Z'),
        randomHex: () => 'abcd1234'
      })

      const task = await queue.createTask({ requestId: 'restart', sourceFile: 'aipin-sqlite:batch:restart', receivedCount: 1 })
      await queue.claimTask(task.taskId)

      const recovered = await queue.recoverInterruptedTasks()

      expect(recovered).toHaveLength(1)
      expect(recovered[0]).toMatchObject({
        taskId: task.taskId,
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        sessionId: null,
        outputDir: null,
        resultFile: null,
        error: null
      })
      expect(await queue.claimTask()).toMatchObject({
        taskId: task.taskId,
        status: 'processing'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('prepares any existing task for manual midea-yq-alert processing', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-queue-'))
    try {
      const { AipinProcessingQueue } = require('../server/aipin-processing-queue.js')
      const queue = new AipinProcessingQueue({
        userDataPath,
        now: () => new Date('2026-06-10T02:03:04.000Z'),
        randomHex: () => 'abcd1234'
      })

      const task = await queue.createTask({ requestId: 'done', sourceFile: 'aipin-inbound/2026-06-10/done.txt', receivedCount: 1 })
      await queue.completeTask(task.taskId, {
        sessionId: 'old-session',
        outputDir: 'old-output',
        resultFile: 'old-result.json'
      })

      const prepared = await queue.prepareTaskForManualProcess(task.taskId)

      expect(prepared).toMatchObject({
        taskId: task.taskId,
        requestId: 'done',
        skillId: 'midea-yq-alert',
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        sessionId: null,
        outputDir: null,
        resultFile: null,
        error: null
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('allows an explicit skill when creating a manual item task', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-queue-'))
    try {
      const { AipinProcessingQueue } = require('../server/aipin-processing-queue.js')
      const queue = new AipinProcessingQueue({
        userDataPath,
        now: () => new Date('2026-06-10T02:03:04.000Z'),
        randomHex: () => 'abcd1234'
      })

      const task = await queue.createTask({
        requestId: 'manual-item',
        sourceFile: 'aipin-inbound-items/2026-06-10/manual-item.txt',
        receivedCount: 1,
        skillId: 'midea-yq-alert'
      })

      expect(task).toMatchObject({
        requestId: 'manual-item',
        receivedCount: 1,
        skillId: 'midea-yq-alert',
        status: 'pending'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
