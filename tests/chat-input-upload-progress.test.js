import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('chat input upload progress affordance', () => {
  it('renders attachment upload progress and blocks sending while files are uploading', () => {
    const source = readFileSync(join(root, 'src/renderer/pages/main/components/agent/ChatInput.vue'), 'utf8')

    expect(source).toContain('const MAX_IMAGES = 5')
    expect(source).toContain('hasUploadingFiles')
    expect(source).toContain('hasBlockingFiles')
    expect(source).toContain('file.statusText')
    expect(source).toContain('file-preview-progress')
    expect(source).toContain('file.status === \'uploading\'')
    expect(source).toContain('const activeFileItem = attachedFiles.value[attachedFiles.value.length - 1]')
    expect(source).toContain('Object.assign(activeFileItem, {')
    expect(source).not.toContain('Object.assign(fileItem, {')
    expect(source).not.toContain('file.status === \'processing\'')
    expect(source).toContain('attachedFiles.value.filter(file => file.status === \'ready\')')
    expect(source).toContain('if (hasBlockingFiles.value) return')
    expect(source).toContain('|| hasBlockingFiles')
    expect(source).not.toContain('sendAfterUploads')
    expect(source).not.toContain('nextTick(handleSend)')
    expect(source).not.toContain('readAttachmentFileContent')
  })

  it('does not auto-send text-only when a pending attachment upload fails', () => {
    const source = readFileSync(join(root, 'src/renderer/pages/main/components/agent/ChatInput.vue'), 'utf8')

    expect(source).toContain('hasErroredFiles')
    expect(source).toContain('const hasBlockingFiles = computed(() => hasUploadingFiles.value || hasErroredFiles.value)')
    expect(source).toContain('if (hasBlockingFiles.value) return')
    expect(source).not.toContain('sendAfterUploads')
  })

  it('defers attachment parsing to the agent layer after send', () => {
    const source = readFileSync(join(root, 'src/renderer/pages/main/components/agent/ChatInput.vue'), 'utf8')

    expect(source).toContain('relativePath: uploaded?.relativePath || \'\'')
    expect(source).toContain('filePath: uploaded?.filePath || localFilePath')
    expect(source).toContain('window.electronAPI?.getPathForFile')
    expect(source).toContain('status: \'ready\'')
    expect(source).toContain('relativePath: file.relativePath')
    expect(source).toContain('filePath: file.filePath')
    expect(source).toContain('typeof window.electronAPI?.uploadAgentAttachment === \'function\'')
    expect(source).not.toContain('window.electronAPI?.platform === \'web\'')
    expect(source).not.toContain("return window.electronAPI?.platform !== 'web'")
    expect(source).toContain('readAttachmentAsBase64Payload')
    expect(source).toContain('withAttachmentTimeout')
    expect(source).toContain('onProgress: (percent) =>')
    expect(source).toContain('activeFileItem.statusText = `上传中 ${normalized}%`')
    expect(source).toContain('localFilePath ? \'\' : await withAttachmentTimeout(readAttachmentAsBase64Payload(file), \'Attachment read\')')
    expect(source).toContain('contentBase64')
    expect(source).toContain('falling back to inline payload')
    expect(source).toContain('Unable to read attachment bytes')
    expect(source).toContain('cwd: props.projectPath || null')
    expect(source).not.toContain('No local file path available for attachment')
    expect(source).not.toContain('await readAttachmentFileContent(file)')
    expect(source).not.toContain('fileItem.status = \'processing\'')
  })
})
