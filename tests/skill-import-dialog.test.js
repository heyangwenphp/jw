import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('skill import and export dialogs', () => {
  const modalSource = readSource('src/renderer/pages/main/components/RightPanel/tabs/skills/SkillImportModal.vue')
  const mainIpcSource = readSource('src/main/ipc-handlers.js')

  it('uses browser file inputs for web skill import instead of desktop dialogs', () => {
    expect(modalSource).toContain("window.electronAPI?.platform === 'web'")
    expect(modalSource).toContain('ref="folderInputRef"')
    expect(modalSource).toContain('webkitdirectory')
    expect(modalSource).toContain('ref="zipInputRef"')
    expect(modalSource).toContain('handleWebImportFiles')
    expect(modalSource).toContain('fileToBase64')
    expect(modalSource).toContain('sourcePayload')
    expect(modalSource).toContain('folderInputRef.value?.click()')
    expect(modalSource).toContain('zipInputRef.value?.click()')
    expect(modalSource).toContain('source: form.value.sourcePayload')
  })

  it('downloads web skill exports directly without selecting a desktop folder', () => {
    const exportModalSource = readSource('src/renderer/pages/main/components/RightPanel/tabs/skills/SkillExportModal.vue')
    const polyfillSource = readSource('src/renderer/client-api/electron-polyfill.js')

    expect(exportModalSource).toContain('const isWeb = computed')
    expect(exportModalSource).toContain('if (!isWeb.value)')
    expect(exportModalSource).toContain('window.electronAPI.selectFolder()')
    expect(exportModalSource).toContain("format: 'zip'")
    expect(polyfillSource).toContain('validateSkillImport,')
    expect(polyfillSource).toContain('importSkills,')
    expect(polyfillSource).toContain('exportSkill,')
    expect(polyfillSource).toContain('exportSkillsBatch,')
  })

  it('opens file pickers from the sender window so subwindow imports are visible', () => {
    const selectFileHandler = mainIpcSource.match(
      /ipcMain\.handle\('dialog:selectFile'[\s\S]*?\n  \}\);/
    )?.[0]
    const selectFilesHandler = mainIpcSource.match(
      /ipcMain\.handle\('dialog:selectFiles'[\s\S]*?\n  \}\);/
    )?.[0]

    expect(selectFileHandler).toBeTruthy()
    expect(selectFilesHandler).toBeTruthy()
    expect(selectFileHandler).toContain('BrowserWindow.fromWebContents(event.sender)')
    expect(selectFileHandler).toContain('senderWindow || mainWindow')
    expect(selectFilesHandler).toContain('BrowserWindow.fromWebContents(event.sender)')
    expect(selectFilesHandler).toContain('senderWindow || mainWindow')
  })
})
