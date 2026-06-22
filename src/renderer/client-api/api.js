/**
 * Web API Client
 * Replaces window.electronAPI for the web version.
 * Uses HTTP API + Socket.io for real-time streaming.
 */

import { io } from 'socket.io-client'

const DEFAULT_API_ORIGIN = typeof window !== 'undefined' && window.location?.origin
  ? window.location.origin
  : 'http://localhost:3456'
const API_BASE = import.meta.env.VITE_API_BASE || DEFAULT_API_ORIGIN
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || DEFAULT_API_ORIGIN

let socket = null
let socketReady = false
const eventListeners = new Map()

// ===================== Socket.io =====================

export function ensureSocket() {
  if (socket) return socket

  socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10
  })

  socket.on('connect', () => {
    console.log('[API] Socket connected:', socket.id)
    socketReady = true
  })

  socket.on('disconnect', () => {
    console.log('[API] Socket disconnected')
    socketReady = false
  })

  socket.on('connect_error', (err) => {
    console.error('[API] Socket connection error:', err.message)
    socketReady = false
  })

  // Forward all agent events to registered listeners
  const agentChannels = [
    'agent:init', 'agent:message', 'agent:stream', 'agent:result',
    'agent:error', 'agent:cliError', 'agent:statusChange',
    'agent:toolProgress', 'agent:systemStatus', 'agent:otherMessage',
    'agent:renamed', 'agent:compacted', 'agent:usage',
    'agent:interactionRequest', 'agent:interactionResolved',
    'agent:allSessionsClosed'
  ]

  for (const channel of agentChannels) {
    socket.on(channel, (data) => {
      const listeners = eventListeners.get(channel)
      if (listeners) {
        listeners.forEach(cb => {
          try { cb(data) } catch (e) { console.error(`[API] Listener error on ${channel}:`, e) }
        })
      }
    })
  }

  return socket
}

export function getSocket() {
  return ensureSocket()
}

export function isSocketReady() {
  return socketReady && socket?.connected
}

// Register event listener (returns cleanup function)
export function onEvent(channel, callback) {
  ensureSocket()
  if (!eventListeners.has(channel)) {
    eventListeners.set(channel, new Set())
  }
  eventListeners.get(channel).add(callback)
  return () => {
    eventListeners.get(channel)?.delete(callback)
  }
}

// Emit socket event with callback
export function emitSocket(event, data, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const s = ensureSocket()
    let settled = false
    let timeoutId = null

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      s.off?.('connect', handleConnect)
      s.off?.('connect_error', handleConnectError)
      s.off?.('reconnect_failed', handleReconnectFailed)
    }

    const finishResolve = (result) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const finishReject = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const emit = () => {
      s.emit(event, data, (result) => {
        if (result?.error) {
          finishReject(new Error(result.error))
        } else {
          finishResolve(result)
        }
      })
    }

    const handleConnect = () => emit()
    const handleConnectError = (err) => finishReject(err instanceof Error ? err : new Error(err?.message || 'Socket not connected'))
    const handleReconnectFailed = () => finishReject(new Error(`Socket reconnection exhausted: ${event}`))

    timeoutId = setTimeout(() => finishReject(new Error(`Socket timeout: ${event}`)), timeout)

    if (s.connected) {
      emit()
    } else {
      s.on('connect', handleConnect)
      s.on('connect_error', handleConnectError)
      s.on('reconnect_failed', handleReconnectFailed)
    }
  })
}

// ===================== HTTP API =====================

async function httpRequest(method, path, body) {
  const url = `${API_BASE}${path}`
  const options = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }
  const res = await fetch(url, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function uploadFormData(path, formData, { onProgress, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    xhr.open('POST', `${API_BASE}${path}`, true)
    xhr.withCredentials = true
    xhr.timeout = timeout

    const parseResponse = () => {
      if (xhr.response && typeof xhr.response === 'object') return xhr.response
      try {
        return JSON.parse(xhr.responseText || '{}')
      } catch {
        return {}
      }
    }

    const finish = () => {
      if (settled || xhr.readyState !== XMLHttpRequest.DONE) return
      settled = true
      const response = parseResponse()

      if (xhr.status >= 200 && xhr.status < 300) {
        if (typeof onProgress === 'function') onProgress(100)
        resolve(response)
      } else {
        reject(new Error(response?.error || `HTTP ${xhr.status}`))
      }
    }

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') return
      onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))))
    }

    xhr.onreadystatechange = finish
    xhr.onload = finish
    xhr.onloadend = finish
    xhr.onerror = () => reject(new Error('Upload request failed'))
    xhr.ontimeout = () => reject(new Error('Upload request timed out'))
    xhr.onabort = () => reject(new Error('Upload request aborted'))
    xhr.send(formData)
  })
}

export const api = {
  get: (path) => httpRequest('GET', path),
  post: (path, body) => httpRequest('POST', path, body),
  put: (path, body) => httpRequest('PUT', path, body),
  patch: (path, body) => httpRequest('PATCH', path, body),
  delete: (path) => httpRequest('DELETE', path)
}

// ===================== Config =====================

export async function getConfig() {
  return api.get('/api/config')
}

export async function saveConfig(config) {
  return api.post('/api/config', config)
}

export async function updateSettings(settings) {
  return api.patch('/api/settings', settings)
}

// ===================== IM Bridge =====================

export async function getDingTalkStatus() {
  return api.get('/api/dingtalk/status')
}

export async function startDingTalk() {
  return api.post('/api/dingtalk/start')
}

export async function stopDingTalk() {
  return api.post('/api/dingtalk/stop')
}

export async function restartDingTalk() {
  return api.post('/api/dingtalk/restart')
}

export async function updateDingTalkConfig(config) {
  return api.post('/api/dingtalk/config', config)
}

export function onDingTalkStatusChange(callback) {
  return onEvent('dingtalk:statusChange', callback)
}

export function onDingTalkError(callback) {
  return onEvent('dingtalk:error', callback)
}

export function onDingTalkMessageReceived(callback) {
  return onEvent('dingtalk:messageReceived', callback)
}

export function onDingTalkSessionCreated(callback) {
  return onEvent('dingtalk:sessionCreated', callback)
}

export function onDingTalkSessionClosed(callback) {
  return onEvent('dingtalk:sessionClosed', callback)
}

export async function getFeishuStatus() {
  return api.get('/api/feishu/status')
}

export async function startFeishu() {
  return api.post('/api/feishu/start')
}

export async function stopFeishu() {
  return api.post('/api/feishu/stop')
}

export async function restartFeishu() {
  return api.post('/api/feishu/restart')
}

export async function updateFeishuConfig(config) {
  return api.post('/api/feishu/config', config)
}

export function onFeishuStatusChange(callback) {
  return onEvent('feishu:statusChange', callback)
}

export function onFeishuError(callback) {
  return onEvent('feishu:error', callback)
}

export function onFeishuMessageReceived(callback) {
  return onEvent('feishu:messageReceived', callback)
}

export function onFeishuSessionCreated(callback) {
  return onEvent('feishu:sessionCreated', callback)
}

// ===================== Auth =====================

export async function authLogin(payload) {
  return api.post('/api/auth/login', payload)
}

export async function authGetCurrentUser() {
  return api.get('/api/auth/current-user')
}

export async function authLogout() {
  return api.post('/api/auth/logout')
}

// ===================== Projects =====================

export async function listProjects() {
  return api.get('/api/projects')
}

// ===================== Project Library =====================

export async function listProjectMasterRecords({ all = false } = {}) {
  return api.get(`/api/project-master-records${all ? '?all=1' : ''}`)
}

export async function createProjectMasterRecord(payload) {
  return api.post('/api/project-master-records', payload)
}

export async function updateProjectMasterRecord({ id, updates }) {
  return api.patch(`/api/project-master-records/${encodeURIComponent(id)}`, updates)
}

export async function deleteProjectMasterRecord(id) {
  return api.delete(`/api/project-master-records/${encodeURIComponent(id)}`)
}

export async function listProjectLibraryWorkspaces() {
  return api.get('/api/project-library/workspaces')
}

export async function createProjectLibraryWorkspace(payload) {
  return api.post('/api/project-library/workspaces', payload)
}

export async function getProjectLibraryWorkspace(id) {
  return api.get(`/api/project-library/workspaces/${encodeURIComponent(id)}`)
}

export async function deleteProjectLibraryWorkspace(id) {
  return api.delete(`/api/project-library/workspaces/${encodeURIComponent(id)}`)
}

export async function createProjectLibraryItem({ workspaceId, ...payload }) {
  return api.post(`/api/project-library/workspaces/${encodeURIComponent(workspaceId)}/items`, payload)
}

export async function uploadProjectLibraryFile({ workspaceId, parentId = null, file }) {
  if (!workspaceId) throw new Error('Missing workspaceId')
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('Invalid upload file')
  }

  const contentBase64 = await readFileAsBase64Payload(file)
  return api.post(`/api/project-library/workspaces/${encodeURIComponent(workspaceId)}/uploads`, {
    parentId,
    name: file.name || 'upload',
    mimeType: file.type || '',
    sizeBytes: Number.isFinite(file.size) ? file.size : 0,
    contentBase64
  })
}

export async function updateProjectLibraryItem({ id, updates }) {
  return api.patch(`/api/project-library/items/${encodeURIComponent(id)}`, updates)
}

export async function deleteProjectLibraryItem(id) {
  return api.delete(`/api/project-library/items/${encodeURIComponent(id)}`)
}

export async function bindProjectLibraryAgentSession({ workspaceId, sessionId }) {
  return api.post(`/api/project-library/workspaces/${encodeURIComponent(workspaceId)}/agent-session`, { sessionId })
}

export async function bindProjectLibraryItemAgentSession({ itemId, sessionId }) {
  return api.post(`/api/project-library/items/${encodeURIComponent(itemId)}/agent-session`, { sessionId })
}

// ===================== API Profiles =====================

export async function listAPIProfiles() {
  return api.get('/api/profiles')
}

export async function getAPIProfile(profileId) {
  return api.get(`/api/profiles/${profileId}`)
}

export async function addAPIProfile(profileData) {
  return api.post('/api/profiles', profileData)
}

export async function updateAPIProfile(profileId, updates) {
  return api.patch(`/api/profiles/${profileId}`, updates)
}

export async function deleteAPIProfile(profileId) {
  return api.delete(`/api/profiles/${profileId}`)
}

// ===================== Providers =====================

export async function listProviders() {
  return api.get('/api/providers')
}

export async function addProvider(definition) {
  return api.post('/api/providers', definition)
}

export async function updateProvider({ id, updates }) {
  return api.patch(`/api/providers/${id}`, updates)
}

export async function deleteProvider(id) {
  return api.delete(`/api/providers/${id}`)
}

// ===================== Connection Test =====================

export async function testConnection(apiConfig) {
  return api.post('/api/test-connection', apiConfig)
}

// ===================== Agent Sessions (HTTP) =====================

export async function createAgentSession(options) {
  return api.post('/api/agent/sessions', options)
}

export async function listAgentSessions() {
  return api.get('/api/agent/sessions')
}

export async function getAgentSession(sessionId) {
  return api.get(`/api/agent/sessions/${sessionId}`)
}

export async function getAgentMessages(sessionId) {
  return api.get(`/api/agent/sessions/${sessionId}/messages`)
}

export async function renameAgentSession({ sessionId, title }) {
  return api.patch(`/api/agent/sessions/${sessionId}/title`, { title })
}

export async function deleteAgentConversation(sessionId) {
  return api.delete(`/api/agent/sessions/${sessionId}`)
}

async function readFileAsBase64Payload(file) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export async function uploadAgentAttachment({ sessionId, cwd, file, onProgress } = {}) {
  if (!file) {
    throw new Error('Invalid upload file')
  }

  const formData = new FormData()
  formData.append('file', file, file.name || 'upload')
  formData.append('name', file.name || 'upload')
  formData.append('mimeType', file.type || '')
  formData.append('sizeBytes', String(Number.isFinite(file.size) ? file.size : 0))

  if (!sessionId) {
    formData.append('cwd', typeof cwd === 'string' ? cwd : '')
    return uploadFormData('/api/agent/uploads', formData, { onProgress })
  }

  return uploadFormData(`/api/agent/sessions/${encodeURIComponent(sessionId)}/uploads`, formData, { onProgress })
}

export async function createAgentConversationComponent(params) {
  return api.post('/api/agent/components', params)
}

// ===================== Agent Streaming (Socket.io) =====================

export async function sendAgentMessage({ sessionId, message, model, providerId }) {
  return emitSocket('agent:sendMessage', { sessionId, message, model, providerId })
}

export async function cancelAgentGeneration(sessionId) {
  return emitSocket('agent:cancel', sessionId)
}

export async function closeAgentSession(sessionId) {
  return emitSocket('agent:close', sessionId)
}

export async function reopenAgentSession(sessionId) {
  return emitSocket('agent:reopen', sessionId)
}

export async function switchAgentApiProfile({ sessionId, profileId }) {
  return emitSocket('agent:switchApiProfile', { sessionId, profileId })
}

export async function clearAndRecreateAgentSession({ sessionId, overrides }) {
  return emitSocket('agent:clearAndRecreate', { sessionId, overrides })
}

export async function compactAgentConversation(sessionId) {
  return emitSocket('agent:compact', sessionId)
}

export async function respondAgentInteraction(params) {
  return emitSocket('agent:respondInteraction', params)
}

export async function cancelAgentInteraction(params) {
  return emitSocket('agent:cancelInteraction', params)
}

export async function setAgentModel(sessionId, model, providerId) {
  return emitSocket('agent:setModel', { sessionId, model, providerId })
}

export async function getAgentSupportedModels(sessionId) {
  return emitSocket('agent:getSupportedModels', sessionId)
}

export async function getAgentSupportedCommands(sessionId) {
  return emitSocket('agent:getSupportedCommands', sessionId)
}

export async function getAgentAccountInfo(sessionId) {
  return emitSocket('agent:getAccountInfo', sessionId)
}

export async function getAgentMcpServerStatus(sessionId) {
  return emitSocket('agent:getMcpServerStatus', sessionId)
}

export async function getAgentInitResult(sessionId) {
  return emitSocket('agent:getInitResult', sessionId)
}

export async function toggleAgentMcp(sessionId, name, enabled) {
  return emitSocket('agent:toggleMcp', { sessionId, name, enabled })
}

// ===================== Agent Event Listeners =====================

export function onAgentInit(callback) {
  return onEvent('agent:init', callback)
}

export function onAgentMessage(callback) {
  return onEvent('agent:message', callback)
}

export function onAgentStream(callback) {
  return onEvent('agent:stream', callback)
}

export function onAgentResult(callback) {
  return onEvent('agent:result', callback)
}

export function onAgentError(callback) {
  return onEvent('agent:error', callback)
}

export function onAgentCliError(callback) {
  return onEvent('agent:cliError', callback)
}

export function onAgentStatusChange(callback) {
  return onEvent('agent:statusChange', callback)
}

export function onAgentToolProgress(callback) {
  return onEvent('agent:toolProgress', callback)
}

export function onAgentSystemStatus(callback) {
  return onEvent('agent:systemStatus', callback)
}

export function onAgentOtherMessage(callback) {
  return onEvent('agent:otherMessage', callback)
}

export function onAgentRenamed(callback) {
  return onEvent('agent:renamed', callback)
}

export function onAgentCompacted(callback) {
  return onEvent('agent:compacted', callback)
}

export function onAgentUsage(callback) {
  return onEvent('agent:usage', callback)
}

export function onAgentInteractionRequest(callback) {
  return onEvent('agent:interactionRequest', callback)
}

export function onAgentInteractionResolved(callback) {
  return onEvent('agent:interactionResolved', callback)
}

export function onAgentAllSessionsClosed(callback) {
  return onEvent('agent:allSessionsClosed', callback)
}

// ===================== Agent File Operations (HTTP) =====================

export async function listAgentDir({ sessionId, relativePath, showHidden }) {
  const query = new URLSearchParams({ relativePath: relativePath || '', showHidden: String(!!showHidden) })
  return api.get(`/api/agent/sessions/${sessionId}/files?${query}`)
}

export async function readAgentFile({ sessionId, relativePath }) {
  const query = new URLSearchParams({ relativePath })
  return api.get(`/api/agent/sessions/${sessionId}/files/content?${query}`)
}

export async function saveAgentFile({ sessionId, relativePath, content }) {
  return api.post(`/api/agent/sessions/${sessionId}/files`, { relativePath, content })
}

export async function createAgentFile({ sessionId, parentPath, name, isDirectory }) {
  return api.post(`/api/agent/sessions/${sessionId}/files`, { parentPath, name, isDirectory })
}

export async function renameAgentFile({ sessionId, oldPath, newName }) {
  return api.patch(`/api/agent/sessions/${sessionId}/files`, { oldPath, newName })
}

export async function deleteAgentFile({ sessionId, path }) {
  return api.delete(`/api/agent/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`)
}

export async function searchAgentFiles({ sessionId, keyword, showHidden }) {
  const query = new URLSearchParams({ keyword, showHidden: String(!!showHidden) })
  return api.get(`/api/agent/sessions/${sessionId}/files/search?${query}`)
}

export async function getAgentOutputDir(sessionId) {
  return api.get(`/api/agent/sessions/${sessionId}/output-dir`)
}

export async function listAgentOutputFiles(sessionId) {
  return api.get(`/api/agent/sessions/${sessionId}/output-files`)
}

export async function readAbsolutePath({ filePath, sessionId, confirmed = false }) {
  const query = new URLSearchParams({
    filePath: filePath || '',
    sessionId: sessionId || '',
    confirmed: String(!!confirmed)
  })
  return api.get(`/api/files/absolute/metadata?${query}`)
}

export async function readReportText({ filePath, sessionId, maxChars } = {}) {
  const query = new URLSearchParams({
    filePath: filePath || '',
    sessionId: sessionId || '',
    maxChars: maxChars ? String(maxChars) : ''
  })
  return api.get(`/api/files/absolute/report-text?${query}`)
}

export async function listWelcomeReports() {
  return api.get('/api/reports/welcome')
}

export async function listGeneratedReports({ mode } = {}) {
  const query = new URLSearchParams()
  if (mode) query.set('mode', mode)
  const suffix = query.toString()
  return api.get(`/api/reports/generated${suffix ? `?${suffix}` : ''}`)
}

export async function hideGeneratedReport({ mode, filePath } = {}) {
  return api.post('/api/reports/generated/hide', { mode, filePath })
}

// ===================== AipinData / Midea Monitor =====================

export async function listMideaYqPushes(options = {}) {
  const query = new URLSearchParams()
  if (options.status) query.set('status', options.status)
  if (options.page) query.set('page', String(options.page))
  if (options.pageSize) query.set('pageSize', String(options.pageSize))
  if (options.limit) query.set('limit', String(options.limit))
  const suffix = query.toString()
  return api.get(`/api/aipin-data/admin/pushes${suffix ? `?${suffix}` : ''}`)
}

export async function listMideaYqItems(options = {}) {
  const query = new URLSearchParams()
  if (options.status) query.set('status', options.status)
  if (options.pushStatus) query.set('pushStatus', options.pushStatus)
  if (options.pushFlag) query.set('pushFlag', options.pushFlag)
  if (options.publishStart) query.set('publishStart', options.publishStart)
  if (options.publishEnd) query.set('publishEnd', options.publishEnd)
  if (options.page) query.set('page', String(options.page))
  if (options.pageSize) query.set('pageSize', String(options.pageSize))
  const suffix = query.toString()
  return api.get(`/api/aipin-data/admin/items${suffix ? `?${suffix}` : ''}`)
}

export async function getMideaYqPushDetail(requestId) {
  return api.get(`/api/aipin-data/admin/pushes/${encodeURIComponent(requestId)}`)
}

export async function getMideaYqItemDetail(itemId) {
  return api.get(`/api/aipin-data/admin/items/${encodeURIComponent(itemId)}`)
}

export async function retryMideaYqTask(taskId) {
  return api.post(`/api/aipin-data/admin/tasks/${encodeURIComponent(taskId)}/retry`, {})
}

export async function processMideaYqTask(taskId) {
  return api.post(`/api/aipin-data/admin/tasks/${encodeURIComponent(taskId)}/process`, {})
}

export async function processMideaYqPush(requestId) {
  return api.post(`/api/aipin-data/admin/pushes/${encodeURIComponent(requestId)}/process`, {})
}

export async function processMideaYqItem(itemId) {
  return api.post(`/api/aipin-data/admin/items/${encodeURIComponent(itemId)}/process`, {})
}

export async function pushMideaYqItem(itemId) {
  return api.post(`/api/aipin-data/admin/items/${encodeURIComponent(itemId)}/push`, {})
}

// ===================== Weixin Notify =====================

export async function startWeixinNotifyLogin(options = {}) {
  return api.post('/api/weixin-notify/login/start', options)
}

export async function waitWeixinNotifyLogin(options = {}) {
  return api.post('/api/weixin-notify/login/wait', options)
}

export async function listWeixinNotifyAccounts() {
  return api.get('/api/weixin-notify/accounts')
}

export async function listWeixinNotifyTargets() {
  return api.get('/api/weixin-notify/targets')
}

export async function updateWeixinNotifyTarget(payload = {}) {
  return api.patch('/api/weixin-notify/targets', payload)
}

export async function deleteWeixinNotifyTarget(payload = {}) {
  return api.post('/api/weixin-notify/targets/delete', payload)
}

export async function pollWeixinNotifyOnce(options = {}) {
  return api.post('/api/weixin-notify/poll-once', options)
}

export async function sendWeixinNotifyText(payload = {}) {
  return api.post('/api/weixin-notify/send-text', payload)
}

export async function bindSessionToWeixinTarget(payload = {}) {
  return api.post('/api/weixin-notify/session-binding', payload)
}

export async function unbindSessionWeixinTarget(payload = {}) {
  return api.post('/api/weixin-notify/session-binding/delete', payload)
}

export async function getSessionWeixinBinding(sessionId) {
  return api.get(`/api/weixin-notify/session-binding/${encodeURIComponent(sessionId || '')}`)
}

export function onWeixinMessageReceived(callback) {
  return onEvent('weixin:messageReceived', callback)
}

export function onWeixinSessionCreated(callback) {
  return onEvent('weixin:sessionCreated', callback)
}

async function openPathInWeb(filePath) {
  if (!filePath) {
    return { success: false, error: 'Path is required' }
  }

  try {
    return await api.post('/api/system/open-path', { filePath })
  } catch (err) {
    console.warn('[API] openPath failed in web:', err.message || err)
    return { success: false, error: err.message || String(err) }
  }
}

// ===================== Skills =====================

export async function listSkillsAll(projectPath) {
  const query = new URLSearchParams()
  if (projectPath) query.set('projectPath', projectPath)
  const suffix = query.toString()
  return api.get(`/api/skills${suffix ? `?${suffix}` : ''}`)
}

export async function getSkillRawContent(params) {
  const query = new URLSearchParams()
  if (params?.source) query.set('source', params.source)
  if (params?.skillId) query.set('skillId', params.skillId)
  if (params?.projectPath) query.set('projectPath', params.projectPath)
  return api.get(`/api/skills/raw?${query}`)
}

export async function createSkillRaw(params) {
  return api.post('/api/skills/raw', params)
}

export async function updateSkillRaw(params) {
  return api.put('/api/skills/raw', params)
}

export async function updateSkillVisibility(params) {
  return api.patch('/api/skills/visibility', params)
}

export async function toggleSkillDisabled(params) {
  return api.patch('/api/skills/disabled', params)
}

export async function deleteSkill(params) {
  return api.post('/api/skills/delete', params)
}

export async function copySkill(params) {
  return api.post('/api/skills/copy', params)
}

export async function validateSkillImport(source) {
  return api.post('/api/skills/import/validate', { source })
}

export async function importSkills(params) {
  return api.post('/api/skills/import', params)
}

function getDownloadFilename(response, fallback) {
  const disposition = response.headers.get('Content-Disposition') || ''
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/)
  if (utf8Match) return decodeURIComponent(utf8Match[1])

  const asciiMatch = disposition.match(/filename="([^"]+)"/)
  return asciiMatch?.[1] || fallback
}

async function downloadSkillExport(params) {
  const res = await fetch(`${API_BASE}/api/skills/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    return { success: false, error: err.error || `HTTP ${res.status}` }
  }

  const blob = await res.blob()
  const filename = getDownloadFilename(res, 'skills-export.zip')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)

  return {
    success: true,
    path: filename,
    count: Number(res.headers.get('X-Skill-Count') || 0)
  }
}

export async function exportSkill(params) {
  return downloadSkillExport({
    ...params,
    scope: 'single',
    format: 'zip'
  })
}

export async function exportSkillsBatch(params) {
  return downloadSkillExport({
    ...params,
    scope: 'batch',
    format: 'zip'
  })
}

// ===================== Agents =====================

export async function listAgentsAll(projectPath) {
  const query = new URLSearchParams()
  if (projectPath) query.set('projectPath', projectPath)
  const suffix = query.toString()
  return api.get(`/api/agents${suffix ? `?${suffix}` : ''}`)
}

export async function getAgentRawContent(params) {
  const query = new URLSearchParams()
  if (params?.source) query.set('source', params.source)
  if (params?.agentId) query.set('agentId', params.agentId)
  if (params?.projectPath) query.set('projectPath', params.projectPath)
  return api.get(`/api/agents/raw?${query}`)
}

export async function createAgentRaw(params) {
  return api.post('/api/agents/raw', params)
}

export async function updateAgentRaw(params) {
  return api.put('/api/agents/raw', params)
}

export async function updateAgentVisibility(params) {
  return api.patch('/api/agents/visibility', params)
}

export async function toggleAgentDisabled(params) {
  return api.patch('/api/agents/disabled', params)
}

export async function deleteAgent(params) {
  return api.post('/api/agents/delete', params)
}

export async function copyAgent(params) {
  return api.post('/api/agents/copy', params)
}

export async function renameAgent(params) {
  return api.post('/api/agents/rename', params)
}

export async function validateAgentImport(source) {
  return api.post('/api/agents/import/validate', { source })
}

export async function importAgents(params) {
  return api.post('/api/agents/import', params)
}

async function downloadAgentExport(params) {
  const res = await fetch(`${API_BASE}/api/agents/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    return { success: false, error: err.error || `HTTP ${res.status}` }
  }

  const blob = await res.blob()
  const filename = getDownloadFilename(res, 'agents-export.zip')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)

  return {
    success: true,
    path: filename,
    count: Number(res.headers.get('X-Agent-Count') || 0)
  }
}

export async function exportAgent(params) {
  return downloadAgentExport({
    ...params,
    scope: 'single',
    format: 'zip'
  })
}

export async function exportAgentsBatch(params) {
  return downloadAgentExport({
    ...params,
    scope: 'batch',
    format: 'zip'
  })
}

// ===================== Project Agent Profiles =====================

export async function resolveProjectAgentProfiles(projectPath) {
  return api.post('/api/project-agent-profiles/resolve', { projectPath })
}

export async function saveProjectAgentProfile(params) {
  return api.post('/api/project-agent-profiles/profile', params)
}

export async function deleteProjectAgentProfile(params) {
  return api.post('/api/project-agent-profiles/profile/delete', params)
}

export async function setDefaultProjectAgentProfile(params) {
  return api.post('/api/project-agent-profiles/default', params)
}

export async function toggleProjectAgentPinned(params) {
  return api.post('/api/project-agent-profiles/pinned', params)
}

export async function saveCapabilityProject(params) {
  return api.post('/api/project-agent-profiles/capability-project', params)
}

export async function deleteCapabilityProject(params) {
  return api.post('/api/project-agent-profiles/capability-project/delete', params)
}

export async function selectCapabilityProject(params) {
  return api.post('/api/project-agent-profiles/capability-project/select', params)
}

// ===================== Mock/Unimplemented =====================

// These are no-ops or mocks for features not needed in web version
export const shell = {
  openExternal: (url) => { window.open(url, '_blank'); return Promise.resolve({ success: true }) },
  openPath: openPathInWeb
}

export const dialog = {
  selectFolder: () => { console.warn('[API] selectFolder not available in web'); return Promise.resolve(null) },
  selectDirectory: () => { console.warn('[API] selectDirectory not available in web'); return Promise.resolve(null) },
  selectFile: () => { console.warn('[API] selectFile not available in web'); return Promise.resolve(null) },
  selectFiles: () => { console.warn('[API] selectFiles not available in web'); return Promise.resolve(null) },
  saveFile: () => { console.warn('[API] saveFile not available in web'); return Promise.resolve({ success: false }) },
  saveImage: () => { console.warn('[API] saveImage not available in web'); return Promise.resolve({ success: false }) }
}

export const notification = {
  show: ({ title, body }) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
    return Promise.resolve({ success: true })
  }
}

// ===================== Window (no-op in web) =====================

export const windowAPI = {
  openProfileManager: () => console.warn('[API] openProfileManager not available in web'),
  openGlobalSettings: () => console.warn('[API] openGlobalSettings not available in web'),
  openAppearanceSettings: () => console.warn('[API] openAppearanceSettings not available in web'),
  openSettingsWorkbench: () => console.warn('[API] openSettingsWorkbench not available in web'),
  openProviderManager: () => console.warn('[API] openProviderManager not available in web'),
  openModelSettings: () => console.warn('[API] openModelSettings not available in web'),
  closeWindow: () => console.warn('[API] closeWindow not available in web'),
  focusMainWindow: () => Promise.resolve({ success: true }),
  setMainWindowTitleByMode: () => Promise.resolve({ success: true })
}
