import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function wait(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('AipinProcessingScheduler', () => {
  it('starts tasks up to the configured max concurrency when memory is healthy', async () => {
    const { AipinProcessingScheduler } = require('../server/aipin-processing-scheduler.js')
    const running = []
    const started = []
    const scheduler = new AipinProcessingScheduler({
      getConfig: async () => ({
        minConcurrentAgents: 1,
        maxConcurrentAgents: 3,
        memorySoftLimitPercent: 75,
        memoryHardLimitPercent: 88,
        memoryResumePercent: 68
      }),
      getMemoryUsagePercent: () => 40,
      runTask: async taskId => {
        started.push(taskId)
        const task = deferred()
        running.push(task)
        return task.promise
      },
      logger: { info() {}, warn() {} }
    })

    const promises = [1, 2, 3, 4, 5].map(id => scheduler.schedule(`task-${id}`))
    await wait()

    expect(started).toEqual(['task-1', 'task-2', 'task-3'])
    expect(scheduler.getState()).toMatchObject({ activeCount: 3, pendingCount: 2 })

    running[0].resolve('done-1')
    await expect(promises[0]).resolves.toBe('done-1')
    await wait()

    expect(started).toEqual(['task-1', 'task-2', 'task-3', 'task-4'])
    running.slice(1).forEach((task, index) => task.resolve(`done-${index + 2}`))
    await Promise.all(promises.slice(1, 4))
  })

  it('reduces new starts to min concurrency while memory is above the soft limit', async () => {
    const { AipinProcessingScheduler } = require('../server/aipin-processing-scheduler.js')
    let memory = 80
    const running = []
    const started = []
    const scheduler = new AipinProcessingScheduler({
      getConfig: async () => ({
        minConcurrentAgents: 1,
        maxConcurrentAgents: 4,
        memorySoftLimitPercent: 75,
        memoryHardLimitPercent: 88,
        memoryResumePercent: 68
      }),
      getMemoryUsagePercent: () => memory,
      runTask: async taskId => {
        started.push(taskId)
        const task = deferred()
        running.push(task)
        return task.promise
      },
      logger: { info() {}, warn() {} }
    })

    const promises = [1, 2, 3].map(id => scheduler.schedule(`task-${id}`))
    await wait()

    expect(started).toEqual(['task-1'])
    expect(scheduler.getState()).toMatchObject({ activeCount: 1, pendingCount: 2, memoryBackpressure: true })

    memory = 60
    running[0].resolve('done-1')
    await expect(promises[0]).resolves.toBe('done-1')
    await wait()

    expect(started).toEqual(['task-1', 'task-2', 'task-3'])
    running.slice(1).forEach(task => task.resolve('done'))
    await Promise.all(promises.slice(1))
  })

  it('pauses starting new tasks above the hard memory limit and retries after memory recovers', async () => {
    const { AipinProcessingScheduler } = require('../server/aipin-processing-scheduler.js')
    let memory = 90
    const running = []
    const started = []
    const scheduler = new AipinProcessingScheduler({
      getConfig: async () => ({
        minConcurrentAgents: 1,
        maxConcurrentAgents: 4,
        memorySoftLimitPercent: 75,
        memoryHardLimitPercent: 88,
        memoryResumePercent: 68,
        memoryPollIntervalMs: 10
      }),
      getMemoryUsagePercent: () => memory,
      runTask: async taskId => {
        started.push(taskId)
        const task = deferred()
        running.push(task)
        return task.promise
      },
      logger: { info() {}, warn() {} }
    })

    const promise = scheduler.schedule('task-hard-limit')
    await wait(15)

    expect(started).toEqual([])
    expect(scheduler.getState()).toMatchObject({ activeCount: 0, pendingCount: 1, memoryBackpressure: true })

    memory = 60
    await wait(25)

    expect(started).toEqual(['task-hard-limit'])
    running[0].resolve('done')
    await expect(promise).resolves.toBe('done')
  })

  it('keeps claiming pending tasks to refill available concurrency slots', async () => {
    const { AipinProcessingScheduler } = require('../server/aipin-processing-scheduler.js')
    const queuedTasks = [
      { taskId: 'task-1' },
      { taskId: 'task-2' },
      { taskId: 'task-3' },
      { taskId: 'task-4' }
    ]
    const running = []
    const claimed = []
    const started = []
    const scheduler = new AipinProcessingScheduler({
      getConfig: async () => ({
        minConcurrentAgents: 1,
        maxConcurrentAgents: 2,
        memorySoftLimitPercent: 75,
        memoryHardLimitPercent: 88,
        memoryResumePercent: 68
      }),
      getMemoryUsagePercent: () => 40,
      claimTask: async taskId => {
        const task = taskId
          ? queuedTasks.splice(queuedTasks.findIndex(item => item.taskId === taskId), 1)[0]
          : queuedTasks.shift()
        if (task) claimed.push(task.taskId)
        return task || null
      },
      runTask: async task => {
        started.push(task.taskId)
        const pending = deferred()
        running.push(pending)
        return pending.promise
      },
      logger: { info() {}, warn() {} }
    })

    const firstPromise = scheduler.schedule()
    await wait()

    expect(claimed).toEqual(['task-1', 'task-2'])
    expect(started).toEqual(['task-1', 'task-2'])
    expect(scheduler.getState()).toMatchObject({ activeCount: 2, pendingCount: 0 })

    running[0].resolve('done-1')
    await expect(firstPromise).resolves.toBe('done-1')
    await wait()

    expect(claimed).toEqual(['task-1', 'task-2', 'task-3'])
    expect(started).toEqual(['task-1', 'task-2', 'task-3'])

    running[1].resolve('done-2')
    await wait()
    expect(claimed).toEqual(['task-1', 'task-2', 'task-3', 'task-4'])
    expect(started).toEqual(['task-1', 'task-2', 'task-3', 'task-4'])

    running.slice(2).forEach(task => task.resolve('done'))
    await wait()
    expect(scheduler.getState()).toMatchObject({ activeCount: 0, pendingCount: 0 })
  })
})
