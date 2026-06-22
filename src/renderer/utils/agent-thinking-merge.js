const ASSISTANT_ROLE = 'assistant'

const hasVisibleText = (value) => String(value || '').trim().length > 0

const isAssistantThinkingOnlyMessage = (message) => {
  return message?.role === ASSISTANT_ROLE &&
    hasVisibleText(message.thinking) &&
    !hasVisibleText(message.content)
}

export const mergeAssistantThinkingOnlyMessage = (previousMessage, incomingMessage) => {
  if (!isAssistantThinkingOnlyMessage(previousMessage) || !isAssistantThinkingOnlyMessage(incomingMessage)) {
    return false
  }

  previousMessage.thinking = [
    String(previousMessage.thinking || '').trimEnd(),
    String(incomingMessage.thinking || '').trimStart()
  ].filter(Boolean).join('\n\n')
  previousMessage.timestamp = incomingMessage.timestamp || previousMessage.timestamp

  return true
}
