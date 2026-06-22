import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()

function agentMarkdown({ name, description = 'Demo agent', color = 'blue' }) {
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `color: ${color}`,
    '---',
    '',
    '# Agent Prompt',
    '',
    'Use this agent for focused test work.'
  ].join('\n')
}

describe('web agent API loading', () => {
  it('returns user and project agents separately from built-in agents', () => {
    const { scanAgentsForWeb } = require('../server/agent-scanner.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-agents-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))

    try {
      mkdirSync(join(projectRoot, 'agents'), { recursive: true })
      writeFileSync(join(projectRoot, 'agents', 'built-in-demo.md'), agentMarkdown({
        name: 'built-in-demo',
        description: 'Built in demo'
      }))

      mkdirSync(join(projectPath, '.codex', 'agents'), { recursive: true })
      writeFileSync(join(projectPath, '.codex', 'agents', 'project-demo.md'), agentMarkdown({
        name: 'project-demo',
        description: 'Project demo'
      }))

      writeFileSync(join(userAgentsDir, 'user-demo.md'), agentMarkdown({
        name: 'user-demo',
        description: 'User demo'
      }))

      const result = scanAgentsForWeb({ projectRoot, projectPath, userAgentsDir })

      expect(result.builtIn.map(agent => agent.id)).toContain('built-in-demo')
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
      expect(result.all.map(agent => agent.id)).toContain('user-demo')
      expect(result.all.map(agent => agent.id)).toContain('project-demo')
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('creates raw web agents and reads, renames, updates, then deletes them', () => {
    const {
      createWebAgentRaw,
      getWebAgentRawContent,
      renameWebAgent,
      updateWebAgentRaw,
      deleteWebAgent
    } = require('../server/agent-scanner.js')
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))

    try {
      const created = createWebAgentRaw({
        source: 'user',
        agentId: 'custom-agent',
        rawContent: agentMarkdown({ name: 'custom-agent' }),
        projectPath,
        userAgentsDir
      })

      expect(created).toEqual(expect.objectContaining({ success: true }))
      expect(existsSync(join(userAgentsDir, 'custom-agent.md'))).toBe(true)

      const raw = getWebAgentRawContent({
        source: 'user',
        agentId: 'custom-agent',
        projectPath,
        userAgentsDir
      })
      expect(raw).toEqual(expect.objectContaining({
        success: true,
        content: expect.stringContaining('name: custom-agent')
      }))

      const renamed = renameWebAgent({
        source: 'user',
        oldAgentId: 'custom-agent',
        newAgentId: 'renamed-agent',
        projectPath,
        userAgentsDir
      })
      expect(renamed.success).toBe(true)
      expect(existsSync(join(userAgentsDir, 'renamed-agent.md'))).toBe(true)

      const updated = updateWebAgentRaw({
        source: 'user',
        agentId: 'renamed-agent',
        rawContent: agentMarkdown({ name: 'renamed-agent', description: 'Updated demo' }),
        projectPath,
        userAgentsDir
      })
      expect(updated.success).toBe(true)
      expect(readFileSync(join(userAgentsDir, 'renamed-agent.md'), 'utf8')).toContain('Updated demo')

      const deleted = deleteWebAgent({
        source: 'user',
        agentId: 'renamed-agent',
        projectPath,
        userAgentsDir
      })
      expect(deleted.success).toBe(true)
      expect(existsSync(join(userAgentsDir, 'renamed-agent.md'))).toBe(false)
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('creates conversation agents as private user components with origin metadata', () => {
    const { createWebAgentRaw } = require('../server/agent-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))
    const store = new ComponentMetadataStore(join(projectPath, 'component-metadata.json'))

    try {
      const created = createWebAgentRaw({
        source: 'user',
        agentId: 'conversation-agent',
        rawContent: agentMarkdown({ name: 'conversation-agent' }),
        projectPath,
        userAgentsDir,
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
      expect(store.get('agents', 'conversation-agent')).toEqual(expect.objectContaining({
        ownerUserId: 7,
        visibility: 'private',
        source: 'agent_conversation',
        createdBy: 'agent',
        originConversationId: 'conv-1',
        originMessageId: 'msg-1'
      }))
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('saves structured agent conversation agent payloads through the user agent store', () => {
    const { createAgentConversationComponent } = require('../server/agent-component-creator.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))
    const store = new ComponentMetadataStore(join(projectPath, 'component-metadata.json'))

    try {
      const result = createAgentConversationComponent({
        type: 'agent',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        component: {
          id: 'structured-agent',
          content: agentMarkdown({ name: 'structured-agent' })
        },
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 7 }
      })

      expect(result).toEqual(expect.objectContaining({
        success: true,
        type: 'agent',
        componentId: 'structured-agent',
        source: 'user',
        visibility: 'private'
      }))
      expect(existsSync(join(userAgentsDir, 'structured-agent.md'))).toBe(true)
    } finally {
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('imports uploaded web agent files into the user store and exports them as zip', () => {
    const {
      importWebAgents,
      exportWebAgents,
      scanAgentsForWeb
    } = require('../server/agent-scanner.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-agents-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))
    const content = agentMarkdown({ name: 'uploaded-agent', description: 'Uploaded demo' })

    try {
      const result = importWebAgents({
        source: {
          type: 'files',
          files: [{
            relativePath: 'uploaded-agent.md',
            dataBase64: Buffer.from(content, 'utf8').toString('base64')
          }]
        },
        targetSource: 'user',
        projectPath,
        userAgentsDir,
        selectedAgentIds: ['uploaded-agent']
      })

      expect(result.success).toBe(true)
      expect(result.imported).toEqual([
        expect.objectContaining({ agentId: 'uploaded-agent', name: 'uploaded-agent' })
      ])
      expect(existsSync(join(userAgentsDir, 'uploaded-agent.md'))).toBe(true)

      const scanned = scanAgentsForWeb({ projectRoot, projectPath, userAgentsDir })
      expect(scanned.user.map(agent => agent.id)).toContain('uploaded-agent')

      const exported = exportWebAgents({
        source: 'user',
        scope: 'single',
        agentId: 'uploaded-agent',
        userAgentsDir,
        projectPath
      })

      expect(exported.success).toBe(true)
      expect(Buffer.isBuffer(exported.buffer)).toBe(true)
      expect(exported.filename).toBe('uploaded-agent.zip')
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('passes project paths through the web agents client and polyfill', () => {
    const apiSource = readFileSync(join(root, 'src/renderer/client-api/api.js'), 'utf8')
    const polyfillSource = readFileSync(join(root, 'src/renderer/client-api/electron-polyfill.js'), 'utf8')

    expect(apiSource).toContain('export async function listAgentsAll(projectPath)')
    expect(apiSource).toContain('export async function createAgentRaw(params)')
    expect(apiSource).toContain('export async function validateAgentImport(source)')
    expect(apiSource).toContain('export async function importAgents(params)')
    expect(apiSource).toContain('export async function exportAgent(params)')
    expect(apiSource).toContain('export async function exportAgentsBatch(params)')
    expect(apiSource).toContain('api.get(`/api/agents')
    expect(apiSource).toContain('/api/agents/import/validate')
    expect(apiSource).toContain('/api/agents/export')
    expect(polyfillSource).toContain('createAgentRaw, updateAgentRaw, getAgentRawContent')
    expect(polyfillSource).toContain('validateAgentImport, importAgents, exportAgent, exportAgentsBatch')
    expect(polyfillSource).toContain('createAgentRaw,')
    expect(polyfillSource).toContain('importAgents,')
    expect(polyfillSource).not.toContain('createAgentRaw: noop')
    expect(polyfillSource).not.toContain('validateAgentImport: noop')
  })

  it('exposes web agent import, export, and raw edit endpoints', () => {
    const serverSource = readFileSync(join(root, 'server/index.js'), 'utf8')

    expect(serverSource).toContain("app.post('/api/agents/raw'")
    expect(serverSource).toContain("app.put('/api/agents/raw'")
    expect(serverSource).toContain("app.get('/api/agents/raw'")
    expect(serverSource).toContain("app.post('/api/agents/import/validate'")
    expect(serverSource).toContain("app.post('/api/agents/import'")
    expect(serverSource).toContain("app.post('/api/agents/export'")
    expect(serverSource).toContain('importWebAgents({')
    expect(serverSource).toContain('exportWebAgents({')
    expect(serverSource).toContain('X-Agent-Count')
  })

  it('exposes web agent visibility endpoint and client method', () => {
    const serverSource = readFileSync(join(root, 'server/index.js'), 'utf8')
    const apiSource = readFileSync(join(root, 'src/renderer/client-api/api.js'), 'utf8')
    const polyfillSource = readFileSync(join(root, 'src/renderer/client-api/electron-polyfill.js'), 'utf8')

    expect(serverSource).toContain("app.patch('/api/agents/visibility'")
    expect(apiSource).toContain('export async function updateAgentVisibility(params)')
    expect(apiSource).toContain("api.patch('/api/agents/visibility', params)")
    expect(polyfillSource).toContain('updateAgentVisibility,')
    expect(polyfillSource).toContain('...(agentsResult?.public || [])')
  })

  it('exposes web agent enabled toggle endpoint and client method', () => {
    const serverSource = readFileSync(join(root, 'server/index.js'), 'utf8')
    const apiSource = readFileSync(join(root, 'src/renderer/client-api/api.js'), 'utf8')
    const polyfillSource = readFileSync(join(root, 'src/renderer/client-api/electron-polyfill.js'), 'utf8')

    expect(serverSource).toContain("app.patch('/api/agents/disabled'")
    expect(apiSource).toContain('export async function toggleAgentDisabled(params)')
    expect(apiSource).toContain("api.patch('/api/agents/disabled', params)")
    expect(polyfillSource).toContain('updateAgentVisibility, toggleAgentDisabled,')
    expect(polyfillSource).toContain('return toggleAgentDisabled({ agentId: id, disabled })')
  })

  it('persists built-in agent global enabled state with admin-only writes', () => {
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-agents-root-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      expect(store.getBuiltInAgentState('official-agent')).toEqual({
        enabled: true,
        disabled: false,
        updatedBy: null,
        updatedAt: null
      })
      expect(() => store.setBuiltInAgentEnabled('official-agent', false, { id: 8, phone: '18800000000' }))
        .toThrow('Access denied')

      const disabled = store.setBuiltInAgentEnabled('official-agent', false, { id: 1, phone: '15527109305' })
      expect(disabled).toEqual(expect.objectContaining({
        success: true,
        agentId: 'official-agent',
        enabled: false,
        disabled: true,
        updatedBy: '15527109305'
      }))
      expect(store.getBuiltInAgentState('official-agent')).toEqual(expect.objectContaining({
        enabled: false,
        disabled: true,
        updatedBy: '15527109305'
      }))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it('marks built-in agents globally disabled and only exposes the switch flag to admin', () => {
    const { scanAgentsForWeb, toggleWebAgentDisabled } = require('../server/agent-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-agents-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      mkdirSync(join(projectRoot, 'agents'), { recursive: true })
      writeFileSync(join(projectRoot, 'agents', 'official-agent.md'), agentMarkdown({
        name: 'official-agent',
        description: 'Official demo'
      }))

      const blocked = toggleWebAgentDisabled({
        source: 'built-in',
        agentId: 'official-agent',
        disabled: true,
        projectRoot,
        metadataStore: store,
        currentUser: { id: 8, phone: '18800000000' }
      })
      expect(blocked).toEqual(expect.objectContaining({
        success: false,
        code: 'AUTH_FORBIDDEN'
      }))

      expect(toggleWebAgentDisabled({
        source: 'built-in',
        agentId: 'official-agent',
        disabled: true,
        projectRoot,
        metadataStore: store,
        currentUser: { id: 1, phone: '15527109305' }
      })).toEqual(expect.objectContaining({
        success: true,
        agentId: 'official-agent',
        disabled: true
      }))

      const userView = scanAgentsForWeb({
        projectRoot,
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 8, phone: '18800000000' }
      }).builtIn.find(agent => agent.id === 'official-agent')
      expect(userView).toEqual(expect.objectContaining({
        disabled: true,
        enabled: false,
        canUse: false,
        canCopy: false,
        canManage: false,
        canToggleBuiltIn: false,
        globalDisabled: true
      }))

      const adminView = scanAgentsForWeb({
        projectRoot,
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 1, phone: '15527109305' }
      }).builtIn.find(agent => agent.id === 'official-agent')
      expect(adminView).toEqual(expect.objectContaining({
        disabled: true,
        canManage: true,
        canToggleBuiltIn: true,
        globalDisabled: true
      }))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('renders the built-in agent switch only from the admin-only capability flag', () => {
    const source = readFileSync(join(root, 'src/renderer/pages/main/components/RightPanel/tabs/AgentsTab.vue'), 'utf8')

    expect(source).toContain('v-if="agent.canToggleBuiltIn"')
    expect(source).toContain('v-if="agent.canCopy !== false"')
    expect(source).toContain("source: agent.source || 'user'")
    expect(source).toContain("agent.source === 'built-in' ? 'builtIn' : agent.source")
  })

  it('exposes agent conversation component creation endpoint and client method', () => {
    const serverSource = readFileSync(join(root, 'server/index.js'), 'utf8')
    const apiSource = readFileSync(join(root, 'src/renderer/client-api/api.js'), 'utf8')
    const polyfillSource = readFileSync(join(root, 'src/renderer/client-api/electron-polyfill.js'), 'utf8')

    expect(serverSource).toContain("app.post('/api/agent/components'")
    expect(serverSource).toContain('createAgentConversationComponent({')
    expect(serverSource).toContain('agentSessionManager.setAgentComponentCreator')
    expect(serverSource).toContain('const currentUser = assertWebConversationAccess(req.body?.conversationId, requireWebUser(req))')
    expect(serverSource.indexOf("if (typeof callback === 'function') callback({ success: true })"))
      .toBeLessThan(serverSource.indexOf('agentSessionManager.sendMessage(sessionId, message, { model, providerId, currentUser })'))
    expect(serverSource).toContain('setImmediate(() => {')
    expect(serverSource).toContain('agentSessionManager.sendMessage(sessionId, message, { model, providerId, currentUser })')
    expect(apiSource).toContain('export async function createAgentConversationComponent(params)')
    expect(apiSource).toContain("api.post('/api/agent/components', params)")
    expect(polyfillSource).toContain('createAgentConversationComponent,')
  })
})

describe('web agent public visibility', () => {
  it('keeps owner public agents in user and exposes them to others in public', () => {
    const { scanAgentsForWeb } = require('../server/agent-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-agents-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      writeFileSync(join(userAgentsDir, 'shared-agent.md'), agentMarkdown({
        name: 'shared-agent',
        description: 'Shared demo'
      }))
      store.setVisibility('agents', 'shared-agent', { ownerUserId: 7, visibility: 'public' })

      const ownerView = scanAgentsForWeb({
        projectRoot,
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 7 }
      })
      expect(ownerView.user.map(agent => agent.id)).toContain('shared-agent')
      expect(ownerView.public.map(agent => agent.id)).not.toContain('shared-agent')

      const otherView = scanAgentsForWeb({
        projectRoot,
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })
      expect(otherView.public).toEqual([
        expect.objectContaining({
          id: 'shared-agent',
          source: 'public',
          canCopy: true,
          canManage: false
        })
      ])
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('shows every user-created agent to the super admin account', () => {
    const { scanAgentsForWeb } = require('../server/agent-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-agents-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      writeFileSync(join(userAgentsDir, 'owner-private-agent.md'), agentMarkdown({ name: 'owner-private-agent' }))
      writeFileSync(join(userAgentsDir, 'other-private-agent.md'), agentMarkdown({ name: 'other-private-agent' }))
      store.setVisibility('agents', 'owner-private-agent', { ownerUserId: 7, visibility: 'private' })
      store.setVisibility('agents', 'other-private-agent', { ownerUserId: 8, visibility: 'private' })

      const adminView = scanAgentsForWeb({
        projectRoot,
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 1, phone: '15527109305', isAdmin: true }
      })

      expect(adminView.user.map(agent => agent.id)).toEqual(expect.arrayContaining(['owner-private-agent', 'other-private-agent']))
      expect(adminView.user).toHaveLength(2)
      expect(adminView.public).toEqual([])
      expect(adminView.user.find(agent => agent.id === 'other-private-agent')).toEqual(expect.objectContaining({
        ownerUserId: 8,
        visibility: 'private',
        canView: true,
        canManage: false,
        canToggleVisibility: false
      }))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('copies public agents into the current user store as private owned copies', () => {
    const { copyWebAgent, scanAgentsForWeb } = require('../server/agent-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-agents-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      writeFileSync(join(userAgentsDir, 'shared-agent.md'), agentMarkdown({ name: 'shared-agent' }))
      store.setVisibility('agents', 'shared-agent', { ownerUserId: 7, visibility: 'public' })

      const result = copyWebAgent({
        fromSource: 'public',
        agentId: 'shared-agent',
        toSource: 'user',
        newAgentId: 'copied-agent',
        projectPath,
        userAgentsDir,
        projectRoot,
        metadataStore: store,
        currentUser: { id: 8 }
      })

      expect(result.success).toBe(true)
      const copied = scanAgentsForWeb({
        projectRoot,
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      }).user.find(agent => agent.id === 'copied-agent')
      expect(copied).toEqual(expect.objectContaining({
        ownerUserId: 8,
        visibility: 'private',
        canManage: true
      }))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('toggles user agents by renaming markdown files and keeps disabled agents visible', () => {
    const { scanAgentsForWeb, toggleWebAgentDisabled } = require('../server/agent-scanner.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-agents-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))

    try {
      writeFileSync(join(userAgentsDir, 'toggle-agent.md'), agentMarkdown({ name: 'toggle-agent' }))

      expect(toggleWebAgentDisabled({
        source: 'user',
        agentId: 'toggle-agent',
        disabled: true,
        projectPath,
        userAgentsDir,
        projectRoot
      })).toEqual(expect.objectContaining({ success: true }))
      expect(existsSync(join(userAgentsDir, 'toggle-agent.md'))).toBe(false)
      expect(existsSync(join(userAgentsDir, 'toggle-agent.md.disabled'))).toBe(true)
      expect(scanAgentsForWeb({ projectRoot, projectPath, userAgentsDir }).user).toEqual([
        expect.objectContaining({ id: 'toggle-agent', disabled: true })
      ])

      expect(toggleWebAgentDisabled({
        source: 'user',
        agentId: 'toggle-agent',
        disabled: false,
        projectPath,
        userAgentsDir,
        projectRoot
      })).toEqual(expect.objectContaining({ success: true }))
      expect(existsSync(join(userAgentsDir, 'toggle-agent.md'))).toBe(true)
      expect(existsSync(join(userAgentsDir, 'toggle-agent.md.disabled'))).toBe(false)
      expect(scanAgentsForWeb({ projectRoot, projectPath, userAgentsDir }).user).toEqual([
        expect.objectContaining({ id: 'toggle-agent', disabled: false })
      ])
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })

  it('allows reading public agent content but blocks non-owner management', () => {
    const {
      getWebAgentRawContent,
      updateWebAgentRaw,
      deleteWebAgent,
      renameWebAgent,
      updateWebAgentVisibility
    } = require('../server/agent-scanner.js')
    const { ComponentMetadataStore } = require('../server/component-metadata.js')
    const projectRoot = mkdtempSync(join(tmpdir(), 'jedi-web-agents-root-'))
    const projectPath = mkdtempSync(join(tmpdir(), 'jedi-web-agents-project-'))
    const userAgentsDir = mkdtempSync(join(tmpdir(), 'jedi-web-agents-user-'))
    const store = new ComponentMetadataStore(join(projectRoot, 'component-metadata.json'))

    try {
      writeFileSync(join(userAgentsDir, 'shared-agent.md'), agentMarkdown({
        name: 'shared-agent',
        description: 'Shared demo'
      }))
      writeFileSync(join(userAgentsDir, 'private-agent.md'), agentMarkdown({
        name: 'private-agent',
        description: 'Private demo'
      }))
      store.setVisibility('agents', 'shared-agent', { ownerUserId: 7, visibility: 'public' })
      store.setVisibility('agents', 'private-agent', { ownerUserId: 7, visibility: 'private' })

      const readable = getWebAgentRawContent({
        source: 'public',
        agentId: 'shared-agent',
        projectPath,
        userAgentsDir,
        projectRoot,
        metadataStore: store,
        currentUser: { id: 8 }
      })
      expect(readable).toEqual(expect.objectContaining({
        success: true,
        content: expect.stringContaining('Shared demo')
      }))

      const privateRead = getWebAgentRawContent({
        source: 'public',
        agentId: 'private-agent',
        projectPath,
        userAgentsDir,
        projectRoot,
        metadataStore: store,
        currentUser: { id: 8 }
      })
      expect(privateRead).toEqual(expect.objectContaining({
        success: false,
        code: 'AUTH_FORBIDDEN'
      }))

      expect(updateWebAgentVisibility({
        agentId: 'shared-agent',
        visibility: 'private',
        metadataStore: store,
        currentUser: { id: 8 }
      })).toEqual(expect.objectContaining({ success: false, code: 'AUTH_FORBIDDEN' }))

      expect(updateWebAgentRaw({
        source: 'user',
        agentId: 'shared-agent',
        rawContent: 'changed',
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })).toEqual(expect.objectContaining({ success: false, code: 'AUTH_FORBIDDEN' }))

      expect(renameWebAgent({
        source: 'user',
        oldAgentId: 'shared-agent',
        newAgentId: 'renamed-shared-agent',
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })).toEqual(expect.objectContaining({ success: false, code: 'AUTH_FORBIDDEN' }))

      expect(deleteWebAgent({
        source: 'user',
        agentId: 'shared-agent',
        projectPath,
        userAgentsDir,
        metadataStore: store,
        currentUser: { id: 8 }
      })).toEqual(expect.objectContaining({ success: false, code: 'AUTH_FORBIDDEN' }))
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
      rmSync(projectPath, { recursive: true, force: true })
      rmSync(userAgentsDir, { recursive: true, force: true })
    }
  })
})
