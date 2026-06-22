import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  appendPdfInitialView,
  buildFileDownloadUrl,
  buildFilePreviewUrl,
  buildWebRawFileUrl
} from '../src/renderer/utils/file-preview-url-utils.js'

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('file preview URL utilities', () => {
  it('uses the session raw endpoint for generated files in the agent cwd', () => {
    const url = buildWebRawFileUrl({
      sessionId: 'session 1',
      relativePath: 'reports/final report.html',
      filePath: 'C:\\server\\sessions\\reports\\final report.html'
    })

    expect(url).toBe('/api/agent/sessions/session%201/files/raw?relativePath=reports%2Ffinal%20report.html')
  })

  it('uses the absolute raw endpoint for external generated reports', () => {
    const url = buildWebRawFileUrl({
      sessionId: 'session-1',
      filePath: 'C:\\server path\\final report.pdf',
      isExternalFile: true
    })

    expect(url).toBe('/api/files/absolute/raw?filePath=C%3A%5Cserver+path%5Cfinal+report.pdf&sessionId=session-1')
  })

  it('preserves server-provided raw URLs from metadata', () => {
    const url = buildWebRawFileUrl({
      url: '/api/files/absolute/raw?filePath=C%3A%5Creport.pdf'
    })

    expect(url).toBe('/api/files/absolute/raw?filePath=C%3A%5Creport.pdf')
  })

  it('builds attachment download URLs for generated session files and report raw URLs', () => {
    expect(buildFileDownloadUrl({
      sessionId: 'session 1',
      relativePath: 'reports/final report.md'
    })).toBe('/api/agent/sessions/session%201/files/raw?relativePath=reports%2Ffinal%20report.md&download=1')

    expect(buildFileDownloadUrl({
      url: '/api/files/absolute/raw?filePath=C%3A%5Creport.pdf&sessionId=session-1'
    })).toBe('/api/files/absolute/raw?filePath=C%3A%5Creport.pdf&sessionId=session-1&download=1')
  })

  it('adds initial PDF view fragments without losing query parameters', () => {
    expect(appendPdfInitialView('/api/file/raw?x=1', 'zoom=100')).toBe('/api/file/raw?x=1#zoom=100')
    expect(appendPdfInitialView('/api/file/raw#page=2', 'zoom=100')).toBe('/api/file/raw#page=2&zoom=100')
  })

  it('never returns file URLs for web HTML previews', () => {
    const url = buildFilePreviewUrl({
      type: 'html',
      sessionId: 'session-1',
      relativePath: 'out/index.html',
      filePath: 'C:\\server\\out\\index.html'
    }, { isWeb: true })

    expect(url).toBe('/api/agent/sessions/session-1/static/out/index.html')
    expect(url).not.toContain('file://')
  })

  it('renders generated HTML through a browser iframe in web deployments', () => {
    const source = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')
    const getWebviewSrcBody = source.match(/const getWebviewSrc = \(\) => \{[\s\S]*?\n}/)?.[0] || ''

    expect(source).toContain('<iframe')
    expect(source).toContain('v-if="isWeb"')
    expect(source).toContain('buildFilePreviewUrl')
    expect(getWebviewSrcBody).not.toContain('file://')
  })

  it('keeps generated HTML preview on the session static endpoint so relative assets resolve', () => {
    const source = readSource('src/renderer/utils/file-preview-url-utils.js')
    const serverSource = readSource('server/index.js')

    expect(source).toContain('buildSessionStaticFileUrl')
    expect(source).toContain('/static/')
    expect(serverSource).toContain("'.html': 'text/html; charset=utf-8'")
    expect(serverSource).toContain('relativePath: relativePath || undefined')
  })

  it('classifies generated Word and spreadsheet files as web-previewable document types', () => {
    const serverSource = readSource('server/index.js')
    const agentFileManagerSource = readSource('src/main/managers/agent-file-manager.js')
    const filePreviewSource = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')

    expect(serverSource).toContain("if (ext === '.docx') return 'word'")
    expect(serverSource).toContain("if (['.doc', '.xlsx', '.xls'].includes(ext)) return 'office'")
    expect(agentFileManagerSource).toContain("if (['.xlsx', '.xls'].includes(ext))")
    expect(filePreviewSource).toContain("await import('xlsx')")
  })

  it('exposes single-file downloads from file trees and PDF/Markdown previews', () => {
    const menuSource = readSource('src/renderer/pages/main/components/AgentRightPanel/FileTreeContextMenu.vue')
    const agentPanelSource = readSource('src/renderer/pages/main/components/AgentRightPanel/index.vue')
    const filesTabSource = readSource('src/renderer/pages/main/components/RightPanel/tabs/FilesTab.vue')
    const filePreviewSource = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')

    expect(menuSource).toContain("handleAction('download')")
    expect(menuSource).toContain('Icon name="download"')
    expect(agentPanelSource).toContain("case 'download':")
    expect(agentPanelSource).toContain('downloadAgentFile')
    expect(filesTabSource).toContain("case 'download':")
    expect(filesTabSource).toContain('downloadProjectFile')
    expect(filePreviewSource).toContain('const downloadCurrentFile = () =>')
    expect(filePreviewSource).toContain('buildFileDownloadUrl')
  })

  it('opens Markdown files in rendered preview mode by default', () => {
    const filePreviewSource = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')
    const previewWatchBody = filePreviewSource.match(/watch\(\(\) => props\.preview,[\s\S]*?\}, \{ immediate: true \}\)/)?.[0] || ''

    expect(filePreviewSource).toContain('const markdownPreviewMode = ref(false)')
    expect(previewWatchBody).toContain('markdownPreviewMode.value = isMarkdown.value')
    expect(previewWatchBody).not.toContain('markdownPreviewMode.value = false')
  })

  it('serves requested raw file downloads as browser attachments', () => {
    const serverSource = readSource('server/index.js')

    expect(serverSource).toContain("'.md': 'text/markdown; charset=utf-8'")
    expect(serverSource).toContain("const isDownloadRequest = req.query.download === '1'")
    expect(serverSource).toContain('buildAttachmentContentDisposition')
    expect(serverSource).toContain("res.setHeader('Content-Disposition', isDownloadRequest")
  })
})
