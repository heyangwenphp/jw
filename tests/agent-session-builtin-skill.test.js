import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { AgentSessionManager } = require('../src/main/agent-session-manager.js')
const { LeadMemoryStore } = require('../src/main/services/lead-memory/lead-memory-store.js')
const {
  serializeComponentCreateResult
} = require('../src/main/managers/desktop-capability-query-options.js')

function createMemoryAwareManager(outputBaseDir, extraAgentSettings = {}) {
  return new AgentSessionManager(null, {
    userDataPath: outputBaseDir,
    getConfig: () => ({
      settings: {
        developerClaudeSource: 'system',
        agent: {
          outputBaseDir,
          ...extraAgentSettings
        }
      }
    }),
    getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null }),
    getAPIProfile: () => null
  })
}

function stubRunner(manager) {
  const state = { queue: null, options: null, session: null }
  manager.runner = {
    buildEnv: () => ({}),
    createQuery: async (queue, options, session) => {
      state.queue = queue
      state.options = options
      state.session = session
      return (async function* () {})()
    }
  }
  return state
}

describe('AgentSessionManager built-in session skills', () => {
  it('uses the web-branded default output root when no custom output dir is configured', () => {
    const manager = new AgentSessionManager(null, {
      getConfig: () => ({ settings: { agent: { outputBaseDir: '' } } }),
      getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null })
    })

    expect(manager._getOutputBaseDir()).toBe(join(homedir(), 'jedi-web-agent-output'))
  })

  it('installs early-investment-research into every newly assigned session cwd', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-skills-'))
    try {
      const manager = new AgentSessionManager(null, {
        getConfig: () => ({ settings: { agent: { outputBaseDir } } }),
        getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null })
      })

      const session = manager.create({ type: 'chat', title: 'Research chat' })

      for (const scope of ['.codex']) {
        const skillPath = join(session.cwd, scope, 'skills', 'early-investment-research', 'SKILL.md')
        const content = readFileSync(skillPath, 'utf8')

        expect(content).toContain('name: early-investment-research')
        expect(content).toContain('Agent 对话中的可见输出只能是报告正文内容本身')
        expect(content).toContain('Markdown 文件写入为静默副作用')
        expect(content).toContain('每条搜索线索生成一个 Markdown 文档')
      }
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('does not install globally disabled built-in skills and removes existing session copies', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-disabled-skill-'))
    try {
      const manager = new AgentSessionManager(null, {
        userDataPath: outputBaseDir,
        getConfig: () => ({ settings: { agent: { outputBaseDir } } }),
        getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null })
      })

      const session = manager.create({ type: 'chat', title: 'Research chat' })
      const skillPath = join(session.cwd, '.codex', 'skills', 'early-investment-research', 'SKILL.md')
      expect(existsSync(skillPath)).toBe(true)

      manager._getComponentMetadataStore().setBuiltInSkillEnabled(
        'early-investment-research',
        false,
        { id: 1, phone: '15527109305' }
      )
      manager._ensureSessionCwd(session)

      expect(existsSync(join(session.cwd, '.codex', 'skills', 'early-investment-research'))).toBe(false)
      expect(existsSync(join(session.cwd, '.claude', 'skills', 'early-investment-research'))).toBe(false)

      const nextSession = manager.create({ type: 'chat', title: 'Disabled research chat' })
      expect(existsSync(join(nextSession.cwd, '.codex', 'skills', 'early-investment-research'))).toBe(false)
      expect(existsSync(join(nextSession.cwd, '.claude', 'skills', 'early-investment-research'))).toBe(false)
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('makes the built-in wechat sqlite database available in newly assigned session cwd', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-wechat-db-'))
    try {
      const sourceDbPath = join(outputBaseDir, 'source-wechat.sqlite')
      writeFileSync(sourceDbPath, 'sqlite placeholder')
      const manager = new AgentSessionManager(null, {
        getConfig: () => ({
          settings: {
            agent: {
              outputBaseDir,
              wechatDbPath: sourceDbPath
            }
          }
        }),
        getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null })
      })

      const session = manager.create({ type: 'chat', title: 'Research chat' })
      const sessionDbPath = join(session.cwd, 'wechat_765.sqlite')

      expect(existsSync(sessionDbPath)).toBe(true)
      expect(readFileSync(sessionDbPath, 'utf8')).toBe('sqlite placeholder')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('rewrites a leading skill slash invocation before sending it to the SDK', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-skill-slash-'))
    try {
      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      const session = manager.create({ type: 'chat', title: 'Skill slash chat' })
      const skillDir = join(session.cwd, '.codex', 'skills', 'auto-dev')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), [
        '---',
        'name: auto-dev',
        'description: 自动开发流程',
        '---',
        '',
        '按开发流程执行。'
      ].join('\n'))

      await manager.sendMessage(session.id, '/auto-dev 开发流程是怎样的')

      const sent = runner.queue._queue[0].message.content
      expect(sent).not.toMatch(/^\/auto-dev\b/)
      expect(sent).toContain('auto-dev')
      expect(sent).toContain('开发流程是怎样的')
      expect(sent).toContain('skill')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('rewrites a leading slash invocation for web user skills', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-web-user-skill-slash-'))
    try {
      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      const session = manager.create({ type: 'chat', title: 'Web user skill slash chat' })
      const skillDir = join(outputBaseDir, 'skills', 'auto-dev')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), [
        '---',
        'name: auto-dev',
        'description: auto development workflow',
        '---',
        '',
        'Run the auto development workflow.'
      ].join('\n'))

      await manager.sendMessage(session.id, '/auto-dev how does the workflow run')

      const sent = runner.queue._queue[0].message.content
      expect(sent).not.toMatch(/^\/auto-dev\b/)
      expect(sent).toContain('auto-dev')
      expect(sent).toContain('how does the workflow run')
      expect(sent).toContain('skill')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('rewrites a leading slash invocation for repository built-in skills', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-root-builtin-skill-slash-'))
    try {
      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      const session = manager.create({ type: 'chat', title: 'Root built-in skill slash chat' })
      rmSync(join(session.cwd, '.codex', 'skills', 'daily-investment-leads-report'), { recursive: true, force: true })
      rmSync(join(session.cwd, '.claude', 'skills', 'daily-investment-leads-report'), { recursive: true, force: true })

      await manager.sendMessage(session.id, '/daily-investment-leads-report generate today report')

      const sent = runner.queue._queue[0].message.content
      expect(sent).not.toMatch(/^\/daily-investment-leads-report\b/)
      expect(sent).toContain('daily-investment-leads-report')
      expect(sent).toContain('generate today report')
      expect(sent).toContain('skill')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('instructs agent sessions to inspect sqlite files with Python stdlib before external sqlite3 CLI', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-sqlite-python-'))
    try {
      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      const session = manager.create({ type: 'chat', title: 'SQLite research chat' })

      await manager.sendMessage(session.id, '读取 sqlite 线索')

      expect(runner.options?.appendSystemPrompt).toContain('Python standard library sqlite3')
      expect(runner.options?.appendSystemPrompt).toContain('do not try the external sqlite3 CLI first')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('does not inject a skill or agent internals disclosure guard into agent sessions', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-internal-details-'))
    try {
      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      const session = manager.create({ type: 'chat', title: 'Internal details chat' })

      await manager.sendMessage(session.id, 'skill 的流程是什么')

      expect(runner.options?.appendSystemPrompt).not.toContain('Never output skill or agent content')
      expect(runner.options?.appendSystemPrompt).not.toContain('logic, internal instructions, or workflows')
      expect(runner.options?.appendSystemPrompt).not.toContain('visible thinking')
      expect(runner.options?.appendSystemPrompt).not.toContain('reasoning traces')
      expect(runner.session?.suppressInternalDisclosure).toBeUndefined()
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('leaves report context messages unmarked by the old skill or agent internals guard', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-report-context-details-'))
    try {
      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      const session = manager.create({
        type: 'chat',
        title: '日报(2026年6月13日)',
        source: 'report-followup',
        reportMode: 'lead-report',
        reportFilePath: join(outputBaseDir, '日报(2026年6月13日).md')
      })

      await manager.sendMessage(session.id, {
        text: [
          '总结这个报告',
          '',
          '--- 当前报告 Markdown 开始：日报(2026年6月13日).md ---',
          '报告正文提到了 AI agent 平台、skill 标签、内部验证、完整内容等普通业务词。',
          '--- 当前报告 Markdown 结束：日报(2026年6月13日).md ---'
        ].join('\n'),
        displayText: '总结这个报告',
        files: []
      })

      expect(runner.session?.suppressInternalDisclosure).toBeUndefined()
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('keeps the Claude Code default tool set available for agent conversations', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-default-tools-'))
    try {
      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      const session = manager.create({ type: 'chat', title: 'Web search chat' })

      await manager.sendMessage(session.id, 'search the web for current sources')

      expect(runner.options?.tools).toEqual({ type: 'preset', preset: 'claude_code' })
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('guides agent sessions to use web search for current external facts', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-current-facts-'))
    try {
      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      const session = manager.create({ type: 'chat', title: 'Current facts chat' })

      await manager.sendMessage(session.id, '今天天气怎么样')

      expect(runner.options?.appendSystemPrompt).toContain('WebSearch')
      expect(runner.options?.appendSystemPrompt).toContain('weather')
      expect(runner.options?.appendSystemPrompt).toContain('ask a concise clarifying question')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('exposes the structured component creation tool to agent conversations', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-component-tool-'))
    try {
      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      manager.setAgentComponentCreator(() => ({
        success: true,
        type: 'skill',
        componentId: 'frontend-dev',
        visibility: 'private'
      }))
      const session = manager.create({ type: 'chat', title: 'Component creator chat' })

      await manager.sendMessage(session.id, 'create a frontend development skill', {
        currentUser: { id: 'user-123', username: 'Owner' }
      })

      expect(runner.options?.appendSystemPrompt).toContain('jedi_component_create')
      expect(runner.options?.appendSystemPrompt).toContain('.claude/skills')
      expect(runner.options?.appendSystemPrompt).toContain('Do not include local filesystem paths')
      expect(runner.options?.allowedTools).toContain('mcp__JediDesktop__jedi_component_create')
      expect(runner.options?.mcpServers?.JediDesktop).toBeTruthy()
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('keeps local component paths out of the agent-visible create tool result', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-component-paths-'))
    try {
      const payload = serializeComponentCreateResult({
        success: true,
        type: 'skill',
        componentId: 'product-manager',
        path: join(outputBaseDir, 'skills', 'product-manager'),
        filePath: join(outputBaseDir, 'skills', 'product-manager', 'SKILL.md'),
        visibility: 'private'
      })
      const text = JSON.stringify(payload)

      expect(text).not.toContain(outputBaseDir)
      expect(text).not.toContain('SKILL.md')
      expect(payload).toEqual({
        success: true,
        type: 'skill',
        componentId: 'product-manager',
        visibility: 'private'
      })
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('hides runtime skill directories from user-facing output files', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-agent-hidden-runtime-dirs-'))
    try {
      const manager = new AgentSessionManager(null, {
        getConfig: () => ({ settings: { agent: { outputBaseDir } } }),
        getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null })
      })

      const session = manager.create({ type: 'chat', title: 'Research chat' })
      const names = manager.listOutputFiles(session.id).map(file => file.name)

      expect(existsSync(join(session.cwd, '.codex'))).toBe(true)
      expect(names).not.toContain('.claude')
      expect(names).not.toContain('.codex')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('assigns standalone daily, weekly, and monthly report sessions to dedicated project folders', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-report-session-cwd-'))
    try {
      const manager = new AgentSessionManager(null, {
        getConfig: () => ({ settings: { agent: { outputBaseDir } } }),
        getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null })
      })

      const dailySession = manager.create({
        type: 'chat',
        title: '日报',
        cwd: join(outputBaseDir, 'ignored-input-cwd'),
        meta: { reportMode: 'lead-report' }
      })
      const weeklySession = manager.create({
        type: 'chat',
        title: '周报',
        meta: { reportMode: 'weekly-report' }
      })
      const monthlySession = manager.create({
        type: 'chat',
        title: '月报',
        meta: { reportMode: 'monthly-report' }
      })

      expect(dailySession.cwd).toBe(join(outputBaseDir, 'reports', 'daily'))
      expect(weeklySession.cwd).toBe(join(outputBaseDir, 'reports', 'weekly'))
      expect(monthlySession.cwd).toBe(join(outputBaseDir, 'reports', 'monthly'))
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('overwrites same-name markdown when auto-saving standalone report output', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-report-overwrite-'))
    try {
      const manager = new AgentSessionManager(null, {
        getConfig: () => ({ settings: { agent: { outputBaseDir } } }),
        getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null })
      })
      const session = manager.create({
        type: 'chat',
        title: '日报',
        meta: { reportMode: 'lead-report' }
      })
      const reportPath = join(session.cwd, '日报(2026年6月4日).md')
      writeFileSync(reportPath, '# old\n', 'utf8')

      session.pendingAssistantReportMarkdown = [
        '# 日报(2026年6月4日)',
        '',
        '## 项目线索',
        '新内容',
        '',
        '来源依据：S1｜来源类型：公开网页｜来源名称：示例来源｜支撑事实：来源事实｜核实状态：已核实｜详情 URL：<a href="https://example.com" target="_blank" rel="noopener noreferrer">点击查看</a>'
      ].join('\n')

      const savedPath = manager._autoSavePendingAssistantReportMarkdown(session)

      expect(savedPath).toBe(reportPath)
      expect(readFileSync(reportPath, 'utf8')).toContain('新内容')
      expect(existsSync(join(session.cwd, '日报(2026年6月4日)(2).md'))).toBe(false)
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('excludes standalone report sessions from the conversation history list', () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-report-history-'))
    try {
      const manager = new AgentSessionManager(null, {
        getConfig: () => ({ settings: { agent: { outputBaseDir } } }),
        getDefaultProfile: () => ({ id: 'default-profile', baseUrl: null, selectedModelId: null })
      })

      const manualSession = manager.create({ type: 'chat', title: '普通对话' })
      manager.create({ type: 'chat', title: '日报', meta: { reportMode: 'lead-report' } })
      manager.create({ type: 'chat', title: '周报', meta: { reportMode: 'weekly-report' } })
      manager.create({ type: 'chat', title: '月报', meta: { reportMode: 'monthly-report' } })
      const reportFollowupSession = manager.create({ type: 'chat', title: 'report followup', source: 'report-followup' })
      manager.create({ type: 'chat', title: 'aipin background', source: 'aipin-data-processing' })

      manager.sessionDatabase = {
        listAllAgentConversations: () => [
          {
            session_id: 'db-daily-report',
            type: 'chat',
            title: '历史日报',
            cwd: join(outputBaseDir, 'reports', 'daily'),
            cwd_auto: 1,
            updated_at: Date.now(),
            created_at: Date.now()
          },
          {
            session_id: 'db-manual',
            type: 'chat',
            title: '历史普通对话',
            cwd: join(outputBaseDir, 'desktop', 'conv-db-manual'),
            cwd_auto: 1,
            updated_at: Date.now(),
            created_at: Date.now()
          },
          {
            session_id: 'db-aipin-background',
            type: 'chat',
            source: 'aipin-data-processing',
            title: 'aipin background',
            cwd: join(outputBaseDir, 'aipin-data', 'conv-aipin'),
            cwd_auto: 1,
            updated_at: Date.now(),
            created_at: Date.now()
          },
          {
            session_id: 'db-report-followup',
            type: 'chat',
            source: 'report-followup',
            title: 'report followup',
            cwd: join(outputBaseDir, 'desktop', 'legacy-report-followup'),
            cwd_auto: 1,
            updated_at: Date.now(),
            created_at: Date.now()
          }
        ]
      }

      expect(manager.list().map(session => session.id).sort()).toEqual([
        manualSession.id,
        reportFollowupSession.id,
        'db-manual',
        'db-report-followup'
      ].sort())
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('injects structured lead memory context before a new investment research run', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-lead-memory-context-'))
    const dbPath = join(outputBaseDir, 'lead-memory.sqlite')
    try {
      const store = new LeadMemoryStore(dbPath, { now: () => '2026-06-02T00:00:00.000Z' })
      store.upsertEntityBundle({
        entity: {
          entity_type: 'project',
          canonical_name: '低空经济项目',
          verification_status: 'verified',
          tsinghua_affiliation_status: 'verified',
          confidence: 0.86
        },
        topics: [{
          topic_type: 'sector',
          canonical_name: '低空经济',
          keywords: ['eVTOL', '无人机']
        }],
        relations: [{
          relation_type: 'related_to_topic',
          target_topic_name: '低空经济',
          verification_status: 'verified',
          confidence: 0.8
        }],
        evidence: [{
          source_type: 'public_web',
          source_title: '低空经济项目来源',
          source_url: 'https://example.test/low-altitude',
          evidence_summary: '低空经济项目与 eVTOL 方向相关'
        }]
      })
      store.close()

      const manager = createMemoryAwareManager(outputBaseDir, { leadMemoryDbPath: dbPath })
      const runner = stubRunner(manager)
      const session = manager.create({ type: 'chat', title: 'Research chat' })

      await manager.sendMessage(session.id, '低空经济')

      const sent = runner.queue._queue[0].message.content
      expect(sent).toContain('低空经济项目')
      expect(sent).toContain('结构化历史线索')
      expect(sent).toContain('https://example.test/low-altitude')
      expect(sent).toContain('candidateSource')
      expect(sent).toContain('"memory"')
      expect(sent).not.toContain('lead-memory.sqlite')

      const cluePath = join(session.cwd, '.codex', 'research-prefill', '线索1.md')
      const reportPath = join(session.cwd, '.codex', 'research-prefill', '低空经济.md')
      expect(existsSync(join(session.cwd, '线索1.md'))).toBe(false)
      expect(existsSync(join(session.cwd, '低空经济.md'))).toBe(false)
      expect(readFileSync(cluePath, 'utf8')).toContain('低空经济项目')
      expect(readFileSync(cluePath, 'utf8')).toContain('https://example.test/low-altitude')
      expect(readFileSync(reportPath, 'utf8')).toContain('# 低空经济')
      expect(readFileSync(reportPath, 'utf8')).toContain('低空经济项目')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })

  it('injects matching historical report context when no structured lead memory exists yet', async () => {
    const outputBaseDir = mkdtempSync(join(tmpdir(), 'jedi-lead-memory-report-context-'))
    try {
      const oldSessionDir = join(outputBaseDir, 'desktop', 'conv-old')
      mkdirSync(oldSessionDir, { recursive: true })
      writeFileSync(join(oldSessionDir, '低空经济.md'), [
        '# 低空经济',
        '生成日期：2026年6月2日',
        '### 2. 项目线索',
        '项目：低空经济历史项目',
        '赛道：低空经济'
      ].join('\n'))

      const manager = createMemoryAwareManager(outputBaseDir)
      const runner = stubRunner(manager)
      const session = manager.create({ type: 'chat', title: 'New research chat' })

      await manager.sendMessage(session.id, '低空经济')

      const sent = runner.queue._queue[0].message.content
      expect(sent).toContain('历史报告候选')
      expect(sent).toContain('低空经济.md')
      expect(sent).toContain('低空经济历史项目')
      expect(sent).toContain('候选 JSON 和历史报告只能作为本轮完整报告的预填依据')
      expect(sent).toContain('不得重新从头筛库')
      expect(sent).toContain('宿主应用会在对话展示后后台静默生成最终报告 Markdown 文档')

      const cluePath = join(session.cwd, '.codex', 'research-prefill', '线索1.md')
      const reportPath = join(session.cwd, '.codex', 'research-prefill', '低空经济.md')
      expect(existsSync(join(session.cwd, '线索1.md'))).toBe(false)
      expect(existsSync(join(session.cwd, '低空经济.md'))).toBe(false)
      expect(readFileSync(cluePath, 'utf8')).toContain('低空经济历史项目')
      expect(readFileSync(cluePath, 'utf8')).toContain('历史报告')
      expect(readFileSync(reportPath, 'utf8')).toContain('低空经济历史项目')
    } finally {
      rmSync(outputBaseDir, { recursive: true, force: true })
    }
  })
})
