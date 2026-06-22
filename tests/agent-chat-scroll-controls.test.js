import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { getScrollPositionState } from '../src/renderer/composables/useAutoScrollToBottom.js'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('agent chat scroll controls', () => {
  it('reports top, bottom, and scrollability for a message container', () => {
    const state = getScrollPositionState(
      { scrollTop: 20, scrollHeight: 1200, clientHeight: 480 },
      { topThreshold: 40, bottomThreshold: 60 }
    )

    expect(state.canScroll).toBe(true)
    expect(state.atTop).toBe(true)
    expect(state.atBottom).toBe(false)
  })

  it('wires floating top and bottom scroll buttons in the agent chat tab', () => {
    const source = readSource('src/renderer/pages/main/components/AgentChatTab.vue')

    expect(source).toContain('class="chat-scroll-controls"')
    expect(source).toContain('scrollToTop(false)')
    expect(source).toContain('scrollToBottom(false, true)')
    expect(source).toContain('canScrollMessages')
    expect(source).toContain('arrowUp')
    expect(source).toContain('arrowDown')
  })
})
