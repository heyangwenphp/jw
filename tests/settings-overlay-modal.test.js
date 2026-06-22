import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('main settings overlay modal', () => {
  it('renders model and capability settings inside a constrained modal shell', () => {
    const source = readSource('src/renderer/pages/main/components/MainContent.vue')

    expect(source).toContain('class="settings-modal-backdrop"')
    expect(source).toContain('class="settings-modal"')
    expect(source).toContain('class="settings-modal-body"')
    expect(source).toContain('width: 95%')
    expect(source).toContain('max-height: calc(100vh - 32px)')
    expect(source).toContain('overflow: auto')
  })
})
