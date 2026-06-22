import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('agent attachment processing handoff', () => {
  it('preserves uploaded file references in outgoing messages', () => {
    const source = readFileSync(join(root, 'src/renderer/composables/useAgentChat.js'), 'utf8')

    expect(source).toContain('filePath: typeof file.filePath === \'string\' ? file.filePath : \'\'')
    expect(source).toContain('relativePath: typeof file.relativePath === \'string\' ? file.relativePath : \'\'')
    expect(source).toContain('.filter(file => file.name && (file.content || file.contentBase64 || file.filePath || file.relativePath))')
  })

  it('resolves and parses file references inside the agent session layer', () => {
    const source = readFileSync(join(root, 'src/main/agent-session-manager.js'), 'utf8')

    expect(source).toContain('extractUploadedAttachmentText')
    expect(source).toContain('async _resolveUserAttachmentContent(session, file)')
    expect(source).toContain('Buffer.from(file.contentBase64, \'base64\')')
    expect(source).toContain('resolved && fs.existsSync(resolved)')
    expect(source).toContain('await this._resolveUserAttachmentContent(session, file)')
  })

  it('web upload endpoint saves attachments before agent parsing', () => {
    const source = readFileSync(join(root, 'server/index.js'), 'utf8')

    expect(source).toContain('extractContent: false')
  })

  it('web upload helper posts to the local server before a session exists', () => {
    const source = readFileSync(join(root, 'src/renderer/client-api/api.js'), 'utf8')
    const uploadAgentAttachmentSource = source.slice(source.indexOf('export async function uploadAgentAttachment'))

    expect(source).not.toContain('throw new Error(\'Missing sessionId\')')
    expect(uploadAgentAttachmentSource).toContain("uploadFormData('/api/agent/uploads'")
    expect(uploadAgentAttachmentSource).toContain("formData.append('cwd', typeof cwd === 'string' ? cwd : '')")
    expect(uploadAgentAttachmentSource).toContain("formData.append('file', file")
    expect(source).toContain('xhr.upload.onprogress')
    expect(source).toContain('xhr.onreadystatechange = finish')
    expect(source).toContain('xhr.onloadend = finish')
    expect(source).toContain('JSON.parse(xhr.responseText || \'{}\')')
    expect(source).not.toContain("xhr.responseType = 'json'")
    expect(uploadAgentAttachmentSource).not.toContain('const contentBase64 = await readFileAsBase64Payload(file)')
  })

  it('web server accepts pre-session uploads and saves them before agent parsing', () => {
    const source = readFileSync(join(root, 'server/index.js'), 'utf8')

    expect(source).toContain("app.post('/api/agent/uploads'")
    expect(source).toContain('readMultipartUpload(req)')
    expect(source).toContain('const requestedCwd = typeof body?.cwd === \'string\' ? body.cwd.trim() : \'\'')
    expect(source).toContain('const uploadCwd = requestedCwd || projectRoot')
    expect(source).toContain('saveAgentUploadFromPayload')
    expect(source).toContain('saveAgentUploadFromBuffer')
    expect(source).toContain('extractContent: false')
  })

  it('lets welcome conversations use backend-assigned independent workspaces', () => {
    const source = readFileSync(join(root, 'src/renderer/pages/main/components/MainContent.vue'), 'utf8')

    const ensureReportConversationStart = source.indexOf('const ensureReportConversation = async')
    const ensureReportConversationEnd = source.indexOf('const handleWelcomeSend = async', ensureReportConversationStart)
    const ensureReportConversationBody = ensureReportConversationStart >= 0 && ensureReportConversationEnd > ensureReportConversationStart
      ? source.slice(ensureReportConversationStart, ensureReportConversationEnd)
      : ''

    expect(ensureReportConversationBody).not.toContain('cwd:')
  })

  it('desktop upload IPC saves attachments before agent parsing', () => {
    const preloadSource = readFileSync(join(root, 'src/preload/preload.js'), 'utf8')
    const handlerSource = readFileSync(join(root, 'src/main/ipc-handlers/agent-handlers.js'), 'utf8')

    expect(preloadSource).toContain('uploadAgentAttachment: async ({ sessionId, cwd, file })')
    expect(preloadSource).toContain("ipcRenderer.invoke('agent:uploadAttachment'")
    expect(preloadSource).toContain('cwd,')
    expect(preloadSource).toContain('const sourcePath = getPathForFileSafe(file)')
    expect(preloadSource).toContain("const contentBase64 = sourcePath ? '' : await readFileAsBase64Payload(file)")
    expect(preloadSource).toContain('sourcePath,')
    expect(handlerSource).toContain("ipcMain.handle('agent:uploadAttachment'")
    expect(handlerSource).toContain('requireAuth()')
    expect(handlerSource).toContain('uploadCwd = typeof cwd === \'string\' ? cwd : \'\'')
    expect(handlerSource).toContain('jedi-agent-uploads')
    expect(handlerSource).toContain('saveAgentUploadFromPayload')
    expect(handlerSource).toContain('saveAgentUploadFromPath')
    expect(handlerSource).toContain('extractContent: false')
  })

  it('desktop file mode prefers the fresh vite build output over stale pages-dist assets', () => {
    const mainSource = readFileSync(join(root, 'src/main/index.js'), 'utf8')
    const ipcSource = readFileSync(join(root, 'src/main/ipc-handlers.js'), 'utf8')

    expect(mainSource).toContain('../../dist/pages/main/index.html')
    expect(mainSource).toContain("fs.existsSync(builtFilePath) ? builtFilePath : legacyFilePath")
    expect(ipcSource).toContain('../../dist/pages/${options.page}/index.html')
    expect(ipcSource).toContain("fs.existsSync(builtFilePath) ? builtFilePath : legacyFilePath")
  })
})
