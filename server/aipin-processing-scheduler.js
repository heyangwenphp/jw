const DEFAULT_AIPIN_SCHEDULER_CONFIG = {
  minConcurrentAgents: 5,
  maxConcurrentAgents: 20,
  memorySoftLimitPercent: 75,
  memoryHardLimitPercent: 88,
  memoryResumePercent: 68,
  memoryPollIntervalMs: 5000
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function normalizePercent(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback
}

function normalizeSchedulerConfig(config = {}) {
  const minConcurrentAgents = normalizePositiveInteger(
    config.minConcurrentAgents,
    DEFAULT_AIPIN_SCHEDULER_CONFIG.minConcurrentAgents
  )
  const maxConcurrentAgents = Math.max(
    minConcurrentAgents,
    normalizePositiveInteger(config.maxConcurrentAgents, DEFAULT_AIPIN_SCHEDULER_CONFIG.maxConcurrentAgents)
  )
  const memoryHardLimitPercent = normalizePercent(
    config.memoryHardLimitPercent,
    DEFAULT_AIPIN_SCHEDULER_CONFIG.memoryHardLimitPercent
  )
  const memorySoftLimitPercent = Math.min(
    memoryHardLimitPercent,
    normalizePercent(config.memorySoftLimitPercent, DEFAULT_AIPIN_SCHEDULER_CONFIG.memorySoftLimitPercent)
  )
  const memoryResumePercent = Math.min(
    memorySoftLimitPercent,
    normalizePercent(config.memoryResumePercent, DEFAULT_AIPIN_SCHEDULER_CONFIG.memoryResumePercent)
  )
  const memoryPollIntervalMs = normalizePositiveInteger(
    config.memoryPollIntervalMs,
    DEFAULT_AIPIN_SCHEDULER_CONFIG.memoryPollIntervalMs
  )

  return {
    minConcurrentAgents,
    maxConcurrentAgents,
    memorySoftLimitPercent,
    memoryHardLimitPercent,
    memoryResumePercent,
    memoryPollIntervalMs
  }
}

class AipinProcessingScheduler {
  constructor({
    runTask,
    claimTask = null,
    getConfig,
    getMemoryUsagePercent,
    logger = console
  } = {}) {
    if (typeof runTask !== 'function') throw new Error('runTask is required')
    if (claimTask !== null && typeof claimTask !== 'function') throw new Error('claimTask must be a function')
    if (typeof getConfig !== 'function') throw new Error('getConfig is required')
    if (typeof getMemoryUsagePercent !== 'function') throw new Error('getMemoryUsagePercent is required')
    this.runTask = runTask
    this.claimTask = claimTask
    this.getConfig = getConfig
    this.getMemoryUsagePercent = getMemoryUsagePercent
    this.logger = logger
    this.pending = []
    this.activeCount = 0
    this.pumping = false
    this.memoryBackpressure = false
    this.retryTimer = null
  }

  schedule(taskId = null, req = null) {
    return new Promise((resolve, reject) => {
      this.pending.push({ taskId, req, resolve, reject })
      this._pump()
    })
  }

  getState() {
    return {
      pendingCount: this.pending.length,
      activeCount: this.activeCount,
      memoryBackpressure: this.memoryBackpressure
    }
  }

  _targetConcurrent(config, memoryPercent) {
    const limits = normalizeSchedulerConfig(config)
    if (memoryPercent >= limits.memoryHardLimitPercent) {
      this.memoryBackpressure = true
      return { target: 0, limits, reason: 'hard-limit' }
    }
    if (memoryPercent >= limits.memorySoftLimitPercent) {
      this.memoryBackpressure = true
    } else if (memoryPercent <= limits.memoryResumePercent) {
      this.memoryBackpressure = false
    }

    return {
      target: this.memoryBackpressure ? limits.minConcurrentAgents : limits.maxConcurrentAgents,
      limits,
      reason: this.memoryBackpressure ? 'soft-limit' : 'normal'
    }
  }

  _scheduleRetry(delayMs) {
    if (this.retryTimer || (!this.pending.length && !this.claimTask)) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this._pump()
    }, delayMs)
    if (typeof this.retryTimer.unref === 'function') this.retryTimer.unref()
  }

  async _startLegacyJob(job, target, memoryPercent, reason) {
    this.activeCount += 1
    this.logger.info?.('[AipinData] Processing scheduler starting task', {
      taskId: job.taskId,
      active: this.activeCount,
      pending: this.pending.length,
      target,
      memoryPercent,
      reason
    })
    Promise.resolve()
      .then(() => this.runTask(job.taskId, job.req))
      .then(job.resolve, job.reject)
      .finally(() => {
        this.activeCount -= 1
        this._pump()
      })
  }

  async _startClaimedJob(job, target, memoryPercent, reason) {
    let task
    try {
      task = await this.claimTask(job?.taskId || null)
    } catch (err) {
      if (job) job.reject(err)
      else this.logger.warn?.('[AipinData] Processing scheduler failed to claim task', err)
      return true
    }

    if (!task) {
      if (job) job.resolve(null)
      return !!job
    }

    this.activeCount += 1
    this.logger.info?.('[AipinData] Processing scheduler starting task', {
      taskId: task.taskId,
      requestedTaskId: job?.taskId || null,
      active: this.activeCount,
      pending: this.pending.length,
      target,
      memoryPercent,
      reason
    })
    Promise.resolve()
      .then(() => this.runTask(task, job?.req || null))
      .then(
        result => {
          if (job) job.resolve(result)
        },
        err => {
          if (job) job.reject(err)
          else this.logger.warn?.('[AipinData] Processing scheduler background task failed', err)
        }
      )
      .finally(() => {
        this.activeCount -= 1
        this._pump()
      })
    return true
  }

  async _pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.pending.length || this.claimTask) {
        const config = await this.getConfig()
        const memoryPercent = this.getMemoryUsagePercent()
        const { target, limits, reason } = this._targetConcurrent(config, memoryPercent)
        if (target <= 0 || this.activeCount >= target) {
          if (target <= 0) {
            this.logger.warn?.('[AipinData] Processing scheduler paused by memory limit', {
              memoryPercent,
              memoryHardLimitPercent: limits.memoryHardLimitPercent,
              pending: this.pending.length,
              active: this.activeCount
            })
          }
          this._scheduleRetry(limits.memoryPollIntervalMs)
          break
        }

        const job = this.pending.shift() || null
        if (!this.claimTask) {
          await this._startLegacyJob(job, target, memoryPercent, reason)
          continue
        }

        const started = await this._startClaimedJob(job, target, memoryPercent, reason)
        if (!started) break
      }
    } catch (err) {
      const job = this.pending.shift()
      if (job) job.reject(err)
      if (this.pending.length) this._scheduleRetry(DEFAULT_AIPIN_SCHEDULER_CONFIG.memoryPollIntervalMs)
    } finally {
      this.pumping = false
    }
  }
}

module.exports = {
  AipinProcessingScheduler,
  DEFAULT_AIPIN_SCHEDULER_CONFIG,
  normalizeSchedulerConfig
}
