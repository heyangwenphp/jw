import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSource = filePath => readFileSync(resolve(process.cwd(), filePath), 'utf8')

describe('web openPath polyfill', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('delegates local file paths to the backend default-app opener', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { shell } = await import('../src/renderer/client-api/api.js?web-open-path-test')
    const result = await shell.openPath('C:\\reports\\Alpha Radar.pdf')

    expect(result).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3456/api/system/open-path',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: 'C:\\reports\\Alpha Radar.pdf' })
      })
    )
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('openPath not available in web:'),
      expect.anything()
    )
  })

  it('exposes a backend endpoint for opening local files in the default app', () => {
    const serverSource = readSource('server/index.js')

    expect(serverSource).toContain("app.post('/api/system/open-path'")
    expect(serverSource).toContain('openPathWithDefaultApp')
    expect(serverSource).toContain('normalizeAbsolutePreviewPath(req.body?.filePath')
  })
})
