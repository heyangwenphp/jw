import { describe, expect, it, vi } from 'vitest'
import { copyTextToClipboard } from '../src/renderer/utils/clipboard-utils.js'

const createFallbackDocument = () => {
  const textarea = {
    value: '',
    style: {},
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    remove: vi.fn()
  }
  const documentRef = {
    body: {
      appendChild: vi.fn()
    },
    createElement: vi.fn(() => textarea),
    execCommand: vi.fn(() => true)
  }

  return { documentRef, textarea }
}

describe('copyTextToClipboard', () => {
  it('uses the Clipboard API when writeText is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { documentRef } = createFallbackDocument()

    await expect(copyTextToClipboard('hello', {
      navigatorRef: { clipboard: { writeText } },
      documentRef
    })).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('hello')
    expect(documentRef.createElement).not.toHaveBeenCalled()
  })

  it('falls back to execCommand when navigator.clipboard is unavailable', async () => {
    const { documentRef, textarea } = createFallbackDocument()

    await expect(copyTextToClipboard('fallback text', {
      navigatorRef: {},
      documentRef
    })).resolves.toBe(true)

    expect(documentRef.createElement).toHaveBeenCalledWith('textarea')
    expect(textarea.value).toBe('fallback text')
    expect(documentRef.body.appendChild).toHaveBeenCalledWith(textarea)
    expect(textarea.select).toHaveBeenCalled()
    expect(documentRef.execCommand).toHaveBeenCalledWith('copy')
    expect(textarea.remove).toHaveBeenCalled()
  })

  it('falls back when Clipboard API writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    const { documentRef } = createFallbackDocument()

    await expect(copyTextToClipboard('retry text', {
      navigatorRef: { clipboard: { writeText } },
      documentRef
    })).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('retry text')
    expect(documentRef.execCommand).toHaveBeenCalledWith('copy')
  })
})
