function setupAuthHandlers(ipcMain, authManager) {
  if (!authManager) {
    console.warn('[IPC] AuthManager not available, skipping auth handlers')
    return
  }

  ipcMain.handle('auth:login', async (event, payload) => authManager.login(payload || {}))
  ipcMain.handle('auth:getCurrentUser', async () => ({ success: true, user: authManager.getCurrentUser() }))
  ipcMain.handle('auth:logout', async () => authManager.logout())
}

module.exports = { setupAuthHandlers }
