/**
 * Agent IPC 处理器
 * 处理 Agent 模式下的所有 IPC 通信
 *
 * 参照 active-session-handlers.js 的模式
 */

const { shell } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { VIDEO_EXTS, VIDEO_MIME_MAP, MAX_VIDEO_SIZE, MAX_IMG_SIZE } = require('../utils/agent-constants')
const { extractPdfText } = require('../utils/pdf-text-extractor')
const { saveAgentUploadFromPayload, saveAgentUploadFromPath } = require('../../../server/agent-upload-utils')

const MAX_TEXT_PREVIEW_SIZE = 1024 * 1024

function setupAgentHandlers(ipcMain, agentSessionManager, authManager) {
  if (!agentSessionManager) {
    console.warn('[IPC] AgentSessionManager not available, skipping agent handlers')
    return
  }

  const authErrorResponse = (err) => {
    if (err?.code === 'AUTH_FORBIDDEN') return { error: 'Access denied', code: 'AUTH_FORBIDDEN' }
    if (err?.code === 'AUTH_REQUIRED') return { error: '请先登录', code: 'AUTH_REQUIRED' }
    if (String(err?.message || '').includes('无权访问该会话')) return { error: '无权访问该会话', code: 'AUTH_FORBIDDEN' }
    return { error: err?.message || 'Unknown error' }
  }

  const requireAuth = () => {
    if (!authManager?.requireCurrentUser) {
      const error = new Error('请先登录')
      error.code = 'AUTH_REQUIRED'
      throw error
    }
    return authManager.requireCurrentUser()
  }

  const requireSessionAccess = (sessionId) => {
    const currentUser = requireAuth()
    if (authManager?.canAccessConversation && !authManager.canAccessConversation(sessionId, currentUser)) {
      const error = new Error('Access denied')
      error.code = 'AUTH_FORBIDDEN'
      throw error
    }
    return currentUser
  }

  // ========================================
  // Agent 会话生命周期
  // ========================================

  // 创建新会话
  ipcMain.handle('agent:create', async (event, options) => {
    try {
      const currentUser = requireAuth()
      return agentSessionManager.create({ ...(options || {}), ownerUserId: currentUser.id })
    } catch (err) {
      console.error('[IPC] agent:create error:', err)
      return authErrorResponse(err)
    }
  })

  // 发送消息（异步，流式推送结果）
  ipcMain.handle('agent:sendMessage', async (event, { sessionId, message, model, modelTier, maxTurns, providerId }) => {
    try {
      requireSessionAccess(sessionId)
      // 不等待完成，让流式消息通过 IPC 事件推送
      agentSessionManager.sendMessage(sessionId, message, { model: model || modelTier, maxTurns, providerId }).catch(err => {
        console.error('[IPC] agent:sendMessage async error:', err)
        // 推送错误到前端，使用 _safeSend 防止窗口已销毁时报错
        agentSessionManager._safeSend('agent:error', {
          sessionId,
          error: err.message || 'Unknown error'
        })
        agentSessionManager._safeSend('agent:statusChange', {
          sessionId,
          status: 'idle'
        })
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC] agent:sendMessage error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('agent:uploadAttachment', async (event, { sessionId, cwd, payload } = {}) => {
    try {
      let uploadCwd = ''
      if (sessionId) {
        requireSessionAccess(sessionId)
        let session = agentSessionManager.sessions.get(sessionId)
        if (!session) {
          agentSessionManager.reopen(sessionId)
          session = agentSessionManager.sessions.get(sessionId)
        }
        uploadCwd = session?.cwd || ''
      } else {
        requireAuth()
        uploadCwd = typeof cwd === 'string' ? cwd : ''
      }
      if (!uploadCwd) {
        uploadCwd = path.join(os.tmpdir(), 'jedi-agent-uploads')
      }
      if (fs.existsSync(uploadCwd) && !fs.statSync(uploadCwd).isDirectory()) {
        return { error: 'Upload working directory not found' }
      }

      if (payload?.sourcePath) {
        return await saveAgentUploadFromPath({
          cwd: uploadCwd,
          sourcePath: payload.sourcePath,
          originalName: payload.name,
          mimeType: payload.mimeType || payload.type || '',
          extractContent: false
        })
      }

      return await saveAgentUploadFromPayload({
        cwd: uploadCwd,
        payload,
        extractContent: false
      })
    } catch (err) {
      console.error('[IPC] agent:uploadAttachment error:', err)
      return authErrorResponse(err)
    }
  })

  // 取消生成（使用 interrupt，不杀 CLI 进程）
  ipcMain.handle('agent:cancel', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      await agentSessionManager.cancel(sessionId)
      return { success: true }
    } catch (err) {
      console.error('[IPC] agent:cancel error:', err)
      return authErrorResponse(err)
    }
  })

  // 恢复会话（从 DB 重新加载到内存）
  ipcMain.handle('agent:reopen', async (event, sessionId) => {
    try {
      const currentUser = requireAuth()
      return agentSessionManager.reopen(sessionId, { currentUser })
    } catch (err) {
      console.error('[IPC] agent:reopen error:', err)
      return authErrorResponse(err)
    }
  })

  // 切换 API Profile（终止当前 CLI 进程，下次发消息用新 profile）
  ipcMain.handle('agent:switchApiProfile', async (event, { sessionId, profileId }) => {
    try {
      requireSessionAccess(sessionId)
      await agentSessionManager.switchApiProfile(sessionId, profileId)
      return { success: true }
    } catch (err) {
      console.error('[IPC] agent:switchApiProfile error:', err)
      return authErrorResponse(err)
    }
  })

  // 关闭会话
  ipcMain.handle('agent:close', async (event, sessionId) => {
    try {
      const currentUser = requireAuth()
      await agentSessionManager.close(sessionId, { currentUser })
      return { success: true }
    } catch (err) {
      console.error('[IPC] agent:close error:', err)
      return authErrorResponse(err)
    }
  })

  // 响应宿主交互（AskUserQuestion）
  ipcMain.handle('agent:respondInteraction', async (event, { sessionId, interactionId, answers, questions, annotations, updatedInput, updatedPermissions, decisionClassification, behavior }) => {
    try {
      requireSessionAccess(sessionId)
      return agentSessionManager.resolveInteraction(sessionId, interactionId, {
        answers,
        questions,
        annotations,
        updatedInput,
        updatedPermissions,
        decisionClassification,
        behavior
      })
    } catch (err) {
      console.error('[IPC] agent:respondInteraction error:', err)
      return authErrorResponse(err)
    }
  })

  // 取消宿主交互
  ipcMain.handle('agent:cancelInteraction', async (event, { sessionId, interactionId, reason }) => {
    try {
      requireSessionAccess(sessionId)
      return agentSessionManager.cancelInteraction(sessionId, interactionId, reason)
    } catch (err) {
      console.error('[IPC] agent:cancelInteraction error:', err)
      return authErrorResponse(err)
    }
  })

  // 获取单个会话
  ipcMain.handle('agent:get', async (event, sessionId) => {
    try {
      const currentUser = requireAuth()
      return agentSessionManager.get(sessionId, { currentUser })
    } catch (err) {
      console.error('[IPC] agent:get error:', err)
      return authErrorResponse(err)
    }
  })

  // 获取所有会话列表
  ipcMain.handle('agent:list', async () => {
    try {
      const currentUser = requireAuth()
      return agentSessionManager.list({ currentUser })
    } catch (err) {
      console.error('[IPC] agent:list error:', err)
      return authErrorResponse(err)
    }
  })

  // 重命名会话
  ipcMain.handle('agent:rename', async (event, { sessionId, title }) => {
    try {
      const currentUser = requireAuth()
      return agentSessionManager.rename(sessionId, title, { currentUser })
    } catch (err) {
      console.error('[IPC] agent:rename error:', err)
      return authErrorResponse(err)
    }
  })

  // 获取消息历史
  ipcMain.handle('agent:getMessages', async (event, sessionId) => {
    try {
      const currentUser = requireAuth()
      return agentSessionManager.getMessages(sessionId, { currentUser })
    } catch (err) {
      console.error('[IPC] agent:getMessages error:', err)
      return authErrorResponse(err)
    }
  })

  // 压缩会话上下文
  ipcMain.handle('agent:compact', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      agentSessionManager.compactConversation(sessionId).catch(err => {
        console.error('[IPC] agent:compact async error:', err)
        agentSessionManager._safeSend('agent:error', {
          sessionId,
          error: err.message || 'Compact failed'
        })
        agentSessionManager._safeSend('agent:statusChange', {
          sessionId,
          status: 'idle'
        })
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC] agent:compact error:', err)
      return authErrorResponse(err)
    }
  })

  // 物理删除对话
  ipcMain.handle('agent:deleteConversation', async (event, sessionId) => {
    try {
      const currentUser = requireAuth()
      return agentSessionManager.deleteConversation(sessionId, { currentUser })
    } catch (err) {
      console.error('[IPC] agent:deleteConversation error:', err)
      return authErrorResponse(err)
    }
  })

  // 清空并重建会话（用于 /clear 命令）
  ipcMain.handle('agent:clearAndRecreate', async (event, { sessionId, overrides }) => {
    try {
      const currentUser = requireAuth()
      const newSession = await agentSessionManager.clearAndRecreate(sessionId, overrides || {}, { currentUser })
      return { success: true, session: newSession }
    } catch (err) {
      console.error('[IPC] agent:clearAndRecreate error:', err)
      return authErrorResponse(err)
    }
  })

  // ========================================
  // Streaming Input 控制方法
  // ========================================

  // 切换模型（实时生效）
  ipcMain.handle('agent:setModel', async (event, { sessionId, model, providerId }) => {
    try {
      requireSessionAccess(sessionId)
      const result = await agentSessionManager.setModel(sessionId, model, providerId)
      return result && typeof result === 'object' ? result : { success: true }
    } catch (err) {
      console.error('[IPC] agent:setModel error:', err)
      return authErrorResponse(err)
    }
  })

  // 获取支持的模型列表
  ipcMain.handle('agent:getSupportedModels', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      return await agentSessionManager.getSupportedModels(sessionId)
    } catch (err) {
      console.error('[IPC] agent:getSupportedModels error:', err)
      return authErrorResponse(err)
    }
  })

  // 获取支持的 slash 命令列表
  ipcMain.handle('agent:getSupportedCommands', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      return await agentSessionManager.getSupportedCommands(sessionId)
    } catch (err) {
      console.error('[IPC] agent:getSupportedCommands error:', err)
      return authErrorResponse(err)
    }
  })

  // 获取账户信息
  ipcMain.handle('agent:getAccountInfo', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      return await agentSessionManager.getAccountInfo(sessionId)
    } catch (err) {
      console.error('[IPC] agent:getAccountInfo error:', err)
      return authErrorResponse(err)
    }
  })

  // 获取 MCP 服务器状态
  ipcMain.handle('agent:getMcpServerStatus', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      return await agentSessionManager.getMcpServerStatus(sessionId)
    } catch (err) {
      console.error('[IPC] agent:getMcpServerStatus error:', err)
      return authErrorResponse(err)
    }
  })

  // 获取完整初始化结果
  ipcMain.handle('agent:getInitResult', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      return await agentSessionManager.getInitResult(sessionId)
    } catch (err) {
      const message = String(err?.message || err || '')
      const isExpectedMissingInit = message.includes('No active streaming session') || message.includes('not found')
      if (!isExpectedMissingInit) {
        console.error('[IPC] agent:getInitResult error:', err)
      }
      return authErrorResponse(err)
    }
  })

  // ========================================
  // 成果目录
  // ========================================

  // 获取输出目录路径
  ipcMain.handle('agent:getOutputDir', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      return agentSessionManager.getOutputDir(sessionId)
    } catch (err) {
      return authErrorResponse(err)
    }
  })

  // 打开输出目录
  ipcMain.handle('agent:openOutputDir', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      const dir = agentSessionManager.getOutputDir(sessionId)
      if (dir) {
        await shell.openPath(dir)
        return { success: true }
      }
      return { success: false, error: 'No output directory' }
    } catch (err) {
      return authErrorResponse(err)
    }
  })

  // 列出输出文件
  ipcMain.handle('agent:listOutputFiles', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      return agentSessionManager.listOutputFiles(sessionId)
    } catch (err) {
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('agent:listGeneratedReports', async (event, payload) => {
    try {
      return agentSessionManager.listGeneratedReports(payload || {})
    } catch (err) {
      console.error('[IPC] agent:listGeneratedReports error:', err)
      return authErrorResponse(err)
    }
  })

  ipcMain.handle('agent:hideGeneratedReport', async (event, payload) => {
    try {
      return agentSessionManager.hideGeneratedReport(payload || {})
    } catch (err) {
      console.error('[IPC] agent:hideGeneratedReport error:', err)
      return authErrorResponse(err)
    }
  })

  // ========================================
  // 文件浏览（AgentRightPanel 使用）
  // ========================================

  // 列出目录内容（支持子目录）
  ipcMain.handle('agent:listDir', async (event, { sessionId, relativePath, showHidden }) => {
    try {
      requireSessionAccess(sessionId)
      return agentSessionManager.listDir(sessionId, relativePath || '', !!showHidden)
    } catch (err) {
      console.error('[IPC] agent:listDir error:', err)
      const response = authErrorResponse(err)
      return { entries: [], ...response }
    }
  })

  // 读取文件内容（用于预览）
  ipcMain.handle('agent:readFile', async (event, { sessionId, relativePath }) => {
    try {
      requireSessionAccess(sessionId)
      return agentSessionManager.readFile(sessionId, relativePath)
    } catch (err) {
      console.error('[IPC] agent:readFile error:', err)
      return authErrorResponse(err)
    }
  })

  // 保存文件
  ipcMain.handle('agent:saveFile', async (event, { sessionId, relativePath, content }) => {
    try {
      requireSessionAccess(sessionId)
      return agentSessionManager.saveFile(sessionId, relativePath, content)
    } catch (err) {
      console.error('[IPC] agent:saveFile error:', err)
      return authErrorResponse(err)
    }
  })

  // 用系统默认应用打开文件
  ipcMain.handle('agent:openFile', async (event, { sessionId, relativePath }) => {
    try {
      requireSessionAccess(sessionId)
      const fullPath = agentSessionManager.resolveFilePath(sessionId, relativePath)
      if (!fullPath) return { success: false, error: 'Cannot resolve path' }
      if (!fs.existsSync(fullPath)) return { success: false, error: 'File not found' }
      const result = await shell.openPath(fullPath)
      // shell.openPath 返回空字符串表示成功，否则返回错误信息
      return result ? { success: false, error: result } : { success: true }
    } catch (err) {
      console.error('[IPC] agent:openFile error:', err)
      return { success: false, ...authErrorResponse(err) }
    }
  })

  ipcMain.handle('agent:readReportText', async (event, { filePath, maxChars } = {}) => {
    try {
      return await extractPdfText(filePath, { maxChars })
    } catch (err) {
      console.error('[IPC] agent:readReportText error:', err)
      return { error: err.message || 'Failed to read report text' }
    }
  })

  // 读取任意绝对路径的文件（用于聊天消息中的文件链接预览）
  ipcMain.handle('agent:readAbsolutePath', async (event, { filePath, sessionId, confirmed = false }) => {
    try {
      if (sessionId) requireSessionAccess(sessionId)
      // Windows 上规范化 MSYS/简写盘符路径：/c/foo 或 c/workspace/...、c/users/... → C:/...
      // Node.js 在 Windows 上会把 /c/foo 解析为当前盘符下的 \c\foo，而非 C:\foo
      if (process.platform === 'win32') {
        const msys = filePath.match(/^\/([a-zA-Z])\/(.*)/)
        if (msys) {
          filePath = msys[1].toUpperCase() + ':/' + msys[2]
        } else {
          const driveWithoutColon = filePath.match(/^([a-zA-Z])[\\/](.*)/)
          if (driveWithoutColon) {
            const drive = driveWithoutColon[1].toUpperCase()
            const rest = driveWithoutColon[2] || ''
            // 仅把常见误输出的 c/workspace... 或 c/users... 视为盘符路径，避免误伤普通相对路径
            if (/^(workspace|users)([\\/]|$)/i.test(rest) && fs.existsSync(`${drive}:/`)) {
              filePath = `${drive}:/${rest.replace(/\\/g, '/')}`
            }
          }
        }
      }

      // 相对路径 / ~ 路径：基于会话 cwd 解析为绝对路径
      if (!path.isAbsolute(filePath)) {
        if (filePath.startsWith('~/') || filePath === '~') {
          filePath = path.join(require('os').homedir(), filePath.slice(2))
        } else if (sessionId) {
          const cwd = agentSessionManager.fileManager._resolveCwd(sessionId)
          if (cwd) {
            filePath = path.resolve(cwd, filePath)
          } else {
            return { error: 'Cannot resolve relative path: no working directory' }
          }
        } else {
          return { error: 'Cannot resolve relative path: no session context' }
        }
      }

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        return { error: 'File not found' }
      }

      // 安全检查：检查是否在 cwd 内（方案 C：用户确认）
      if (sessionId && !confirmed) {
        const cwd = agentSessionManager.fileManager._resolveCwd(sessionId)
        if (cwd) {
          // 规范化路径（解析符号链接，防止绕过）
          const realFilePath = fs.realpathSync(filePath)
          const realCwd = fs.realpathSync(cwd)

          // 检查文件是否在 cwd 内
          const relativePath = path.relative(realCwd, realFilePath)
          const isOutsideCwd = relativePath.startsWith('..') || path.isAbsolute(relativePath)

          if (isOutsideCwd) {
            // 文件在 cwd 外，需要用户确认
            return {
              requiresConfirmation: true,
              filePath: realFilePath,
              cwd: realCwd,
              message: `文件位于工作目录之外。是否允许访问？\n\n文件: ${realFilePath}\n工作目录: ${realCwd}`
            }
          }
        }
      }

      const stats = fs.statSync(filePath)
      const name = path.basename(filePath)

      // 如果是目录，返回目录信息
      if (stats.isDirectory()) {
        return {
          type: 'directory',
          name,
          path: filePath
        }
      }

      const ext = path.extname(filePath).toLowerCase()

      // 视频文件（独立大小限制，避免被通用 10MB 拦截）
      if (VIDEO_EXTS.has(ext)) {
        if (stats.size > MAX_VIDEO_SIZE) {
          return { error: `Video too large (max ${MAX_VIDEO_SIZE / 1024 / 1024}MB)` }
        }
        const buffer = fs.readFileSync(filePath)
        return {
          type: 'video',
          name,
          content: `data:${VIDEO_MIME_MAP[ext] || 'video/mp4'};base64,${buffer.toString('base64')}`,
          size: stats.size,
          ext,
          filePath
        }
      }

      // 文件大小限制（与 agent-file-manager 保持一致：图片 20MB，视频已在上面处理）
      if (stats.size > MAX_IMG_SIZE) {
        return { error: `File too large (max ${MAX_IMG_SIZE / 1024 / 1024}MB)` }
      }

      // 图片文件
      if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) {
        const buffer = fs.readFileSync(filePath)
        const base64 = buffer.toString('base64')
        const mimeTypes = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.bmp': 'image/bmp',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml'
        }
        return {
          type: 'image',
          name,
          content: `data:${mimeTypes[ext] || 'image/png'};base64,${base64}`,
          size: stats.size,
          ext,
          filePath
        }
      }

      // HTML 文件（交给右侧 webview 预览）
      if (['.html', '.htm'].includes(ext)) {
        return {
          type: 'html',
          name,
          filePath,
          ext,
          size: stats.size
        }
      }

      // PDF 文件（交给右侧 webview 渲染）
      if (ext === '.pdf') {
        return {
          type: 'pdf',
          name,
          filePath,
          ext,
          size: stats.size
        }
      }

      // 文本文件
      if (stats.size > MAX_TEXT_PREVIEW_SIZE) {
        return { error: `File too large to preview as text (max ${MAX_TEXT_PREVIEW_SIZE / 1024 / 1024}MB)` }
      }

      const content = fs.readFileSync(filePath, 'utf-8')
      return {
        type: 'text',
        name,
        content,
        size: stats.size,
        ext,
        filePath
      }
    } catch (err) {
      console.error('[IPC] agent:readAbsolutePath error:', err)
      return authErrorResponse(err)
    }
  })

  // ========================================
  // 队列持久化
  // ========================================

  // 保存队列消息
  ipcMain.handle('agent:saveQueue', async (event, { sessionId, queue }) => {
    try {
      requireSessionAccess(sessionId)
      agentSessionManager.sessionDatabase.saveAgentQueue(sessionId, queue)
      return { success: true }
    } catch (err) {
      console.error('[IPC] agent:saveQueue error:', err)
      return { success: false, ...authErrorResponse(err) }
    }
  })

  // 读取队列消息
  ipcMain.handle('agent:getQueue', async (event, sessionId) => {
    try {
      requireSessionAccess(sessionId)
      const queue = agentSessionManager.sessionDatabase.getAgentQueue(sessionId)
      return { success: true, queue }
    } catch (err) {
      console.error('[IPC] agent:getQueue error:', err)
      return { success: false, ...authErrorResponse(err), queue: [] }
    }
  })

  // 搜索文件
  ipcMain.handle('agent:searchFiles', async (event, { sessionId, keyword, showHidden }) => {
    try {
      requireSessionAccess(sessionId)
      return await agentSessionManager.searchFiles(sessionId, keyword, !!showHidden)
    } catch (err) {
      console.error('[IPC] agent:searchFiles error:', err)
      return { results: [], ...authErrorResponse(err) }
    }
  })

  // ========================================
  // 文件操作
  // ========================================

  // 创建文件或文件夹
  ipcMain.handle('agent:createFile', async (event, { sessionId, parentPath, name, isDirectory }) => {
    try {
      requireSessionAccess(sessionId)
      return await agentSessionManager.createFile(sessionId, parentPath, name, isDirectory)
    } catch (err) {
      console.error('[IPC] agent:createFile error:', err)
      return authErrorResponse(err)
    }
  })

  // 重命名文件或文件夹
  ipcMain.handle('agent:renameFile', async (event, { sessionId, oldPath, newName }) => {
    try {
      requireSessionAccess(sessionId)
      return await agentSessionManager.renameFile(sessionId, oldPath, newName)
    } catch (err) {
      console.error('[IPC] agent:renameFile error:', err)
      return authErrorResponse(err)
    }
  })

  // 删除文件或文件夹
  ipcMain.handle('agent:deleteFile', async (event, { sessionId, path }) => {
    try {
      requireSessionAccess(sessionId)
      return await agentSessionManager.deleteFile(sessionId, path)
    } catch (err) {
      console.error('[IPC] agent:deleteFile error:', err)
      return authErrorResponse(err)
    }
  })

  // 通过绝对路径保存文件（用于 cwd 外的文件预览编辑保存）
  ipcMain.handle('agent:saveAbsoluteFile', async (event, { filePath, content }) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { error: 'Invalid file path' }
      }

      // 必须是绝对路径
      if (!path.isAbsolute(filePath)) {
        return { error: 'Path must be absolute' }
      }

      // 用 resolve 规范化路径（跨平台，自动处理正反斜杠、. 和 ..）
      const resolved = path.resolve(filePath)

      // 文件必须已存在（只允许编辑，不允许在任意目录创建新文件）
      if (!fs.existsSync(resolved)) {
        return { error: 'File not found' }
      }

      // 解析符号链接，防止绕过目录检查
      const realPath = fs.realpathSync(resolved)
      const fwdPath = realPath.replace(/\\/g, '/')

      // 不允许写入系统关键目录（含 macOS /private/etc 等符号链接目标）
      const blocked = [
        /^\/etc\//i,           // Linux /etc
        /^\/bin\//i,           // Linux /bin
        /^\/sbin\//i,          // Linux /sbin
        /^\/usr\/bin\//i,      // Linux /usr/bin
        /^\/System\//i,        // macOS /System
        /^\/private\/etc\//i,  // macOS /etc 真实路径
        /^\/private\/var\//i,  // macOS /var 真实路径
        /^[A-Z]:\/Windows\//i,
        /^[A-Z]:\/System32\//i
      ]
      if (blocked.some(re => re.test(fwdPath))) {
        return { error: 'Cannot write to system directories' }
      }

      fs.writeFileSync(realPath, content, 'utf-8')
      return { success: true }
    } catch (err) {
      console.error('[IPC] agent:saveAbsoluteFile error:', err)
      return { error: err.message }
    }
  })

  console.log('[IPC] Agent handlers registered')
}

module.exports = { setupAgentHandlers }
