/**
 * IPC 处理器
 * 处理渲染进程和主进程之间的通信
 */

const { ipcMain, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// 安全加载模块，捕获错误
function safeRequire(modulePath, moduleName) {
  try {
    return require(modulePath);
  } catch (err) {
    console.error(`[IPC] Failed to load ${moduleName}:`, err.message);
    return null;
  }
}

const { SessionDatabase } = safeRequire('./session-database', 'SessionDatabase') || {};
const configHandlersMod = safeRequire('./ipc-handlers/config-handlers', 'config-handlers');
const sessionHandlersMod = safeRequire('./ipc-handlers/session-handlers', 'session-handlers');
const authHandlersMod = safeRequire('./ipc-handlers/auth-handlers', 'auth-handlers');
const promptHandlersMod = safeRequire('./ipc-handlers/prompt-handlers', 'prompt-handlers');
const queueHandlersMod = safeRequire('./ipc-handlers/queue-handlers', 'queue-handlers');
const pluginHandlersMod = safeRequire('./ipc-handlers/plugin-handlers', 'plugin-handlers');
const agentHandlersMod = safeRequire('./ipc-handlers/agent-handlers', 'agent-handlers');
const projectFilesHandlersMod = safeRequire('./ipc-handlers/project-files-handlers', 'project-files-handlers');
const projectAgentProfileHandlersMod = safeRequire('./ipc-handlers/project-agent-profile-handlers', 'project-agent-profile-handlers');
const projectLibraryHandlersMod = safeRequire('./ipc-handlers/project-library-handlers', 'project-library-handlers');
const capabilityHandlersMod = safeRequire('./ipc-handlers/capability-handlers', 'capability-handlers');
const updateHandlersMod = safeRequire('./ipc-handlers/update-handlers', 'update-handlers');
const dingtalkHandlersMod = safeRequire('./ipc-handlers/dingtalk-handlers', 'dingtalk-handlers');
const feishuHandlersMod = safeRequire('./ipc-handlers/feishu-handlers', 'feishu-handlers');
const scheduledTaskHandlersMod = safeRequire('./ipc-handlers/scheduled-task-handlers', 'scheduled-task-handlers');
const weixinNotifyHandlersMod = safeRequire('./ipc-handlers/weixin-notify-handlers', 'weixin-notify-handlers');
const backgroundTaskHandlersMod = safeRequire('./ipc-handlers/background-task-handlers', 'background-task-handlers');
const ipcUtilsMod = safeRequire('./utils/ipc-utils', 'ipc-utils');
const appI18nMod = safeRequire('./utils/app-i18n', 'app-i18n');
const authManagerMod = safeRequire('./auth-manager', 'AuthManager');

const setupConfigHandlers = configHandlersMod?.setupConfigHandlers;
const setupSessionHandlers = sessionHandlersMod?.setupSessionHandlers;
const setupAuthHandlers = authHandlersMod?.setupAuthHandlers;
const registerPromptHandlers = promptHandlersMod?.registerPromptHandlers;
const setupQueueHandlers = queueHandlersMod?.setupQueueHandlers;
const setupPluginHandlers = pluginHandlersMod?.setupPluginHandlers;
const setupAgentHandlers = agentHandlersMod?.setupAgentHandlers;
const setupProjectFilesHandlers = projectFilesHandlersMod?.setupProjectFilesHandlers;
const setupProjectAgentProfileHandlers = projectAgentProfileHandlersMod?.setupProjectAgentProfileHandlers;
const setupProjectLibraryHandlers = projectLibraryHandlersMod?.setupProjectLibraryHandlers;
const setupCapabilityHandlers = capabilityHandlersMod?.setupCapabilityHandlers;
const setupUpdateHandlers = updateHandlersMod?.setupUpdateHandlers;
const setupDingTalkHandlers = dingtalkHandlersMod?.setupDingTalkHandlers;
const setupFeishuHandlers = feishuHandlersMod?.setupFeishuHandlers;
const setupScheduledTaskHandlers = scheduledTaskHandlersMod?.setupScheduledTaskHandlers;
const setupWeixinNotifyHandlers = weixinNotifyHandlersMod?.setupWeixinNotifyHandlers;
const setupBackgroundTaskHandlers = backgroundTaskHandlersMod?.setupBackgroundTaskHandlers;
const createIPCHandler = ipcUtilsMod?.createIPCHandler;
const tMain = appI18nMod?.tMain;
const AuthManager = authManagerMod?.AuthManager;

// Bind ipcMain to createIPCHandler for local use
const registerHandler = (channelName, handler) => {
  if (createIPCHandler) {
    createIPCHandler(ipcMain, channelName, handler);
  } else {
    console.error(`[IPC] Cannot register ${channelName}: createIPCHandler not loaded`);
    // Fallback to direct registration
    ipcMain.handle(channelName, async (event, ...args) => {
      try {
        return await handler(...args);
      } catch (err) {
        console.error(`[IPC] ${channelName} error:`, err);
        throw err;
      }
    });
  }
};

function setupIPCHandlers(mainWindow, configManager, agentSessionManager, capabilityManager, updateManager, dingtalkBridge, feishuBridge, scheduledTaskService, weixinNotifyService, weixinBridge) {
  const translate = (key, params = {}) => typeof tMain === 'function'
    ? tMain(configManager, key, params)
    : key

  const getModeTitle = () => translate('app.windows.main')

  const trustedWeixinWebContents = new Set()
  const registerTrustedWeixinWindow = (window) => {
    const webContents = window?.webContents
    if (!webContents) return
    trustedWeixinWebContents.add(webContents)
    window.once('closed', () => {
      trustedWeixinWebContents.delete(webContents)
    })
  }
  registerTrustedWeixinWindow(mainWindow)

  // 初始化共享数据库
  let sessionDatabase = null;
  if (SessionDatabase) {
    try {
      sessionDatabase = new SessionDatabase();
      sessionDatabase.init();
      console.log('[IPC] Session database initialized successfully');
    } catch (err) {
      console.error('[IPC] Failed to initialize session database:', err.message);
      console.error('[IPC] Will retry database connection on demand...');
      // 即使初始化失败也创建实例，后续会通过 ensureDb() 重试
      sessionDatabase = new SessionDatabase();
    }
  }

  // 初始化文件读取服务
  const authManager = AuthManager && sessionDatabase
    ? new AuthManager({ sessionDatabase, configManager })
    : null

  // 设置依赖关系（即使数据库当前不可用也设置，后续会自动重连）
  if (sessionDatabase) {
    if (agentSessionManager) {
      agentSessionManager.setSessionDatabase(sessionDatabase);
    }
    if (capabilityManager) {
      capabilityManager.setSessionDatabase(sessionDatabase);
    }
  }

  // ========================================
  // 配置相关处理器（提取到独立模块）
  // ========================================
  setupConfigHandlers(ipcMain, configManager, agentSessionManager);
  setupAuthHandlers?.(ipcMain, authManager);

  // ========================================
  // 窗口管理
  // ========================================

  // 获取当前主题的背景色
  const getThemeBackgroundColor = () => {
    const config = configManager.getConfig();
    const isDark = config?.settings?.theme === 'dark';
    return isDark ? '#212121' : '#F7F7F8';
  };

  // 子窗口实例表，确保每个 page 只打开一个窗口
  const subWindows = new Map()

  // 创建子窗口的通用配置
  const createSubWindow = (options) => {
    // 关闭所有已打开的子窗口（不保存数据）
    for (const [page, win] of subWindows) {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
    subWindows.clear()

    const { BrowserWindow, app } = require('electron');
    const pathModule = require('path');
    const isMac = process.platform === 'darwin';
    const preloadPath = pathModule.join(__dirname, '../preload/preload.js');

    const window = new BrowserWindow({
      width: options.width || 800,
      height: options.height || 600,
      title: options.title,
      parent: mainWindow,
      modal: false,
      show: false,  // 先隐藏，等待 ready-to-show
      backgroundColor: getThemeBackgroundColor(),
      autoHideMenuBar: true,
      fullscreenable: !isMac,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    subWindows.set(options.page, window)
    window.once('closed', () => {
      subWindows.delete(options.page)
    })

    // 窗口准备好后再显示
    window.once('ready-to-show', () => {
      window.show();
      window.focus();  // macOS 需要显式 focus
      if (isMac) {
        app.dock?.show();  // 确保 dock 图标显示
      }
      // 主动通知渲染进程切换 tab（URL query 在 loadFile 场景下不可靠）
      // 用 setTimeout 确保渲染进程已完成初始化
      if (options.tab) {
        setTimeout(() => {
          console.log('[SubWindow] sending settings:switchTab with tab:', options.tab)
          window.webContents.send('settings:switchTab', { tab: options.tab })
        }, 500)
      }
    });

    // 加载失败时的处理
    window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error(`[SubWindow] Failed to load: ${errorCode} - ${errorDescription}`);
    });

    const query = options.query || ''
    if (process.env.VITE_DEV_SERVER_URL) {
      const baseUrl = process.env.VITE_DEV_SERVER_URL.replace(/\/+$/, '');
      window.loadURL(`${baseUrl}/pages/${options.page}/${query}`);
    } else {
      const builtFilePath = pathModule.join(__dirname, `../../dist/pages/${options.page}/index.html`);
      const legacyFilePath = pathModule.join(__dirname, `../renderer/pages-dist/pages/${options.page}/index.html`);
      const filePath = fs.existsSync(builtFilePath) ? builtFilePath : legacyFilePath;
      window.loadFile(filePath, { query: query.replace('?', '') });
    }

    if (options.trustWeixinNotifyIPC) {
      registerTrustedWeixinWindow(window)
    }

    return window;
  };

  // 打开 Profile 管理窗口
  ipcMain.handle('window:openProfileManager', async () => {
    createSubWindow({
      width: 1000,
      height: 700,
      title: translate('app.windows.profileManager'),
      page: 'profile-manager'
    });
    return { success: true };
  });

  // 打开全局设置窗口
  ipcMain.handle('window:openGlobalSettings', async () => {
    createSubWindow({
      width: 750,
      height: 500,
      title: translate('app.windows.globalSettings'),
      page: 'global-settings'
    });
    return { success: true };
  });

  // 打开外观设置窗口
  ipcMain.handle('window:openAppearanceSettings', async () => {
    createSubWindow({
      width: 600,
      height: 450,
      title: translate('app.windows.appearanceSettings'),
      page: 'appearance-settings'
    });
    return { success: true };
  });

  // 打开能力管理窗口（跨模式可访问）
  ipcMain.handle('window:openSettingsWorkbench', async (_event, options = {}) => {
    const params = new URLSearchParams()
    if (options.mode) params.set('mode', options.mode)
    if (options.cwd) params.set('cwd', options.cwd)
    if (options.tab) params.set('tab', options.tab)
    createSubWindow({
      width: 1100,
      height: 760,
      title: translate('app.windows.settingsWorkbench'),
      page: 'settings-workbench',
      trustWeixinNotifyIPC: true,
      query: params.toString() ? `?${params.toString()}` : '',
      tab: options.tab
    });
    return { success: true };
  });

  // 打开 IM 机器人窗口（独立窗口，不共用能力管理）
  ipcMain.handle('window:openIMBotSettings', async () => {
    createSubWindow({
      width: 900,
      height: 700,
      title: translate('app.windows.imBotSettings'),
      page: 'im-bot-settings',
      trustWeixinNotifyIPC: true
    });
    return { success: true };
  });

  // 打开服务商管理窗口
  ipcMain.handle('window:openProviderManager', async () => {
    createSubWindow({
      width: 1000,
      height: 650,
      title: translate('app.windows.providerManager'),
      page: 'provider-manager'
    });
    return { success: true };
  });

  // 打开会话查询窗口
  ipcMain.handle('window:openSessionManager', async (event, options = {}) => {
    const query = options.projectPath ? `?projectPath=${encodeURIComponent(options.projectPath)}` : ''
    createSubWindow({
      width: 1200,
      height: 700,
      title: translate('app.windows.sessionManager'),
      page: 'session-manager',
      query
    });
    return { success: true };
  });

  // 聚焦主窗口
  ipcMain.handle('window:focusMainWindow', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
      return { success: true };
    }
    return { success: false, error: 'Main window not available' };
  });

  ipcMain.handle('window:setMainTitleByMode', async (_event, mode) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' }
    }

    mainWindow.setTitle(getModeTitle())
    return { success: true }
  })

  // 打开应用更新窗口（防止重复打开）
  let updateManagerWindow = null
  ipcMain.handle('window:openUpdateManager', async () => {
    // 如果窗口已存在且未销毁，聚焦它而不是新开
    if (updateManagerWindow && !updateManagerWindow.isDestroyed()) {
      if (updateManagerWindow.isMinimized()) updateManagerWindow.restore()
      updateManagerWindow.show()
      updateManagerWindow.focus()
      return { success: true }
    }
    updateManagerWindow = createSubWindow({
      width: 700,
      height: 600,
      title: translate('app.windows.updateManager'),
      page: 'update-manager'
    })
    // 窗口关闭时清理引用
    updateManagerWindow.on('closed', () => {
      updateManagerWindow = null
    })
    return { success: true };
  });

  // ========================================
  // Dialog 相关
  // ========================================

  ipcMain.handle('dialog:selectFolder', async (event) => {
    const { BrowserWindow } = require('electron');
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(senderWindow || mainWindow, {
      properties: ['openDirectory'],
      title: translate('app.dialogs.selectProjectFolder')
    });

    if (result.canceled) {
      return null;
    }

    const selectedPath = result.filePaths[0];

    return selectedPath;
  });

  ipcMain.handle('dialog:selectDirectory', async (event, options = {}) => {
    const { BrowserWindow } = require('electron')
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(senderWindow || mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      title: options.title || translate('app.dialogs.selectDirectory')
    })
    return result.canceled ? null : result.filePaths[0]
  });

  ipcMain.handle('dialog:selectFile', async (event, options = {}) => {
    const { title, filters } = options
    const { BrowserWindow } = require('electron')
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(senderWindow || mainWindow, {
      properties: ['openFile'],
      title: title || translate('app.dialogs.selectFile'),
      filters: filters || [{ name: translate('app.dialogs.allFiles'), extensions: ['*'] }]
    });

    if (result.canceled) {
      return null;
    }

    return result.filePaths[0];
  });

  // 选择多个文件
  ipcMain.handle('dialog:selectFiles', async (event, options = {}) => {
    const { title, filters } = options
    const { BrowserWindow } = require('electron')
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(senderWindow || mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: title || translate('app.dialogs.selectFiles'),
      filters: filters || [{ name: translate('app.dialogs.allFiles'), extensions: ['*'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths;
  });

  ipcMain.handle('dialog:saveFile', async (event, { filename, content, ext }) => {
    const filters = ext === 'md'
      ? [{ name: translate('app.dialogs.markdown'), extensions: ['md'] }]
      : [{ name: translate('app.dialogs.json'), extensions: ['json'] }];

    const result = await dialog.showSaveDialog(mainWindow, {
      title: translate('app.dialogs.exportSession'),
      defaultPath: filename,
      filters
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    const fs = require('fs');
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, filePath: result.filePath };
  });

  ipcMain.handle('dialog:saveImage', async (event, { filename, base64, dir }) => {
    let filePath;

    if (dir) {
      // 直接写入指定目录
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      filePath = path.join(dir, filename || 'message.png');
    } else {
      // 弹出保存对话框
      const { BrowserWindow } = require('electron');
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(senderWindow || mainWindow, {
        title: translate('app.dialogs.saveImage'),
        defaultPath: filename || 'message.png',
        filters: [{ name: translate('app.dialogs.pngImage'), extensions: ['png'] }]
      });
      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }
      filePath = result.filePath;
    }

    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
  });

  ipcMain.handle('notification:show', async (_event, options = {}) => {
    const title = typeof options.title === 'string' ? options.title.trim() : '';
    const body = typeof options.body === 'string' ? options.body : '';

    if (!title) {
      return { success: false, error: 'Notification title is required' };
    }

    if (!Notification.isSupported()) {
      return { success: false, error: 'Notifications are not supported on this system' };
    }

    try {
      new Notification({ title, body }).show();
      return { success: true };
    } catch (err) {
      console.error('[IPC] notification:show error:', err);
      return { success: false, error: err.message || 'Failed to show notification' };
    }
  });

  ipcMain.handle('shell:openExternal', async (event, url) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: 'Invalid URL' };
  });

  // 用系统默认程序打开本地文件或目录
  ipcMain.handle('shell:openPath', async (event, filePath) => {
    if (!filePath) {
      return { success: false, error: 'Path is required' };
    }
    try {
      const result = await shell.openPath(filePath);
      if (result) {
        // openPath 返回空字符串表示成功，否则返回错误信息
        return { success: false, error: result };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 解析相对路径为绝对路径（基于指定的 base 目录）
  ipcMain.handle('path:resolve', async (event, basePath, relativePath) => {
    if (!basePath || !relativePath) {
      return null;
    }
    try {
      const path = require('path');
      // 如果 relativePath 已经是绝对路径，直接返回
      if (path.isAbsolute(relativePath)) {
        return relativePath;
      }
      return path.resolve(basePath, relativePath);
    } catch (err) {
      console.error('[IPC] path:resolve error:', err);
      return null;
    }
  });

  ipcMain.handle('path:exists', async (event, targetPath) => {
    if (!targetPath) {
      return false;
    }
    try {
      const fs = require('fs');
      return fs.existsSync(targetPath);
    } catch (err) {
      console.error('[IPC] path:exists error:', err);
      return false;
    }
  });

  // 获取 Claude 配置文件路径
  ipcMain.handle('claude:getSettingsPath', async () => {
    const homedir = require('os').homedir();
    const settingsPath = require('path').join(homedir, '.claude', 'settings.json');
    return settingsPath;
  });

  // 获取项目 Claude 配置文件路径（settings.local.json），不存在则创建
  ipcMain.handle('claude:getProjectConfigPath', async (event, projectPath) => {
    if (!projectPath) {
      return { success: false, error: 'Project path is required' };
    }
    const path = require('path');
    const fs = require('fs');
    const claudeDir = path.join(projectPath, '.claude');
    const configFile = path.join(claudeDir, 'settings.local.json');

    try {
      // 确保 .claude 目录存在
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      // 确保 settings.local.json 文件存在
      if (!fs.existsSync(configFile)) {
        fs.writeFileSync(configFile, '{\n  \n}\n', 'utf-8');
      }
      return configFile;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ========================================
  // 会话历史管理（数据库版）
  // ========================================
  if (sessionDatabase) {
    setupSessionHandlers(ipcMain, sessionDatabase, configManager);
  }

  // ========================================
  // 提示词管理
  // ========================================
  if (registerPromptHandlers && sessionDatabase) {
    registerPromptHandlers(sessionDatabase, configManager);
  }

  // ========================================
  // 消息队列管理
  // ========================================
  if (setupQueueHandlers && sessionDatabase) {
    setupQueueHandlers(ipcMain, sessionDatabase);
  }

  // ========================================
  // Plugin 管理
  // ========================================
  if (setupPluginHandlers) {
    setupPluginHandlers(ipcMain, configManager);
  }

  if (setupProjectAgentProfileHandlers) {
    setupProjectAgentProfileHandlers(ipcMain, configManager);
  }

  // 更新会话标题
  // 支持两种方式：1. sessionId（数据库ID）2. sessionUuid（Claude Code UUID）
  registerHandler('session:updateTitle', async ({ sessionId, sessionUuid, title }) => {
    if (!sessionDatabase) {
      return { success: false, error: 'Database not available' };
    }
    if (sessionId) {
      return sessionDatabase.updateSessionTitle(sessionId, title);
    } else if (sessionUuid) {
      return sessionDatabase.updateSessionTitleByUuid(sessionUuid, title);
    }
    return { success: false, error: 'Missing sessionId or sessionUuid' };
  });

  // 删除会话（数据库 + 文件）
  registerHandler('session:deleteWithFile', async ({ sessionId, projectPath, sessionUuid }) => {
    // 删除文件
    if (sessionUuid && projectPath) {
      const path = require('path');
      const os = require('os');
      const { encodePath } = require('./utils/path-utils');

      const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
      const encodedPath = encodePath(projectPath);
      const sessionFile = path.join(claudeProjectsDir, encodedPath, `${sessionUuid}.jsonl`);

      if (fs.existsSync(sessionFile)) {
        try {
          fs.unlinkSync(sessionFile);
        } catch (err) {
          console.error('[IPC] Failed to delete session file:', err);
        }
      }
    }

    // 删除数据库记录
    if (sessionDatabase && sessionId) {
      return sessionDatabase.deleteSession(sessionId);
    }
    return { success: true };
  });

  registerHandler('session:deleteFile', async ({ projectPath, sessionId }) => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const { encodePath } = require('./utils/path-utils');

    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    const encodedPath = encodePath(projectPath);
    const sessionFile = path.join(claudeProjectsDir, encodedPath, `${sessionId}.jsonl`);

    if (!fs.existsSync(sessionFile)) {
      return { success: false, error: '会话文件不存在' };
    }

    try {
      fs.unlinkSync(sessionFile);
      return { success: true };
    } catch (err) {
      console.error('[IPC] Failed to delete session file:', err);
      return { success: false, error: err.message };
    }
  });

  // ========================================
  // Agent 会话管理
  // ========================================
  if (agentSessionManager && setupAgentHandlers) {
    setupAgentHandlers(ipcMain, agentSessionManager, authManager);
  }

  if (setupProjectFilesHandlers) {
    setupProjectFilesHandlers(ipcMain);
  }

  if (setupProjectLibraryHandlers) {
    setupProjectLibraryHandlers(ipcMain, sessionDatabase, authManager);
  }

  // ========================================
  // 能力管理（Agent 模式）
  // ========================================
  if (capabilityManager && setupCapabilityHandlers) {
    setupCapabilityHandlers(ipcMain, capabilityManager, agentSessionManager);
  }

  // 启动后台能力清单更新检测（延迟 5s）
  if (capabilityManager) {
    setTimeout(async () => {
      try {
        const result = await capabilityManager.checkForCapabilityUpdates()
        if (result.hasUpdate) {
          const { BrowserWindow } = require('electron')
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) win.webContents.send('capabilities-update-available')
          })
        }
      } catch (err) {
        console.warn('[IPC] Capability update check failed:', err.message)
      }
    }, 5000)
  }

  // ========================================
  // 应用更新
  // ========================================
  if (updateManager && setupUpdateHandlers) {
    setupUpdateHandlers(updateManager);
  }

  // ========================================
  // 钉钉桥接
  // ========================================
  if (dingtalkBridge && setupDingTalkHandlers) {
    setupDingTalkHandlers(ipcMain, dingtalkBridge, configManager);
  }

  // ========================================
  // 飞书桥接
  // ========================================
  if (feishuBridge && setupFeishuHandlers) {
    setupFeishuHandlers(ipcMain, feishuBridge, configManager);
  }

  // ========================================
  // 微信通知
  // ========================================
  if (weixinNotifyService && setupWeixinNotifyHandlers) {
    setupWeixinNotifyHandlers(ipcMain, weixinNotifyService, weixinBridge, mainWindow, {
      isTrustedSender: (sender) => trustedWeixinWebContents.has(sender)
    });
  }

  if (scheduledTaskService && setupScheduledTaskHandlers) {
    if (sessionDatabase) {
      scheduledTaskService.setSessionDatabase(sessionDatabase);
      scheduledTaskService.start();
    }
    setupScheduledTaskHandlers(ipcMain, scheduledTaskService);
  }

  // ========================================
  // Background Task Handlers
  // ========================================
  if (setupBackgroundTaskHandlers) {
    setupBackgroundTaskHandlers(mainWindow);
  }

  // 打开钉钉桥接设置窗口
  ipcMain.handle('window:openDingTalkSettings', async () => {
    createSubWindow({
      width: 600,
      height: 600,
      title: translate('app.windows.dingtalkSettings'),
      page: 'dingtalk-settings'
    });
    return { success: true };
  });

  // 关闭当前窗口
  ipcMain.handle('window:close', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.close()
      return { success: true }
    }
    return { success: false, error: 'Window not found' }
  })

  // 打开模型设置窗口
  ipcMain.handle('window:openModelSettings', async () => {
    createSubWindow({
      width: 1000,
      height: 700,
      title: translate('app.windows.modelSettings'),
      page: 'model-settings'
    });
    return { success: true };
  });

  // ========================================
  // 清除所有数据（Jedi 独占数据）
  // ========================================
  ipcMain.handle('app:clearAllData', async () => {
    const os = require('os')
    const fs = require('fs')
    const path = require('path')
    const { app } = require('electron')
    const results = []

    try {
      // 1. 终止所有活跃进程
      if (agentSessionManager) {
        try {
          await agentSessionManager.closeAll()
          results.push({ item: 'agentSessions', status: 'cleared' })
        } catch (err) {
          results.push({ item: 'agentSessions', status: 'error', error: err.message })
        }
      }

      // 2. 关闭数据库连接（必须先关闭才能删除文件）
      if (sessionDatabase) {
        try {
          sessionDatabase.close()
          results.push({ item: 'databaseConnection', status: 'closed' })
        } catch (err) {
          results.push({ item: 'databaseConnection', status: 'error', error: err.message })
        }
      }

      // 3. 获取路径
      const userData = app.getPath('userData')
      const homeDir = os.homedir()

      // 4. 定义要清除的文件/目录列表
      const targets = [
        { name: 'config', path: path.join(userData, 'config.json'), type: 'file' },
        { name: 'database', path: path.join(userData, 'sessions.db'), type: 'file' },
        { name: 'capabilitiesCache', path: path.join(userData, 'capabilities-cache.json'), type: 'file' },
        { name: 'updateState', path: path.join(userData, 'update-state.json'), type: 'file' },
        { name: 'installResult', path: path.join(userData, 'install-result.json'), type: 'file' },
        { name: 'weixinNotifyState', path: path.join(userData, 'weixin-notify', 'state.json'), type: 'file' },
        { name: 'agentOutput', path: path.join(homeDir, 'jedi-web-agent-output'), type: 'dir' },
        { name: 'legacyAgentOutput', path: path.join(homeDir, 'jedi-agent-output'), type: 'dir' }
      ]

      // 4. 逐个删除
      for (const target of targets) {
        try {
          if (!fs.existsSync(target.path)) {
            results.push({ item: target.name, status: 'notFound' })
            continue
          }
          if (target.type === 'dir') {
            fs.rmSync(target.path, { recursive: true, force: true })
          } else {
            fs.unlinkSync(target.path)
          }
          results.push({ item: target.name, status: 'cleared' })
        } catch (err) {
          results.push({ item: target.name, status: 'error', error: err.message })
        }
      }

      // 5. 重新初始化配置（写入默认配置）
      if (configManager) {
        try {
          configManager.resetToDefaults()
          results.push({ item: 'configReset', status: 'cleared' })
        } catch (err) {
          results.push({ item: 'configReset', status: 'error', error: err.message })
        }
      }

      const hasErrors = results.some(r => r.status === 'error')

      // 自动重启应用
      if (!hasErrors) {
        setTimeout(() => {
          app.relaunch()
          app.quit()
        }, 1200)
      }

      return {
        success: !hasErrors,
        results,
        needsRestart: true
      }
    } catch (err) {
      console.error('[IPC] clearAllData error:', err)
      return { success: false, error: err.message, results }
    }
  })
}

module.exports = { setupIPCHandlers };
