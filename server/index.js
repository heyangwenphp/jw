/**
 * Jedi Web Server
 * Express + Socket.io backend for the web version
 * Reuses core logic from src/main/
 */

const express = require('express')
const { createServer } = require('http')
const { Server } = require('socket.io')
const path = require('path')
const fs = require('fs')
const fsp = require('fs').promises
const os = require('os')
const cors = require('cors')
const { execFile } = require('child_process')
const {
  saveAgentUploadFromPayload,
  saveAgentUploadFromBuffer
} = require('./agent-upload-utils')
const { setStaticAssetHeaders } = require('./static-asset-headers')
const { extractPdfText } = require('../src/main/utils/pdf-text-extractor')
const {
  scanSkillsForWeb,
  validateWebSkillImportPayload,
  cleanImportResult,
  createWebSkillRaw,
  updateWebSkillRaw,
  getWebSkillRawContent,
  deleteWebSkill,
  toggleWebSkillDisabled,
  copyWebSkill,
  importWebSkills,
  exportWebSkills,
  updateWebSkillVisibility
} = require('./skill-scanner')
const {
  scanAgentsForWeb,
  validateWebAgentImportPayload,
  importWebAgents,
  exportWebAgents,
  createWebAgentRaw,
  updateWebAgentRaw,
  getWebAgentRawContent,
  deleteWebAgent,
  toggleWebAgentDisabled,
  renameWebAgent,
  copyWebAgent,
  updateWebAgentVisibility
} = require('./agent-scanner')
const {
  assertBuiltInComponentAccess,
  filterBuiltInComponentGroups
} = require('./component-visibility')
const { ComponentMetadataStore } = require('./component-metadata')
const { createAgentConversationComponent } = require('./agent-component-creator')
const { createWebAuthSession } = require('./web-auth-session')
const { registerAipinDataPushRoutes, registerAipinDataAdminRoutes, registerAipinDataTaskRoutes } = require('./aipin-data-routes')
const { AipinProcessingQueue } = require('./aipin-processing-queue')
const { processAipinTask } = require('./aipin-agent-processor')
const { AipinDataStore } = require('./aipin-data-store')
const { AipinFeishuPusher } = require('./aipin-feishu-pusher')
const { AipinProcessingScheduler } = require('./aipin-processing-scheduler')
const { registerProjectLibraryRoutes } = require('./project-library-routes')
const { resolveWebUserDataPath } = require('./user-data-path')
const { ProjectAgentProfileManager } = require('../src/main/managers/project-agent-profile-manager')

const PORT = process.env.PORT || 3456
const projectRoot = path.resolve(__dirname, '..')
const userDataPath = resolveWebUserDataPath({ projectRoot })
fs.mkdirSync(userDataPath, { recursive: true })
const webUserSkillsDir = path.join(userDataPath, 'skills')
fs.mkdirSync(webUserSkillsDir, { recursive: true })
const webUserAgentsDir = path.join(userDataPath, 'agents')
fs.mkdirSync(webUserAgentsDir, { recursive: true })
const componentMetadataStore = new ComponentMetadataStore(path.join(userDataPath, 'component-metadata.json'))

console.log('[Server] userDataPath:', userDataPath)

function flattenComponentGroups(groups) {
  if (!groups || typeof groups !== 'object') return []
  const items = []
  const seen = new Set()
  for (const value of Object.values(groups)) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      const key = `${item?.source || ''}:${item?.id || item?.fullName || ''}`
      if (!item || seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}

function createWebProjectAgentProfileManager(currentUser) {
  return new ProjectAgentProfileManager({
    userDataPath,
    agentsManager: {
      async getAllAgents(projectPath) {
        const groups = filterBuiltInComponentGroups(scanAgentsForWeb({
          projectRoot,
          projectPath,
          userAgentsDir: webUserAgentsDir,
          metadataStore: componentMetadataStore,
          currentUser
        }), currentUser)
        return { ...groups, all: flattenComponentGroups(groups) }
      }
    },
    skillsManager: {
      async getAllSkills(projectPath) {
        const groups = filterBuiltInComponentGroups(scanSkillsForWeb({
          projectRoot,
          projectPath,
          userSkillsDir: webUserSkillsDir,
          metadataStore: componentMetadataStore,
          currentUser
        }), currentUser)
        return { ...groups, all: flattenComponentGroups(groups) }
      }
    }
  })
}

async function sendProjectAgentProfileResult(req, res, action) {
  try {
    const manager = createWebProjectAgentProfileManager(webAuthSession.getCurrentUser(req))
    const result = await action(manager)
    res.status(result?.success === false ? 400 : 200).json(result)
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
}

// ============================================================
// 1. ConfigManager (reuses src/main/config-manager.js)
// ============================================================
const ConfigManager = require('../src/main/config-manager')
const configManager = new ConfigManager({ userDataPath })

// ============================================================
// 2. SessionDatabase (reuses src/main/session-database.js)
// ============================================================
const { SessionDatabase } = require('../src/main/session-database')
const sessionDatabase = new SessionDatabase({ userDataPath })
try {
  sessionDatabase.init()
  console.log('[Server] Session database initialized')
} catch (err) {
  console.error('[Server] Failed to init session database:', err.message)
}

const { ProjectMasterDatabase } = require('../src/main/database/project-master-db')
const projectMasterDatabase = new ProjectMasterDatabase({ userDataPath })
try {
  projectMasterDatabase.init()
  console.log('[Server] Project master database initialized')
} catch (err) {
  console.error('[Server] Failed to init project master database:', err.message)
}

// ============================================================
// 2.5 AuthManager (web login/register session ownership)
// ============================================================
const { AuthManager } = require('../src/main/auth-manager')
const authManager = new AuthManager({ sessionDatabase, configManager })
const webAuthSession = createWebAuthSession({
  authManager,
  userDataPath,
  secureCookie: process.env.JEDI_WEB_SECURE_COOKIE === '1'
})

// ============================================================
// 3. AgentSessionManager (reuses src/main/agent-session-manager.js)
// ============================================================
const { AgentSessionManager } = require('../src/main/agent-session-manager')
const { WeixinNotifyService } = require('../src/main/managers/weixin-notify-service')
const { WeixinBridge } = require('../src/main/managers/weixin-bridge')
const { DingTalkBridge } = require('../src/main/managers/dingtalk-bridge')
const { FeishuBridge } = require('../src/main/managers/feishu-bridge')
const agentSessionManager = new AgentSessionManager(null, configManager)
agentSessionManager.setSessionDatabase(sessionDatabase)
agentSessionManager.setAgentComponentCreator(({ type, conversationId, messageId, component, currentUser }) => createAgentConversationComponent({
  type,
  conversationId,
  messageId,
  component,
  projectPath: projectRoot,
  userSkillsDir: webUserSkillsDir,
  userAgentsDir: webUserAgentsDir,
  metadataStore: componentMetadataStore,
  currentUser
}))

const weixinNotifyService = new WeixinNotifyService(configManager)
weixinNotifyService.start()
agentSessionManager.weixinNotifyService = weixinNotifyService
const weixinBridge = new WeixinBridge(configManager, agentSessionManager, weixinNotifyService, null)
const dingtalkBridge = new DingTalkBridge(configManager, agentSessionManager, null)
const feishuBridge = new FeishuBridge(configManager, agentSessionManager, null)
agentSessionManager.feishuBridge = feishuBridge

const WEB_TEXT_PREVIEW_LIMIT = 512 * 1024
const WEB_BINARY_PREVIEW_LIMIT = 50 * 1024 * 1024
const OPEN_PATH_TIMEOUT_MS = 15000
const WEB_UPLOAD_MULTIPART_LIMIT = 22 * 1024 * 1024
const WEB_MIME_MAP = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
}

function normalizeAbsolutePreviewPath(filePath, sessionId) {
  let resolvedPath = String(filePath || '').trim()
  if (!resolvedPath) {
    throw new Error('Missing filePath')
  }

  const welcomeReportPath = resolveWelcomeReportFilePathFromInput(resolvedPath)
  if (welcomeReportPath) {
    return welcomeReportPath
  }

  if (process.platform === 'win32') {
    const msys = resolvedPath.match(/^\/([a-zA-Z])\/(.*)/)
    if (msys) {
      resolvedPath = `${msys[1].toUpperCase()}:/${msys[2]}`
    } else {
      const driveWithoutColon = resolvedPath.match(/^([a-zA-Z])[\\/](.*)/)
      if (driveWithoutColon) {
        const drive = driveWithoutColon[1].toUpperCase()
        const rest = driveWithoutColon[2] || ''
        if (/^(workspace|users)([\\/]|$)/i.test(rest) && fs.existsSync(`${drive}:/`)) {
          resolvedPath = `${drive}:/${rest.replace(/\\/g, '/')}`
        }
      }
    }
  }

  if (!path.isAbsolute(resolvedPath)) {
    if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
      resolvedPath = path.join(os.homedir(), resolvedPath.slice(2))
    } else if (sessionId) {
      const cwd = agentSessionManager.fileManager._resolveCwd(sessionId)
      if (!cwd) throw new Error('Cannot resolve relative path: no working directory')
      resolvedPath = path.resolve(cwd, resolvedPath)
    } else {
      throw new Error('Cannot resolve relative path: no session context')
    }
  }

  return path.resolve(resolvedPath)
}

function runOpenPathCommand(command, args, options = {}) {
  return new Promise(resolve => {
    execFile(command, args, { windowsHide: true, timeout: OPEN_PATH_TIMEOUT_MS, ...options }, (error, _stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: String(stderr || error.message || 'Failed to open path').trim() })
        return
      }
      resolve({ success: true })
    })
  })
}

async function openPathWithDefaultApp(filePath) {
  const targetPath = path.resolve(filePath)
  const stats = await fsp.stat(targetPath)
  if (!stats.isFile() && !stats.isDirectory()) {
    return { success: false, error: 'Path is not a file or directory' }
  }

  if (process.platform === 'win32') {
    return runOpenPathCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Invoke-Item -LiteralPath $env:JEDI_OPEN_PATH'
    ], {
      env: { ...process.env, JEDI_OPEN_PATH: targetPath }
    })
  }

  if (process.platform === 'darwin') {
    return runOpenPathCommand('open', [targetPath])
  }

  return runOpenPathCommand('xdg-open', [targetPath])
}

function getWebPreviewType(ext) {
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) return 'image'
  if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video'
  if (['.mp3', '.wav'].includes(ext)) return 'audio'
  if (['.html', '.htm'].includes(ext)) return 'html'
  if (ext === '.docx') return 'word'
  if (['.doc', '.xlsx', '.xls'].includes(ext)) return 'office'
  if (ext === '.pdf') return 'pdf'
  return 'text'
}

function requireWebUser(req) {
  return webAuthSession.requireUser(req)
}

function requireWeixinNotifyAdmin(req) {
  const currentUser = requireWebUser(req)
  if (currentUser.phone !== '15527109305') {
    throw createForbiddenError()
  }
  return currentUser
}

function createForbiddenError(message = '无权访问该会话') {
  const error = new Error(message)
  error.code = 'AUTH_FORBIDDEN'
  return error
}

function assertWebConversationAccess(sessionId, currentUser) {
  if (!currentUser) throw createAuthRequiredError()
  if (!authManager.canAccessConversation(sessionId, currentUser)) {
    throw createForbiddenError()
  }
  return currentUser
}

function createAuthRequiredError() {
  const error = new Error('请先登录')
  error.code = 'AUTH_REQUIRED'
  return error
}

function sendWebAuthError(res, err) {
  if (err?.code === 'AUTH_REQUIRED') {
    return res.status(401).json({ success: false, code: err.code, error: err.message || '请先登录' })
  }
  if (err?.code === 'AUTH_FORBIDDEN') {
    return res.status(403).json({ success: false, code: err.code, error: err.message || '无权访问该会话' })
  }
  return res.status(500).json({ success: false, error: err.message })
}

function handleWeixinNotifyRoute(handler) {
  return async (req, res) => {
    try {
      requireWeixinNotifyAdmin(req)
      res.json(await handler(req))
    } catch (err) {
      sendWebAuthError(res, err)
    }
  }
}

function getPathFileName(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || ''
}

function buildAttachmentContentDisposition(fileName) {
  const rawName = getPathFileName(fileName) || 'download'
  const asciiName = rawName
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/["\\\r\n]/g, '_') || 'download'

  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`
}

function findWelcomeReportById(id) {
  const normalizedId = String(id || '').trim()
  return WELCOME_REPORTS.find(report => report.id === normalizedId) || null
}

function resolveWelcomeReportFilePath(report) {
  if (!report?.fileName) return ''
  return path.resolve(__dirname, '..', report.fileName)
}

function resolveWelcomeReportFilePathFromInput(filePath) {
  const fileName = getPathFileName(filePath)
  if (!fileName) return ''
  const report = WELCOME_REPORTS.find(item => item.fileName === fileName)
  return report ? resolveWelcomeReportFilePath(report) : ''
}

const WELCOME_REPORTS = [
  {
    id: 'tsinghua-a2a-agent',
    fileName: '清华 A2A Agent 赛道早期团队.pdf',
    name: '清华 A2A Agent 赛道早期团队',
    kicker: 'Agent 互操作',
    summary: '聚焦清华 x-lab 与 AIR 体系中的多智能体协作、医疗 AI 医院、安全智能体和企业 Agent 编排机会。',
    tags: ['A2A', '医疗 AI', '安全 Agent']
  },
  {
    id: 'tsinghua-embodied-hardware',
    fileName: '清华大学具身硬件早期团队.pdf',
    name: '清华大学具身硬件早期团队',
    kicker: '具身智能硬件',
    summary: '梳理零次方、松延动力、加速进化等清华系机器人团队，强调硬件交付、连续运行与早期约谈优先级。',
    tags: ['人形机器人', '灵巧操作', '硬件交付']
  },
  {
    id: 'tsinghua-ai-infrastructure',
    fileName: '清华机械 AI 基础设施.pdf',
    name: '清华机械 AI 基础设施',
    kicker: 'AI 数据中心供应链',
    summary: '围绕液冷散热、光 I/O/CPO、集成光芯片、Micro LED 与工厂机器人，寻找清华机械校友网络里的早期线索。',
    tags: ['液冷', '光互联', '智能制造']
  }
]

function resolveWelcomeReports() {
  return WELCOME_REPORTS.map(report => {
    const filePath = resolveWelcomeReportFilePath(report)
    let size = 0
    try {
      size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0
    } catch {
      size = 0
    }
    return {
      ...report,
      filePath,
      size,
      type: 'pdf',
      ext: '.pdf',
      url: `/api/reports/welcome/${encodeURIComponent(report.id)}/raw`
    }
  })
}

// Track all connected sockets for broadcasting
const ioSockets = new Set()

// Override _safeSend to emit via Socket.io instead of Electron IPC
agentSessionManager._safeSend = function (channel, data) {
  ioSockets.forEach(socket => socket.emit(channel, data))
  return true
}

weixinBridge._notifyFrontend = function (channel, data) {
  ioSockets.forEach(socket => socket.emit(channel, data))
  return true
}
weixinBridge.start()

dingtalkBridge._notifyFrontend = function (channel, data) {
  ioSockets.forEach(socket => socket.emit(channel, data))
  return true
}
feishuBridge._notifyFrontend = function (channel, data) {
  ioSockets.forEach(socket => socket.emit(channel, data))
  return true
}

if (configManager.getConfig()?.dingtalk?.enabled) {
  dingtalkBridge.start().catch(err => {
    console.error('[Server] DingTalk bridge auto-start failed:', err.message)
  })
}
if (configManager.getConfig()?.feishu?.enabled) {
  feishuBridge.start().catch(err => {
    console.error('[Server] Feishu bridge auto-start failed:', err.message)
  })
}

// Also override emit to include socket broadcast
const originalEmit = agentSessionManager.emit.bind(agentSessionManager)
agentSessionManager.emit = function (event, ...args) {
  originalEmit(event, ...args)
}

const aipinProcessingQueue = new AipinProcessingQueue({ userDataPath })
const aipinDataStore = new AipinDataStore({ userDataPath })
const aipinFeishuPusher = new AipinFeishuPusher({ dataStore: aipinDataStore })

async function processClaimedAipinTask(task, req = null) {
  if (!task) return null
  const config = await aipinProcessingQueue.getConfig()
  const currentUser = req ? requireWebUser(req) : null
  return processAipinTask({
    task,
    userDataPath,
    agentSessionManager,
    queue: aipinProcessingQueue,
    config,
    currentUser,
    aipinDataStore,
    feishuPusher: aipinFeishuPusher
  })
}

function getSystemMemoryUsagePercent() {
  const total = os.totalmem()
  if (!total) return 0
  return Math.round((1 - (os.freemem() / total)) * 100)
}

const aipinProcessingScheduler = new AipinProcessingScheduler({
  claimTask: taskId => aipinProcessingQueue.claimTask(taskId),
  runTask: processClaimedAipinTask,
  getConfig: () => aipinProcessingQueue.getConfig(),
  getMemoryUsagePercent: getSystemMemoryUsagePercent,
  logger: console
})

function processNextAipinTask(taskId = null, req = null) {
  return aipinProcessingScheduler.schedule(taskId, req)
}

async function wakeAipinProcessingIfEnabled(reason = 'manual') {
  const config = await aipinProcessingQueue.getConfig()
  if (config.enabled === false || !config.autoProcess) return false
  console.info('[AipinData] Waking processing scheduler', { reason })
  processNextAipinTask(null).catch(err => {
    console.error('[AipinData] Processing scheduler wake failed:', err)
  })
  return true
}

async function pushPendingAipinIfConfigured(reason = 'manual') {
  if (!aipinFeishuPusher?.isConfigured?.()) return false
  const limit = 100
  let total = 0
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await aipinFeishuPusher.pushPending({ limit })
    total += result?.pushed || 0
    if (!result?.success || !result?.total || result.total < limit) break
  }
  if (total > 0) {
    console.info('[AipinData] Pushed pending records', { reason, total })
  }
  return total > 0
}

async function reconcileUnlinkedAipinBatches() {
  const config = await aipinProcessingQueue.getConfig()
  if (config.enabled === false || !config.autoProcess) return
  const batches = aipinDataStore.listUnlinkedReceivedBatches({ limit: 100 })
  for (const batch of batches) {
    const task = await aipinProcessingQueue.createTask({
      requestId: batch.request_id,
      sourceFile: batch.source_ref || `aipin-sqlite:batch:${batch.request_id}`,
      receivedCount: batch.received_count
    })
    aipinDataStore.markTaskLinked({ requestId: batch.request_id, task })
    console.info('[AipinData] Re-queued unlinked received batch', {
      requestId: batch.request_id,
      taskId: task.taskId,
      receivedCount: batch.received_count
    })
  }
  if (batches.length) {
    await wakeAipinProcessingIfEnabled('startup-reconcile')
  } else {
    await wakeAipinProcessingIfEnabled('startup')
  }
}

async function recoverAipinStartupWork() {
  const recoveredTasks = typeof aipinProcessingQueue.recoverInterruptedTasks === 'function'
    ? await aipinProcessingQueue.recoverInterruptedTasks()
    : []
  const recoveredData = typeof aipinDataStore.recoverInterruptedWork === 'function'
    ? aipinDataStore.recoverInterruptedWork()
    : null

  const recoveredTotal = recoveredTasks.length
    + (recoveredData?.processingBatches || 0)
    + (recoveredData?.processingItems || 0)
    + (recoveredData?.pushingBatches || 0)
    + (recoveredData?.pushingItems || 0)

  if (recoveredTotal > 0) {
    console.info('[AipinData] Recovered interrupted work on startup', {
      processingTasks: recoveredTasks.length,
      ...recoveredData
    })
  }

  await reconcileUnlinkedAipinBatches()
  if (recoveredTasks.length || recoveredData?.processingBatches || recoveredData?.processingItems) {
    await wakeAipinProcessingIfEnabled('startup-recovered-processing')
  }
  await pushPendingAipinIfConfigured('startup')
}

recoverAipinStartupWork().catch(err => {
  console.error('[AipinData] Failed to recover startup work:', err)
})

// ============================================================
// 4. Express + Socket.io setup
// ============================================================
const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 50 * 1024 * 1024
})

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '50mb' }))
registerAipinDataPushRoutes({
  app,
  userDataPath,
  processingQueue: aipinProcessingQueue,
  processNextTask: processNextAipinTask
})
app.use(webAuthSession.requirePageAuth)
registerAipinDataAdminRoutes({
  app,
  userDataPath,
  processingQueue: aipinProcessingQueue,
  processNextTask: processNextAipinTask,
  feishuPusher: aipinFeishuPusher,
  requireAdmin: requireWeixinNotifyAdmin,
  requireUser: requireWebUser
})
registerAipinDataTaskRoutes({
  app,
  processingQueue: aipinProcessingQueue,
  processNextTask: processNextAipinTask
})
app.use(express.static(path.join(__dirname, '../dist'), {
  setHeaders: setStaticAssetHeaders
}))

registerProjectLibraryRoutes({
  app,
  sessionDatabase,
  projectMasterDatabase,
  requireWebUser,
  sendWebAuthError
})

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '0.29-web' })
})

app.post('/api/system/open-path', async (req, res) => {
  try {
    const filePath = normalizeAbsolutePreviewPath(req.body?.filePath, req.body?.sessionId)
    const result = await openPathWithDefaultApp(filePath)
    if (!result.success) {
      return res.status(500).json(result)
    }
    res.json(result)
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: 'Path not found' })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/api/reports/welcome', (_req, res) => {
  try {
    res.json(resolveWelcomeReports())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/reports/generated', (req, res) => {
  try {
    res.json(agentSessionManager.listGeneratedReports({ mode: req.query.mode }))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/reports/generated/hide', (req, res) => {
  try {
    const { mode, filePath } = req.body || {}
    res.json(agentSessionManager.hideGeneratedReport({ mode, filePath }))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/reports/welcome/:id/raw', async (req, res) => {
  try {
    const report = findWelcomeReportById(req.params.id)
    if (!report) {
      return res.status(404).json({ error: 'Report not found' })
    }

    const filePath = resolveWelcomeReportFilePath(report)
    const stats = await fsp.stat(filePath)
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'Not a file' })
    }

    const isDownloadRequest = req.query.download === '1'
    res.setHeader('Content-Type', WEB_MIME_MAP['.pdf'])
    res.setHeader('Content-Disposition', isDownloadRequest ? buildAttachmentContentDisposition(report.fileName) : 'inline')
    res.setHeader('Content-Length', stats.size)
    fs.createReadStream(filePath).pipe(res)
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' })
    }
    res.status(500).json({ error: err.message })
  }
})

// ============================================================
// 5. HTTP API Routes
// ============================================================

// --- Config ---
app.get('/api/config', (_req, res) => {
  try {
    res.json(configManager.getConfig())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/config', (req, res) => {
  try {
    configManager.updateConfig(req.body)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/settings', (req, res) => {
  try {
    configManager.updateSettings(req.body)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function updateDingTalkBridgeConfig(updates = {}, currentUser = null) {
  const config = configManager.getConfig()
  config.dingtalk = {
    ...config.dingtalk,
    appKey: updates.appKey !== undefined ? updates.appKey : config.dingtalk?.appKey || '',
    appSecret: updates.appSecret !== undefined ? updates.appSecret : config.dingtalk?.appSecret || '',
    enabled: updates.enabled !== undefined ? updates.enabled : config.dingtalk?.enabled || false,
    defaultCwd: updates.defaultCwd !== undefined ? updates.defaultCwd : config.dingtalk?.defaultCwd || '',
    maxHistorySessions: updates.maxHistorySessions !== undefined ? updates.maxHistorySessions : config.dingtalk?.maxHistorySessions || 5,
    ownerUserId: currentUser?.id || updates.ownerUserId || config.dingtalk?.ownerUserId || null
  }
  return configManager.save(config)
}

function updateFeishuBridgeConfig(updates = {}, currentUser = null) {
  const config = configManager.getConfig()
  config.feishu = {
    ...config.feishu,
    appId: updates.appId !== undefined ? updates.appId : config.feishu?.appId || '',
    appSecret: updates.appSecret !== undefined ? updates.appSecret : config.feishu?.appSecret || '',
    enabled: updates.enabled !== undefined ? updates.enabled : config.feishu?.enabled || false,
    notificationChatId: updates.notificationChatId !== undefined ? updates.notificationChatId : config.feishu?.notificationChatId || '',
    maxHistorySessions: updates.maxHistorySessions !== undefined ? updates.maxHistorySessions : config.feishu?.maxHistorySessions || 5,
    ownerUserId: currentUser?.id || updates.ownerUserId || config.feishu?.ownerUserId || null
  }
  return configManager.save(config)
}

// --- IM Bridge ---
app.get('/api/dingtalk/status', (_req, res) => {
  try {
    res.json(dingtalkBridge.getStatus())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/dingtalk/config', async (req, res) => {
  try {
    await updateDingTalkBridgeConfig(req.body || {}, webAuthSession.getCurrentUser(req))
    if (!configManager.getConfig()?.dingtalk?.enabled) {
      await dingtalkBridge.stop()
      return res.json(false)
    }
    res.json(true)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/dingtalk/start', async (_req, res) => {
  try {
    res.json(await dingtalkBridge.start())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/dingtalk/stop', async (_req, res) => {
  try {
    await dingtalkBridge.stop()
    res.json(true)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/dingtalk/restart', async (_req, res) => {
  try {
    res.json(await dingtalkBridge.restart())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/feishu/status', (_req, res) => {
  try {
    res.json(feishuBridge.getStatus())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/feishu/config', async (req, res) => {
  try {
    await updateFeishuBridgeConfig(req.body || {}, webAuthSession.getCurrentUser(req))
    if (!configManager.getConfig()?.feishu?.enabled) {
      await feishuBridge.stop()
      return res.json(false)
    }
    res.json(true)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/feishu/start', async (_req, res) => {
  try {
    res.json(await feishuBridge.start())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/feishu/stop', async (_req, res) => {
  try {
    await feishuBridge.stop()
    res.json(true)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/feishu/restart', async (_req, res) => {
  try {
    res.json(await feishuBridge.restart())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Weixin Notify ---
app.post('/api/weixin-notify/login/start', handleWeixinNotifyRoute((req) => {
  return weixinNotifyService.startLogin(req.body || {})
}))

app.post('/api/weixin-notify/login/wait', handleWeixinNotifyRoute((req) => {
  return weixinNotifyService.waitLogin(req.body || {})
}))

app.get('/api/weixin-notify/accounts', handleWeixinNotifyRoute(() => {
  return weixinNotifyService.listAccounts()
}))

app.get('/api/weixin-notify/targets', handleWeixinNotifyRoute(() => {
  return weixinNotifyService.listTargets()
}))

app.patch('/api/weixin-notify/targets', handleWeixinNotifyRoute((req) => {
  return weixinNotifyService.updateTarget(req.body || {})
}))

app.post('/api/weixin-notify/targets/delete', handleWeixinNotifyRoute((req) => {
  return weixinNotifyService.deleteTarget(req.body || {})
}))

app.post('/api/weixin-notify/poll-once', handleWeixinNotifyRoute((req) => {
  return weixinNotifyService.pollOnce(req.body || {})
}))

app.post('/api/weixin-notify/send-text', handleWeixinNotifyRoute((req) => {
  return weixinNotifyService.sendText(req.body || {})
}))

app.post('/api/weixin-notify/session-binding', handleWeixinNotifyRoute((req) => {
  const payload = req.body || {}
  return weixinBridge.bindSessionToTarget(payload.sessionId, {
    accountId: payload.accountId,
    targetId: payload.targetId,
    displayName: payload.displayName
  })
}))

app.post('/api/weixin-notify/session-binding/delete', handleWeixinNotifyRoute((req) => {
  return weixinBridge.unbindSessionTarget(req.body?.sessionId)
}))

app.get('/api/weixin-notify/session-binding/:sessionId', handleWeixinNotifyRoute((req) => {
  return weixinBridge.getSessionBinding(req.params.sessionId) || null
}))

// --- Auth ---
app.post('/api/auth/login', (req, res) => {
  try {
    const result = authManager.login(req.body || {}, { persistCurrentUser: false })
    if (result?.success && result?.user?.id != null) {
      webAuthSession.setUserCookie(res, result.user.id)
    }
    res.json(result)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/auth/current-user', (req, res) => {
  try {
    res.json({ success: true, user: webAuthSession.getCurrentUser(req) })
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.post('/api/auth/logout', (_req, res) => {
  try {
    webAuthSession.clearUserCookie(res)
    res.json({ success: true })
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

// --- API Profiles ---
app.get('/api/profiles', (_req, res) => {
  try {
    res.json(configManager.getAPIProfiles())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/profiles/:id', (req, res) => {
  try {
    res.json(configManager.getAPIProfile(req.params.id))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/profiles', (req, res) => {
  try {
    res.json(configManager.addAPIProfile(req.body))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/profiles/:id', (req, res) => {
  try {
    res.json(configManager.updateAPIProfile(req.params.id, req.body))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/profiles/:id', (req, res) => {
  try {
    configManager.deleteAPIProfile(req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Providers ---
app.get('/api/providers', (_req, res) => {
  try {
    res.json(configManager.getServiceProviderDefinitions())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/providers', (req, res) => {
  try {
    res.json(configManager.addServiceProviderDefinition(req.body))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/providers/:id', (req, res) => {
  try {
    res.json(configManager.updateServiceProviderDefinition(req.params.id, req.body))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/providers/:id', (req, res) => {
  try {
    configManager.deleteServiceProviderDefinition(req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Connection Test ---
app.post('/api/test-connection', async (req, res) => {
  try {
    if (agentSessionManager?.probeConnection) {
      const probeResult = await agentSessionManager.probeConnection(req.body)
      if (probeResult.success || !probeResult.canFallbackToHttp) {
        return res.json(probeResult)
      }
      console.warn('[Server] Probe test failed, falling back to HTTP')
      return res.json(await configManager.testAPIConnectionViaHTTP(req.body))
    }
    res.json(await configManager.testAPIConnectionViaHTTP(req.body))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Agent Sessions (RESTful) ---
app.post('/api/agent/components', (req, res) => {
  try {
    const currentUser = assertWebConversationAccess(req.body?.conversationId, requireWebUser(req))
    const result = createAgentConversationComponent({
      type: req.body?.type,
      conversationId: req.body?.conversationId,
      messageId: req.body?.messageId,
      component: req.body?.component,
      projectPath: req.body?.projectPath || projectRoot,
      userSkillsDir: webUserSkillsDir,
      userAgentsDir: webUserAgentsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/agent/sessions', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    res.json(agentSessionManager.list({ currentUser }))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.post('/api/agent/sessions', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    const session = agentSessionManager.create({ ...(req.body || {}), ownerUserId: currentUser.id })
    res.json(session)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/agent/sessions/:id', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    res.json(agentSessionManager.get(req.params.id, { currentUser }))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/agent/sessions/:id/messages', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    res.json(agentSessionManager.getMessages(req.params.id, { currentUser }))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.delete('/api/agent/sessions/:id', async (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    await agentSessionManager.deleteConversation(req.params.id, { currentUser })
    res.json({ success: true })
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.patch('/api/agent/sessions/:id/title', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    res.json(agentSessionManager.rename(req.params.id, req.body.title, { currentUser }))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

// --- Agent File Operations ---
app.get('/api/agent/sessions/:id/files', async (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    const { relativePath, showHidden } = req.query
    res.json(await agentSessionManager.listDir(req.params.id, relativePath || '', showHidden === 'true'))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/agent/sessions/:id/files/content', async (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    res.json(await agentSessionManager.readFile(req.params.id, req.query.relativePath))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

function getMultipartBoundary(contentType = '') {
  const match = String(contentType || '').match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i)
  return match ? String(match[1] || match[2] || '').trim() : ''
}

function parseContentDisposition(value = '') {
  const result = {}
  for (const part of String(value || '').split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    const key = String(rawKey || '').trim().toLowerCase()
    if (!key) continue
    const joined = rawValue.join('=').trim()
    result[key] = joined.replace(/^"|"$/g, '')
  }
  return result
}

async function readMultipartUpload(req) {
  const boundary = getMultipartBoundary(req.headers['content-type'])
  if (!boundary) {
    throw new Error('Missing multipart boundary')
  }

  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > WEB_UPLOAD_MULTIPART_LIMIT) {
      throw new Error('Uploaded file too large (max 20MB)')
    }
    chunks.push(chunk)
  }

  const body = Buffer.concat(chunks)
  const boundaryBuffer = Buffer.from(`--${boundary}`)
  const headerSeparator = Buffer.from('\r\n\r\n')
  const fields = {}
  let file = null
  let cursor = body.indexOf(boundaryBuffer)

  while (cursor !== -1) {
    let partStart = cursor + boundaryBuffer.length
    if (body[partStart] === 45 && body[partStart + 1] === 45) break
    if (body[partStart] === 13 && body[partStart + 1] === 10) partStart += 2

    const nextBoundary = body.indexOf(boundaryBuffer, partStart)
    if (nextBoundary === -1) break

    let partEnd = nextBoundary
    if (body[partEnd - 2] === 13 && body[partEnd - 1] === 10) partEnd -= 2
    const part = body.subarray(partStart, partEnd)
    const headerEnd = part.indexOf(headerSeparator)
    if (headerEnd !== -1) {
      const headersRaw = part.subarray(0, headerEnd).toString('utf8')
      const data = part.subarray(headerEnd + headerSeparator.length)
      const headers = Object.fromEntries(headersRaw
        .split(/\r\n/)
        .map(line => {
          const index = line.indexOf(':')
          return index === -1 ? null : [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()]
        })
        .filter(Boolean))
      const disposition = parseContentDisposition(headers['content-disposition'])

      if (disposition.name === 'file') {
        file = {
          buffer: data,
          originalName: disposition.filename || fields.name || 'upload',
          mimeType: headers['content-type'] || fields.mimeType || ''
        }
      } else if (disposition.name) {
        fields[disposition.name] = data.toString('utf8')
      }
    }

    cursor = nextBoundary
  }

  if (!file) {
    throw new Error('Missing upload file')
  }
  return { fields, file }
}

app.post('/api/agent/uploads', async (req, res) => {
  try {
    requireWebUser(req)
    const isMultipart = String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')
    const upload = isMultipart ? await readMultipartUpload(req) : null
    const body = upload?.fields || req.body || {}
    const requestedCwd = typeof body?.cwd === 'string' ? body.cwd.trim() : ''
    const uploadCwd = requestedCwd || userDataPath
    if (fs.existsSync(uploadCwd) && !fs.statSync(uploadCwd).isDirectory()) {
      return res.status(400).json({ error: 'Upload working directory not found' })
    }

    const result = upload
      ? await saveAgentUploadFromBuffer({
        cwd: uploadCwd,
        buffer: upload.file.buffer,
        originalName: upload.file.originalName || body.name,
        mimeType: upload.file.mimeType || body.mimeType || '',
        extractContent: false
      })
      : await saveAgentUploadFromPayload({
        cwd: uploadCwd,
        payload: req.body,
        extractContent: false
      })
    res.json(result)
  } catch (err) {
    if (err?.code === 'AUTH_REQUIRED' || err?.code === 'AUTH_FORBIDDEN') {
      return sendWebAuthError(res, err)
    }
    res.status(400).json({ error: err.message })
  }
})

app.post('/api/agent/sessions/:id/uploads', async (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    let session = agentSessionManager.sessions.get(req.params.id)
    if (!session) {
      agentSessionManager.reopen(req.params.id)
      session = agentSessionManager.sessions.get(req.params.id)
    }
    if (!session?.cwd) {
      return res.status(404).json({ error: 'Agent session not found' })
    }

    const isMultipart = String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')
    const upload = isMultipart ? await readMultipartUpload(req) : null
    const body = upload?.fields || req.body || {}
    const result = upload
      ? await saveAgentUploadFromBuffer({
        cwd: session.cwd,
        buffer: upload.file.buffer,
        originalName: upload.file.originalName || body.name,
        mimeType: upload.file.mimeType || body.mimeType || '',
        extractContent: false
      })
      : await saveAgentUploadFromPayload({
        cwd: session.cwd,
        payload: req.body,
        extractContent: false
      })
    res.json(result)
  } catch (err) {
    if (err?.code === 'AUTH_REQUIRED' || err?.code === 'AUTH_FORBIDDEN') {
      return sendWebAuthError(res, err)
    }
    res.status(400).json({ error: err.message })
  }
})

// Serve file raw bytes (for PDF/Word preview in web version)
app.get('/api/agent/sessions/:id/files/raw', async (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    const filePath = await agentSessionManager.resolveFilePath(req.params.id, req.query.relativePath)
    if (!filePath || filePath.error) {
      return res.status(404).json({ error: filePath?.error || 'File not found' })
    }

    const stat = await fsp.stat(filePath)
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'Not a file' })
    }

    const ext = path.extname(filePath).toLowerCase()
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.html': 'text/html; charset=utf-8',
      '.htm': 'text/html; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
      '.markdown': 'text/markdown; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
    }
    const isDownloadRequest = req.query.download === '1'
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream')
    res.setHeader('Content-Disposition', isDownloadRequest ? buildAttachmentContentDisposition(path.basename(filePath)) : 'inline')
    res.setHeader('Content-Length', stat.size)

    const stream = fs.createReadStream(filePath)
    stream.pipe(res)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/files/absolute/metadata', async (req, res) => {
  try {
    const filePath = normalizeAbsolutePreviewPath(req.query.filePath, req.query.sessionId)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' })
    }

    const stats = await fsp.stat(filePath)
    const name = path.basename(filePath)
    if (stats.isDirectory()) {
      return res.json({ type: 'directory', name, path: filePath })
    }

    const ext = path.extname(filePath).toLowerCase()
    const type = getWebPreviewType(ext)
    const sessionId = String(req.query.sessionId || '').trim()
    let relativePath = ''
    if (sessionId) {
      const cwd = agentSessionManager.fileManager._resolveCwd(sessionId)
      if (cwd) {
        const resolvedCwd = path.resolve(cwd)
        if (filePath !== resolvedCwd && filePath.startsWith(resolvedCwd + path.sep)) {
          relativePath = path.relative(resolvedCwd, filePath).replace(/\\/g, '/')
        }
      }
    }
    const rawQuery = new URLSearchParams({ filePath })
    if (sessionId) rawQuery.set('sessionId', sessionId)
    const staticUrl = relativePath
      ? `/api/agent/sessions/${encodeURIComponent(sessionId)}/static/${relativePath.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
      : ''
    const url = type === 'html' && staticUrl
      ? staticUrl
      : `/api/files/absolute/raw?${rawQuery.toString()}`

    if (stats.size > WEB_BINARY_PREVIEW_LIMIT && type !== 'text') {
      return res.status(413).json({ error: `File too large (max ${WEB_BINARY_PREVIEW_LIMIT / 1024 / 1024}MB)` })
    }

    if (type === 'image') {
      const buffer = await fsp.readFile(filePath)
      return res.json({
        type,
        name,
        content: `data:${WEB_MIME_MAP[ext] || 'image/png'};base64,${buffer.toString('base64')}`,
        size: stats.size,
        ext,
        filePath,
        url,
        relativePath: relativePath || undefined
      })
    }

    if (type !== 'text') {
      return res.json({ type, name, size: stats.size, ext, filePath, url, relativePath: relativePath || undefined })
    }

    if (stats.size > WEB_TEXT_PREVIEW_LIMIT) {
      return res.status(413).json({ error: `File too large to preview as text (max ${WEB_TEXT_PREVIEW_LIMIT / 1024 / 1024}MB)` })
    }

    const content = await fsp.readFile(filePath, 'utf8')
    res.json({ type: 'text', name, content, size: stats.size, ext, filePath, url, relativePath: relativePath || undefined })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/files/absolute/report-text', async (req, res) => {
  try {
    if (req.query.sessionId) {
      assertWebConversationAccess(req.query.sessionId, requireWebUser(req))
    }
    const filePath = normalizeAbsolutePreviewPath(req.query.filePath, req.query.sessionId)
    const result = await extractPdfText(filePath, { maxChars: req.query.maxChars })
    if (result?.error) {
      return res.status(result.error === 'File not found' ? 404 : 400).json(result)
    }
    res.json(result)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/files/absolute/raw', async (req, res) => {
  try {
    if (req.query.sessionId) {
      assertWebConversationAccess(req.query.sessionId, requireWebUser(req))
    }
    const filePath = normalizeAbsolutePreviewPath(req.query.filePath, req.query.sessionId)
    const stats = await fsp.stat(filePath)
    if (!stats.isFile()) {
      return res.status(404).json({ error: 'Not a file' })
    }

    const ext = path.extname(filePath).toLowerCase()
    const isDownloadRequest = req.query.download === '1'
    res.setHeader('Content-Type', WEB_MIME_MAP[ext] || 'application/octet-stream')
    res.setHeader('Content-Disposition', isDownloadRequest ? buildAttachmentContentDisposition(path.basename(filePath)) : 'inline')
    res.setHeader('Content-Length', stats.size)
    fs.createReadStream(filePath).pipe(res)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.post('/api/agent/sessions/:id/files', async (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    const { relativePath, content, parentPath, name, isDirectory } = req.body
    if (relativePath && content !== undefined) {
      res.json(await agentSessionManager.saveFile(req.params.id, relativePath, content))
    } else if (parentPath && name) {
      res.json(await agentSessionManager.createFile(req.params.id, parentPath, name, isDirectory))
    } else {
      res.status(400).json({ error: 'Missing parameters' })
    }
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.patch('/api/agent/sessions/:id/files', async (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    res.json(await agentSessionManager.renameFile(req.params.id, req.body.oldPath, req.body.newName))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.delete('/api/agent/sessions/:id/files', async (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    res.json(await agentSessionManager.deleteFile(req.params.id, req.query.path))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/agent/sessions/:id/files/search', async (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    res.json(await agentSessionManager.searchFiles(req.params.id, req.query.keyword, req.query.showHidden === 'true'))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/agent/sessions/:id/output-dir', (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    res.json({ path: agentSessionManager.getOutputDir(req.params.id) })
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.get('/api/agent/sessions/:id/output-files', (req, res) => {
  try {
    assertWebConversationAccess(req.params.id, requireWebUser(req))
    res.json(agentSessionManager.listOutputFiles(req.params.id))
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

// ============================================================
// 5.5 Skills
// ============================================================

function parseSkillFrontmatter(content) {
  const result = { name: '', description: '', id: '' }
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  if (!match) return result
  const yaml = match[1]
  const nameM = yaml.match(/^name:\s*(.+)$/m)
  const descM = yaml.match(/^description:\s*"?(.+?)"?\s*$/m)
  if (nameM) result.name = nameM[1].trim()
  if (descM) result.description = descM[1].trim().replace(/"$/, '').replace(/^"/, '')
  return result
}

function scanBuiltInSkills() {
  const skillsDir = path.join(__dirname, '../skills')
  const skills = []
  if (!fs.existsSync(skillsDir)) {
    console.log('[Skills] skills dir not found:', skillsDir)
    return skills
  }

  const items = fs.readdirSync(skillsDir, { withFileTypes: true })
  for (const item of items) {
    if (item.name.startsWith('.') || item.name === '.DS_Store') continue

    let skillMdContent = null
    let skillId = item.name.replace(/-\d+\.\d+\.\d+$/, '')

    if (item.isDirectory()) {
      const mdPath = path.join(skillsDir, item.name, 'SKILL.md')
      const mdPathLower = path.join(skillsDir, item.name, 'skill.md')
      if (fs.existsSync(mdPath)) {
        skillMdContent = fs.readFileSync(mdPath, 'utf-8')
      } else if (fs.existsSync(mdPathLower)) {
        skillMdContent = fs.readFileSync(mdPathLower, 'utf-8')
      }
    } else if (item.isFile() && item.name.endsWith('.zip')) {
      try {
        const AdmZip = require('adm-zip')
        const zip = new AdmZip(path.join(skillsDir, item.name))
        const entries = zip.getEntries()
        const entry = entries.find(e => !e.isDirectory && (e.entryName === 'SKILL.md' || e.entryName === 'skill.md'))
        if (entry) {
          skillMdContent = entry.getData().toString('utf-8')
          skillId = item.name.replace(/\.zip$/, '').replace(/-\d+\.\d+\.\d+$/, '')
        }
      } catch (err) {
        console.error('[Skills] Failed to read zip:', item.name, err.message)
      }
    }

    if (skillMdContent) {
      try {
        const meta = parseSkillFrontmatter(skillMdContent)
        skills.push({
          id: meta.name || skillId,
          name: meta.name || skillId,
          fullName: skillId,
          description: meta.description || '',
          source: 'built-in',
          filePath: item.isDirectory() ? path.join(skillsDir, item.name, 'SKILL.md') : null
        })
      } catch (err) {
        console.error('[Skills] Failed to parse skill:', item.name, err.message)
      }
    }
  }

  return skills
}

app.get('/api/skills', (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' && req.query.projectPath.trim()
      ? req.query.projectPath.trim()
      : projectRoot
    const currentUser = webAuthSession.getCurrentUser(req)
    const skills = scanSkillsForWeb({
      projectRoot,
      projectPath,
      userSkillsDir: webUserSkillsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.json(filterBuiltInComponentGroups(skills, currentUser))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/skills/raw', (req, res) => {
  try {
    const currentUser = webAuthSession.getCurrentUser(req)
    assertBuiltInComponentAccess(req.query || {}, currentUser)
    const result = getWebSkillRawContent({
      source: req.query.source,
      skillId: req.query.skillId,
      projectPath: req.query.projectPath || projectRoot,
      userSkillsDir: webUserSkillsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 404).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/skills/raw', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    const result = createWebSkillRaw({
      source: req.body?.source,
      skillId: req.body?.skillId,
      rawContent: req.body?.rawContent,
      projectPath: req.body?.projectPath || projectRoot,
      userSkillsDir: webUserSkillsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.put('/api/skills/raw', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const result = updateWebSkillRaw({
      source: req.body?.source,
      skillId: req.body?.skillId,
      rawContent: req.body?.rawContent,
      projectPath: req.body?.projectPath || projectRoot,
      userSkillsDir: webUserSkillsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.patch('/api/skills/visibility', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    const result = updateWebSkillVisibility({
      skillId: req.body?.skillId,
      visibility: req.body?.visibility,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : (result.code === 'AUTH_FORBIDDEN' ? 403 : 400)).json(result)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.patch('/api/skills/disabled', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    const result = toggleWebSkillDisabled({
      source: req.body?.source || 'user',
      skillId: req.body?.skillId,
      disabled: !!req.body?.disabled,
      projectRoot,
      projectPath: req.body?.projectPath || projectRoot,
      userSkillsDir: webUserSkillsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : (result.code === 'AUTH_FORBIDDEN' ? 403 : 400)).json(result)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.post('/api/skills/delete', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const result = deleteWebSkill({
      source: req.body?.source,
      skillId: req.body?.skillId,
      projectPath: req.body?.projectPath || projectRoot,
      userSkillsDir: webUserSkillsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/skills/copy', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const result = copyWebSkill({
      fromSource: req.body?.fromSource,
      skillId: req.body?.skillId,
      toSource: req.body?.toSource,
      newSkillId: req.body?.newSkillId,
      projectPath: req.body?.projectPath || projectRoot,
      userSkillsDir: webUserSkillsDir,
      projectRoot,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/skills/import/validate', (req, res) => {
  let validation
  try {
    validation = validateWebSkillImportPayload(req.body?.source)
    res.json(cleanImportResult(validation))
  } catch (err) {
    res.status(400).json({ valid: false, errors: [err.message], skills: [] })
  } finally {
    if (validation?._tempDir && fs.existsSync(validation._tempDir)) {
      fs.rmSync(validation._tempDir, { recursive: true, force: true })
    }
  }
})

app.post('/api/skills/import', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const result = importWebSkills({
      source: req.body?.source,
      targetSource: req.body?.targetSource,
      projectPath: req.body?.projectPath || projectRoot,
      selectedSkillIds: req.body?.selectedSkillIds,
      overwriteExisting: !!req.body?.overwriteExisting,
      userSkillsDir: webUserSkillsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, errors: [err.message] })
  }
})

app.post('/api/skills/export', (req, res) => {
  try {
    const currentUser = webAuthSession.getCurrentUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const exportResult = exportWebSkills({
      source: req.body?.source,
      scope: req.body?.scope,
      skillId: req.body?.skillId,
      skillIds: req.body?.skillIds,
      projectPath: req.body?.projectPath || projectRoot,
      userSkillsDir: webUserSkillsDir
    })

    if (!exportResult.success) {
      res.status(400).json({ success: false, error: exportResult.error })
      return
    }

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', buildAttachmentContentDisposition(exportResult.filename))
    res.setHeader('Content-Length', exportResult.buffer.length)
    res.setHeader('X-Skill-Count', String(exportResult.count || 0))
    res.send(exportResult.buffer)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/api/projects', (req, res) => {
  res.json([{
    id: 'web-dev-current-project',
    name: path.basename(projectRoot) || projectRoot,
    path: projectRoot,
    pathValid: fs.existsSync(projectRoot),
    is_pinned: true
  }])
})

// ============================================================
// 5.6 Agents (built-in only for web version)
// ============================================================

function scanBuiltInAgents() {
  const agentsDir = path.join(__dirname, '../agents')
  const agents = []
  if (!fs.existsSync(agentsDir)) {
    console.log('[Agents] agents dir not found:', agentsDir)
    return agents
  }

  const items = fs.readdirSync(agentsDir, { withFileTypes: true })
  for (const item of items) {
    if (!item.isFile() || !item.name.endsWith('.md')) continue
    if (item.name.startsWith('.') || item.name === '.DS_Store') continue

    const filePath = path.join(agentsDir, item.name)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const meta = parseSkillFrontmatter(content)
      const agentId = item.name.replace(/\.md$/, '')
      agents.push({
        id: meta.name || agentId,
        name: meta.name || agentId,
        fullName: agentId,
        description: meta.description || '',
        source: 'built-in',
        filePath,
        tools: meta.tools || ''
      })
    } catch (err) {
      console.error('[Agents] Failed to parse agent:', item.name, err.message)
    }
  }

  return agents
}

app.get('/api/agents', (req, res) => {
  try {
    const projectPath = typeof req.query.projectPath === 'string' && req.query.projectPath.trim()
      ? req.query.projectPath.trim()
      : projectRoot
    const currentUser = webAuthSession.getCurrentUser(req)
    const agents = scanAgentsForWeb({
      projectRoot,
      projectPath,
      userAgentsDir: webUserAgentsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.json(filterBuiltInComponentGroups(agents, currentUser))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/agents/raw', (req, res) => {
  try {
    const currentUser = webAuthSession.getCurrentUser(req)
    assertBuiltInComponentAccess(req.query || {}, currentUser)
    const result = getWebAgentRawContent({
      source: req.query.source,
      agentId: req.query.agentId,
      projectPath: req.query.projectPath || projectRoot,
      userAgentsDir: webUserAgentsDir,
      projectRoot,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 404).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/agents/raw', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    const result = createWebAgentRaw({
      source: req.body?.source,
      agentId: req.body?.agentId,
      rawContent: req.body?.rawContent,
      projectPath: req.body?.projectPath || projectRoot,
      userAgentsDir: webUserAgentsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.put('/api/agents/raw', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const result = updateWebAgentRaw({
      source: req.body?.source,
      agentId: req.body?.agentId,
      rawContent: req.body?.rawContent,
      projectPath: req.body?.projectPath || projectRoot,
      userAgentsDir: webUserAgentsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.patch('/api/agents/visibility', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    const result = updateWebAgentVisibility({
      agentId: req.body?.agentId,
      visibility: req.body?.visibility,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : (result.code === 'AUTH_FORBIDDEN' ? 403 : 400)).json(result)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.patch('/api/agents/disabled', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    const result = toggleWebAgentDisabled({
      source: req.body?.source || 'user',
      agentId: req.body?.agentId,
      disabled: !!req.body?.disabled,
      projectPath: req.body?.projectPath || projectRoot,
      userAgentsDir: webUserAgentsDir,
      projectRoot,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : (result.code === 'AUTH_FORBIDDEN' ? 403 : 400)).json(result)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

app.post('/api/agents/delete', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const result = deleteWebAgent({
      source: req.body?.source,
      agentId: req.body?.agentId,
      projectPath: req.body?.projectPath || projectRoot,
      userAgentsDir: webUserAgentsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/agents/rename', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const result = renameWebAgent({
      source: req.body?.source,
      oldAgentId: req.body?.oldAgentId,
      newAgentId: req.body?.newAgentId,
      projectPath: req.body?.projectPath || projectRoot,
      userAgentsDir: webUserAgentsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/agents/copy', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const result = copyWebAgent({
      fromSource: req.body?.fromSource,
      agentId: req.body?.agentId,
      toSource: req.body?.toSource,
      newAgentId: req.body?.newAgentId,
      projectPath: req.body?.projectPath || projectRoot,
      userAgentsDir: webUserAgentsDir,
      projectRoot,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/agents/import/validate', (req, res) => {
  let validation
  try {
    validation = validateWebAgentImportPayload(req.body?.source)
    res.json(cleanImportResult(validation))
  } catch (err) {
    res.status(400).json({ valid: false, errors: [err.message], agents: [] })
  } finally {
    if (validation?._tempDir && fs.existsSync(validation._tempDir)) {
      fs.rmSync(validation._tempDir, { recursive: true, force: true })
    }
  }
})

app.post('/api/agents/import', (req, res) => {
  try {
    const currentUser = requireWebUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const result = importWebAgents({
      source: req.body?.source,
      targetSource: req.body?.targetSource,
      projectPath: req.body?.projectPath || projectRoot,
      selectedAgentIds: req.body?.selectedAgentIds,
      userAgentsDir: webUserAgentsDir,
      metadataStore: componentMetadataStore,
      currentUser
    })
    res.status(result.success ? 200 : 400).json(result)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, errors: [err.message] })
  }
})

app.post('/api/agents/export', (req, res) => {
  try {
    const currentUser = webAuthSession.getCurrentUser(req)
    assertBuiltInComponentAccess(req.body || {}, currentUser)
    const exportResult = exportWebAgents({
      source: req.body?.source,
      scope: req.body?.scope,
      agentId: req.body?.agentId,
      agentIds: req.body?.agentIds,
      projectPath: req.body?.projectPath || projectRoot,
      userAgentsDir: webUserAgentsDir,
      projectRoot
    })

    if (!exportResult.success) {
      res.status(400).json({ success: false, error: exportResult.error })
      return
    }

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', buildAttachmentContentDisposition(exportResult.filename))
    res.setHeader('Content-Length', exportResult.buffer.length)
    res.setHeader('X-Agent-Count', String(exportResult.count || 0))
    res.send(exportResult.buffer)
  } catch (err) {
    if (err?.code === 'AUTH_FORBIDDEN') {
      return res.status(403).json({ success: false, code: err.code, error: err.message })
    }
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/project-agent-profiles/resolve', (req, res) => {
  sendProjectAgentProfileResult(req, res, manager =>
    manager.resolveCapabilityProjects(req.body?.projectPath)
  )
})

app.post('/api/project-agent-profiles/profile', (req, res) => {
  sendProjectAgentProfileResult(req, res, manager =>
    manager.saveProfile(req.body?.projectPath, req.body?.profile, { setDefault: req.body?.setDefault })
  )
})

app.post('/api/project-agent-profiles/profile/delete', (req, res) => {
  sendProjectAgentProfileResult(req, res, manager =>
    manager.deleteProfile(req.body?.projectPath, req.body?.profileId)
  )
})

app.post('/api/project-agent-profiles/default', (req, res) => {
  sendProjectAgentProfileResult(req, res, manager =>
    manager.setDefault(req.body?.projectPath, req.body?.profileId)
  )
})

app.post('/api/project-agent-profiles/pinned', (req, res) => {
  sendProjectAgentProfileResult(req, res, manager =>
    manager.togglePinned(req.body?.projectPath, req.body?.type, req.body?.id, req.body?.pinned)
  )
})

app.post('/api/project-agent-profiles/capability-project', (req, res) => {
  sendProjectAgentProfileResult(req, res, manager =>
    manager.saveCapabilityProject(req.body?.project, { select: req.body?.select })
  )
})

app.post('/api/project-agent-profiles/capability-project/delete', (req, res) => {
  sendProjectAgentProfileResult(req, res, manager =>
    manager.deleteCapabilityProject(req.body?.projectId)
  )
})

app.post('/api/project-agent-profiles/capability-project/select', (req, res) => {
  sendProjectAgentProfileResult(req, res, manager =>
    manager.selectCapabilityProject(req.body?.projectId, req.body?.projectPath)
  )
})

// Serve static files from session output dirs
app.use('/api/agent/sessions/:id/static', (req, res, next) => {
  try {
    const sessionId = req.params.id
    assertWebConversationAccess(sessionId, requireWebUser(req))
    const filePath = decodeURIComponent(req.path.slice(1))
    const cwd = agentSessionManager.getOutputDir(sessionId)
    if (!cwd) return res.status(404).json({ error: 'Session not found' })
    const fullPath = path.resolve(cwd, filePath)
    if (!fullPath.startsWith(cwd)) {
      return res.status(403).json({ error: 'Access denied' })
    }
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' })
    }
    res.sendFile(fullPath)
  } catch (err) {
    sendWebAuthError(res, err)
  }
})

// ============================================================
// 6. Socket.io handlers (real-time streaming)
// ============================================================

io.on('connection', (socket) => {
  console.log('[Socket] Client connected:', socket.id)
  ioSockets.add(socket)
  const requireSocketUser = () => requireWebUser(socket.request)
  const assertSocketConversationAccess = (sessionId) => assertWebConversationAccess(sessionId, requireSocketUser())

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id)
    ioSockets.delete(socket)
  })

  // --- Agent streaming events ---

  socket.on('agent:sendMessage', async ({ sessionId, message, model, providerId }, callback) => {
    try {
      const currentUser = assertSocketConversationAccess(sessionId)
      if (typeof callback === 'function') callback({ success: true })
      setImmediate(() => {
        agentSessionManager.sendMessage(sessionId, message, { model, providerId, currentUser }).catch(err => {
          console.error('[Socket] agent:sendMessage async error:', err)
          socket.emit('agent:error', { sessionId, error: err.message || 'Unknown error' })
          socket.emit('agent:statusChange', { sessionId, status: 'idle' })
        })
      })
    } catch (err) {
      console.error('[Socket] agent:sendMessage error:', err)
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:cancel', async (sessionId, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      await agentSessionManager.cancel(sessionId)
      if (typeof callback === 'function') callback({ success: true })
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:close', async (sessionId, callback) => {
    try {
      const currentUser = assertSocketConversationAccess(sessionId)
      await agentSessionManager.close(sessionId, { currentUser })
      if (typeof callback === 'function') callback({ success: true })
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:reopen', async (sessionId, callback) => {
    try {
      const currentUser = requireSocketUser()
      const result = agentSessionManager.reopen(sessionId, { currentUser })
      if (typeof callback === 'function') callback(result)
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:switchApiProfile', async ({ sessionId, profileId }, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      await agentSessionManager.switchApiProfile(sessionId, profileId)
      if (typeof callback === 'function') callback({ success: true })
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:clearAndRecreate', async ({ sessionId, overrides }, callback) => {
    try {
      const currentUser = assertSocketConversationAccess(sessionId)
      const newSession = await agentSessionManager.clearAndRecreate(sessionId, overrides || {}, { currentUser })
      if (typeof callback === 'function') callback({ success: true, session: newSession })
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:compact', async (sessionId, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      agentSessionManager.compactConversation(sessionId).catch(err => {
        socket.emit('agent:error', { sessionId, error: err.message || 'Compact failed' })
        socket.emit('agent:statusChange', { sessionId, status: 'idle' })
      })
      if (typeof callback === 'function') callback({ success: true })
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:respondInteraction', async ({ sessionId, interactionId, answers, questions, annotations, updatedInput, updatedPermissions, decisionClassification, behavior }, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      const result = agentSessionManager.resolveInteraction(sessionId, interactionId, {
        answers, questions, annotations, updatedInput, updatedPermissions, decisionClassification, behavior
      })
      if (typeof callback === 'function') callback(result)
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:cancelInteraction', async ({ sessionId, interactionId, reason }, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      const result = agentSessionManager.cancelInteraction(sessionId, interactionId, reason)
      if (typeof callback === 'function') callback(result)
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:setModel', async ({ sessionId, model, providerId }, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      const result = await agentSessionManager.setModel(sessionId, model, providerId)
      if (typeof callback === 'function') callback(result && typeof result === 'object' ? result : { success: true })
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:getSupportedModels', async (sessionId, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      const result = await agentSessionManager.getSupportedModels(sessionId)
      if (typeof callback === 'function') callback(result)
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:getSupportedCommands', async (sessionId, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      const result = await agentSessionManager.getSupportedCommands(sessionId)
      if (typeof callback === 'function') callback(result)
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:getAccountInfo', async (sessionId, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      const result = await agentSessionManager.getAccountInfo(sessionId)
      if (typeof callback === 'function') callback(result)
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:getMcpServerStatus', async (sessionId, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      const result = await agentSessionManager.getMcpServerStatus(sessionId)
      if (typeof callback === 'function') callback(result)
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:getInitResult', async (sessionId, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      const result = await agentSessionManager.getInitResult(sessionId)
      if (typeof callback === 'function') callback(result)
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })

  socket.on('agent:toggleMcp', async ({ sessionId, name, enabled }, callback) => {
    try {
      assertSocketConversationAccess(sessionId)
      const result = await agentSessionManager.toggleMcp(sessionId, name, enabled)
      if (typeof callback === 'function') callback(result)
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message })
    }
  })
})

// ============================================================
// 7. Start server
// ============================================================
httpServer.listen(PORT, () => {
  console.log(`[Server] Jedi Web Server running on http://localhost:${PORT}`)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Server] Shutting down...')
  try {
    dingtalkBridge.stop()
    feishuBridge.stop()
    weixinBridge.stop()
    weixinNotifyService.stop()
    await agentSessionManager.closeAll()
    sessionDatabase.close()
  } catch (e) {
    // ignore
  }
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...')
  try {
    dingtalkBridge.stop()
    feishuBridge.stop()
    weixinBridge.stop()
    weixinNotifyService.stop()
    await agentSessionManager.closeAll()
    sessionDatabase.close()
  } catch (e) {
    // ignore
  }
  process.exit(0)
})
