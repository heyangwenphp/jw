import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

const require = createRequire(import.meta.url)
const ClaudeCodeRunner = require('../src/main/runners/claude-code-runner.js')

describe('agent default thinking mode', () => {
  it('does not override thinking controls in Claude query options', async () => {
    const runner = new ClaudeCodeRunner()
    let capturedOptions = null

    runner._loadSDK = async () => ({ options }) => {
      capturedOptions = options
      return []
    }

    await runner.createQuery({}, {
      cwd: 'C:\\workspace\\demo',
      env: {}
    }, {})

    expect(capturedOptions).not.toHaveProperty('thinking')
    expect(capturedOptions).not.toHaveProperty('effort')
    expect(capturedOptions).not.toHaveProperty('maxTurns')
  })

  it('removes the quick response entry and fast-mode payload propagation', () => {
    const chatInputToolbarSource = readSource('src/renderer/pages/main/components/agent/ChatInputToolbar.vue')
    const chatInputSource = readSource('src/renderer/pages/main/components/agent/ChatInput.vue')
    const agentChatSource = readSource('src/renderer/composables/useAgentChat.js')
    const preloadSource = readSource('src/preload/preload.js')
    const clientApiSource = readSource('src/renderer/client-api/api.js')
    const agentHandlersSource = readSource('src/main/ipc-handlers/agent-handlers.js')
    const agentSessionManagerSource = readSource('src/main/agent-session-manager.js')
    const runnerSource = readSource('src/main/runners/claude-code-runner.js')

    expect(chatInputToolbarSource).not.toContain('fast-mode-btn')
    expect(chatInputToolbarSource).not.toContain('update:fastMode')
    expect(chatInputToolbarSource).not.toContain('快速响应')
    expect(chatInputSource).not.toContain(':fast-mode=')
    expect(chatInputSource).not.toContain('const fastMode')
    expect(chatInputSource).not.toContain('fastMode:')
    expect(agentChatSource).not.toContain('fastMode')
    expect(preloadSource).not.toContain('fastMode')
    expect(clientApiSource).not.toContain('fastMode')
    expect(agentHandlersSource).not.toContain('fastMode')
    expect(agentSessionManagerSource).not.toContain('fastMode')
    expect(agentSessionManagerSource).not.toContain('setMaxThinkingTokens')
    expect(runnerSource).not.toContain('disableExtendedThinking')
  })
})
