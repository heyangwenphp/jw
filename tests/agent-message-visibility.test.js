import { describe, expect, it } from 'vitest'
import {
  HIDDEN_AGENT_TOOL_MESSAGE_TYPES,
  isVisibleAgentMessage
} from '../src/renderer/utils/agent-message-visibility.js'

describe('agent message visibility', () => {
  it('hides noisy built-in tool messages from the visible agent transcript', () => {
    expect(HIDDEN_AGENT_TOOL_MESSAGE_TYPES).toEqual([
      'TodoWrite',
      'Agent',
      'Read',
      'Write',
      'Bash',
      'Skill',
      'WebSearch',
      'Glob',
      'WebFetch',
      'TaskOutput',
      'TaskResult'
    ])

    for (const toolName of HIDDEN_AGENT_TOOL_MESSAGE_TYPES) {
      expect(isVisibleAgentMessage({
        role: 'tool',
        toolName,
        input: { file_path: 'README.md' },
        output: 'done'
      })).toBe(false)
    }
  })

  it('keeps user, assistant, system, and interactive tool messages visible', () => {
    expect(isVisibleAgentMessage({ role: 'user', content: 'hello' })).toBe(true)
    expect(isVisibleAgentMessage({ role: 'assistant', content: 'hi' })).toBe(true)
    expect(isVisibleAgentMessage({ role: 'system', content: 'done' })).toBe(true)
    expect(isVisibleAgentMessage({ role: 'tool', toolName: 'AskUserQuestion' })).toBe(true)
    expect(isVisibleAgentMessage({
      role: 'tool',
      toolName: 'PermissionRequest',
      input: { kind: 'permission_request' }
    })).toBe(true)
    expect(isVisibleAgentMessage({ role: 'tool', toolName: 'ScheduledTaskDraft' })).toBe(true)
  })

  it('hides assistant thinking-only messages while keeping attachments visible', () => {
    expect(isVisibleAgentMessage({
      role: 'assistant',
      content: '',
      thinking: '正在检索并核验公开来源...',
      timestamp: 1779768000000
    })).toBe(false)

    expect(isVisibleAgentMessage({
      role: 'assistant',
      content: '',
      thinking: '我已经整理出两个候选项目，接下来需要您确认优先级。',
      timestamp: 1779768000000
    })).toBe(false)

    expect(isVisibleAgentMessage({
      role: 'assistant',
      content: '现在为您生成 PDF 报告。',
      timestamp: 1779768000000
    })).toBe(false)

    expect(isVisibleAgentMessage({
      role: 'assistant',
      content: '',
      files: [{ name: 'report.pdf' }]
    })).toBe(true)
  })
})
