const { createWebSkillRaw } = require('./skill-scanner')
const { createWebAgentRaw } = require('./agent-scanner')
const yaml = require('js-yaml')

const CLAUDE_SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

function normalizeComponentType(type) {
  const normalized = String(type || '').trim().toLowerCase()
  return normalized === 'skill' || normalized === 'agent' ? normalized : null
}

function normalizeComponentId(component = {}) {
  return String(component.id || component.skillId || component.agentId || '').trim()
}

function normalizeRawContent(component = {}) {
  return String(component.rawContent || component.content || '')
}

function validateClaudeCodeSkillContent(rawContent, componentId) {
  const content = String(rawContent || '')
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/)
  if (!match) {
    return {
      valid: false,
      error: 'Claude Code skill SKILL.md must start with YAML frontmatter delimited by --- lines.'
    }
  }

  let parsed
  try {
    parsed = yaml.load(match[1]) || {}
  } catch (err) {
    return {
      valid: false,
      error: `Claude Code skill frontmatter is not valid YAML: ${err.message}`
    }
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : ''
  const body = String(match[2] || '').trim()
  if (!name) {
    return { valid: false, error: 'Claude Code skill frontmatter must include a name field.' }
  }
  if (!CLAUDE_SKILL_NAME.test(name)) {
    return {
      valid: false,
      error: 'Claude Code skill name must use lowercase letters, digits, and hyphens only, up to 64 characters.'
    }
  }
  if (componentId && name !== componentId) {
    return {
      valid: false,
      error: `Claude Code skill frontmatter name "${name}" must match the component id "${componentId}".`
    }
  }
  if (!description) {
    return { valid: false, error: 'Claude Code skill frontmatter must include a description field.' }
  }
  if (!body) {
    return { valid: false, error: 'Claude Code skill SKILL.md must include Markdown instructions after the frontmatter.' }
  }

  return { valid: true, name, description }
}

function buildConversationMetadata({ conversationId, messageId } = {}) {
  return {
    source: 'agent_conversation',
    createdBy: 'agent',
    originConversationId: conversationId || null,
    originMessageId: messageId || null,
    copiedFrom: null
  }
}

function createAgentConversationComponent({
  type,
  conversationId,
  messageId,
  component,
  projectPath,
  userSkillsDir,
  userAgentsDir,
  metadataStore,
  currentUser
}) {
  const componentType = normalizeComponentType(type)
  if (!componentType) {
    return { success: false, error: 'Component type must be "skill" or "agent".' }
  }

  const componentId = normalizeComponentId(component)
  if (!componentId) {
    return { success: false, error: 'Component id is required.' }
  }

  const rawContent = normalizeRawContent(component)
  if (!rawContent.trim()) {
    return { success: false, error: 'Component content is required.' }
  }
  if (componentType === 'skill') {
    const validation = validateClaudeCodeSkillContent(rawContent, componentId)
    if (!validation.valid) {
      return {
        success: false,
        code: 'INVALID_CLAUDE_SKILL',
        error: validation.error
      }
    }
  }

  const metadataDefaults = buildConversationMetadata({ conversationId, messageId })
  const result = componentType === 'skill'
    ? createWebSkillRaw({
      source: 'user',
      skillId: componentId,
      rawContent,
      projectPath,
      userSkillsDir,
      metadataStore,
      currentUser,
      metadataDefaults
    })
    : createWebAgentRaw({
      source: 'user',
      agentId: componentId,
      rawContent,
      projectPath,
      userAgentsDir,
      metadataStore,
      currentUser,
      metadataDefaults
    })

  if (!result.success) return result
  return {
    ...result,
    type: componentType,
    componentId,
    source: 'user',
    visibility: 'private'
  }
}

module.exports = {
  createAgentConversationComponent,
  normalizeComponentType,
  normalizeComponentId,
  normalizeRawContent,
  validateClaudeCodeSkillContent,
  buildConversationMetadata
}
