export function toSkillRawContent(content) {
  return typeof content === 'string' ? content : ''
}

export function getSkillInvocationName(rawContent, skillId, fallback = 'my-skill') {
  const content = toSkillRawContent(rawContent)
  const fallbackName = skillId || fallback
  const nameMatch = content.match(/^name:\s*([^\n\r]*)$/m)
  const nameValue = nameMatch ? nameMatch[1].trim() : ''

  if (!nameValue || nameValue.includes(':')) {
    return fallbackName
  }
  return nameValue
}
