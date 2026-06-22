import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readSource(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('agent panel conversation filtering', () => {
  it('keeps project library conversations out of the home agent list', () => {
    const source = readSource('src/renderer/composables/useAgentPanel.js')

    expect(source).toContain("if (conv.source === 'project-library') return false")
    expect(source).toMatch(/const shouldShowConversation = \(conv\) => \{[\s\S]*conv\.source === 'project-library'[\s\S]*sourceFilteredConversations/)
  })
})
