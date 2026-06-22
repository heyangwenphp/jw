/**
 * Background Task Manager
 * Manages background task states and broadcasts updates to renderer processes.
 */

class BackgroundTaskManager {
  constructor() {
    this.tasks = new Map()
    this.listeners = new Set()
    this.idCounter = 0
  }

  /**
   * Subscribe to task updates
   * @param {(tasks: Array) => void} listener
   * @returns {() => void} unsubscribe function
   */
  subscribe(listener) {
    this.listeners.add(listener)
    // Immediately send current state
    listener(this.getAllTasks())
    return () => this.listeners.delete(listener)
  }

  /**
   * Notify all listeners of current task state
   */
  _notify() {
    const tasks = this.getAllTasks()
    this.listeners.forEach(listener => {
      try {
        listener(tasks)
      } catch (err) {
        console.error('[TaskManager] Listener error:', err)
      }
    })
  }

  /**
   * Get all tasks as an array, sorted by start time (newest first)
   */
  getAllTasks() {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.startTime - a.startTime)
  }

  /**
   * Get currently running tasks
   */
  getRunningTasks() {
    return this.getAllTasks().filter(t => t.status === 'running')
  }

  /**
   * Start a new background task
   * @param {Object} options
   * @param {string} options.description - Human-readable description
   * @param {string} [options.type='general'] - Task type
   * @returns {string} taskId
   */
  startTask({ description, type = 'general' }) {
    const id = `task-${++this.idCounter}-${Date.now()}`
    const task = {
      id,
      description,
      type,
      status: 'running',
      startTime: Date.now(),
      endTime: null,
      error: null
    }
    this.tasks.set(id, task)
    this._notify()
    return id
  }

  /**
   * Update a running task's description
   * @param {string} taskId
   * @param {string} description
   */
  updateTask(taskId, { description }) {
    const task = this.tasks.get(taskId)
    if (!task) return
    if (description !== undefined) {
      task.description = description
    }
    this._notify()
  }

  /**
   * Mark a task as completed
   * @param {string} taskId
   * @param {Object} [result]
   */
  completeTask(taskId, result = null) {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'completed'
    task.endTime = Date.now()
    task.result = result
    this._notify()

    // Auto-remove completed tasks after 30 seconds
    setTimeout(() => {
      this.removeTask(taskId)
    }, 30000)
  }

  /**
   * Mark a task as failed
   * @param {string} taskId
   * @param {string} error
   */
  failTask(taskId, error) {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'failed'
    task.endTime = Date.now()
    task.error = error
    this._notify()

    // Keep failed tasks for 60 seconds
    setTimeout(() => {
      this.removeTask(taskId)
    }, 60000)
  }

  /**
   * Cancel a running task
   * @param {string} taskId
   */
  cancelTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = 'cancelled'
    task.endTime = Date.now()
    this._notify()

    setTimeout(() => {
      this.removeTask(taskId)
    }, 30000)
  }

  /**
   * Remove a task from the list
   * @param {string} taskId
   */
  removeTask(taskId) {
    this.tasks.delete(taskId)
    this._notify()
  }

  /**
   * Clear all completed/cancelled/failed tasks
   */
  clearCompleted() {
    for (const [id, task] of this.tasks) {
      if (task.status !== 'running') {
        this.tasks.delete(id)
      }
    }
    this._notify()
  }
}

module.exports = { BackgroundTaskManager }
