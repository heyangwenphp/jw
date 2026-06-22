import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('skill edit content utilities', () => {
  it('imports the skill edit utility through a configured renderer alias', () => {
    const modalSource = readSource('src/renderer/pages/main/components/RightPanel/tabs/skills/SkillEditModal.vue')

    expect(modalSource).toContain("from '@utils/skill-edit-utils'")
    expect(modalSource).not.toContain('@renderer/utils/skill-edit-utils')
  })

  it('parses invocation names without throwing when raw content is missing', async () => {
    const { getSkillInvocationName } = await import('../src/renderer/utils/skill-edit-utils.js')

    expect(getSkillInvocationName(undefined, 'fallback-skill')).toBe('fallback-skill')
    expect(getSkillInvocationName(null, 'fallback-skill')).toBe('fallback-skill')
    expect(getSkillInvocationName('---\nname: parsed-skill\n---\n', 'fallback-skill')).toBe('parsed-skill')
    expect(getSkillInvocationName('---\nname: bad:name\n---\n', 'fallback-skill')).toBe('fallback-skill')
  })

  it('normalizes raw skill content to a string', async () => {
    const { toSkillRawContent } = await import('../src/renderer/utils/skill-edit-utils.js')

    expect(toSkillRawContent(undefined)).toBe('')
    expect(toSkillRawContent(null)).toBe('')
    expect(toSkillRawContent(123)).toBe('')
    expect(toSkillRawContent('content')).toBe('content')
  })
})
