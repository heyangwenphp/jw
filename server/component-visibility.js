const { ADMIN_PHONE } = require('../src/main/auth-manager')

function canAccessBuiltInComponents(currentUser) {
  return Boolean(
    currentUser &&
    (currentUser.phone === ADMIN_PHONE || currentUser.isAdmin === true)
  )
}

function isBuiltInComponent(component) {
  return component?.source === 'built-in'
}

function filterBuiltInComponentGroups(groups, currentUser) {
  return groups
}

function hasBuiltInSource(params = {}) {
  return params.source === 'built-in' ||
    params.scope === 'built-in' ||
    params.fromSource === 'built-in' ||
    params.toSource === 'built-in' ||
    params.targetSource === 'built-in'
}

function assertBuiltInComponentAccess(params, currentUser) {
  if (!hasBuiltInSource(params)) return
  if (canAccessBuiltInComponents(currentUser)) return
  const error = new Error('Access denied')
  error.code = 'AUTH_FORBIDDEN'
  throw error
}

module.exports = {
  canAccessBuiltInComponents,
  filterBuiltInComponentGroups,
  assertBuiltInComponentAccess
}
