import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import {
  getAttachmentFileSizeLimitMb,
  getFileExtension,
  getServerUploadAttachmentFileSizeLimitMb,
  isServerUploadAttachmentFile,
  isSupportedAttachmentFile,
  readAttachmentFileContent,
  readDocxFile
} from '../src/renderer/utils/file-attachment-utils.js'

describe('file attachment utilities', () => {
  it('supports docx and spreadsheet attachments while rejecting binary office formats that are not parsed as text', () => {
    expect(getFileExtension({ name: 'Speech.DOCX' })).toBe('docx')
    expect(isSupportedAttachmentFile({
      name: 'speech.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    })).toBe(true)
    expect(isSupportedAttachmentFile({ name: 'legacy.doc', type: 'application/msword' })).toBe(false)
    expect(isSupportedAttachmentFile({ name: 'slides.pdf', type: 'application/pdf' })).toBe(false)
    expect(isSupportedAttachmentFile({ name: 'deck.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe(false)
    expect(isSupportedAttachmentFile({ name: 'legacy.ppt', type: 'application/vnd.ms-powerpoint' })).toBe(false)
    expect(isSupportedAttachmentFile({ name: 'sheet.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe(true)
    expect(isSupportedAttachmentFile({ name: 'legacy.xls', type: 'application/vnd.ms-excel' })).toBe(true)
  })

  it('marks binary document uploads as server-readable attachments for web sessions', () => {
    expect(isServerUploadAttachmentFile({ name: 'slides.pdf', type: 'application/pdf' })).toBe(true)
    expect(isServerUploadAttachmentFile({ name: 'deck.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe(true)
    expect(isServerUploadAttachmentFile({ name: 'legacy.ppt', type: 'application/vnd.ms-powerpoint' })).toBe(true)
    expect(isServerUploadAttachmentFile({ name: 'sheet.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBe(true)
    expect(isServerUploadAttachmentFile({ name: 'legacy.doc', type: 'application/msword' })).toBe(false)
  })

  it('uses a 20MB server upload limit for all server-readable attachments', () => {
    expect(getServerUploadAttachmentFileSizeLimitMb({ name: 'deck.pptx' })).toBe(20)
    expect(getServerUploadAttachmentFileSizeLimitMb({ name: 'legacy.ppt' })).toBe(20)
    expect(getServerUploadAttachmentFileSizeLimitMb({ name: 'paper.pdf' })).toBe(20)
    expect(getServerUploadAttachmentFileSizeLimitMb({ name: 'sheet.xlsx' })).toBe(20)
  })

  it('uses a 20MB client read limit for supported attachments', () => {
    expect(getAttachmentFileSizeLimitMb({ name: 'notes.txt', type: 'text/plain' })).toBe(20)
    expect(getAttachmentFileSizeLimitMb({ name: 'brief.md', type: 'text/markdown' })).toBe(20)
    expect(getAttachmentFileSizeLimitMb({ name: 'speech.docx' })).toBe(20)
    expect(getAttachmentFileSizeLimitMb({ name: 'scores.xlsx' })).toBe(20)
  })

  it('extracts readable text from docx attachments instead of reading binary text', async () => {
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer
    const parser = {
      extractRawText: vi.fn().mockResolvedValue({ value: '演讲正文\n第二段' })
    }
    const file = {
      name: 'speech.docx',
      arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer)
    }

    await expect(readDocxFile(file, parser)).resolves.toBe('演讲正文\n第二段')
    expect(parser.extractRawText).toHaveBeenCalledWith({ arrayBuffer })
  })

  it('reads regular text attachments through file.text when available', async () => {
    const file = {
      name: 'notes.md',
      type: 'text/markdown',
      text: vi.fn().mockResolvedValue('# Notes')
    }

    await expect(readAttachmentFileContent(file)).resolves.toBe('# Notes')
  })

  it('extracts readable CSV text from spreadsheet attachments', async () => {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Name', 'Score'],
      ['Alpha', 42]
    ])
    XLSX.utils.book_append_sheet(workbook, sheet, 'Scores')
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    const file = {
      name: 'scores.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer)
    }

    const content = await readAttachmentFileContent(file)

    expect(content).toContain('Sheet: Scores')
    expect(content).toContain('Name,Score')
    expect(content).toContain('Alpha,42')
  })
})
