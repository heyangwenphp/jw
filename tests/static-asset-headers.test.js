import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { setStaticAssetHeaders } = require('../server/static-asset-headers.js')

describe('static asset headers', () => {
  it('serves Vite ES module worker chunks with a JavaScript MIME type', () => {
    const res = { setHeader: vi.fn() }

    setStaticAssetHeaders(res, 'dist/assets/pdf.worker-B1D2UnXD.mjs')

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript; charset=utf-8')
  })
})
