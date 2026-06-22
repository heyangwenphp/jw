const normalizeMessageContent = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const isSameOptimisticMessage = (historyMessage, currentMessage) => {
  if (!historyMessage || !currentMessage) return false
  if (historyMessage.id && currentMessage.id && historyMessage.id === currentMessage.id) return true
  if (historyMessage.role !== currentMessage.role) return false

  const historyContent = normalizeMessageContent(historyMessage.content)
  const currentContent = normalizeMessageContent(currentMessage.content)
  if (!historyContent || historyContent !== currentContent) return false

  const historyTimestamp = Number(historyMessage.timestamp)
  const currentTimestamp = Number(currentMessage.timestamp)
  if (!Number.isFinite(historyTimestamp) || !Number.isFinite(currentTimestamp)) return false

  return Math.abs(historyTimestamp - currentTimestamp) <= 10000
}

export const mergeAgentMessageHistory = (history = [], current = []) => {
  const currentMessages = Array.isArray(current) ? current : []
  const historyMessages = Array.isArray(history) ? history : []
  const existingIds = new Set(currentMessages.map(message => message?.id).filter(Boolean))
  const toInsert = historyMessages.filter(historyMessage => {
    if (historyMessage?.id && existingIds.has(historyMessage.id)) return false
    return !currentMessages.some(currentMessage => isSameOptimisticMessage(historyMessage, currentMessage))
  })

  return [...toInsert, ...currentMessages]
}
