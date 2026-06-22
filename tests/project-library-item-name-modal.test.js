import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function readSource(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('project library item name modal', () => {
  it('uses a styled project-library modal instead of browser prompts for create and rename', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryWorkbench.vue')

    expect(source).toContain("import ProjectLibraryItemNameModal from './ProjectLibraryItemNameModal.vue'")
    expect(source).toContain('<ProjectLibraryItemNameModal')
    expect(source).toContain('v-model:show="showItemNameModal"')
    expect(source).toContain('@submit="handleItemNameSubmit"')
    expect(source).not.toContain('window.prompt')
  })

  it('keeps the item name modal visually aligned with the create project modal', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryItemNameModal.vue')

    expect(source).toContain('<n-modal')
    expect(source).toContain('class="project-library-item-dialog"')
    expect(source).toContain('class="dialog-header"')
    expect(source).toContain('class="form-block"')
    expect(source).toContain('class="footer-btn cancel"')
    expect(source).toContain('class="footer-btn submit"')
    expect(source).toContain('border-radius: 8px')
    expect(source).toContain('box-shadow: 0 26px 70px rgba(15, 23, 42, 0.26)')
  })

  it('creates new markdown project documents with blank content', () => {
    const source = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryWorkbench.vue')

    expect(source).toContain('content: \'\'')
    expect(source).not.toContain("content: state.nodeType === 'markdown' ? `# ${name.replace(/\\.md$/i, '')}\\n` : ''")
  })
})
