const unsupportedCanvasColorPattern = /\b(?:color|color-mix|oklch|lab|lch|hwb)\(/i
const transparentColorPattern = /^transparent$/i
const rgbaAlphaPattern = /^rgba\([^,]+,[^,]+,[^,]+,\s*(0|0?\.\d+)\s*\)$/i

export const getCanvasSafeColor = (value = '', fallback = '#ffffff') => {
  const color = String(value || '').trim()
  if (!color || unsupportedCanvasColorPattern.test(color)) return fallback
  return color
}

export const isTransparentCanvasColor = (value = '') => {
  const color = String(value || '').trim()
  if (!color) return true
  if (transparentColorPattern.test(color)) return true
  const alphaMatch = color.match(rgbaAlphaPattern)
  return alphaMatch ? Number(alphaMatch[1]) === 0 : false
}

export const resolveCanvasBackgroundColor = (element, fallback = '#ffffff') => {
  let current = element
  while (current && current.nodeType === 1) {
    const color = getComputedStyle(current).backgroundColor
    const safeColor = getCanvasSafeColor(color, '')
    if (safeColor && !isTransparentCanvasColor(safeColor)) return safeColor
    current = current.parentElement
  }
  return fallback
}

export const applyCanvasSafeStyles = (root, options = {}) => {
  if (!root) return
  const rootBackgroundColor = options.rootBackgroundColor || '#ffffff'
  const elements = [root, ...root.querySelectorAll('*')]
  elements.forEach((element) => {
    const style = getComputedStyle(element)
    const backgroundFallback = element === root ? rootBackgroundColor : 'transparent'
    element.style.backgroundColor = getCanvasSafeColor(style.backgroundColor, backgroundFallback)
    element.style.color = getCanvasSafeColor(style.color, '#111827')
    element.style.borderTopColor = getCanvasSafeColor(style.borderTopColor, 'transparent')
    element.style.borderRightColor = getCanvasSafeColor(style.borderRightColor, 'transparent')
    element.style.borderBottomColor = getCanvasSafeColor(style.borderBottomColor, 'transparent')
    element.style.borderLeftColor = getCanvasSafeColor(style.borderLeftColor, 'transparent')
    if (unsupportedCanvasColorPattern.test(style.boxShadow || '')) {
      element.style.boxShadow = 'none'
    }
  })
  root.style.backgroundColor = rootBackgroundColor
}

export const canvasToOpaqueDataUrl = (canvas, backgroundColor = '#ffffff', type = 'image/png') => {
  if (!canvas) return ''
  const output = document.createElement('canvas')
  output.width = canvas.width
  output.height = canvas.height
  const context = output.getContext('2d')
  context.fillStyle = backgroundColor || '#ffffff'
  context.fillRect(0, 0, output.width, output.height)
  context.drawImage(canvas, 0, 0)
  return output.toDataURL(type)
}
