export function reconcileWorkspaceExpansion({ workspaces, expandedIds, initialized }) {
  const workspaceIds = Array.isArray(workspaces)
    ? workspaces.map(workspace => workspace?.id).filter(id => id !== null && id !== undefined)
    : []

  if (workspaceIds.length === 0) {
    return {
      expandedIds: new Set(),
      initialized: false
    }
  }

  if (!initialized) {
    return {
      expandedIds: new Set([workspaceIds[0]]),
      initialized: true
    }
  }

  const validIds = new Set(workspaceIds)
  const nextExpandedIds = new Set(
    [...(expandedIds || [])].filter(id => validIds.has(id))
  )

  return {
    expandedIds: nextExpandedIds,
    initialized: true
  }
}
