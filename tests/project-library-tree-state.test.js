import { describe, expect, it } from 'vitest'
import { reconcileWorkspaceExpansion } from '../src/renderer/pages/main/components/project-library/project-tree-state.js'

describe('project library tree expansion state', () => {
  it('expands only the first workspace by default', () => {
    const result = reconcileWorkspaceExpansion({
      workspaces: [{ id: 1 }, { id: 3 }, { id: 5 }],
      expandedIds: new Set(),
      initialized: false
    })

    expect([...result.expandedIds]).toEqual([1])
    expect(result.initialized).toBe(true)
  })

  it('preserves manual expansion and keeps newly added workspaces collapsed', () => {
    const result = reconcileWorkspaceExpansion({
      workspaces: [{ id: 1 }, { id: 3 }, { id: 5 }],
      expandedIds: new Set([3]),
      initialized: true
    })

    expect([...result.expandedIds]).toEqual([3])
    expect(result.initialized).toBe(true)
  })
})
