import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readSource(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('project create modal input focus behavior', () => {
  it('keeps custom project name and description inputs explicitly focusable', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectCreateModal.vue')

    expect(source).toContain('ref="customNameInputRef"')
    expect(source).toContain('ref="descriptionInputRef"')
    expect(source).toContain('class="project-input native-project-input"')
    expect(source).toContain('class="description-input native-description-input"')
    expect(source).toContain('@click="focusCustomName"')
    expect(source).toContain('@mousedown.capture="focusCustomName"')
    expect(source).toContain('@click="focusDescription"')
    expect(source).toContain('@mousedown.capture="focusDescription"')
    expect(source).toContain('const focusCustomName =')
    expect(source).toContain('const focusDescription =')
  })

  it('disables the modal focus trap so native inputs can keep focus', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectCreateModal.vue')

    expect(source).toContain(':trap-focus="false"')
  })
})
