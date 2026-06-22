const getDefaultNavigator = () => (
  typeof globalThis !== 'undefined' ? globalThis.navigator : undefined
)

const getDefaultDocument = () => (
  typeof globalThis !== 'undefined' ? globalThis.document : undefined
)

export const copyTextToClipboard = async (text, {
  navigatorRef = getDefaultNavigator(),
  documentRef = getDefaultDocument()
} = {}) => {
  const value = String(text ?? '')
  let clipboardError = null

  if (typeof navigatorRef?.clipboard?.writeText === 'function') {
    try {
      await navigatorRef.clipboard.writeText(value)
      return true
    } catch (err) {
      clipboardError = err
    }
  }

  if (
    !documentRef?.body ||
    typeof documentRef.createElement !== 'function' ||
    typeof documentRef.execCommand !== 'function'
  ) {
    throw clipboardError || new Error('Clipboard API is unavailable')
  }

  const textarea = documentRef.createElement('textarea')
  textarea.value = value
  textarea.setAttribute?.('readonly', '')
  Object.assign(textarea.style, {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    opacity: '0'
  })

  documentRef.body.appendChild(textarea)

  try {
    textarea.focus?.()
    textarea.select?.()
    const copied = documentRef.execCommand('copy')
    if (!copied) {
      throw clipboardError || new Error('Clipboard fallback failed')
    }
    return true
  } finally {
    if (typeof textarea.remove === 'function') {
      textarea.remove()
    } else {
      documentRef.body.removeChild?.(textarea)
    }
  }
}
