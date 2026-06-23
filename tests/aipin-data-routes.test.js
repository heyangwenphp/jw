import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const root = process.cwd()

function createApp() {
  const routes = new Map()
  const app = {
    get(path, handler) {
      routes.set(`GET ${path}`, handler)
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler)
    }
  }
  return { app, routes }
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    }
  }
}

async function invoke(routes, method, path, { body = {}, params = {}, query = {}, currentUser = null } = {}) {
  const handler = routes.get(`${method} ${path}`)
  expect(handler).toEqual(expect.any(Function))
  const res = createResponse()
  await handler({ body, params, query, currentUser }, res)
  return res
}

describe('AipinData push API routes', () => {
  it('registers the push route before web page authentication middleware', () => {
    const source = readFileSync(join(root, 'server/index.js'), 'utf-8')
    expect(source).toContain("const { registerAipinDataPushRoutes, registerAipinDataAdminRoutes, registerAipinDataTaskRoutes } = require('./aipin-data-routes')")
    expect(source).toContain("const { AipinProcessingQueue } = require('./aipin-processing-queue')")
    expect(source).toContain("const { processAipinTask } = require('./aipin-agent-processor')")

    const pushIndex = source.indexOf('registerAipinDataPushRoutes({')
    const authIndex = source.indexOf('app.use(webAuthSession.requirePageAuth)')
    const adminIndex = source.indexOf('registerAipinDataAdminRoutes({')
    const taskIndex = source.indexOf('registerAipinDataTaskRoutes({')

    expect(pushIndex).toBeGreaterThan(-1)
    expect(authIndex).toBeGreaterThan(-1)
    expect(adminIndex).toBeGreaterThan(-1)
    expect(taskIndex).toBeGreaterThan(-1)
    expect(pushIndex).toBeLessThan(authIndex)
    expect(adminIndex).toBeGreaterThan(authIndex)
    expect(adminIndex).toBeLessThan(taskIndex)
    expect(taskIndex).toBeGreaterThan(authIndex)
  })

  it('stores the pushed AipinData data array in SQLite', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-data-'))
    try {
      const { registerAipinDataRoutes } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      registerAipinDataRoutes({
        app,
        userDataPath,
        now: () => new Date('2026-06-08T08:30:12.000Z'),
        randomHex: () => 'abcd1234'
      })

      const payload = [
        {
          scheme_id: 1,
          platform_name: '微博',
          news_title: '人工智能发展迅速',
          news_uuid: 'abc123',
          push_time: '2026-06-08 10:31:00'
        }
      ]

      const res = await invoke(routes, 'POST', '/api/aipin-data/push', { body: payload })

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        requestId: 'aipin_20260608_083012_abcd1234',
        receivedCount: 1,
        storedFile: 'aipin-sqlite:batch:aipin_20260608_083012_abcd1234',
        storage: 'sqlite'
      })
      expect(existsSync(join(userDataPath, 'aipin-data.sqlite'))).toBe(true)
      expect(existsSync(join(userDataPath, 'aipin-inbound', 'index.jsonl'))).toBe(false)

      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const store = new AipinDataStore({ userDataPath })
      expect(store.getBatchEnvelope('aipin_20260608_083012_abcd1234')).toMatchObject({
        requestId: 'aipin_20260608_083012_abcd1234',
        receivedAt: '2026-06-08T08:30:12.000Z',
        receivedCount: 1,
        data: payload
      })
      expect(store.listItems()[0]).toMatchObject({
        itemId: 'aipin_20260608_083012_abcd1234__item_0',
        status: 'received',
        pushStatus: ''
      })
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('creates a pending processing task after storing a valid push', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-data-'))
    try {
      const { registerAipinDataPushRoutes } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const createdTasks = []
      const processingQueue = {
        createTask: async taskInput => {
          createdTasks.push(taskInput)
          return {
            taskId: 'aipin_task_20260608_083012_taskabcd',
            skillId: 'midea-yq-alert',
            status: 'pending',
            ...taskInput
          }
        }
      }

      registerAipinDataPushRoutes({
        app,
        userDataPath,
        processingQueue,
        now: () => new Date('2026-06-08T08:30:12.000Z'),
        randomHex: () => 'abcd1234'
      })

      const payload = [{ news_uuid: 'abc123', news_title: 'AI startup signal' }]
      const res = await invoke(routes, 'POST', '/api/aipin-data/push', { body: payload })

      expect(res.statusCode).toBe(200)
      expect(createdTasks).toEqual([
        {
          requestId: 'aipin_20260608_083012_abcd1234',
          sourceFile: 'aipin-sqlite:batch:aipin_20260608_083012_abcd1234',
          receivedCount: 1
        }
      ])
      expect(res.body).toMatchObject({
        success: true,
        taskId: 'aipin_task_20260608_083012_taskabcd',
        taskStatus: 'pending',
        skillId: 'midea-yq-alert'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('deduplicates pushed items globally by the original data id before creating tasks', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-data-id-dedupe-'))
    try {
      const { registerAipinDataPushRoutes } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { app, routes } = createApp()
      const createdTasks = []
      const randoms = ['first001', 'second02']
      const processingQueue = {
        createTask: async taskInput => {
          createdTasks.push(taskInput)
          return {
            taskId: `task-${createdTasks.length}`,
            skillId: 'midea-yq-alert',
            status: 'pending',
            ...taskInput
          }
        }
      }

      registerAipinDataPushRoutes({
        app,
        userDataPath,
        processingQueue,
        now: () => new Date('2026-06-08T08:30:12.000Z'),
        randomHex: () => randoms.shift()
      })

      const first = await invoke(routes, 'POST', '/api/aipin-data/push', {
        body: [{ id: 8801, news_uuid: 'uuid-first', news_title: 'First signal' }]
      })
      const duplicate = await invoke(routes, 'POST', '/api/aipin-data/push', {
        body: [{ id: 8801, news_uuid: 'uuid-second', news_title: 'Duplicate signal' }]
      })

      expect(first.statusCode).toBe(200)
      expect(duplicate.statusCode).toBe(200)
      expect(first.body).toMatchObject({
        receivedCount: 1,
        storedCount: 1,
        duplicateCount: 0,
        taskId: 'task-1'
      })
      expect(duplicate.body).toMatchObject({
        receivedCount: 1,
        storedCount: 0,
        duplicateCount: 1
      })
      expect(duplicate.body.taskId).toBeUndefined()
      expect(createdTasks).toEqual([
        {
          requestId: 'aipin_20260608_083012_first001',
          sourceFile: 'aipin-sqlite:batch:aipin_20260608_083012_first001',
          receivedCount: 1
        }
      ])

      const store = new AipinDataStore({ userDataPath })
      expect(store.listItems()).toHaveLength(1)
      expect(store.listItems()[0]).toMatchObject({
        articleId: '8801',
        newsUuid: 'uuid-first',
        newsTitle: 'First signal'
      })
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('lists received batches that were stored but not linked to processing tasks', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-data-unlinked-'))
    try {
      const { storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          { id: 6101, news_uuid: 'unlinked-1', news_title: 'Unlinked one' },
          { id: 6102, news_uuid: 'unlinked-2', news_title: 'Unlinked two' }
        ],
        now: () => new Date('2026-06-10T02:03:04.000Z'),
        randomHex: () => 'unlinked'
      })
      const store = new AipinDataStore({ userDataPath })

      expect(store.listUnlinkedReceivedBatches()).toEqual([
        expect.objectContaining({
          request_id: stored.requestId,
          source_ref: stored.storedFile,
          received_count: 2,
          process_status: 'received'
        })
      ])

      store.markTaskLinked({
        requestId: stored.requestId,
        task: {
          taskId: 'aipin_task_unlinked_1',
          requestId: stored.requestId,
          skillId: 'midea-yq-alert',
          status: 'pending'
        }
      })
      expect(store.listUnlinkedReceivedBatches()).toEqual([])
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('starts agent processing after storing a valid push when auto processing is enabled', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-data-'))
    try {
      const { registerAipinDataPushRoutes } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const processCalls = []
      const processingQueue = {
        createTask: async taskInput => ({
          taskId: 'aipin_task_20260608_083012_taskabcd',
          skillId: 'midea-yq-alert',
          status: 'pending',
          ...taskInput
        }),
        getConfig: async () => ({ autoProcess: true })
      }

      registerAipinDataPushRoutes({
        app,
        userDataPath,
        processingQueue,
        processNextTask: async taskId => {
          processCalls.push(taskId)
          return { taskId, status: 'completed' }
        },
        now: () => new Date('2026-06-08T08:30:12.000Z'),
        randomHex: () => 'abcd1234'
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/push', {
        body: [{ news_uuid: 'abc123', news_title: 'AI startup signal' }]
      })
      await Promise.resolve()

      expect(res.statusCode).toBe(200)
      expect(processCalls).toEqual(['aipin_task_20260608_083012_taskabcd'])
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('does not start agent processing when auto processing is disabled', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-data-'))
    try {
      const { registerAipinDataPushRoutes } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const processCalls = []
      const processingQueue = {
        createTask: async taskInput => ({
          taskId: 'aipin_task_20260608_083012_taskabcd',
          skillId: 'midea-yq-alert',
          status: 'pending',
          ...taskInput
        }),
        getConfig: async () => ({ enabled: true, autoProcess: false })
      }

      registerAipinDataPushRoutes({
        app,
        userDataPath,
        processingQueue,
        processNextTask: async taskId => {
          processCalls.push(taskId)
          return { taskId, status: 'completed' }
        },
        now: () => new Date('2026-06-08T08:30:12.000Z'),
        randomHex: () => 'abcd1234'
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/push', {
        body: [{ news_uuid: 'abc123', news_title: 'AI startup signal' }]
      })
      await Promise.resolve()

      expect(res.statusCode).toBe(200)
      expect(processCalls).toEqual([])
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('rejects payloads that are not arrays', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-data-'))
    try {
      const { registerAipinDataRoutes } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      registerAipinDataRoutes({ app, userDataPath })

      const res = await invoke(routes, 'POST', '/api/aipin-data/push', {
        body: { data: [] }
      })

      expect(res.statusCode).toBe(400)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Invalid AipinData payload: request body must be an array or data.data array'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('accepts the AipinData query response shape with data.data array', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-data-shape-'))
    try {
      const { registerAipinDataRoutes } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      registerAipinDataRoutes({
        app,
        userDataPath,
        now: () => new Date('2026-06-08T08:30:12.000Z'),
        randomHex: () => 'shape001'
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/push', {
        body: {
          code: 10000,
          msg: 'success',
          data: {
            data: [{ id: 12345, news_uuid: 'shape-1', news_title: 'Shape candidate' }],
            page: 1,
            limit: 1,
            total: 1
          }
        }
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        requestId: 'aipin_20260608_083012_shape001',
        receivedCount: 1,
        storedFile: 'aipin-sqlite:batch:aipin_20260608_083012_shape001'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('registers internal task routes separately from the external push route', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-data-'))
    try {
      const { registerAipinDataTaskRoutes } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const task = { taskId: 'task-1', status: 'pending' }
      const processCalls = []

      registerAipinDataTaskRoutes({
        app,
        processingQueue: {
          listTasks: async () => [task],
          getTask: async taskId => taskId === 'task-1' ? task : null
        },
        processNextTask: async (taskId, req) => {
          processCalls.push({ taskId, req })
          return { taskId: 'task-1', status: 'completed' }
        }
      })

      const listRes = await invoke(routes, 'GET', '/api/aipin-data/tasks')
      expect(listRes.statusCode).toBe(200)
      expect(listRes.body).toEqual({ success: true, tasks: [task] })

      const processRes = await invoke(routes, 'POST', '/api/aipin-data/tasks/process')
      expect(processRes.statusCode).toBe(200)
      expect(processRes.body).toEqual({ success: true, task: { taskId: 'task-1', status: 'completed' } })
      expect(processCalls).toMatchObject([{ taskId: null }])
      expect(processCalls[0].req.body).toEqual({})
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('returns 404 when no pending task exists for processing', async () => {
    const { registerAipinDataTaskRoutes } = require('../server/aipin-data-routes.js')
    const { app, routes } = createApp()
    registerAipinDataTaskRoutes({
      app,
      processingQueue: {
        listTasks: async () => [],
        getTask: async () => null
      },
      processNextTask: async () => null
    })

    const res = await invoke(routes, 'POST', '/api/aipin-data/tasks/process')
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({
      success: false,
      error: 'No pending AipinData processing task found'
    })
  })

  it('lets logged-in users view Midea monitor data while keeping write actions admin-only', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const payload = [{ news_uuid: 'midea-1', news_title: 'Midea alert candidate' }]
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload,
        now: () => new Date('2026-06-09T02:10:00.000Z'),
        randomHex: () => 'midea001'
      })
      const task = {
        taskId: 'aipin_task_20260609_021001_queue01',
        requestId: stored.requestId,
        sourceFile: stored.storedFile,
        receivedCount: 1,
        skillId: 'midea-yq-alert',
        status: 'failed',
        createdAt: '2026-06-09T02:10:01.000Z',
        startedAt: '2026-06-09T02:10:02.000Z',
        finishedAt: '2026-06-09T02:10:03.000Z',
        sessionId: null,
        outputDir: null,
        resultFile: null,
        error: 'agent failed'
      }

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => [task]
        },
        requireAdmin: req => {
          if (req.currentUser?.phone !== '15527109305') {
            const err = new Error('Forbidden')
            err.code = 'AUTH_FORBIDDEN'
            throw err
          }
          return req.currentUser
        },
        requireUser: req => {
          if (!req.currentUser) {
            const err = new Error('Login required')
            err.code = 'AUTH_REQUIRED'
            throw err
          }
          return req.currentUser
        }
      })

      const normalRead = await invoke(routes, 'GET', '/api/aipin-data/admin/pushes', {
        currentUser: { phone: '13900000000' }
      })
      expect(normalRead.statusCode).toBe(200)
      expect(normalRead.body).toMatchObject({
        success: true,
        total: 1
      })

      const deniedWrite = await invoke(routes, 'POST', '/api/aipin-data/admin/tasks/:taskId/process', {
        params: { taskId: 'aipin_task_20260609_021001_queue01' },
        currentUser: { phone: '13900000000' }
      })
      expect(deniedWrite.statusCode).toBe(403)
      expect(deniedWrite.body).toEqual({ success: false, error: 'Forbidden' })

      const res = await invoke(routes, 'GET', '/api/aipin-data/admin/pushes', {
        currentUser: { phone: '15527109305' }
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        page: 1,
        pageSize: 20,
        total: 1,
        pushes: [
          expect.objectContaining({
            requestId: 'aipin_20260609_021000_midea001',
            receivedAt: '2026-06-09T02:10:00.000Z',
            receivedCount: 1,
            storedFile: 'aipin-sqlite:batch:aipin_20260609_021000_midea001',
            taskId: 'aipin_task_20260609_021001_queue01',
            skillId: 'midea-yq-alert',
            status: 'failed',
            createdAt: '2026-06-09T02:10:01.000Z',
            startedAt: '2026-06-09T02:10:02.000Z',
            finishedAt: '2026-06-09T02:10:03.000Z',
            sessionId: null,
            outputDir: null,
            resultFile: null,
            error: 'agent failed'
          })
        ]
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('paginates Midea admin monitor pushes with 20 records by default', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-pages-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const tasks = []

      for (let index = 0; index < 25; index++) {
        const day = String(index + 1).padStart(2, '0')
        const stored = await storeAipinDataPayload({
          userDataPath,
          payload: [{ news_uuid: `midea-page-${index}` }],
          now: () => new Date(`2026-06-${day}T02:10:00.000Z`),
          randomHex: () => `page${String(index).padStart(3, '0')}`
        })
        tasks.push({
          taskId: `task-${index}`,
          requestId: stored.requestId,
          sourceFile: stored.storedFile,
          receivedCount: 1,
          skillId: 'midea-yq-alert',
          status: 'completed',
          createdAt: `2026-06-${day}T02:10:01.000Z`
        })
      }

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => tasks
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const firstPage = await invoke(routes, 'GET', '/api/aipin-data/admin/pushes')
      expect(firstPage.statusCode).toBe(200)
      expect(firstPage.body.page).toBe(1)
      expect(firstPage.body.pageSize).toBe(20)
      expect(firstPage.body.total).toBe(25)
      expect(firstPage.body.pushes).toHaveLength(20)
      expect(firstPage.body.pushes[0].requestId).toContain('20260625')

      const secondPage = await invoke(routes, 'GET', '/api/aipin-data/admin/pushes', {
        query: { page: '2', pageSize: '20' }
      })
      expect(secondPage.statusCode).toBe(200)
      expect(secondPage.body.page).toBe(2)
      expect(secondPage.body.pageSize).toBe(20)
      expect(secondPage.body.total).toBe(25)
      expect(secondPage.body.pushes).toHaveLength(5)
      expect(secondPage.body.pushes[0].requestId).toContain('20260605')
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('lists individual pushed payload items for the Midea admin monitor', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-items-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { app, routes } = createApp()
      const payload = [
        { id: 7001, news_uuid: 'item-1', news_title: 'First candidate', platform_name: '微博', push_time: '2026-06-09 10:00:00', news_posttime: '2026-06-09 09:58:00', news_content: 'long body one' },
        { id: 7002, news_uuid: 'item-2', news_title: 'Second candidate', platform_name: '抖音', push_time: '2026-06-09 10:01:00', news_posttime: '2026-06-09 09:59:00', news_content: 'long body two' }
      ]
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload,
        now: () => new Date('2026-06-09T02:10:00.000Z'),
        randomHex: () => 'items001'
      })
      const task = {
        taskId: 'item-task-2',
        requestId: `${stored.requestId}__item_1`,
        sourceFile: 'aipin-inbound-items/2026-06-09/item-task-2.txt',
        receivedCount: 1,
        skillId: 'midea-yq-alert',
        status: 'failed',
        createdAt: '2026-06-09T02:10:01.000Z',
        startedAt: '2026-06-09T02:10:02.000Z',
        finishedAt: '2026-06-09T02:10:03.000Z',
        error: 'single item failed'
      }
      const store = new AipinDataStore({ userDataPath })
      store.markTaskLinked({ requestId: task.requestId, task })
      store.markTaskStatus({ requestId: task.requestId, task, status: 'failed', error: task.error })
      store.close()

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'GET', '/api/aipin-data/admin/items')

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        page: 1,
        pageSize: 20,
        total: 2,
        summary: {
          total: 2,
          pending: 1,
          processing: 0,
          pushed: 0,
          processFailed: 1,
          pushFailed: 0
        }
      })
      expect(res.body.items).toEqual([
        expect.objectContaining({
          itemId: `${stored.requestId}__item_0`,
          requestId: stored.requestId,
          itemIndex: 0,
          newsUuid: 'item-1',
          newsTitle: 'First candidate',
          platformName: '微博',
          article_id: '7001',
          articleId: '7001',
          push: expect.objectContaining({
            push_flag: '否',
            article_id: '7001'
          }),
          pushTime: '2026-06-09 10:00:00',
          newsPosttime: '2026-06-09 09:58:00',
          status: 'received',
          taskId: null
        }),
        expect.objectContaining({
          itemId: `${stored.requestId}__item_1`,
          requestId: stored.requestId,
          itemIndex: 1,
          newsUuid: 'item-2',
          newsTitle: 'Second candidate',
          platformName: '抖音',
          article_id: '7002',
          articleId: '7002',
          push: expect.objectContaining({
            push_flag: '否',
            article_id: '7002'
          }),
          pushTime: '2026-06-09 10:01:00',
          newsPosttime: '2026-06-09 09:59:00',
          status: 'failed',
          taskId: 'item-task-2',
          error: 'single item failed'
        })
      ])
      expect(res.body.items[0]).not.toHaveProperty('data')

      const pagedRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items', {
        query: { page: '1', pageSize: '1' }
      })

      expect(pagedRes.statusCode).toBe(200)
      expect(pagedRes.body).toMatchObject({
        success: true,
        page: 1,
        pageSize: 1,
        total: 2,
        summary: {
          total: 2,
          pending: 1,
          processing: 0,
          pushed: 0,
          processFailed: 1,
          pushFailed: 0
        }
      })
      expect(pagedRes.body.items).toHaveLength(1)

      const detailRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items/:itemId', {
        params: { itemId: `${stored.requestId}__item_0` }
      })
      expect(detailRes.statusCode).toBe(200)
      expect(detailRes.body.item).toMatchObject({
        itemId: `${stored.requestId}__item_0`,
        article_id: '7001',
        articleId: '7001',
        push: expect.objectContaining({
          push_flag: '否',
          article_id: '7001'
        }),
        data: expect.objectContaining({
          id: 7001,
          news_content: 'long body one'
        })
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('filters Midea admin monitor items by push status', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-push-status-filter-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          { id: 5001, news_uuid: 'push-filter-1', news_title: 'Push filter none' },
          { id: 5002, news_uuid: 'push-filter-2', news_title: 'Push filter success' },
          { id: 5003, news_uuid: 'push-filter-3', news_title: 'Push filter failed' }
        ],
        now: () => new Date('2026-06-09T02:15:00.000Z'),
        randomHex: () => 'pushflt1'
      })
      const store = new AipinDataStore({ userDataPath })
      const successItemId = `${stored.requestId}__item_1`
      const failedItemId = `${stored.requestId}__item_2`
      store.updateProcessedFields({
        itemId: successItemId,
        fields: { summary: 'success summary', pushFlag: '推送' },
        status: 'completed'
      })
      store.markPushResult({
        itemId: successItemId,
        status: 'success',
        request: { record: { article_id: '5002' } },
        response: { code: 10000 }
      })
      store.updateProcessedFields({
        itemId: failedItemId,
        fields: { summary: 'failed summary', pushFlag: '推送' },
        status: 'completed'
      })
      store.markPushResult({
        itemId: failedItemId,
        status: 'failed',
        request: { record: { article_id: '5003' } },
        response: { code: 50000 },
        error: 'push failed'
      })
      store.close()

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const successRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items', {
        query: { pushStatus: 'success' }
      })
      const noneRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items', {
        query: { pushStatus: 'none' }
      })
      const failedRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items', {
        query: { pushStatus: 'failed' }
      })

      expect(successRes.statusCode).toBe(200)
      expect(successRes.body.total).toBe(1)
      expect(successRes.body.summary).toMatchObject({
        total: 1,
        pending: 0,
        processing: 0,
        pushed: 1,
        processFailed: 0,
        pushFailed: 0
      })
      expect(successRes.body.items[0]).toMatchObject({
        itemId: successItemId,
        pushStatus: 'success'
      })
      expect(noneRes.statusCode).toBe(200)
      expect(noneRes.body.total).toBe(1)
      expect(noneRes.body.items[0]).toMatchObject({
        itemId: `${stored.requestId}__item_0`,
        pushStatus: ''
      })
      expect(failedRes.statusCode).toBe(200)
      expect(failedRes.body.total).toBe(1)
      expect(failedRes.body.summary).toMatchObject({
        total: 1,
        pending: 0,
        processing: 0,
        pushed: 0,
        processFailed: 0,
        pushFailed: 1
      })
      expect(failedRes.body.items[0]).toMatchObject({
        itemId: failedItemId,
        pushStatus: 'failed'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('filters Midea admin monitor items by push flag', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-push-flag-filter-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          { id: 5101, news_uuid: 'push-flag-1', news_title: 'Push flag none' },
          { id: 5102, news_uuid: 'push-flag-2', news_title: 'Push flag yes' },
          { id: 5103, news_uuid: 'push-flag-3', news_title: 'Push flag duplicate' }
        ],
        now: () => new Date('2026-06-09T02:16:00.000Z'),
        randomHex: () => 'flagflt1'
      })
      const store = new AipinDataStore({ userDataPath })
      const pushItemId = `${stored.requestId}__item_1`
      const duplicateItemId = `${stored.requestId}__item_2`
      store.updateProcessedFields({
        itemId: pushItemId,
        fields: { summary: 'push flag summary', pushFlag: '推送' },
        status: 'completed'
      })
      store.updateProcessedFields({
        itemId: duplicateItemId,
        fields: { summary: 'duplicate flag summary', pushFlag: '重复' },
        status: 'completed'
      })
      store.close()

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const pushRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items', {
        query: { pushFlag: '推送' }
      })
      const noneRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items', {
        query: { pushFlag: 'none' }
      })
      const duplicateRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items', {
        query: { pushFlag: '重复' }
      })

      expect(pushRes.statusCode).toBe(200)
      expect(pushRes.body.total).toBe(1)
      expect(pushRes.body.items[0]).toMatchObject({
        itemId: pushItemId,
        pushFlag: '推送'
      })
      expect(noneRes.statusCode).toBe(200)
      expect(noneRes.body.total).toBe(1)
      expect(noneRes.body.items[0]).toMatchObject({
        itemId: `${stored.requestId}__item_0`,
        pushFlag: ''
      })
      expect(duplicateRes.statusCode).toBe(200)
      expect(duplicateRes.body.total).toBe(1)
      expect(duplicateRes.body.items[0]).toMatchObject({
        itemId: duplicateItemId,
        pushFlag: '重复'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('filters Midea admin monitor items by publish time range to the minute', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-publish-filter-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          { id: 5301, news_uuid: 'publish-filter-1', news_title: 'Publish before', news_posttime: '2026-06-09 08:29:59' },
          { id: 5302, news_uuid: 'publish-filter-2', news_title: 'Publish in range', news_posttime: '2026-06-09 08:30:30' },
          { id: 5303, news_uuid: 'publish-filter-3', news_title: 'Publish after', news_posttime: '2026-06-09 08:31:00' }
        ],
        now: () => new Date('2026-06-09T02:18:00.000Z'),
        randomHex: () => 'pubflt1'
      })

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'GET', '/api/aipin-data/admin/items', {
        query: { publishStart: '2026-06-09T08:30', publishEnd: '2026-06-09T08:30' }
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        total: 1,
        summary: {
          total: 1,
          pending: 1
        }
      })
      expect(res.body.items).toEqual([
        expect.objectContaining({
          itemId: `${stored.requestId}__item_1`,
          newsPosttime: '2026-06-09 08:30:30'
        })
      ])
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('summarizes push flag and emotion attributes for Midea admin monitor items', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-summary-extra-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          { id: 5201, news_uuid: 'summary-extra-1', news_title: 'Positive push', news_emotion: '正面' },
          { id: 5202, news_uuid: 'summary-extra-2', news_title: 'Negative duplicate', news_emotion: '负面' },
          { id: 5203, news_uuid: 'summary-extra-3', news_title: 'Neutral none', news_emotion: '中性' }
        ],
        now: () => new Date('2026-06-09T02:17:00.000Z'),
        randomHex: () => 'sumextra'
      })
      const store = new AipinDataStore({ userDataPath })
      store.updateProcessedFields({
        itemId: `${stored.requestId}__item_0`,
        fields: { summary: 'positive summary', pushFlag: '推送' },
        status: 'completed'
      })
      store.updateProcessedFields({
        itemId: `${stored.requestId}__item_1`,
        fields: { summary: 'negative summary', pushFlag: '重复' },
        status: 'completed'
      })
      store.close()

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'GET', '/api/aipin-data/admin/items')
      const pushRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items', {
        query: { pushFlag: '推送' }
      })

      expect(res.statusCode).toBe(200)
      expect(res.body.summary).toMatchObject({
        total: 3,
        pushFlagPush: 1,
        emotionPositive: 1,
        emotionNegative: 1
      })
      expect(pushRes.statusCode).toBe(200)
      expect(pushRes.body.summary).toMatchObject({
        total: 1,
        pushFlagPush: 1,
        emotionPositive: 1,
        emotionNegative: 0
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('adds processed Midea fields from skill result files to monitor items', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-item-fields-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { app, routes } = createApp()
      const payload = [
        {
          news_uuid: 'field-1',
          news_title: 'Field candidate one',
          news_emotion: '负面',
          news_digest: 'original digest'
        },
        {
          news_uuid: 'field-2',
          news_title: 'Field candidate two',
          AI总结: '原始AI总结'
        }
      ]
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload,
        now: () => new Date('2026-06-09T02:10:00.000Z'),
        randomHex: () => 'fields01'
      })
      const resultDir = join(userDataPath, 'aipin-processed', '2026-06-09', 'task-fields')
      const outputDir = join(userDataPath, 'agent-output', 'task-fields')
      mkdirSync(resultDir, { recursive: true })
      mkdirSync(outputDir, { recursive: true })
      const resultFile = join(resultDir, 'result.json')
      writeFileSync(resultFile, JSON.stringify({
        structuredResult: null
      }), 'utf-8')
      writeFileSync(join(outputDir, 'aipin-result.json'), JSON.stringify({
        items: [
          {
            news_uuid: 'field-1',
            summary: 'skill 摘要 1',
            fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
            complaintNo: 'HM-1001',
            aiSummary: 'skill AI 总结 1',
            aiJudgement: 'skill AI 研判 1',
            pushFlag: '有推送'
          },
          {
            itemIndex: 1,
            摘要: 'skill 摘要 2',
            完整标签: '【重复事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
            投诉编号: 'HM-1002',
            AI总结: 'skill AI 总结 2',
            AI研判: 'skill AI 研判 2',
            推送标识: '重复'
          }
        ]
      }), 'utf-8')
      const batchTask = {
        taskId: 'task-fields',
        requestId: stored.requestId,
        sourceFile: stored.storedFile,
        receivedCount: 2,
        skillId: 'midea-yq-alert',
        status: 'completed',
        createdAt: '2026-06-09T02:10:01.000Z',
        finishedAt: '2026-06-09T02:10:03.000Z',
        outputDir,
        resultFile
      }
      const store = new AipinDataStore({ userDataPath })
      store.updateProcessedFields({
        itemId: `${stored.requestId}__item_0`,
        fields: {
          summary: 'skill 摘要 1',
          fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
          complaintNo: 'HM-1001',
          aiSummary: 'skill AI 总结 1',
          aiJudgement: 'skill AI 研判 1',
          pushFlag: '推送'
        },
        status: 'completed'
      })
      store.updateProcessedFields({
        itemId: `${stored.requestId}__item_1`,
        fields: {
          summary: 'skill 摘要 2',
          fullLabel: '【重复事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
          complaintNo: 'HM-1002',
          aiSummary: 'skill AI 总结 2',
          aiJudgement: 'skill AI 研判 2',
          pushFlag: '重复'
        },
        status: 'completed'
      })
      store.close()

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'GET', '/api/aipin-data/admin/items')

      expect(res.statusCode).toBe(200)
      expect(res.body.items).toEqual([
        expect.objectContaining({
          itemId: `${stored.requestId}__item_0`,
          status: 'completed',
          newsEmotion: '负面',
          summary: 'skill 摘要 1',
          fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
          complaintNo: 'HM-1001',
          aiSummary: 'skill AI 总结 1',
          aiJudgement: 'skill AI 研判 1',
          pushFlag: '推送'
        }),
        expect.objectContaining({
          itemId: `${stored.requestId}__item_1`,
          status: 'completed',
          summary: 'skill 摘要 2',
          fullLabel: '【重复事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
          complaintNo: 'HM-1002',
          aiSummary: 'skill AI 总结 2',
          aiJudgement: 'skill AI 研判 2',
          pushFlag: '重复'
        })
      ])
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('keeps monitor items readable when a skill result file contains invalid JSON', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-invalid-result-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          {
            news_uuid: 'invalid-result-1',
            news_title: 'Invalid result candidate',
            news_emotion: 'negative'
          }
        ],
        now: () => new Date('2026-06-09T02:20:00.000Z'),
        randomHex: () => 'badjson1'
      })
      const outputDir = join(userDataPath, 'agent-output', 'bad-json')
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(join(outputDir, 'aipin-result.json'), `{
  "items": [
    {
      "itemIndex": 0,
      "news_uuid": "invalid-result-1",
      "summary": "contains "quoted" text",
      "complaintNo": "HM-2001",
      "aiSummary": "AI summary with "quoted" text",
      "aiJudgement": "不报送：AI judgement"
    }
  ]
}`, 'utf-8')

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => [
            {
              taskId: 'task-bad-json',
              requestId: stored.requestId,
              sourceFile: stored.storedFile,
              receivedCount: 1,
              skillId: 'midea-yq-alert',
              status: 'completed',
              createdAt: '2026-06-09T02:20:01.000Z',
              finishedAt: '2026-06-09T02:20:03.000Z',
              outputDir,
              resultFile: null
            }
          ]
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'GET', '/api/aipin-data/admin/items')

      expect(res.statusCode).toBe(200)
      expect(res.body.items).toEqual([
        expect.objectContaining({
          itemId: `${stored.requestId}__item_0`,
          status: 'received',
          newsEmotion: 'negative',
          summary: '',
          complaintNo: '',
          aiSummary: '',
          aiJudgement: '',
          pushFlag: ''
        })
      ])
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('recovers processed Midea fields from stored SQLite task output when queue task is unavailable', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-row-output-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          {
            news_uuid: 'row-output-1',
            news_title: 'Row output candidate',
            news_emotion: 'negative'
          }
        ],
        now: () => new Date('2026-06-09T02:30:00.000Z'),
        randomHex: () => 'rowout01'
      })
      const itemId = `${stored.requestId}__item_0`
      const outputDir = join(userDataPath, 'agent-output', 'row-output')
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(join(outputDir, 'aipin-result.json'), JSON.stringify({
        items: [
          {
            itemIndex: 0,
            news_uuid: 'row-output-1',
            summary: 'row output summary',
            complaintNo: 'HM-3001',
            aiSummary: 'row output AI summary',
            aiJudgement: 'row output AI judgement',
            pushFlag: '不推送'
          }
        ]
      }), 'utf-8')
      const store = new AipinDataStore({ userDataPath })
      store.markTaskStatus({
        requestId: itemId,
        task: {
          startedAt: '2026-06-09T02:30:01.000Z',
          finishedAt: '2026-06-09T02:30:03.000Z',
          outputDir,
          resultFile: null
        },
        status: 'completed'
      })
      store.updateProcessedFields({
        itemId,
        fields: {
          summary: 'row output summary',
          complaintNo: 'HM-3001',
          aiSummary: 'row output AI summary',
          aiJudgement: 'row output AI judgement',
          pushFlag: '不推送'
        },
        status: 'completed'
      })
      store.close()

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'GET', '/api/aipin-data/admin/items')

      expect(res.statusCode).toBe(200)
      expect(res.body.items).toEqual([
        expect.objectContaining({
          itemId,
          status: 'completed',
          summary: 'row output summary',
          complaintNo: 'HM-3001',
          aiSummary: 'row output AI summary',
          aiJudgement: 'row output AI judgement',
          pushFlag: '不推送'
        })
      ])
      const verifyStore = new AipinDataStore({ userDataPath })
      expect(verifyStore.getItem(itemId)).toMatchObject({
        summary: 'row output summary',
        complaintNo: 'HM-3001',
        aiSummary: 'row output AI summary',
        aiJudgement: 'row output AI judgement',
        pushFlag: '不推送'
      })
      verifyStore.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('pushes a completed pending Midea monitor item on demand without clearing processed fields', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-manual-push-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          {
            id: 3001,
            news_uuid: 'manual-push-1',
            news_title: 'Manual push candidate',
            news_emotion: 'negative'
          }
        ],
        now: () => new Date('2026-06-09T02:40:00.000Z'),
        randomHex: () => 'push001'
      })
      const itemId = `${stored.requestId}__item_0`
      const store = new AipinDataStore({ userDataPath })
      store.updateProcessedFields({
        itemId,
        fields: {
          summary: 'manual push summary',
          complaintNo: 'HM-4001',
          aiSummary: 'manual push AI summary',
          aiJudgement: 'manual push AI judgement',
          pushFlag: '推送'
        },
        status: 'completed'
      })
      store.close()

      const pushCalls = []
      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        feishuPusher: {
          pushPending: async input => {
            pushCalls.push(input)
            const pushStore = new AipinDataStore({ userDataPath })
            pushStore.markPushResult({
              itemId,
              status: 'success',
              request: {
                endpoint: 'https://example.test/receive',
                record: { article_id: '3001', push_flag: '是' }
              },
              response: { code: 10000 }
            })
            pushStore.close()
            return { success: true, total: 1, pushed: 1 }
          }
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/admin/items/:itemId/push', {
        params: { itemId }
      })

      expect(res.statusCode).toBe(200)
      expect(pushCalls).toEqual([{ requestId: itemId, limit: 1 }])
      expect(res.body).toMatchObject({
        success: true,
        push: { success: true, total: 1, pushed: 1 },
        item: {
          itemId,
          status: 'completed',
          pushStatus: 'success',
          summary: 'manual push summary',
          complaintNo: 'HM-4001',
          aiSummary: 'manual push AI summary',
          aiJudgement: 'manual push AI judgement',
          pushFlag: '推送',
          pushRequest: {
            endpoint: 'https://example.test/receive',
            record: { article_id: '3001', push_flag: '是' }
          },
          pushResponse: { code: 10000 }
        }
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('allows manually pushing completed Midea monitor items with stale non-success push status', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-push-stale-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          {
            id: 3002,
            news_uuid: 'manual-push-stale-1',
            news_title: 'Manual push stale candidate',
            news_emotion: 'negative'
          }
        ],
        now: () => new Date('2026-06-09T02:45:00.000Z'),
        randomHex: () => 'pushstl'
      })
      const itemId = `${stored.requestId}__item_0`
      const store = new AipinDataStore({ userDataPath })
      store.updateProcessedFields({
        itemId,
        fields: {
          summary: 'manual push stale summary',
          aiSummary: 'manual push stale AI summary',
          aiJudgement: 'manual push stale AI judgement',
          pushFlag: '推送'
        },
        status: 'completed'
      })
      store.markPushResult({
        itemId,
        status: 'sending',
        error: 'stale local state'
      })
      store.close()

      const pushCalls = []
      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        feishuPusher: {
          pushPending: async input => {
            pushCalls.push(input)
            const pushStore = new AipinDataStore({ userDataPath })
            expect(pushStore.getPushableItems({ requestId: itemId, limit: 1 })).toHaveLength(1)
            pushStore.markPushResult({
              itemId,
              status: 'success',
              request: { record: { article_id: '3002', push_flag: '是' } },
              response: { code: 10000 }
            })
            pushStore.close()
            return { success: true, total: 1, pushed: 1 }
          }
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/admin/items/:itemId/push', {
        params: { itemId }
      })

      expect(res.statusCode).toBe(200)
      expect(pushCalls).toEqual([{ requestId: itemId, limit: 1 }])
      expect(res.body.item).toMatchObject({
        itemId,
        status: 'completed',
        pushStatus: 'success'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('persists recovered processed fields before manual push so Feishu records include them', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-push-recovered-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { AipinDataStore } = require('../server/aipin-data-store.js')
      const { AipinFeishuPusher } = require('../server/aipin-feishu-pusher.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [
          {
            id: 4001,
            news_uuid: 'manual-push-recovered-1',
            news_title: 'Manual push recovered candidate',
            manual_digest: 'original digest'
          }
        ],
        now: () => new Date('2026-06-09T02:50:00.000Z'),
        randomHex: () => 'recov01'
      })
      const itemId = `${stored.requestId}__item_0`
      const outputDir = join(userDataPath, 'agent-output', 'push-recovered')
      mkdirSync(outputDir, { recursive: true })
      writeFileSync(join(outputDir, 'aipin-result.json'), JSON.stringify({
        items: [
          {
            itemIndex: 0,
            news_uuid: 'manual-push-recovered-1',
            summary: 'recovered summary',
            fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
            complaintNo: 'HM-5001',
            aiSummary: 'recovered AI summary',
            aiJudgement: 'recovered AI judgement',
            pushFlag: '不推送'
          }
        ]
      }), 'utf-8')
      const store = new AipinDataStore({ userDataPath })
      store.markTaskStatus({
        requestId: itemId,
        task: {
          startedAt: '2026-06-09T02:50:01.000Z',
          finishedAt: '2026-06-09T02:50:03.000Z',
          outputDir,
          resultFile: null
        },
        status: 'completed'
      })
      store.updateProcessedFields({
        itemId,
        fields: {
          summary: 'recovered summary',
          fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
          complaintNo: 'HM-5001',
          aiSummary: 'recovered AI summary',
          aiJudgement: 'recovered AI judgement',
          pushFlag: '不推送'
        },
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
          calls.push({ url, payload: JSON.parse(options.body) })
          return {
            ok: true,
            status: 200,
            json: async () => ({
              code: 10000,
              data: {
                details: [
                  {
                    article_id: '4001',
                    pushed: true,
                    error: ''
                  }
                ]
              }
            })
          }
        }
      })

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        feishuPusher: pusher,
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/admin/items/:itemId/push', {
        params: { itemId }
      })

      expect(res.statusCode).toBe(200)
      expect(calls).toHaveLength(1)
      expect(calls[0].payload.records).toEqual([
        expect.objectContaining({
          push_flag: '否',
          full_label: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
          news_digest: 'recovered summary',
          complaint_no: 'HM-5001',
          ai_summary: 'recovered AI summary',
          ai_judgment: 'recovered AI judgement',
          article_id: '4001'
        })
      ])
      expect(res.body.item).toMatchObject({
        summary: 'recovered summary',
        fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
        complaintNo: 'HM-5001',
        aiSummary: 'recovered AI summary',
        aiJudgement: 'recovered AI judgement',
        pushFlag: '不推送',
        pushStatus: 'success'
      })
      expect(store.getItem(itemId)).toMatchObject({
        summary: 'recovered summary',
        fullLabel: '【异常事件】【C端产品风险舆情】【智能家居事业群】【厨热】【服务售后】',
        complaintNo: 'HM-5001',
        aiSummary: 'recovered AI summary',
        aiJudgement: 'recovered AI judgement',
        pushStatus: 'success'
      })
      store.close()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('rejects manual push before a Midea monitor item is completed', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-push-early-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [{ id: 3002, news_uuid: 'push-early-1', news_title: 'Push early candidate' }],
        now: () => new Date('2026-06-09T02:45:00.000Z'),
        randomHex: () => 'early01'
      })
      const itemId = `${stored.requestId}__item_0`

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => []
        },
        feishuPusher: {
          pushPending: async () => {
            throw new Error('push should not run before completed')
          }
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const listRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items')
      expect(listRes.statusCode).toBe(200)
      expect(listRes.body.items[0]).toMatchObject({
        itemId,
        status: 'received',
        pushStatus: ''
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/admin/items/:itemId/push', {
        params: { itemId }
      })

      expect(res.statusCode).toBe(409)
      expect(res.body).toMatchObject({
        success: false,
        error: 'Only completed Midea monitor items can be pushed'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('processes a failed Midea admin monitor task on demand', async () => {
    const { registerAipinDataAdminRoutes } = require('../server/aipin-data-routes.js')
    const { app, routes } = createApp()
    const calls = []

    registerAipinDataAdminRoutes({
      app,
      userDataPath: root,
      processingQueue: {
        listTasks: async () => [],
        retryTask: async taskId => {
          calls.push({ type: 'retry', taskId })
          return { taskId, status: 'pending' }
        }
      },
      processNextTask: async (taskId, req) => {
        calls.push({ type: 'process', taskId, hasReq: !!req })
        return { taskId, status: 'completed' }
      },
      requireAdmin: () => ({ phone: '15527109305' })
    })

    const res = await invoke(routes, 'POST', '/api/aipin-data/admin/tasks/:taskId/process', {
      params: { taskId: 'failed-task-1' }
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      success: true,
      task: { taskId: 'failed-task-1', status: 'completed' }
    })
    expect(calls).toEqual([
      { type: 'retry', taskId: 'failed-task-1' },
      { type: 'process', taskId: 'failed-task-1', hasReq: true }
    ])
  })

  it('processes any Midea admin monitor push on demand with midea-yq-alert', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-process-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const calls = []
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload: [{ news_uuid: 'manual-1', news_title: 'Manual candidate' }],
        now: () => new Date('2026-06-09T03:20:00.000Z'),
        randomHex: () => 'manual01'
      })

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => [],
          createTask: async input => {
            calls.push({ type: 'create', input })
            return {
              taskId: 'manual-task-1',
              ...input,
              skillId: 'midea-yq-alert',
              status: 'pending'
            }
          },
          prepareTaskForManualProcess: async taskId => {
            calls.push({ type: 'prepare', taskId })
            return { taskId, skillId: 'midea-yq-alert', status: 'pending' }
          }
        },
        processNextTask: async (taskId, req) => {
          calls.push({ type: 'process', taskId, hasReq: !!req })
          return { taskId, skillId: 'midea-yq-alert', status: 'completed' }
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/admin/pushes/:requestId/process', {
        params: { requestId: stored.requestId }
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({
        success: true,
        task: { taskId: 'manual-task-1', skillId: 'midea-yq-alert', status: 'completed' }
      })
      expect(calls).toEqual([
        {
          type: 'create',
          input: {
            requestId: stored.requestId,
            sourceFile: stored.storedFile,
            receivedCount: 1
          }
        },
        { type: 'process', taskId: 'manual-task-1', hasReq: true }
      ])
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('processes one Midea monitor item on demand with midea-yq-alert', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-item-process-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const calls = []
      let createdTask = null
      const payload = [
        { news_uuid: 'manual-item-1', news_title: 'Manual item one' },
        { news_uuid: 'manual-item-2', news_title: 'Manual item two' }
      ]
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload,
        now: () => new Date('2026-06-09T03:20:00.000Z'),
        randomHex: () => 'item001'
      })
      const itemId = `${stored.requestId}__item_1`

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => {
            const tasks = [
              {
              taskId: 'batch-task-should-not-run',
              requestId: stored.requestId,
              sourceFile: stored.storedFile,
              receivedCount: 2,
              skillId: 'midea-yq-alert',
              status: 'completed'
              }
            ]
            if (createdTask) tasks.unshift(createdTask)
            return tasks
          },
          createTask: async input => {
            calls.push({ type: 'create', input })
            createdTask = {
              taskId: 'single-item-task-1',
              ...input,
              skillId: 'midea-yq-alert',
              status: 'pending'
            }
            return createdTask
          },
          prepareTaskForManualProcess: async taskId => {
            calls.push({ type: 'prepare', taskId })
            return { taskId, skillId: 'midea-yq-alert', status: 'pending' }
          }
        },
        processNextTask: async (taskId, req) => {
          calls.push({ type: 'process', taskId, hasReq: !!req })
          createdTask = { ...createdTask, taskId, skillId: 'midea-yq-alert', status: 'completed' }
          return createdTask
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/admin/items/:itemId/process', {
        params: { itemId }
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toEqual({
        success: true,
        task: expect.objectContaining({ taskId: 'single-item-task-1', skillId: 'midea-yq-alert', status: 'completed' }),
        item: expect.objectContaining({
          itemId,
          taskId: 'single-item-task-1',
          taskRequestId: itemId,
          status: 'completed'
        })
      })
      expect(calls).toEqual([
        {
          type: 'create',
          input: expect.objectContaining({
            requestId: itemId,
            sourceFile: `aipin-sqlite:item:${itemId}`,
            receivedCount: 1,
            skillId: 'midea-yq-alert'
          })
        },
        { type: 'process', taskId: 'single-item-task-1', hasReq: true }
      ])
      expect(calls.find(call => call.type === 'prepare')).toBeUndefined()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('does not read legacy text-backed Midea monitor items', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-legacy-item-'))
    try {
      const { registerAipinDataAdminRoutes } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const inboundDir = join(userDataPath, 'aipin-inbound', '2026-06-09')
      mkdirSync(inboundDir, { recursive: true })
      const requestId = 'aipin_20260609_072116_38b7d134'
      const payload = [
        { news_uuid: 'legacy-0', news_title: 'Legacy item zero' },
        { news_uuid: 'legacy-1', news_title: 'Legacy item one' }
      ]
      writeFileSync(join(inboundDir, `${requestId}.txt`), JSON.stringify({
        requestId,
        receivedAt: '2026-06-09T07:21:16.564Z',
        receivedCount: payload.length,
        data: payload
      }, null, 2), 'utf-8')
      mkdirSync(join(userDataPath, 'aipin-inbound'), { recursive: true })
      writeFileSync(join(userDataPath, 'aipin-inbound', 'index.jsonl'), `${JSON.stringify({
        requestId,
        receivedAt: '2026-06-09T07:21:16.564Z',
        receivedCount: payload.length,
        storedFile: `aipin-inbound/2026-06-09/${requestId}.txt`
      })}\n`, 'utf-8')

      const itemId = `${requestId}__item_1`
      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => [],
          createTask: async () => {
            throw new Error('legacy txt data should not create a processing task')
          }
        },
        processNextTask: async () => {
          throw new Error('legacy txt data should not be processed')
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const listRes = await invoke(routes, 'GET', '/api/aipin-data/admin/items')
      expect(listRes.statusCode).toBe(200)
      expect(listRes.body).toMatchObject({
        success: true,
        total: 0,
        items: []
      })

      const res = await invoke(routes, 'POST', '/api/aipin-data/admin/items/:itemId/process', {
        params: { itemId }
      })

      expect(res.statusCode).toBe(404)
      expect(res.body).toEqual({
        success: false,
        error: 'AipinData item record not found'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('loads a single pushed payload detail for the Midea admin monitor', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'jedi-aipin-admin-detail-'))
    try {
      const { registerAipinDataAdminRoutes, storeAipinDataPayload } = require('../server/aipin-data-routes.js')
      const { app, routes } = createApp()
      const payload = [{ news_uuid: 'midea-2', news_title: 'Detail candidate' }]
      const stored = await storeAipinDataPayload({
        userDataPath,
        payload,
        now: () => new Date('2026-06-09T03:20:00.000Z'),
        randomHex: () => 'midea002'
      })
      const task = {
        taskId: 'aipin_task_20260609_032001_queue02',
        requestId: stored.requestId,
        sourceFile: stored.storedFile,
        receivedCount: 1,
        skillId: 'midea-yq-alert',
        status: 'pending',
        createdAt: '2026-06-09T03:20:01.000Z'
      }

      registerAipinDataAdminRoutes({
        app,
        userDataPath,
        processingQueue: {
          listTasks: async () => [task]
        },
        requireAdmin: () => ({ phone: '15527109305' })
      })

      const res = await invoke(routes, 'GET', '/api/aipin-data/admin/pushes/:requestId', {
        params: { requestId: stored.requestId }
      })

      expect(res.statusCode).toBe(200)
      expect(res.body).toMatchObject({
        success: true,
        push: {
          requestId: 'aipin_20260609_032000_midea002',
          receivedAt: '2026-06-09T03:20:00.000Z',
          receivedCount: 1,
          data: payload,
          task: {
            taskId: 'aipin_task_20260609_032001_queue02',
            status: 'pending',
            skillId: 'midea-yq-alert'
          }
        }
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
