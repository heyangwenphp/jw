import { describe, expect, it } from 'vitest'
import { mergeAssistantThinkingOnlyMessage } from '../src/renderer/utils/agent-thinking-merge.js'

describe('agent thinking-only message merging', () => {
  it('merges a new assistant thinking-only message into the previous assistant thinking-only message', () => {
    const previous = {
      role: 'assistant',
      content: '',
      thinking: 'first thought',
      timestamp: 100
    }
    const incoming = {
      role: 'assistant',
      content: '',
      thinking: 'second thought',
      timestamp: 200
    }

    const didMerge = mergeAssistantThinkingOnlyMessage(previous, incoming)

    expect(didMerge).toBe(true)
    expect(previous.thinking).toBe('first thought\n\nsecond thought')
    expect(previous.timestamp).toBe(200)
  })

  it('does not merge when either message has visible content', () => {
    const previous = {
      role: 'assistant',
      content: 'visible answer',
      thinking: 'first thought',
      timestamp: 100
    }
    const incoming = {
      role: 'assistant',
      content: '',
      thinking: 'second thought',
      timestamp: 200
    }

    const didMerge = mergeAssistantThinkingOnlyMessage(previous, incoming)

    expect(didMerge).toBe(false)
    expect(previous.thinking).toBe('first thought')
    expect(previous.timestamp).toBe(100)
  })

  it('does not merge across non-assistant messages', () => {
    const previous = {
      role: 'tool',
      content: '',
      thinking: 'first thought',
      timestamp: 100
    }
    const incoming = {
      role: 'assistant',
      content: '',
      thinking: 'second thought',
      timestamp: 200
    }

    const didMerge = mergeAssistantThinkingOnlyMessage(previous, incoming)

    expect(didMerge).toBe(false)
    expect(previous.thinking).toBe('first thought')
  })
})
