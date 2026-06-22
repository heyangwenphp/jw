export function isAdminModeFromSearch(search) {
  const value = typeof search === 'string' ? search.trim() : ''
  if (!value) return false

  const query = value.startsWith('?') ? value.slice(1) : value
  try {
    return new URLSearchParams(query).get('admin') === 'hyw'
  } catch {
    return false
  }
}

export function getIsAdminMode() {
  if (typeof window === 'undefined') return false
  return isAdminModeFromSearch(window.location?.search || '')
}
