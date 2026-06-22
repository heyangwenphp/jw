import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import crypto from 'node:crypto'

const require = createRequire(import.meta.url)

describe('Aipin Feishu pusher', () => {
  it('builds the signed Midea payload with records mapped from processed items', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-feishu-'))
    try {
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { AipinFeishuPusher, signMideaFeishuPayload } = require('../server/aipin-feishu-pusher.js')
      const store = new AipinDataStore({ userDataPath, now: () => '2026-06-10T03:00:00.000Z' })
      store.storePayload({
        requestId: 'aipin_20260610_020304_push01',
        receivedAt: '2026-06-10T02:03:04.000Z',
        items: [
          {
            id: 2842005360331600,
            news_uuid: 'push-uuid-1',
            news_title: 'Push candidate',
            manual_digest: '原摘要'
          }
        ]
      })
      store.updateProcessedFields({
        itemId: 'aipin_20260610_020304_push01__item_0',
        fields: {
          summary: '优化摘要',
          fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
          complaintNo: 'TS202606050001',
          aiSummary: 'AI总结',
          aiJudgement: 'AI研判',
          pushFlag: '推送'
        },
        task: { finishedAt: '2026-06-10T03:00:00.000Z' },
        status: 'completed'
      })

      const calls = []
      const pusher = new AipinFeishuPusher({
        dataStore: store,
        endpoint: 'https://example.test/receive',
        appId: 'SP202606080001',
        appSecret: 'secret',
        now: () => new Date('2026-06-10T03:00:00.000Z'),
        fetchImpl: async (url, options) => {
          calls.push({ url, options, payload: JSON.parse(options.body) })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: 10000,
              msg: '处理完成',
              data: {
                details: [
                  {
                    article_id: '2842005360331600',
                    push_flag: '是',
                    pushed: true,
                    error: ''
                  }
                ]
              }
            })
          }
        }
      })

      const result = await pusher.pushPending({ requestId: 'aipin_20260610_020304_push01' })

      expect(result).toMatchObject({ success: true, total: 1, pushed: 1 })
      expect(calls).toHaveLength(1)
      expect(calls[0].payload).toMatchObject({
        app_id: 'SP202606080001',
        timestamp: '1781060400',
        records: [
          {
            push_flag: '是',
            full_label: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
            news_digest: '优化摘要',
            complaint_no: 'TS202606050001',
            ai_summary: 'AI总结',
            ai_judgment: 'AI研判',
            article_id: '2842005360331600'
          }
        ]
      })
      expect(calls[0].payload.sign).toBe(signMideaFeishuPayload({
        appId: 'SP202606080001',
        timestamp: '1781060400',
        appSecret: 'secret'
      }))
      expect(store.getItem('aipin_20260610_020304_push01__item_0')).toMatchObject({
        pushStatus: 'success',
        pushAttempts: 1,
        pushRequest: expect.objectContaining({
          endpoint: 'https://example.test/receive',
          article_id: '2842005360331600',
          record: expect.objectContaining({
            push_flag: '是',
            full_label: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
            article_id: '2842005360331600'
          }),
          payload: expect.objectContaining({
            app_id: 'SP202606080001',
            records: [
              expect.objectContaining({
                article_id: '2842005360331600'
              })
            ]
          })
        }),
        pushResponse: expect.objectContaining({
          article_id: '2842005360331600',
          pushed: true
        })
      })
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('matches the documented MD5 signing algorithm', () => {
    const { signMideaFeishuPayload } = require('../server/aipin-feishu-pusher.js')
    const raw = 'appId=SP202606080001&timestamp=1718236800&app_secret=secret'
    expect(signMideaFeishuPayload({
      appId: 'SP202606080001',
      timestamp: '1718236800',
      appSecret: 'secret'
    })).toBe(crypto.createHash('md5').update(raw).digest('hex'))
  })

  it('marks items as pushing before sending and recovers interrupted work', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-recover-'))
    try {
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { AipinFeishuPusher } = require('../server/aipin-feishu-pusher.js')
      const store = new AipinDataStore({ userDataPath, now: () => '2026-06-10T03:00:00.000Z' })
      store.storePayload({
        requestId: 'aipin_20260610_020304_recover01',
        receivedAt: '2026-06-10T02:03:04.000Z',
        items: [
          { id: 5001, news_uuid: 'recover-uuid-1', news_title: 'Recover push candidate' },
          { id: 5002, news_uuid: 'recover-uuid-2', news_title: 'Recover processing candidate' },
          { id: 5003, news_uuid: 'recover-uuid-3', news_title: 'Recover pushing candidate' }
        ]
      })
      for (const index of [0, 2]) {
        store.updateProcessedFields({
          itemId: `aipin_20260610_020304_recover01__item_${index}`,
          fields: {
            summary: `Recover summary ${index}`,
            fullLabel: `Recover label ${index}`,
            aiSummary: `Recover AI summary ${index}`,
            aiJudgement: `Recover AI judgement ${index}`,
            pushFlag: 'push'
          },
          status: 'completed'
        })
      }
      store.markTaskStatus({
        requestId: 'aipin_20260610_020304_recover01__item_1',
        task: {
          startedAt: '2026-06-10T02:30:00.000Z',
          sessionId: 'interrupted-session',
          outputDir: 'old-output',
          resultFile: 'old-result.json'
        },
        status: 'processing'
      })

      const pushStatuses = []
      const originalMarkPushStarted = store.markPushStarted.bind(store)
      store.markPushStarted = input => {
        const result = originalMarkPushStarted(input)
        pushStatuses.push(store.getItem(input.itemId).pushStatus)
        return result
      }
      const pusher = new AipinFeishuPusher({
        dataStore: store,
        endpoint: 'https://example.test/receive',
        appId: 'SP202606080001',
        appSecret: 'secret',
        now: () => new Date('2026-06-10T03:00:00.000Z'),
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            code: 10000,
            data: {
              details: [
                { article_id: '5001', push_flag: 'yes', pushed: true, error: '' }
              ]
            }
          })
        })
      })

      await pusher.pushPending({ requestId: 'aipin_20260610_020304_recover01__item_0', limit: 1 })
      expect(pushStatuses).toEqual(['pushing'])

      store.markPushStarted({
        itemId: 'aipin_20260610_020304_recover01__item_2',
        request: { endpoint: 'https://example.test/receive' }
      })
      const recovered = store.recoverInterruptedWork()

      expect(recovered).toMatchObject({
        processingItems: 1,
        pushingItems: 1
      })
      expect(store.getItem('aipin_20260610_020304_recover01__item_1')).toMatchObject({
        status: 'pending',
        error: null,
        sessionId: null,
        outputDir: null,
        resultFile: null
      })
      expect(store.getItem('aipin_20260610_020304_recover01__item_2')).toMatchObject({
        pushStatus: 'pending',
        pushError: null
      })
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('maps Midea push flags to Feishu push_flag values', () => {
    const { buildFeishuRecord } = require('../server/aipin-feishu-pusher.js')

    expect(buildFeishuRecord({ pushFlag: '不推送', data: { id: 1 } })).toMatchObject({
      push_flag: '否',
      article_id: '1'
    })
    expect(buildFeishuRecord({ pushFlag: '推送', data: { id: 2 } })).toMatchObject({
      push_flag: '是',
      article_id: '2'
    })
    expect(buildFeishuRecord({ pushFlag: '重复', data: { id: 3 } })).toMatchObject({
      push_flag: '重复',
      article_id: '3'
    })
    expect(buildFeishuRecord({ pushFlag: '推送', data: { article_id: 99 } })).toMatchObject({
      push_flag: '是',
      article_id: ''
    })
  })

  it('treats Feishu non-push details as accepted when push_flag is not 是', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-feishu-nonpush-'))
    try {
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { AipinFeishuPusher } = require('../server/aipin-feishu-pusher.js')
      const store = new AipinDataStore({ userDataPath, now: () => '2026-06-10T03:00:00.000Z' })
      store.storePayload({
        requestId: 'aipin_20260610_020304_nonpush01',
        receivedAt: '2026-06-10T02:03:04.000Z',
        items: [{ id: 4001, news_uuid: 'nonpush-uuid-1', news_title: 'Non push candidate' }]
      })
      store.updateProcessedFields({
        itemId: 'aipin_20260610_020304_nonpush01__item_0',
        fields: {
          summary: '不推送摘要',
          fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
          aiSummary: 'AI总结',
          aiJudgement: 'AI研判',
          pushFlag: '不推送'
        },
        status: 'completed'
      })

      const pusher = new AipinFeishuPusher({
        dataStore: store,
        endpoint: 'https://example.test/receive',
        appId: 'SP202606080001',
        appSecret: 'secret',
        now: () => new Date('2026-06-10T03:00:00.000Z'),
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            code: 10000,
            data: {
              details: [
                {
                  article_id: '4001',
                  push_flag: '否',
                  pushed: false,
                  error: 'push_flag is not "是"'
                }
              ]
            }
          })
        })
      })

      const result = await pusher.pushPending({ requestId: 'aipin_20260610_020304_nonpush01' })

      expect(result).toMatchObject({ success: true, total: 1, pushed: 1 })
      expect(store.getItem('aipin_20260610_020304_nonpush01__item_0')).toMatchObject({
        pushStatus: 'success',
        pushError: null,
        pushRequest: expect.objectContaining({
          record: expect.objectContaining({
            push_flag: '否',
            full_label: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】'
          })
        }),
        pushResponse: expect.objectContaining({
          pushed: false,
          error: 'push_flag is not "是"'
        })
      })
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('treats Feishu code 10000 as success even when the detail is skipped', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-feishu-skipped-'))
    try {
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { AipinFeishuPusher } = require('../server/aipin-feishu-pusher.js')
      const store = new AipinDataStore({ userDataPath, now: () => '2026-06-16T02:20:00.000Z' })
      store.storePayload({
        requestId: 'aipin_20260615_201202_7389c872',
        receivedAt: '2026-06-15T20:12:02.572Z',
        items: [{ id: 22118073, news_uuid: 'skipped-uuid-1', news_title: 'Skipped candidate' }]
      })
      store.updateProcessedFields({
        itemId: 'aipin_20260615_201202_7389c872__item_0',
        fields: {
          summary: 'Skipped summary',
          fullLabel: 'Skipped label',
          aiSummary: 'Skipped AI summary',
          aiJudgement: 'Skipped AI judgment',
          pushFlag: '推送'
        },
        status: 'completed'
      })

      const pusher = new AipinFeishuPusher({
        dataStore: store,
        endpoint: 'https://example.test/receive',
        appId: 'SP202606080001',
        appSecret: 'secret',
        now: () => new Date('2026-06-16T02:20:00.000Z'),
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            code: 10000,
            msg: '处理完成',
            data: {
              total: 1,
              push_count: 0,
              skip_count: 1,
              fail_count: 0,
              details: [
                {
                  article_id: '22118073',
                  push_flag: '是',
                  pushed: false,
                  error: ''
                }
              ]
            }
          })
        })
      })

      const result = await pusher.pushPending({ requestId: 'aipin_20260615_201202_7389c872__item_0', limit: 1 })

      expect(result).toMatchObject({ success: true, total: 1, pushed: 1 })
      expect(store.getItem('aipin_20260615_201202_7389c872__item_0')).toMatchObject({
        pushStatus: 'success',
        pushError: null,
        pushResponse: expect.objectContaining({
          article_id: '22118073',
          pushed: false,
          error: ''
        })
      })
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
