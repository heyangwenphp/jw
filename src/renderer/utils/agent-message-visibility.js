import {
  compactThinkingText,
  extractVisibleReportFromThinking,
  sanitizeAgentVisibleText
} from './agent-thinking-display'

export const HIDDEN_AGENT_TOOL_MESSAGE_TYPES = [
  'TodoWrite',
  'Read',
  'Write',
  'Bash',
  'WebSearch',
  'Glob',
  'WebFetch',
  'TaskOutput',
  'TaskResult'
]

const HIDDEN_AGENT_TOOL_MESSAGE_TYPE_SET = new Set(HIDDEN_AGENT_TOOL_MESSAGE_TYPES.map(type => type.toLowerCase()))

const getAgentToolMessageType = (message = {}) =>
  message.toolName || message.name || message.tool_name || ''

const hasVisibleText = (message = {}) => {
  const visibleContent = sanitizeAgentVisibleText(message.content || '')
  if (visibleContent.trim()) return true

  const promotedThinking = extractVisibleReportFromThinking(message.thinking || '')
  const visibleThinking = compactThinkingText(message.thinking || '')
  return Boolean(promotedThinking.trim() || visibleThinking.trim())
}

const hasVisibleAttachment = (message = {}) =>
  (Array.isArray(message.files) && message.files.length > 0) ||
  (Array.isArray(message.images) && message.images.length > 0)

export const isVisibleAgentMessage = (message = {}) => {
  if (message.role === 'tool') {
    return !HIDDEN_AGENT_TOOL_MESSAGE_TYPE_SET.has(getAgentToolMessageType(message).toLowerCase())
  }

  if (message.role === 'assistant') {
    return hasVisibleText(message) || hasVisibleAttachment(message)
  }

  return true
}
