import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()

describe('web component metadata store', () => {
  it('creates private owner metadata and derives owner permissions', () => {
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const metadataPath = join(mkdtempSync(join(tmpdir(), 'jedi-component-meta-')), 'component-metadata.json')
    const store = new ComponentMetadataStore(metadataPath)

    const meta = store.ensure('skills', 'owner-skill', { ownerUserId: 7 })

    expect(meta).toEqual(expect.objectContaining({
      ownerUserId: 7,
      visibility: 'private'
    }))
    expect(store.permissions(meta, { id: 7 })).toEqual(expect.objectContaining({
      isOwner: true,
      canUse: true,
      canView: true,
      canCopy: true,
      canManage: true,
      canToggleVisibility: true
    }))
  })

  it('derives public non-owner permissions without management access', () => {
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const metadataPath = join(mkdtempSync(join(tmpdir(), 'jedi-component-meta-')), 'component-metadata.json')
    const store = new ComponentMetadataStore(metadataPath)
    const meta = store.setVisibility('skills', 'public-skill', {
      ownerUserId: 7,
      visibility: 'public'
    })

    expect(store.permissions(meta, { id: 8 })).toEqual(expect.objectContaining({
      isOwner: false,
      canUse: true,
      canView: true,
      canCopy: true,
      canManage: false,
      canToggleVisibility: false
    }))
  })

  it('lets the super admin account view private non-owner components without owner management access', () => {
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const metadataPath = join(mkdtempSync(join(tmpdir(), 'jedi-component-meta-')), 'component-metadata.json')
    const store = new ComponentMetadataStore(metadataPath)
    const meta = store.setVisibility('skills', 'private-skill', {
      ownerUserId: 7,
      visibility: 'private'
    })

    expect(store.permissions(meta, { id: 1, phone: '15527109305', isAdmin: true })).toEqual(expect.objectContaining({
      isOwner: false,
      canUse: true,
      canView: true,
      canCopy: true,
      canManage: false,
      canToggleVisibility: false
    }))
  })

  it('preserves safe conversation creation metadata', () => {
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const metadataPath = join(mkdtempSync(join(tmpdir(), 'jedi-component-meta-')), 'component-metadata.json')
    const store = new ComponentMetadataStore(metadataPath)

    const meta = store.ensure('skills', 'conversation-skill', {
      ownerUserId: 7,
      visibility: 'public',
      source: 'agent_conversation',
      createdBy: 'agent',
      originConversationId: 'conv-1',
      originMessageId: 'msg-1',
      copiedFrom: null,
      unsafeField: 'ignored'
    })

    expect(meta).toEqual(expect.objectContaining({
      ownerUserId: 7,
      visibility: 'public',
      source: 'agent_conversation',
      createdBy: 'agent',
      originConversationId: 'conv-1',
      originMessageId: 'msg-1',
      copiedFrom: null
    }))
    expect(meta).not.toHaveProperty('unsafeField')
  })

  it('persists built-in skill global enabled state with admin-only writes', () => {
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const metadataPath = join(mkdtempSync(join(tmpdir(), 'jedi-component-meta-')), 'component-metadata.json')
    const store = new ComponentMetadataStore(metadataPath)

    expect(store.getBuiltInSkillState('early-investment-research')).toEqual(expect.objectContaining({
      enabled: true,
      disabled: false
    }))

    expect(() => store.setBuiltInSkillEnabled(
      'early-investment-research',
      false,
      { id: 8, phone: '13900000000' }
    )).toThrow('Access denied')

    const updated = store.setBuiltInSkillEnabled(
      'early-investment-research',
      false,
      { id: 1, phone: '15527109305' }
    )

    expect(updated).toEqual(expect.objectContaining({
      success: true,
      skillId: 'early-investment-research',
      enabled: false,
      disabled: true,
      updatedBy: '15527109305'
    }))
    expect(store.isBuiltInSkillEnabled('early-investment-research')).toBe(false)
  })
})

describe('web skill API loading', () => {
  it('returns project .claude skills separately from built-in skills', () => {
    const { scanSkillsForWeb } = require('../server/skill-scanner.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-skills-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))

    try {
      mkdirSync(join(projectRoot, 'skills', 'built-in-demo'), { recursive: true })
      writeFileSync(join(projectRoot, 'skills', 'built-in-demo', 'SKILL.md'), [
        '---',
        'name: built-in-demo',
        'description: Built in demo',
        '---',
        '',
        '# Built In'
      ].join('\n'))

      mkdirSync(join(projectPath, '.codex', 'skills', 'project-demo'), { recursive: true })
      writeFileSync(join(projectPath, '.codex', 'skills', 'project-demo', 'SKILL.md'), [
        '---',
        'name: project-demo',
        'description: Project demo',
        '---',
        '',
        '# Project'
      ].join('\n'))

      mkdirSync(join(userSkillsDir, 'user-demo'), { recursive: true })
      writeFileSync(join(userSkillsDir, 'user-demo', 'SKILL.md'), [
        '---',
        'name: user-demo',
        'description: User demo',
        '---',
        '',
        '# User'
      ].join('\n'))

      const result = scanSkillsForWeb({ projectRoot, projectPath, userSkillsDir })

      expect(result.builtIn.map(skill => skill.id)).toContain('built-in-demo')
      expect(result.user).toEqual([
        expect.objectContaining({
          id: 'user-demo',
          name: 'user-demo',
          description: 'User demo',
          source: 'user'
        })
      ])
      expect(result.project).toEqual([
        expect.objectContaining({
          id: 'project-demo',
          name: 'project-demo',
          description: 'Project demo',
          source: 'project'
        })
      ])
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('marks built-in skills globally disabled and only exposes the switch flag to admin', () => {
    const { scanSkillsForWeb, toggleWebSkillDisabled } = require('../server/skill-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-skills-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      mkdirSync(join(projectRoot, 'skills', 'built-in-demo'), { recursive: true })
      writeFileSync(join(projectRoot, 'skills', 'built-in-demo', 'SKILL.md'), [
        '---',
        'name: built-in-demo',
        'description: Built in demo',
        '---',
        '',
        '# Built In'
      ].join('\n'))

      const denied = toggleWebSkillDisabled({
        source: 'built-in',
        skillId: 'built-in-demo',
        disabled: true,
        projectRoot,
        metadataStore: store,
        currentUser: { id: 8, phone: '13900000000' }
      })
      expect(denied).toEqual(expect.objectContaining({
        success: false,
        code: 'AUTH_FORBIDDEN'
      }))

      const toggled = toggleWebSkillDisabled({
        source: 'built-in',
        skillId: 'built-in-demo',
        disabled: true,
        projectRoot,
        metadataStore: store,
        currentUser: { id: 1, phone: '15527109305' }
      })
      expect(toggled).toEqual(expect.objectContaining({ success: true, disabled: true }))

      const ordinaryView = scanSkillsForWeb({
        projectRoot,
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 8, phone: '13900000000' }
      }).builtIn[0]
      expect(ordinaryView).toEqual(expect.objectContaining({
        id: 'built-in-demo',
        disabled: true,
        canUse: false,
        canCopy: false,
        canToggleBuiltIn: false
      }))

      const adminView = scanSkillsForWeb({
        projectRoot,
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 1, phone: '15527109305' }
      }).builtIn[0]
      expect(adminView).toEqual(expect.objectContaining({
        disabled: true,
        canToggleBuiltIn: true,
        canManage: true
      }))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('imports uploaded web skill files into the user skill store and exports them as zip', () => {
    const {
      importWebSkills,
      exportWebSkills,
      scanSkillsForWeb
    } = require('../server/skill-scanner.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-skills-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const skillContent = [
      '---',
      'name: uploaded-demo',
      'description: Uploaded demo',
      '---',
      '',
      '# Uploaded'
    ].join('\n')

    try {
      const result = importWebSkills({
        source: {
          type: 'folder',
          files: [{
            relativePath: 'uploaded-demo/SKILL.md',
            dataBase64: Buffer.from(skillContent, 'utf8').toString('base64')
          }]
        },
        targetSource: 'user',
        projectPath,
        userSkillsDir,
        selectedSkillIds: ['uploaded-demo']
      })

      expect(result.success).toBe(true)
      expect(result.imported).toEqual([
        expect.objectContaining({ skillId: 'uploaded-demo', name: 'uploaded-demo' })
      ])
      expect(existsSync(join(userSkillsDir, 'uploaded-demo', 'SKILL.md'))).toBe(true)

      const scanned = scanSkillsForWeb({ projectRoot, projectPath, userSkillsDir })
      expect(scanned.user.map(skill => skill.id)).toContain('uploaded-demo')

      const exported = exportWebSkills({
        source: 'user',
        scope: 'single',
        skillId: 'uploaded-demo',
        userSkillsDir,
        projectPath
      })

      expect(exported.success).toBe(true)
      expect(Buffer.isBuffer(exported.buffer)).toBe(true)
      expect(exported.filename).toBe('uploaded-demo.zip')
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('creates, reads, and updates web skill raw content', () => {
    const {
      createWebSkillRaw,
      getWebSkillRawContent,
      updateWebSkillRaw
    } = require('../server/skill-scanner.js')
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const initialContent = [
      '---',
      'name: raw-demo',
      'description: Raw demo',
      '---',
      '',
      '# Initial'
    ].join('\n')
    const updatedContent = initialContent.replace('# Initial', '# Updated')

    try {
      const created = createWebSkillRaw({
        source: 'user',
        skillId: 'raw-demo',
        rawContent: initialContent,
        projectPath,
        userSkillsDir
      })

      expect(created).toEqual(expect.objectContaining({ success: true }))

      const loaded = getWebSkillRawContent({
        source: 'user',
        skillId: 'raw-demo',
        projectPath,
        userSkillsDir
      })
      expect(loaded).toEqual(expect.objectContaining({
        success: true,
        content: initialContent
      }))

      const updated = updateWebSkillRaw({
        source: 'user',
        skillId: 'raw-demo',
        rawContent: updatedContent,
        projectPath,
        userSkillsDir
      })
      expect(updated).toEqual(expect.objectContaining({ success: true }))
      expect(readFileSync(join(userSkillsDir, 'raw-demo', 'SKILL.md'), 'utf8')).toBe(updatedContent)
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('creates conversation skills as private user components with origin metadata', () => {
    const { createWebSkillRaw } = require('../server/skill-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const store = new ComponentMetadataStore(join(projectPath, 'component-metadata.json'))

    try {
      const created = createWebSkillRaw({
        source: 'user',
        skillId: 'conversation-skill',
        rawContent: [
          '---',
          'name: conversation-skill',
          'description: Demo',
          '---',
          '',
          '# Demo'
        ].join('\n'),
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 7 },
        metadataDefaults: {
          visibility: 'public',
          source: 'agent_conversation',
          createdBy: 'agent',
          originConversationId: 'conv-1',
          originMessageId: 'msg-1'
        }
      })

      expect(created.success).toBe(true)
      expect(store.get('skills', 'conversation-skill')).toEqual(expect.objectContaining({
        ownerUserId: 7,
        visibility: 'private',
        source: 'agent_conversation',
        createdBy: 'agent',
        originConversationId: 'conv-1',
        originMessageId: 'msg-1'
      }))
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('saves structured agent conversation skill payloads through the user skill store', () => {
    const { createAgentConversationComponent } = require('../server/agent-component-creator.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const store = new ComponentMetadataStore(join(projectPath, 'component-metadata.json'))

    try {
      const result = createAgentConversationComponent({
        type: 'skill',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        component: {
          id: 'structured-skill',
          content: [
            '---',
            'name: structured-skill',
            'description: Demo',
            '---',
            '',
            '# Demo'
          ].join('\n')
        },
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 7 }
      })

      expect(result).toEqual(expect.objectContaining({
        success: true,
        type: 'skill',
        componentId: 'structured-skill',
        source: 'user',
        visibility: 'private'
      }))
      expect(existsSync(join(userSkillsDir, 'structured-skill', 'SKILL.md'))).toBe(true)
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('rejects non-standard Claude Code skill payloads from agent conversations', () => {
    const { createAgentConversationComponent } = require('../server/agent-component-creator.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const store = new ComponentMetadataStore(join(projectPath, 'component-metadata.json'))

    try {
      const result = createAgentConversationComponent({
        type: 'skill',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        component: {
          id: 'frontend-dev',
          content: '# Frontend Dev\n\nUse this skill for frontend development.'
        },
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 7 }
      })

      expect(result).toEqual(expect.objectContaining({
        success: false,
        code: 'INVALID_CLAUDE_SKILL'
      }))
      expect(result.error).toContain('YAML frontmatter')
      expect(existsSync(join(userSkillsDir, 'frontend-dev', 'SKILL.md'))).toBe(false)
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('returns readable Chinese skip reasons for duplicated web skill imports', () => {
    const { importWebSkills } = require('../server/skill-scanner.js')
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const skillContent = [
      '---',
      'name: early-investment-research',
      'description: Demo',
      '---',
      '',
      '# Demo'
    ].join('\n')

    try {
      mkdirSync(join(projectPath, '.codex', 'skills', 'early-investment-research'), { recursive: true })
      writeFileSync(join(projectPath, '.codex', 'skills', 'early-investment-research', 'SKILL.md'), skillContent)

      const result = importWebSkills({
        source: {
          type: 'folder',
          files: [{
            relativePath: 'early-investment-research/SKILL.md',
            dataBase64: Buffer.from(skillContent, 'utf8').toString('base64')
          }]
        },
        targetSource: 'user',
        projectPath,
        userSkillsDir,
        selectedSkillIds: ['early-investment-research']
      })

      expect(result.success).toBe(true)
      expect(result.skipped).toEqual([
        expect.objectContaining({
          skillId: 'early-investment-research',
          reason: 'project already has a skill with the same ID.'
        })
      ])
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('passes project paths through the web skills client and capability list', () => {
    const apiSource = readFileSync(join(root, 'src/renderer/client-api/api.js'), 'utf8')
    const polyfillSource = readFileSync(join(root, 'src/renderer/client-api/electron-polyfill.js'), 'utf8')

    expect(apiSource).toContain('export async function listSkillsAll(projectPath)')
    expect(apiSource).toContain('export async function getSkillRawContent(params)')
    expect(apiSource).toContain('export async function createSkillRaw(params)')
    expect(apiSource).toContain('export async function updateSkillRaw(params)')
    expect(apiSource).toContain('export async function validateSkillImport(source)')
    expect(apiSource).toContain('export async function importSkills(params)')
    expect(apiSource).toContain('export async function exportSkill(params)')
    expect(apiSource).toContain('export async function exportSkillsBatch(params)')
    expect(apiSource).toContain('api.get(`/api/skills')
    expect(apiSource).toContain('projectPath')
    expect(polyfillSource).toContain('fetchCapabilities: async (projectPath = null)')
    expect(polyfillSource).toContain('listSkillsAll(projectPath)')
    expect(polyfillSource).toContain('const skills = [')
    expect(polyfillSource).toContain('validateSkillImport,')
    expect(polyfillSource).toContain('getSkillRawContent,')
    expect(polyfillSource).toContain('createSkillRaw,')
    expect(polyfillSource).toContain('updateSkillRaw,')
    expect(polyfillSource).toContain('importSkills,')
    expect(polyfillSource).toContain('exportSkill,')
    expect(polyfillSource).toContain('exportSkillsBatch,')
    expect(polyfillSource).toContain('...(skillsResult?.project || [])')
    expect(polyfillSource).toContain('...(skillsResult?.builtIn || [])')
  })

  it('exposes web skill import and export endpoints', () => {
    const serverSource = readFileSync(join(root, 'server/index.js'), 'utf8')

    expect(serverSource).toContain("app.post('/api/skills/import/validate'")
    expect(serverSource).toContain("app.get('/api/skills/raw'")
    expect(serverSource).toContain("app.post('/api/skills/raw'")
    expect(serverSource).toContain("app.put('/api/skills/raw'")
    expect(serverSource).toContain("app.post('/api/skills/import'")
    expect(serverSource).toContain("app.post('/api/skills/export'")
    expect(serverSource).toContain('importWebSkills({')
    expect(serverSource).toContain('exportWebSkills({')
    expect(serverSource).toContain('buildAttachmentContentDisposition(exportResult.filename)')
  })

  it('exposes web skill visibility endpoint and client method', () => {
    const serverSource = readFileSync(join(root, 'server/index.js'), 'utf8')
    const apiSource = readFileSync(join(root, 'src/renderer/client-api/api.js'), 'utf8')
    const polyfillSource = readFileSync(join(root, 'src/renderer/client-api/electron-polyfill.js'), 'utf8')

    expect(serverSource).toContain("app.patch('/api/skills/visibility'")
    expect(apiSource).toContain('export async function updateSkillVisibility(params)')
    expect(apiSource).toContain("api.patch('/api/skills/visibility', params)")
    expect(polyfillSource).toContain('updateSkillVisibility,')
    expect(polyfillSource).toContain('...(skillsResult?.public || [])')
  })

  it('exposes web skill enabled toggle endpoint and client method', () => {
    const serverSource = readFileSync(join(root, 'server/index.js'), 'utf8')
    const apiSource = readFileSync(join(root, 'src/renderer/client-api/api.js'), 'utf8')
    const polyfillSource = readFileSync(join(root, 'src/renderer/client-api/electron-polyfill.js'), 'utf8')

    expect(serverSource).toContain("app.patch('/api/skills/disabled'")
    expect(apiSource).toContain('export async function toggleSkillDisabled(params)')
    expect(apiSource).toContain("api.patch('/api/skills/disabled', params)")
    expect(polyfillSource).toContain('toggleComponentDisabled: async (type, id, disabled) => {')
    expect(polyfillSource).toMatch(/updateSkillVisibility,\s*toggleSkillDisabled,/)
    expect(polyfillSource).toContain('return toggleSkillDisabled({ skillId: id, disabled })')
  })

  it('renders the built-in skill switch only from the admin-only capability flag', () => {
    const source = readFileSync(join(root, 'src/renderer/pages/main/components/RightPanel/tabs/SkillsTab.vue'), 'utf8')

    expect(source).toContain('v-if="skill.canToggleBuiltIn"')
    expect(source).toContain('skill.canCopy !== false')
    expect(source).toContain("source: skill.source || 'user'")
  })
})

describe('web skill public visibility', () => {
  function writeSkill(dir, skillId, description = 'Demo skill') {
    mkdirSync(join(dir, skillId), { recursive: true })
    writeFileSync(join(dir, skillId, 'SKILL.md'), [
      '---',
      `name: ${skillId}`,
      `description: ${description}`,
      '---',
      '',
      '# Body'
    ].join('\n'))
  }

  it('keeps owner public skills in user and exposes them to others in public', () => {
    const { scanSkillsForWeb } = require('../server/skill-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-skills-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      writeSkill(userSkillsDir, 'shared-skill')
      store.setVisibility('skills', 'shared-skill', { ownerUserId: 7, visibility: 'public' })

      const ownerView = scanSkillsForWeb({
        projectRoot,
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 7 }
      })
      expect(ownerView.user.map(skill => skill.id)).toContain('shared-skill')
      expect(ownerView.public.map(skill => skill.id)).not.toContain('shared-skill')
      expect(ownerView.user.find(skill => skill.id === 'shared-skill')).toEqual(expect.objectContaining({
        visibility: 'public',
        canManage: true,
        canToggleVisibility: true
      }))

      const otherView = scanSkillsForWeb({
        projectRoot,
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })
      expect(otherView.user.map(skill => skill.id)).not.toContain('shared-skill')
      expect(otherView.public).toEqual([
        expect.objectContaining({
          id: 'shared-skill',
          source: 'public',
          canCopy: true,
          canManage: false
        })
      ])
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('shows every user-created skill to the super admin account', () => {
    const { scanSkillsForWeb } = require('../server/skill-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-skills-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      writeSkill(userSkillsDir, 'owner-private-skill')
      writeSkill(userSkillsDir, 'other-private-skill')
      store.setVisibility('skills', 'owner-private-skill', { ownerUserId: 7, visibility: 'private' })
      store.setVisibility('skills', 'other-private-skill', { ownerUserId: 8, visibility: 'private' })

      const adminView = scanSkillsForWeb({
        projectRoot,
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 1, phone: '15527109305', isAdmin: true }
      })

      expect(adminView.user.map(skill => skill.id)).toEqual(expect.arrayContaining(['owner-private-skill', 'other-private-skill']))
      expect(adminView.user).toHaveLength(2)
      expect(adminView.public).toEqual([])
      expect(adminView.user.find(skill => skill.id === 'other-private-skill')).toEqual(expect.objectContaining({
        ownerUserId: 8,
        visibility: 'private',
        canView: true,
        canManage: false,
        canToggleVisibility: false
      }))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('copies public skills into the current user store as private owned copies', () => {
    const { copyWebSkill, scanSkillsForWeb } = require('../server/skill-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-skills-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      writeSkill(userSkillsDir, 'shared-skill')
      store.setVisibility('skills', 'shared-skill', { ownerUserId: 7, visibility: 'public' })

      const result = copyWebSkill({
        fromSource: 'public',
        skillId: 'shared-skill',
        toSource: 'user',
        newSkillId: 'copied-skill',
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })

      expect(result.success).toBe(true)
      const copied = scanSkillsForWeb({
        projectRoot,
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      }).user.find(skill => skill.id === 'copied-skill')
      expect(copied).toEqual(expect.objectContaining({
        ownerUserId: 8,
        visibility: 'private',
        canManage: true
      }))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('toggles user skills by renaming SKILL.md and keeps disabled skills visible', () => {
    const { scanSkillsForWeb, toggleWebSkillDisabled } = require('../server/skill-scanner.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-skills-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))

    try {
      writeSkill(userSkillsDir, 'toggle-skill')

      expect(toggleWebSkillDisabled({
        source: 'user',
        skillId: 'toggle-skill',
        disabled: true,
        projectPath,
        userSkillsDir
      })).toEqual(expect.objectContaining({ success: true }))
      expect(existsSync(join(userSkillsDir, 'toggle-skill', 'SKILL.md'))).toBe(false)
      expect(existsSync(join(userSkillsDir, 'toggle-skill', 'SKILL.md.disabled'))).toBe(true)
      expect(scanSkillsForWeb({ projectRoot, projectPath, userSkillsDir }).user).toEqual([
        expect.objectContaining({ id: 'toggle-skill', disabled: true })
      ])

      expect(toggleWebSkillDisabled({
        source: 'user',
        skillId: 'toggle-skill',
        disabled: false,
        projectPath,
        userSkillsDir
      })).toEqual(expect.objectContaining({ success: true }))
      expect(existsSync(join(userSkillsDir, 'toggle-skill', 'SKILL.md'))).toBe(true)
      expect(existsSync(join(userSkillsDir, 'toggle-skill', 'SKILL.md.disabled'))).toBe(false)
      expect(scanSkillsForWeb({ projectRoot, projectPath, userSkillsDir }).user).toEqual([
        expect.objectContaining({ id: 'toggle-skill', disabled: false })
      ])
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('allows reading public skill content but blocks non-owner management', () => {
    const {
      getWebSkillRawContent,
      updateWebSkillRaw,
      deleteWebSkill,
      updateWebSkillVisibility
    } = require('../server/skill-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-skills-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-skills-project-'))
    const userSkillsDir = mkdtempSync(join(tmpdir(), 'jedi-web-skills-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      writeSkill(userSkillsDir, 'shared-skill', 'Shared demo')
      writeSkill(userSkillsDir, 'private-skill', 'Private demo')
      store.setVisibility('skills', 'shared-skill', { ownerUserId: 7, visibility: 'public' })
      store.setVisibility('skills', 'private-skill', { ownerUserId: 7, visibility: 'private' })

      const readable = getWebSkillRawContent({
        source: 'public',
        skillId: 'shared-skill',
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })
      expect(readable).toEqual(expect.objectContaining({
        success: true,
        content: expect.stringContaining('Shared demo')
      }))

      const privateRead = getWebSkillRawContent({
        source: 'public',
        skillId: 'private-skill',
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })
      expect(privateRead).toEqual(expect.objectContaining({
        success: false,
        code: 'AUTH_FORBIDDEN'
      }))

      expect(updateWebSkillVisibility({
        skillId: 'shared-skill',
        visibility: 'private',
        metadataStore: store,
        currentUser: { id: 8 }
      })).toEqual(expect.objectContaining({ success: false, code: 'AUTH_FORBIDDEN' }))

      expect(updateWebSkillRaw({
        source: 'user',
        skillId: 'shared-skill',
        rawContent: 'changed',
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })).toEqual(expect.objectContaining({ success: false, code: 'AUTH_FORBIDDEN' }))

      expect(deleteWebSkill({
        source: 'user',
        skillId: 'shared-skill',
        projectPath,
        userSkillsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })).toEqual(expect.objectContaining({ success: false, code: 'AUTH_FORBIDDEN' }))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })
})
