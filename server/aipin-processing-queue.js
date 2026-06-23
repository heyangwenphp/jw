const crypto = require('crypto')
const fs = require('fs')
const fsp = require('fs').promises
const path = require('path')

const DEFAULT_AIPIN_PROCESSING_CONFIG = {
  enabled: true,
  autoProcess: true,
  defaultSkillId: 'midea-yq-alert',
  maxItemsPerTask: 100,
  minConcurrentAgents: 10,
  maxConcurrentAgents: 30,
  memorySoftLimitPercent: 75,
  memoryHardLimitPercent: 88,
  memoryResumePercent: 68,
  memoryPollIntervalMs: 5000,
  structuredResultWaitMs: 600000,
  structuredResultPollMs: 500
}
const DEFAULT_MAX_TASK_LOG_BYTES = 1024 * 1024

function pad2(value) {
  return String(value).padStart(2, '0')
}

function formatDateParts(date) {
  return {
    day: `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    compact: `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`,
    time: `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}`
  }
}

class AipinProcessingQueue {
  constructor({ userDataPath, now = () => new Date(), randomHex = () => crypto.randomBytes(4).toString('hex'), maxTaskLogBytes = DEFAULT_MAX_TASK_LOG_BYTES }) {
    if (!userDataPath) throw new Error('userDataPath is required')
    this.userDataPath = userDataPath
    this.now = now
    this.randomHex = randomHex
    this.maxTaskLogBytes = maxTaskLogBytes
    this.writeChain = Promise.resolve()
    this.rootDir = path.join(userDataPath, 'aipin-processing')
    this.tasksFile = path.join(this.rootDir, 'tasks.jsonl')
    this.configFile = path.join(this.rootDir, 'config.json')
    fs.mkdirSync(this.rootDir, { recursive: true })
  }

  async getConfig() {
    try {
      const parsed = JSON.parse(await fsp.readFile(this.configFile, 'utf-8'))
      const config = { ...DEFAULT_AIPIN_PROCESSING_CONFIG, ...parsed }
      let changed = false
      for (const key of Object.keys(DEFAULT_AIPIN_PROCESSING_CONFIG)) {
        if (parsed[key] === undefined) changed = true
      }
      if (!config.defaultSkillId || config.defaultSkillId === 'early-investment-research') {
        config.defaultSkillId = DEFAULT_AIPIN_PROCESSING_CONFIG.defaultSkillId
        changed = true
      }
      if (changed) {
        await fsp.writeFile(this.configFile, JSON.stringify(config, null, 2), 'utf-8')
      }
      return config
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      await fsp.writeFile(this.configFile, JSON.stringify(DEFAULT_AIPIN_PROCESSING_CONFIG, null, 2), 'utf-8')
      return { ...DEFAULT_AIPIN_PROCESSING_CONFIG }
    }
  }

  async _appendTask(task) {
    const write = async () => {
      await fsp.mkdir(this.rootDir, { recursive: true })
      await fsp.appendFile(this.tasksFile, `${JSON.stringify(task)}\n`, 'utf-8')
      await this._compactTaskLogIfNeeded()
    }
    this.writeChain = this.writeChain.catch(() => null).then(write)
    await this.writeChain
    return task
  }

  async _compactTaskLogIfNeeded() {
    if (!this.maxTaskLogBytes) return
    let stat
    try {
      stat = await fsp.stat(this.tasksFile)
    } catch (err) {
      if (err.code === 'ENOENT') return
      throw err
    }
    if (stat.size <= this.maxTaskLogBytes) return

    const tasks = [...(await this._loadTaskMap()).values()]
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    const tmpFile = `${this.tasksFile}.tmp`
    await fsp.writeFile(
      tmpFile,
      tasks.map(task => JSON.stringify(task)).join('\n') + (tasks.length ? '\n' : ''),
      'utf-8'
    )
    await fsp.rename(tmpFile, this.tasksFile)
  }

  async _loadTaskMap() {
    const tasks = new Map()
    let content = ''
    try {
      content = await fsp.readFile(this.tasksFile, 'utf-8')
    } catch (err) {
      if (err.code === 'ENOENT') return tasks
      throw err
    }

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const task = JSON.parse(trimmed)
      tasks.set(task.taskId, task)
    }
    return tasks
  }

  async createTask({ requestId, sourceFile, receivedCount, skillId = null }) {
    if (!requestId) throw new Error('requestId is required')
    if (!sourceFile) throw new Error('sourceFile is required')
    const config = await this.getConfig()
    const createdAtDate = this.now()
    const { compact, time } = formatDateParts(createdAtDate)
    const task = {
      taskId: `aipin_task_${compact}_${time}_${this.randomHex()}`,
      requestId,
      sourceFile,
      receivedCount,
      skillId: skillId || config.defaultSkillId,
      agentId: null,
      status: 'pending',
      createdAt: createdAtDate.toISOString(),
      startedAt: null,
      finishedAt: null,
      sessionId: null,
      outputDir: null,
      resultFile: null,
      error: null
    }
    return this._appendTask(task)
  }

  async listTasks({ status, limit = 100 } = {}) {
    const tasks = [...(await this._loadTaskMap()).values()]
      .filter(task => !status || task.status === status)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    return tasks.slice(0, limit)
  }

  async getTask(taskId) {
    if (!taskId) throw new Error('taskId is required')
    return (await this._loadTaskMap()).get(taskId) || null
  }

  async updateTask(taskId, patch) {
    const current = await this.getTask(taskId)
    if (!current) throw new Error(`Aipin processing task not found: ${taskId}`)
    return this._appendTask({ ...current, ...patch })
  }

  async claimTask(taskId = null) {
    const target = taskId
      ? await this.getTask(taskId)
      : (await this.listTasks({ status: 'pending', limit: 1 }))[0]
    if (!target) return null
    if (target.status !== 'pending') {
      throw new Error(`Aipin processing task is not pending: ${target.taskId}`)
    }
    return this.updateTask(target.taskId, {
      status: 'processing',
      startedAt: this.now().toISOString(),
      finishedAt: null,
      error: null
    })
  }

  async completeTask(taskId, { sessionId, outputDir, resultFile }) {
    return this.updateTask(taskId, {
      status: 'completed',
      finishedAt: this.now().toISOString(),
      sessionId: sessionId || null,
      outputDir: outputDir || null,
      resultFile: resultFile || null,
      error: null
    })
  }

  async failTask(taskId, err) {
    return this.updateTask(taskId, {
      status: 'failed',
      finishedAt: this.now().toISOString(),
      error: err?.message || String(err || 'Aipin processing failed')
    })
  }

  async retryTask(taskId) {
    const task = await this.getTask(taskId)
    if (!task) throw new Error(`Aipin processing task not found: ${taskId}`)
    if (task.status !== 'failed') {
      throw new Error(`Only failed Aipin processing tasks can be retried: ${taskId}`)
    }
    return this.updateTask(taskId, {
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      error: null
    })
  }

  async prepareTaskForManualProcess(taskId, { skillId = DEFAULT_AIPIN_PROCESSING_CONFIG.defaultSkillId } = {}) {
    const task = await this.getTask(taskId)
    if (!task) throw new Error(`Aipin processing task not found: ${taskId}`)
    return this.updateTask(taskId, {
      skillId,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      sessionId: null,
      outputDir: null,
      resultFile: null,
      error: null
    })
  }

  async recoverInterruptedTasks() {
    const tasks = await this.listTasks({ status: 'processing', limit: Number.MAX_SAFE_INTEGER })
    const recovered = []
    for (const task of tasks) {
      recovered.push(await this.updateTask(task.taskId, {
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        sessionId: null,
        outputDir: null,
        resultFile: null,
        error: null
      }))
    }
    return recovered
  }
}

module.exports = {
  AipinProcessingQueue,
  DEFAULT_AIPIN_PROCESSING_CONFIG
}
