import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { setupProjectFilesHandlers } = require('../src/main/ipc-handlers/project-files-handlers.js')
const XLSX = require('xlsx')

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8')

const withTempProject = async (fn) => {
  const cwd = mkdtempSync(join(tmpdir(), 'jedi-project-files-'))
  try {
    await fn(cwd)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

const createProjectFileHandlers = () => {
  const handlers = new Map()
  setupProjectFilesHandlers({
    handle: (channel, handler) => handlers.set(channel, handler)
  })
  return handlers
}

describe('project file previews', () => {
  it('loads project directory entry metadata concurrently', async () => {
    await withTempProject(async (cwd) => {
      for (let i = 0; i < 8; i++) {
        writeFileSync(join(cwd, `file-${i}.txt`), `file ${i}`)
      }

      const originalStat = fsp.stat
      let activeStatCalls = 0
      let maxActiveStatCalls = 0
      fsp.stat = async (...args) => {
        activeStatCalls += 1
        maxActiveStatCalls = Math.max(maxActiveStatCalls, activeStatCalls)
        try {
          await new Promise(resolve => setTimeout(resolve, 30))
          return await originalStat(...args)
        } finally {
          activeStatCalls -= 1
        }
      }

      try {
        const handlers = createProjectFileHandlers()
        const listProjectDir = handlers.get('project:listDir')

        const result = await listProjectDir(null, {
          rootPath: cwd,
          relativePath: '',
          showHidden: false
        })

        expect(result.entries).toHaveLength(8)
        expect(maxActiveStatCalls).toBeGreaterThan(1)
      } finally {
        fsp.stat = originalStat
      }
    })
  })

  it('classifies project PDF files as PDF previews for the right-panel toolbar', async () => {
    await withTempProject(async (cwd) => {
      writeFileSync(join(cwd, 'report.pdf'), '%PDF-1.7\n')

      const handlers = createProjectFileHandlers()
      const readProjectFile = handlers.get('project:readFile')

      const result = await readProjectFile(null, {
        rootPath: cwd,
        relativePath: 'report.pdf'
      })

      expect(result.type).toBe('pdf')
      expect(result.filePath).toBe(join(cwd, 'report.pdf'))
    })
  })

  it('classifies project Word and spreadsheet files for the shared right-panel preview', async () => {
    await withTempProject(async (cwd) => {
      writeFileSync(join(cwd, 'brief.docx'), 'docx placeholder')
      writeFileSync(join(cwd, 'legacy.doc'), 'doc placeholder')
      writeFileSync(join(cwd, 'table.xlsx'), 'xlsx placeholder')
      writeFileSync(join(cwd, 'legacy.xls'), 'xls placeholder')

      const handlers = createProjectFileHandlers()
      const readProjectFile = handlers.get('project:readFile')

      await expect(readProjectFile(null, {
        rootPath: cwd,
        relativePath: 'brief.docx'
      })).resolves.toMatchObject({ type: 'word', ext: '.docx' })

      await expect(readProjectFile(null, {
        rootPath: cwd,
        relativePath: 'legacy.doc'
      })).resolves.toMatchObject({ type: 'office', ext: '.doc' })

      await expect(readProjectFile(null, {
        rootPath: cwd,
        relativePath: 'table.xlsx'
      })).resolves.toMatchObject({ type: 'office', ext: '.xlsx' })

      await expect(readProjectFile(null, {
        rootPath: cwd,
        relativePath: 'legacy.xls'
      })).resolves.toMatchObject({ type: 'office', ext: '.xls' })
    })
  })

  it('parses project Excel files for project-library preview tables', async () => {
    await withTempProject(async (cwd) => {
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['Name', 'Score'],
        ['Luke', 98]
      ])
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet A')
      const filePath = join(cwd, 'scores.xlsx')
      XLSX.writeFile(workbook, filePath)

      const handlers = createProjectFileHandlers()
      const readOfficeFile = handlers.get('project:readOfficeFile')
      const result = await readOfficeFile(null, { filePath, ext: 'xlsx' })

      expect(result.type).toBe('excel')
      expect(result.meta.sheetNames).toEqual(['Sheet A'])
      expect(JSON.parse(result.content)['Sheet A']).toEqual([
        ['Name', 'Score'],
        ['Luke', 98]
      ])
    })
  })

  it('renders PDF page count and zoom controls in the shared file preview toolbar', () => {
    const source = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')
    const pdfBlock = source.match(/<!-- PDF -->[\s\S]*?<!-- Word \(\.docx\) -->/)?.[0] || ''

    expect(source).toContain("await import('pdfjs-dist/legacy/build/pdf.mjs')")
    expect(source).toContain('const pdfDoc = shallowRef(null)')
    expect(source).toContain('pdfPageCount')
    expect(pdfBlock).toContain('pdf-page-status')
    expect(pdfBlock).toContain('zoomOutPdf')
    expect(pdfBlock).toContain('zoomInPdf')
    expect(pdfBlock).toContain('resetPdfZoom')
  })

  it('shows download and hides default-app open in the PDF preview toolbar', () => {
    const source = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')
    const pdfBlock = source.match(/<!-- PDF -->[\s\S]*?<!-- Word \(\.docx\) -->/)?.[0] || ''

    expect(pdfBlock).toContain('@click="downloadCurrentFile"')
    expect(pdfBlock).toContain("t('agent.files.download')")
    expect(pdfBlock).toContain('Icon name="download"')
    expect(pdfBlock).not.toContain("t('agent.files.openInDefaultApp')")
    expect(pdfBlock).not.toContain('openPdfExternal')
    expect(source).not.toContain('const openPdfExternal = async')
  })

  it('hides default-app and external-open buttons from all file preview toolbars', () => {
    const source = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')

    expect(source).not.toContain("t('agent.files.openInDefaultApp')")
    expect(source).not.toContain("t('agent.files.openExternal')")
    expect(source).not.toContain('Icon name="externalLink"')
    expect(source).not.toMatch(/@click="open[A-Za-z]*External"/)
    expect(source).not.toContain('const openTextExternal = async')
    expect(source).not.toContain('const openImageExternal = async')
    expect(source).not.toContain('const openVideoExternal = async')
    expect(source).not.toContain('const openAudioExternal = async')
    expect(source).not.toContain('const openWordExternal = async')
    expect(source).not.toContain('const openOfficeExternal = async')
    expect(source).not.toContain('const openNotebookExternal = async')
    expect(source).not.toContain('const openExternal = async')
  })

  it('uses pdf.js official viewer layer for continuous PDF previews', () => {
    const source = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')
    const pdfBlock = source.match(/<!-- PDF -->[\s\S]*?<!-- Word \(\.docx\) -->/)?.[0] || ''

    expect(source).toContain("await import('pdfjs-dist/legacy/web/pdf_viewer.mjs')")
    expect(source).toContain("import 'pdfjs-dist/legacy/web/pdf_viewer.css'")
    expect(source).toContain("new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url)")
    expect(source).toContain('new EventBus()')
    expect(source).toContain('new PDFLinkService(')
    expect(source).toContain('new PDFViewer(')
    expect(source).toContain('pdfViewerInstance')
    expect(pdfBlock).toContain('ref="pdfViewerContainerRef"')
    expect(pdfBlock).toContain('ref="pdfViewerRef"')
    expect(pdfBlock).toContain('class="pdfViewer"')
    expect(source).not.toContain('renderPdfPage')
    expect(source).not.toContain('pdfCanvasRef')
  })

  it('fits PDF previews to the right-panel width by default', () => {
    const source = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')

    expect(source).toContain('const pdfDefaultZoom = ref(1)')
    expect(source).toContain('const isPdfZoomAtDefault = computed(')
    expect(source).toContain("pdfViewerInstance.value.currentScaleValue = 'page-width'")
    expect(source).toContain('pdfDefaultZoom.value = defaultZoom')
    expect(source).toContain(':disabled="isPdfZoomAtDefault || pdfRendering"')
  })

  it('syncs toolbar page and zoom controls with the official PDF viewer', () => {
    const source = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')

    expect(source).toContain("eventBus.on('pagesinit'")
    expect(source).toContain("eventBus.on('pagechanging'")
    expect(source).toContain('pdfViewerInstance.value.currentPageNumber')
    expect(source).toContain('pdfViewerInstance.value.currentScale')
    expect(source).toContain('pdfViewerInstance.value.currentScaleValue')
  })
})
