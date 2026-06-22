import { describe, expect, it } from 'vitest'
import { mergeAgentMessageHistory } from '../src/renderer/utils/agent-message-history-merge.js'

describe('agent message history merge', () => {
  it('does not duplicate a persisted copy of an optimistic user message', () => {
    const current = [{
      id: 'optimistic-1',
      role: 'user',
      content: '帮我写一份日报',
      timestamp: 1000
    }]
    const history = [{
      id: 'persisted-1',
      role: 'user',
      content: '帮我写一份日报',
      timestamp: 1200
    }]

    expect(mergeAgentMessageHistory(history, current)).toEqual(current)
  })

  it('keeps distinct messages with the same role', () => {
    const current = [{
      id: 'optimistic-1',
      role: 'user',
      content: '第一条',
      timestamp: 1000
    }]
    const history = [{
      id: 'persisted-2',
      role: 'user',
      content: '第二条',
      timestamp: 1200
    }]

    expect(mergeAgentMessageHistory(history, current)).toEqual([
      history[0],
      current[0]
    ])
  })
})
