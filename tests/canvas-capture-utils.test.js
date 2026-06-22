import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyCanvasSafeStyles,
  canvasToOpaqueDataUrl,
  getCanvasSafeColor,
  isTransparentCanvasColor,
  resolveCanvasBackgroundColor
} from '../src/renderer/utils/canvas-capture-utils.js'

describe('canvas capture utilities', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves the nearest visible ancestor background for transparent capture roots', () => {
    const parent = { nodeType: 1, parentElement: null }
    const child = { nodeType: 1, parentElement: parent }
    vi.stubGlobal('getComputedStyle', vi.fn((element) => ({
      backgroundColor: element === child ? 'rgba(0, 0, 0, 0)' : 'rgb(248, 250, 252)'
    })))

    expect(resolveCanvasBackgroundColor(child)).toBe('rgb(248, 250, 252)')
  })

  it('keeps black backgrounds distinct from transparent backgrounds', () => {
    expect(isTransparentCanvasColor('rgb(0, 0, 0)')).toBe(false)
    expect(isTransparentCanvasColor('rgba(0, 0, 0, 0)')).toBe(true)
  })

  it('falls back when html2canvas cannot parse modern css color functions', () => {
    expect(getCanvasSafeColor('color-mix(in srgb, red 10%, transparent)', '#ffffff')).toBe('#ffffff')
    expect(getCanvasSafeColor('rgb(255, 255, 255)', '#000000')).toBe('rgb(255, 255, 255)')
  })

  it('forces the cloned capture root to use the resolved export background', () => {
    const child = { style: {}, querySelectorAll: () => [] }
    const root = { style: {}, querySelectorAll: () => [child] }
    vi.stubGlobal('getComputedStyle', vi.fn((element) => ({
      backgroundColor: element === root ? 'rgba(0, 0, 0, 0)' : 'color-mix(in srgb, red 12%, transparent)',
      color: 'rgb(17, 24, 39)',
      borderTopColor: 'rgba(0, 0, 0, 0)',
      borderRightColor: 'rgba(0, 0, 0, 0)',
      borderBottomColor: 'rgba(0, 0, 0, 0)',
      borderLeftColor: 'rgba(0, 0, 0, 0)',
      boxShadow: 'none'
    })))

    applyCanvasSafeStyles(root, { rootBackgroundColor: 'rgb(248, 250, 252)' })

    expect(root.style.backgroundColor).toBe('rgb(248, 250, 252)')
    expect(child.style.backgroundColor).toBe('transparent')
  })

  it('redraws html2canvas output onto an opaque background before exporting', () => {
    const calls = []
    const outputCanvas = {
      width: 0,
      height: 0,
      toDataURL: vi.fn(() => 'data:image/png;base64,opaque'),
      getContext: vi.fn(() => ({
        set fillStyle(value) {
          calls.push(['fillStyle', value])
        },
        fillRect: vi.fn((...args) => calls.push(['fillRect', ...args])),
        drawImage: vi.fn((...args) => calls.push(['drawImage', ...args]))
      }))
    }
    const sourceCanvas = { width: 320, height: 180 }
    vi.stubGlobal('document', {
      createElement: vi.fn(() => outputCanvas)
    })

    const result = canvasToOpaqueDataUrl(sourceCanvas, 'rgb(248, 250, 252)', 'image/png')

    expect(outputCanvas.width).toBe(320)
    expect(outputCanvas.height).toBe(180)
    expect(calls).toContainEqual(['fillStyle', 'rgb(248, 250, 252)'])
    expect(calls).toContainEqual(['fillRect', 0, 0, 320, 180])
    expect(calls).toContainEqual(['drawImage', sourceCanvas, 0, 0])
    expect(result).toBe('data:image/png;base64,opaque')
  })
})
