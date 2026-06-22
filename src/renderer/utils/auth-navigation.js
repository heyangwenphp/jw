export function getPageUrl(page, locationLike = globalThis.location) {
  const target = String(page || '').trim()
  if (!target) return ''

  if (locationLike?.protocol === 'file:' || String(locationLike?.href || '').startsWith('file:')) {
    return new URL(`../${target}/index.html`, locationLike.href).href
  }

  return `/pages/${target}/`
}

function navigateTo(url, locationLike = globalThis.location) {
  if (!url || !locationLike) return
  if (typeof locationLike.assign === 'function') {
    locationLike.assign(url)
    return
  }
  locationLike.href = url
}

export function redirectToLoginPage(locationLike = globalThis.location) {
  navigateTo(getPageUrl('login', locationLike), locationLike)
}

export function redirectToMainPage(locationLike = globalThis.location) {
  navigateTo(getPageUrl('main', locationLike), locationLike)
}

export async function requireMainPageAuth({
  electronAPI = globalThis.window?.electronAPI,
  location = globalThis.location
} = {}) {
  try {
    if (!electronAPI?.authGetCurrentUser) {
      redirectToLoginPage(location)
      return null
    }

    const result = await electronAPI.authGetCurrentUser()
    const user = result?.user || null
    if (!user) {
      redirectToLoginPage(location)
      return null
    }
    return user
  } catch (err) {
    console.error('[auth-navigation] auth guard failed:', err)
    redirectToLoginPage(location)
    return null
  }
}
