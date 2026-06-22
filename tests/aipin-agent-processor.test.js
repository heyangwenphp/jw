import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)

describe('Aipin agent processor', () => {
  it('creates an agent session, writes normalized input files, and invokes the task skill', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-processor-'))
    try {
      const { AipinDataStore, dataReferenceForBatch } = require('../server/aipin-data-store.js')
      const store = new AipinDataStore({ userDataPath })
      store.storePayload({
        requestId: 'aipin_20260610_020304_abcd1234',
        receivedAt: '2026-06-10T02:03:04.000Z',
        items: [
          {
            id: 1,
            scheme_id: 9,
            platform_name: 'media',
            news_title: '清华团队创业融资',
            news_uuid: 'uuid-1',
            push_time: '2026-06-10 10:00:00',
            news_content: 'x'.repeat(20)
          },
          {
            id: 2,
            scheme_id: 9,
            platform_name: 'media',
            news_title: 'duplicate',
            news_uuid: 'uuid-1',
            push_time: '2026-06-10 10:01:00',
            news_content: 'duplicate'
          },
          {
            id: 3,
            scheme_id: 9,
            platform_name: 'media',
            news_title: 'minimal',
            news_uuid: 'uuid-2',
            push_time: '2026-06-10 10:02:00'
          }
        ]
      })
      store.close()

      const created = []
      const sent = []
      const closed = []
      const agentSessionManager = {
        create: options => {
          created.push(options)
          return {
            id: 'session-1',
            cwd: join(userDataPath, 'output', 'desktop', 'conv-session-1')
          }
        },
        sendMessage: async (sessionId, message, options) => {
          sent.push({ sessionId, message, options })
          const cwd = join(userDataPath, 'output', 'desktop', 'conv-session-1')
          writeFileSync(join(cwd, 'aipin-result.json'), JSON.stringify({
            items: [
              {
                id: 1,
                itemIndex: 0,
                news_uuid: 'uuid-1',
                summary: '清华团队创业融资摘要',
                fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
                aiSummary: '该内容提及清华团队创业融资。',
                aiJudgement: '建议推送，属于有效舆情线索。',
                pushFlag: '推送'
              },
              {
                id: 2,
                itemIndex: 1,
                news_uuid: 'uuid-1',
                summary: '重复链接摘要',
                fullLabel: '【重复事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
                aiSummary: '该内容与前一条 news_uuid 重复。',
                aiJudgement: '重复内容，不重复推送。',
                pushFlag: '重复'
              },
              {
                id: 3,
                itemIndex: 2,
                news_uuid: 'uuid-2',
                summary: '信息不足摘要',
                fullLabel: '【信息不足】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
                aiSummary: '该内容字段较少，需要人工复核。',
                aiJudgement: '信息不足，暂不推送。',
                pushFlag: '不推送'
              }
            ]
          }), 'utf-8')
          return { ok: true }
        },
        close: async sessionId => {
          closed.push(sessionId)
        }
      }
      const transitions = []
      const queue = {
        completeTask: async (taskId, patch) => {
          transitions.push({ type: 'complete', taskId, patch })
          return { taskId, status: 'completed', ...patch }
        },
        failTask: async (taskId, err) => {
          transitions.push({ type: 'fail', taskId, error: err.message })
          return { taskId, status: 'failed', error: err.message }
        }
      }

      const { processAipinTask } = require('../server/aipin-agent-processor.js')
      const result = await processAipinTask({
        task: {
          taskId: 'task-1',
          requestId: 'aipin_20260610_020304_abcd1234',
          sourceFile: dataReferenceForBatch('aipin_20260610_020304_abcd1234'),
          skillId: 'midea-yq-alert'
        },
        userDataPath,
        agentSessionManager,
        queue,
        currentUser: { id: 42, phone: '15500000000' },
        config: {
          maxItemsPerTask: 100,
          maxContentCharsPerItem: 10,
          structuredResultWaitMs: 0,
          structuredResultPollMs: 1
        },
        now: () => new Date('2026-06-10T03:00:00.000Z')
      })

      expect(created).toEqual([
        expect.objectContaining({
          type: 'chat',
          title: 'AipinData处理-aipin_20260610_020304_abcd1234',
          source: 'aipin-data-processing',
          cwdSubDir: 'aipin-data',
          ownerUserId: 42,
          meta: {
            aipinTaskId: 'task-1',
            requestId: 'aipin_20260610_020304_abcd1234',
            skillId: 'midea-yq-alert'
          }
        })
      ])
      expect(sent[0].sessionId).toBe('session-1')
      expect(sent[0].message).toContain('/midea-yq-alert')
      expect(sent[0].message).toContain('aipin-input.json')
      expect(sent[0].message).toContain('aipin-input-summary.json')
      expect(sent[0].message).toContain('aipin-result.json')
      expect(sent[0].message).toContain('summary')
      expect(sent[0].message).toContain('fullLabel')
      expect(sent[0].message).toContain('complaintNo')
      expect(sent[0].message).toContain('aiSummary')
      expect(sent[0].message).toContain('aiJudgement')
      expect(sent[0].message).toContain('pushFlag')
      expect(sent[0].options.meta).toMatchObject({
        aipinTaskId: 'task-1',
        requestId: 'aipin_20260610_020304_abcd1234',
        skillId: 'midea-yq-alert'
      })
      expect(sent[0].options.currentUser).toEqual({ id: 42, phone: '15500000000' })

      const inputPath = join(userDataPath, 'output', 'desktop', 'conv-session-1', 'aipin-input.json')
      const summaryPath = join(userDataPath, 'output', 'desktop', 'conv-session-1', 'aipin-input-summary.json')
      const skillPath = join(userDataPath, 'output', 'desktop', 'conv-session-1', '.codex', 'skills', 'midea-yq-alert', 'SKILL.md')
      expect(existsSync(inputPath)).toBe(true)
      expect(existsSync(summaryPath)).toBe(true)
      expect(existsSync(skillPath)).toBe(true)

      const input = JSON.parse(readFileSync(inputPath, 'utf-8'))
      const summary = JSON.parse(readFileSync(summaryPath, 'utf-8'))
      expect(input.data).toHaveLength(3)
      expect(input.data[0].news_content).toBe('x'.repeat(20))
      expect(summary).toMatchObject({
        requestId: 'aipin_20260610_020304_abcd1234',
        inputCount: 3,
        originalCount: 3,
        duplicateCount: 0,
        minimalShapeCount: 1
      })
      expect(transitions[0]).toMatchObject({
        type: 'complete',
        taskId: 'task-1',
        patch: {
          sessionId: 'session-1',
          outputDir: join(userDataPath, 'output', 'desktop', 'conv-session-1')
        }
      })
      expect(closed).toEqual(['session-1'])
      expect(result.status).toBe('completed')
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('fails after retrying empty required fields and does not push the record', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-processor-required-'))
    let store
    try {
      const { AipinDataStore, dataReferenceForBatch } = require('../server/aipin-data-store.js')
      const { processAipinTask } = require('../server/aipin-agent-processor.js')
      store = new AipinDataStore({ userDataPath, now: () => '2026-06-10T03:00:00.000Z' })
      store.storePayload({
        requestId: 'aipin_20260610_020304_required',
        receivedAt: '2026-06-10T02:03:04.000Z',
        items: [
          {
            id: 9001,
            news_uuid: 'required-uuid-1',
            news_title: 'Required fields candidate',
            push_time: '2026-06-10 10:00:00'
          }
        ]
      })

      const cwd = join(userDataPath, 'output', 'desktop', 'conv-session-required')
      const sent = []
      const transitions = []
      const pushed = []
      const result = await processAipinTask({
        task: {
          taskId: 'task-required',
          requestId: 'aipin_20260610_020304_required',
          sourceFile: dataReferenceForBatch('aipin_20260610_020304_required'),
          skillId: 'midea-yq-alert'
        },
        userDataPath,
        agentSessionManager: {
          create: () => ({ id: 'session-required', cwd }),
          sendMessage: async (sessionId, message) => {
            sent.push({ sessionId, message })
            writeFileSync(join(cwd, 'aipin-result.json'), JSON.stringify({
              items: [
                {
                  id: 9001,
                  itemIndex: 0,
                  news_uuid: 'required-uuid-1',
                  summary: '有摘要',
                  fullLabel: '',
                  aiSummary: '',
                  aiJudgement: '',
                  pushFlag: ''
                }
              ]
            }), 'utf-8')
            return { ok: true }
          }
        },
        queue: {
          completeTask: async (taskId, patch) => {
            transitions.push({ type: 'complete', taskId, patch })
            return { taskId, status: 'completed', ...patch }
          },
          failTask: async (taskId, err) => {
            transitions.push({ type: 'fail', taskId, error: err.message })
            return { taskId, status: 'failed', error: err.message }
          }
        },
        aipinDataStore: store,
        feishuPusher: {
          pushPending: async input => {
            pushed.push(input)
            return { success: true, total: 1, pushed: 1 }
          }
        },
        config: {
          structuredResultWaitMs: 1000,
          structuredResultPollMs: 1,
          requiredFieldRetryAttempts: 3
        },
        now: () => new Date('2026-06-10T03:00:00.000Z')
      })

      expect(result.status).toBe('failed')
      expect(sent).toHaveLength(3)
      expect(sent[1].message).toContain('第 2/3 次处理尝试')
      expect(sent[2].message).toContain('第 3/3 次处理尝试')
      expect(transitions[0]).toMatchObject({
        type: 'fail',
        taskId: 'task-required',
        error: expect.stringContaining('AI总结为空')
      })
      expect(transitions[0].error).toContain('完整标签为空')
      const resultFile = join(userDataPath, 'aipin-processed', '2026-06-10', 'task-required', 'result.json')
      const resultJson = JSON.parse(readFileSync(resultFile, 'utf-8'))
      expect(resultJson).toMatchObject({
        requiredFieldAttempts: 3,
        validationError: expect.stringContaining('AI总结为空')
      })
      expect(resultJson.validationError).toContain('完整标签为空')
      expect(store.getItem('aipin_20260610_020304_required__item_0')).toMatchObject({
        status: 'failed',
        aiSummary: '',
        aiJudgement: '',
        pushFlag: '',
        isProcessed: false,
        pushStatus: ''
      })
      expect(pushed).toEqual([])
    } finally {
      store?.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('does not match agent results without the original data id', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-processor-id-only-'))
    let store
    try {
      const { AipinDataStore, dataReferenceForBatch } = require('../server/aipin-data-store.js')
      const { processAipinTask } = require('../server/aipin-agent-processor.js')
      store = new AipinDataStore({ userDataPath, now: () => '2026-06-10T03:00:00.000Z' })
      store.storePayload({
        requestId: 'aipin_20260610_020304_idonly',
        receivedAt: '2026-06-10T02:03:04.000Z',
        items: [
          {
            id: 9101,
            news_uuid: 'strict-uuid-1',
            news_title: 'Strict id candidate',
            push_time: '2026-06-10 10:00:00'
          }
        ]
      })

      const cwd = join(userDataPath, 'output', 'desktop', 'conv-session-id-only')
      const transitions = []
      const result = await processAipinTask({
        task: {
          taskId: 'task-id-only',
          requestId: 'aipin_20260610_020304_idonly',
          sourceFile: dataReferenceForBatch('aipin_20260610_020304_idonly'),
          skillId: 'midea-yq-alert'
        },
        userDataPath,
        agentSessionManager: {
          create: () => ({ id: 'session-id-only', cwd }),
          sendMessage: async () => {
            writeFileSync(join(cwd, 'aipin-result.json'), JSON.stringify({
              items: [
                {
                  itemIndex: 0,
                  news_uuid: 'strict-uuid-1',
                  summary: 'summary',
                  fullLabel: 'label',
                  aiSummary: 'ai summary',
                  aiJudgement: 'ai judgement',
                  pushFlag: 'push'
                }
              ]
            }), 'utf-8')
            return { ok: true }
          }
        },
        queue: {
          completeTask: async () => {
            throw new Error('complete should not be called')
          },
          failTask: async (taskId, err) => {
            transitions.push({ taskId, error: err.message })
            return { taskId, status: 'failed', error: err.message }
          }
        },
        aipinDataStore: store,
        config: {
          structuredResultWaitMs: 1000,
          structuredResultPollMs: 1,
          requiredFieldRetryAttempts: 1
        },
        now: () => new Date('2026-06-10T03:00:00.000Z')
      })

      expect(result.status).toBe('failed')
      expect(transitions[0]).toMatchObject({
        taskId: 'task-id-only',
        error: expect.stringContaining('AipinData skill result missing required fields')
      })
      expect(store.getItem('aipin_20260610_020304_idonly__item_0')).toMatchObject({
        summary: '',
        fullLabel: '',
        aiSummary: '',
        aiJudgement: '',
        pushFlag: '',
        isProcessed: false
      })
    } finally {
      store?.close()
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('marks the task failed when the source is not a SQLite reference', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-processor-'))
    try {
      const transitions = []
      const { processAipinTask } = require('../server/aipin-agent-processor.js')

      const result = await processAipinTask({
        task: {
          taskId: 'task-bad',
          requestId: 'bad',
          sourceFile: 'aipin-inbound/2026-06-10/bad.txt',
          skillId: 'midea-yq-alert'
        },
        userDataPath,
        agentSessionManager: {
          create: () => {
            throw new Error('agent should not be created')
          }
        },
        queue: {
          completeTask: async () => {
            throw new Error('complete should not be called')
          },
          failTask: async (taskId, err) => {
            transitions.push({ taskId, error: err.message })
            return { taskId, status: 'failed', error: err.message }
          }
        }
      })

      expect(result).toMatchObject({
        taskId: 'task-bad',
        status: 'failed',
        error: 'Unsupported AipinData source reference: aipin-inbound/2026-06-10/bad.txt'
      })
      expect(transitions).toEqual([
        {
          taskId: 'task-bad',
          error: 'Unsupported AipinData source reference: aipin-inbound/2026-06-10/bad.txt'
        }
      ])
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('loads a SQLite source reference and writes processed fields back to the item row', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-processor-sqlite-'))
    try {
      const { AipinDataStore, dataReferenceForBatch } = require('../server/aipin-data-store.js')
      const { processAipinTask } = require('../server/aipin-agent-processor.js')
      const store = new AipinDataStore({ userDataPath, now: () => '2026-06-10T03:00:00.000Z' })
      store.storePayload({
        requestId: 'aipin_20260610_020304_sqlite01',
        receivedAt: '2026-06-10T02:03:04.000Z',
        items: [
          {
            id: 1001,
            news_uuid: 'sqlite-uuid-1',
            news_title: 'SQLite candidate',
            push_time: '2026-06-10 10:00:00'
          }
        ]
      })

      const task = {
        taskId: 'task-sqlite',
        requestId: 'aipin_20260610_020304_sqlite01',
        sourceFile: dataReferenceForBatch('aipin_20260610_020304_sqlite01'),
        skillId: 'midea-yq-alert',
        status: 'processing'
      }
      const agentSessionManager = {
        create: () => ({
          id: 'session-sqlite',
          cwd: join(userDataPath, 'output', 'desktop', 'conv-session-sqlite')
        }),
        sendMessage: async sessionId => {
          const cwd = join(userDataPath, 'output', 'desktop', 'conv-session-sqlite')
          writeFileSync(join(cwd, 'aipin-result.json'), JSON.stringify({
            items: [
              {
                id: 1001,
                news_uuid: 'sqlite-uuid-1',
                summary: '优化摘要',
                fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
                complaintNo: 'TS-1',
                aiSummary: 'AI总结',
                aiJudgement: 'AI研判',
                pushFlag: '推送'
              }
            ]
          }), 'utf-8')
          return { sessionId }
        }
      }
      const queue = {
        completeTask: async (taskId, patch) => ({ ...task, ...patch, taskId, status: 'completed' }),
        failTask: async (taskId, err) => ({ ...task, taskId, status: 'failed', error: err.message })
      }
      const pushed = []
      const feishuPusher = {
        pushPending: async input => {
          pushed.push(input)
          store.markPushResult({
            itemId: 'aipin_20260610_020304_sqlite01__item_0',
            status: 'success',
            request: { record: { article_id: '1001', push_flag: '是' } },
            response: { code: 10000 }
          })
          return { success: true, total: 1, pushed: 1 }
        }
      }

      const result = await processAipinTask({
        task,
        userDataPath,
        agentSessionManager,
        queue,
        aipinDataStore: store,
        feishuPusher,
        config: {
          structuredResultWaitMs: 1000,
          structuredResultPollMs: 1
        },
        now: () => new Date('2026-06-10T03:00:00.000Z')
      })

      expect(result.status).toBe('completed')
      expect(store.getItem('aipin_20260610_020304_sqlite01__item_0')).toMatchObject({
        status: 'completed',
        summary: '优化摘要',
        fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
        complaintNo: 'TS-1',
        aiSummary: 'AI总结',
        aiJudgement: 'AI研判',
        pushFlag: '推送',
        isProcessed: true,
        pushStatus: 'success'
      })
      expect(pushed).toEqual([{ requestId: 'aipin_20260610_020304_sqlite01' }])
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('tolerates loose aipin-result JSON and keeps non-push items queued for delivery', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-processor-loose-'))
    try {
      const { AipinDataStore, dataReferenceForBatch } = require('../server/aipin-data-store.js')
      const { processAipinTask } = require('../server/aipin-agent-processor.js')
      const store = new AipinDataStore({ userDataPath, now: () => '2026-06-10T03:00:00.000Z' })
      store.storePayload({
        requestId: 'aipin_20260610_020304_loose01',
        receivedAt: '2026-06-10T02:03:04.000Z',
        items: [
          {
            id: 1002,
            news_uuid: 'loose-uuid-1',
            news_title: 'Loose candidate',
            push_time: '2026-06-10 10:00:00'
          }
        ]
      })

      const task = {
        taskId: 'task-loose',
        requestId: 'aipin_20260610_020304_loose01',
        sourceFile: dataReferenceForBatch('aipin_20260610_020304_loose01'),
        skillId: 'midea-yq-alert',
        status: 'processing'
      }
      const cwd = join(userDataPath, 'output', 'desktop', 'conv-session-loose')
      const agentSessionManager = {
        create: () => ({ id: 'session-loose', cwd }),
        sendMessage: async () => {
          writeFileSync(join(cwd, 'aipin-result.json'), `{
  "items": [
    {
      "id": 1002,
      "itemIndex": 0,
      "news_uuid": "loose-uuid-1",
      "summary": "微博用户"测试"发布内容",
      "fullLabel": "【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】",
      "complaintNo": "",
      "aiSummary": "AI总结",
      "aiJudgement": "建议不报送",
      "pushFlag": "不推送"
    }
  ]
}`, 'utf-8')
          return { ok: true }
        }
      }
      const queue = {
        completeTask: async (taskId, patch) => ({ ...task, ...patch, taskId, status: 'completed' }),
        failTask: async (taskId, err) => ({ ...task, taskId, status: 'failed', error: err.message })
      }

      const result = await processAipinTask({
        task,
        userDataPath,
        agentSessionManager,
        queue,
        aipinDataStore: store,
        config: {
          structuredResultWaitMs: 1000,
          structuredResultPollMs: 1
        },
        now: () => new Date('2026-06-10T03:00:00.000Z')
      })

      expect(result.status).toBe('completed')
      expect(store.getItem('aipin_20260610_020304_loose01__item_0')).toMatchObject({
        summary: '微博用户"测试"发布内容',
        fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
        aiJudgement: '建议不报送',
        pushFlag: '不推送',
        isProcessed: true,
        pushStatus: 'pending'
      })
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
