import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('ClaudeCodeRunner tool preset forwarding', () => {
  it('passes the tools option through to the Claude Agent SDK', () => {
    const source = readFileSync(join(root, 'src/main/runners/claude-code-runner.js'), 'utf8')

    expect(source).toContain('if (options.tools) queryOptions.tools = options.tools')
  })
})
