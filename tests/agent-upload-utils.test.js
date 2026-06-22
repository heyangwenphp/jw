import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const {
  extractUploadedAttachmentText,
  isSupportedUploadAttachment,
  saveAgentUploadFromBuffer,
  saveAgentUploadFromPayload,
  saveAgentUploadFromPath
} = require('../server/agent-upload-utils.js')

const createPptxBuffer = (slideText) => {
  const zip = new AdmZip()
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?>'))
  zip.addFile(
    'ppt/slides/slide1.xml',
    Buffer.from([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
      '<p:cSld><p:spTree><p:sp><p:txBody>',
      `<a:p><a:r><a:t>${slideText}</a:t></a:r></a:p>`,
      '</p:txBody></p:sp></p:spTree></p:cSld>',
      '</p:sld>'
    ].join(''))
  )
  return zip.toBuffer()
}

const withTempCwd = async (fn) => {
  const cwd = mkdtempSync(join(tmpdir(), 'jedi-upload-'))
  try {
    await fn(cwd)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

describe('agent upload utilities', () => {
  it('stores a browser-uploaded text file under the session cwd and returns prompt content', async () => {
    await withTempCwd(async (cwd) => {
      const result = await saveAgentUploadFromPayload({
        cwd,
        payload: {
          name: '../notes.md',
          mimeType: 'text/markdown',
          sizeBytes: 11,
          contentBase64: Buffer.from('# Server OK').toString('base64')
        },
        timestamp: '20260520-120000'
      })

      expect(result.name).toBe('notes.md')
      expect(result.relativePath).toBe('uploaded_files/20260520-120000-notes.md')
      expect(result.content).toBe('# Server OK')
      expect(readFileSync(join(cwd, result.relativePath), 'utf8')).toBe('# Server OK')
    })
  })

  it('can store a browser-uploaded file without parsing prompt content', async () => {
    await withTempCwd(async (cwd) => {
      const result = await saveAgentUploadFromPayload({
        cwd,
        extractContent: false,
        payload: {
          name: 'market-data.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          contentBase64: Buffer.from('saved workbook bytes').toString('base64')
        },
        timestamp: '20260520-120001'
      })

      expect(result.name).toBe('market-data.xlsx')
      expect(result.relativePath).toBe('uploaded_files/20260520-120001-market-data.xlsx')
      expect(result).not.toHaveProperty('content')
      expect(readFileSync(join(cwd, result.relativePath), 'utf8')).toBe('saved workbook bytes')
    })
  })

  it('can store a multipart browser upload without parsing prompt content', async () => {
    await withTempCwd(async (cwd) => {
      const result = await saveAgentUploadFromBuffer({
        cwd,
        buffer: Buffer.from('multipart workbook bytes'),
        originalName: '../market-data.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extractContent: false,
        timestamp: '20260520-120002'
      })

      expect(result.name).toBe('market-data.xlsx')
      expect(result.relativePath).toBe('uploaded_files/20260520-120002-market-data.xlsx')
      expect(result).not.toHaveProperty('content')
      expect(readFileSync(join(cwd, result.relativePath), 'utf8')).toBe('multipart workbook bytes')
    })
  })

  it('can store an electron local file by copying from its source path', async () => {
    await withTempCwd(async (cwd) => {
      const sourcePath = join(cwd, 'source-notes.md')
      writeFileSync(sourcePath, '# Local Path')

      const result = await saveAgentUploadFromPath({
        cwd,
        sourcePath,
        originalName: '../notes.md',
        mimeType: 'text/markdown',
        extractContent: false,
        timestamp: '20260520-120002'
      })

      expect(result.name).toBe('notes.md')
      expect(result.relativePath).toBe('uploaded_files/20260520-120002-notes.md')
      expect(result).not.toHaveProperty('content')
      expect(readFileSync(join(cwd, result.relativePath), 'utf8')).toBe('# Local Path')
    })
  })

  it('supports ppt and pptx uploads as readable attachments', () => {
    expect(isSupportedUploadAttachment('deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe(true)
    expect(isSupportedUploadAttachment('legacy.ppt', 'application/vnd.ms-powerpoint')).toBe(true)
  })

  it('extracts slide text from pptx uploads', async () => {
    const content = await extractUploadedAttachmentText({
      buffer: createPptxBuffer('Alpha Roadmap'),
      name: 'deck.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    })

    expect(content).toContain('Slide 1')
    expect(content).toContain('Alpha Roadmap')
  })

  it('extracts readable strings from legacy ppt uploads', async () => {
    const content = await extractUploadedAttachmentText({
      buffer: Buffer.from('Legacy PPT\x00Quarterly Strategy\x00Funding Plan', 'binary'),
      name: 'legacy.ppt',
      mimeType: 'application/vnd.ms-powerpoint'
    })

    expect(content).toContain('Quarterly Strategy')
    expect(content).toContain('Funding Plan')
  })

  it('rejects browser uploads larger than 20MB', async () => {
    await withTempCwd(async (cwd) => {
      await expect(saveAgentUploadFromPayload({
        cwd,
        payload: {
          name: 'large.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.alloc(20 * 1024 * 1024 + 1, 'a').toString('base64')
        }
      })).rejects.toThrow('max 20MB')
    })
  })
})
