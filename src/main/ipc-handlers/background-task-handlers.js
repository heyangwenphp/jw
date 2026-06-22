/**
 * Background Task IPC Handlers
 */

const { ipcMain } = require('electron')
const { BackgroundTaskManager } = require('../managers/background-task-manager')

let taskManager = null

function getTaskManager() {
  if (!taskManager) {
    taskManager = new BackgroundTaskManager()
  }
  return taskManager
}

/**
 * Setup background task IPC handlers and broadcasting
 * @param {BrowserWindow} mainWindow - Main browser window
 */
function setupBackgroundTaskHandlers(mainWindow) {
  const manager = getTaskManager()

  // Subscribe to task updates and broadcast to renderer
  manager.subscribe((tasks) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('background-tasks:update', tasks)
    }
  })

  // Handler: Get all tasks
  ipcMain.handle('background-tasks:getAll', () => {
    return manager.getAllTasks()
  })

  // Handler: Get running tasks
  ipcMain.handle('background-tasks:getRunning', () => {
    return manager.getRunningTasks()
  })

  // Handler: Cancel a task
  ipcMain.handle('background-tasks:cancel', (event, taskId) => {
    manager.cancelTask(taskId)
    return { success: true }
  })

  // Handler: Clear completed tasks
  ipcMain.handle('background-tasks:clearCompleted', () => {
    manager.clearCompleted()
    return { success: true }
  })

  // Export manager for other main process modules to use
  global.backgroundTaskManager = manager
}

module.exports = { setupBackgroundTaskHandlers, getTaskManager }
