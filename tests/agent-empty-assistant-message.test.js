import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { AgentSession } = require('../src/main/agent-session.js')
const { AgentSessionManager } = require('../src/main/agent-session-manager.js')
const { AgentType } = require('../src/main/utils/agent-constants.js')

describe('agent assistant message persistence', () => {
  it('does not store empty assistant text blocks as visible messages', async () => {
    const storedMessages = []
    const manager = new AgentSessionManager(null, {})
    manager._safeSend = () => true
    manager.runner.normalizeMessage = (message) => message
    manager.sessionDatabase = {
      insertAgentMessage(_conversationId, message) {
        storedMessages.push(message)
      },
      updateAgentConversation() {}
    }

    const session = new AgentSession({
      id: 'session-empty-assistant',
      type: AgentType.CHAT,
      title: 'Empty assistant'
    })
    session.dbConversationId = 1

    await manager._processMessage(session, {
      type: 'assistant_message',
      content: [{ type: 'text', text: '' }],
      uuid: 'assistant-empty'
    })

    expect(storedMessages).toEqual([])
    expect(session.messages).toEqual([])
  })

  it('drops leaked execution planning text before broadcasting assistant output', async () => {
    const sentMessages = []
    const emittedMessages = []
    const storedMessages = []
    const manager = new AgentSessionManager(null, {})
    manager._safeSend = (channel, payload) => {
      if (channel === 'agent:message') sentMessages.push(payload)
      return true
    }
    manager.runner.normalizeMessage = (message) => message
    manager.on('agentMessage', (_sessionId, message) => {
      emittedMessages.push(message)
    })
    manager.sessionDatabase = {
      insertAgentMessage(_conversationId, message) {
        storedMessages.push(message)
      },
      updateAgentConversation() {}
    }

    const session = new AgentSession({
      id: 'session-leaked-planning',
      type: AgentType.CHAT,
      title: 'Leaked planning'
    })
    session.dbConversationId = 1

    await manager._processMessage(session, {
      type: 'assistant_message',
      content: [{
        type: 'text',
        text: [
          '好的，现在我已经准备好了完整的报告内容。接下来我需要：',
          '',
          '先输出即时状态到对话',
          '然后输出报告骨架',
          '然后输出项目线索',
          '同时写入线索文件和报告文件',
          '最后输出剩余章节',
          '但是，文件写入必须在最终报告正文展示前完成。',
          '',
          '让我这样做：',
          '',
          '第一步：输出即时状态 + 同时写入所有文件',
          '第二步：输出报告骨架',
          '第三步：输出项目线索',
          '第四步：输出剩余章节'
        ].join('\n')
      }],
      uuid: 'assistant-leaked-planning'
    })

    expect(sentMessages).toEqual([])
    expect(emittedMessages).toEqual([])
    expect(storedMessages).toEqual([])
    expect(session.messages).toEqual([])
  })

  it('drops leaked report delivery status after the report body is already displayed', async () => {
    const sentMessages = []
    const emittedMessages = []
    const storedMessages = []
    const manager = new AgentSessionManager(null, {})
    manager._safeSend = (channel, payload) => {
      if (channel === 'agent:message') sentMessages.push(payload)
      return true
    }
    manager.runner.normalizeMessage = (message) => message
    manager.on('agentMessage', (_sessionId, message) => {
      emittedMessages.push(message)
    })
    manager.sessionDatabase = {
      insertAgentMessage(_conversationId, message) {
        storedMessages.push(message)
      },
      updateAgentConversation() {}
    }

    const session = new AgentSession({
      id: 'session-leaked-delivery-status',
      type: AgentType.CHAT,
      title: 'Leaked delivery status'
    })
    session.dbConversationId = 1

    await manager._processMessage(session, {
      type: 'assistant_message',
      content: [{
        type: 'text',
        text: [
          '报告正文已在对话中展示完毕，3个线索文档也已成功写入当前会话目录。根据技能规则W12，最终报告Markdown文件由宿主应用后台静默生成，Agent不应自行创建。',
          '',
          '所有工作已完成：',
          '1. 对话中展示了完整的碳中和赛道清华系早期投资研判报告',
          '2. 静默写入了3个线索文档到当前会话目录',
          '',
          '不需要再输出任何额外内容。',
          '报告正文已展示完毕。3条搜索线索文档已写入当前会话目录：',
          '• 线索1.md — 贺克斌/徐明团队（天工LCA数据库）',
          '• 线索2.md — 温宗国团队（退役风机叶片资源化利用）',
          '• 线索3.md — 刘竹团队（中国净零碳预算框架研究）',
          '最终报告 Markdown 文件将由宿主应用后台静默生成'
        ].join('\n')
      }],
      uuid: 'assistant-leaked-delivery-status'
    })

    expect(sentMessages).toEqual([])
    expect(emittedMessages).toEqual([])
    expect(storedMessages).toEqual([])
    expect(session.messages).toEqual([])
  })

  it('drops leaked report drafting notes before the report body is displayed', async () => {
    const sentMessages = []
    const emittedMessages = []
    const storedMessages = []
    const manager = new AgentSessionManager(null, {})
    manager._safeSend = (channel, payload) => {
      if (channel === 'agent:message') sentMessages.push(payload)
      return true
    }
    manager.runner.normalizeMessage = (message) => message
    manager.on('agentMessage', (_sessionId, message) => {
      emittedMessages.push(message)
    })
    manager.sessionDatabase = {
      insertAgentMessage(_conversationId, message) {
        storedMessages.push(message)
      }
    }

    const session = new AgentSession({
      id: 'session-leaked-drafting-notes',
      type: AgentType.CHAT,
      title: 'Leaked drafting notes'
    })
    session.dbConversationId = 1

    await manager._processMessage(session, {
      type: 'assistant_message',
      content: [{
        type: 'text',
        text: [
          ':::field-card格式） 3. Alpha Signal 分析 4. 行动建议与工作流队列 5. 缺失信息与风险',
          '',
          '同时我还需要生成线索文档写入当前会话目录。',
          '',
          '让我开始整理报告内容。主要线索：',
          '',
          '高优先级：',
          '',
          '元节智能 - 具身智能+餐饮，清华张钹院士学生王栋，千万级种子轮',
          '北京极佳视界科技有限公司 - 黄冠，清华自动化系，世界模型+具身智能',
          '',
          '注意： 启迪之星发布的SOFC技术来自中国石油大学（华东），不是清华系主体，不能放入项目线索，但可以作为线索文档记录。',
          '',
          ':::field-card字段块',
          '',
          '字段名不使用**加粗',
          'URL使用HTML链接格式',
          '不使用代码块包裹报告',
          '区分[来源事实]、[判断]、[待验证]',
          '让我现在开始写报告。'
        ].join('\n')
      }],
      uuid: 'assistant-leaked-drafting-notes'
    })

    expect(sentMessages).toEqual([])
    expect(emittedMessages).toEqual([])
    expect(storedMessages).toEqual([])
    expect(session.messages).toEqual([])
  })

  it('passes through assistant output when it contains skill or agent details', async () => {
    const sentMessages = []
    const emittedMessages = []
    const storedMessages = []
    const manager = new AgentSessionManager(null, {})
    manager._safeSend = (channel, payload) => {
      if (channel === 'agent:message') sentMessages.push(payload)
      return true
    }
    manager.runner.normalizeMessage = (message) => message
    manager.on('agentMessage', (_sessionId, message) => {
      emittedMessages.push(message)
    })
    manager.sessionDatabase = {
      insertAgentMessage(_conversationId, message) {
        storedMessages.push(message)
      },
      updateAgentConversation() {}
    }

    const session = new AgentSession({
      id: 'session-internal-skill-details',
      type: AgentType.CHAT,
      title: 'Internal skill details'
    })
    session.dbConversationId = 1

    await manager._processMessage(session, {
      type: 'assistant_message',
      content: [
        {
          type: 'thinking',
          thinking: 'The product-manager skill says to output PRD steps.'
        },
        {
          type: 'text',
          text: [
            '---',
            'name: product-manager',
            'description: product work',
            '---',
            '## 1. Requirements',
            '- Convert user pain points into product requirements'
          ].join('\n')
        }
      ],
      uuid: 'assistant-internal-skill-leak'
    })
    await manager._processMessage(session, {
      type: 'assistant_message',
      content: [{
        type: 'text',
        text: 'This skill mainly helps with requirements analysis, PRD writing, competitor research, user stories, and product planning.'
      }],
      uuid: 'assistant-internal-skill-leak-followup'
    })

    const visibleText = sentMessages[0]?.message?.content?.find(block => block.type === 'text')?.text || ''
    expect(sentMessages).toHaveLength(2)
    expect(emittedMessages).toHaveLength(2)
    expect(storedMessages).toHaveLength(2)
    expect(visibleText).toContain('product-manager')
    expect(visibleText).toContain('Requirements')
    expect(storedMessages[0].content).toContain('product-manager')
    expect(storedMessages[0].thinking).toContain('product-manager skill')
    expect(session.messages[0].thinking).toContain('product-manager skill')

    await manager._processMessage(session, {
      type: 'result',
      subtype: 'success',
      isError: false,
      totalCostUsd: 0
    })
    expect(session.suppressInternalDisclosure).toBeUndefined()
  })

  it('streams thinking events even when they mention skill or agent details', async () => {
    const sentStreams = []
    const manager = new AgentSessionManager(null, {})
    manager._safeSend = (channel, payload) => {
      if (channel === 'agent:stream') sentStreams.push(payload)
      return true
    }
    manager.runner.normalizeMessage = (message) => message

    const session = new AgentSession({
      id: 'session-internal-thinking-details',
      type: AgentType.CHAT,
      title: 'Internal thinking details'
    })

    await manager._processMessage(session, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: {
          type: 'thinking_delta',
          thinking: 'The skill file contains a product-manager workflow.'
        }
      }
    })

    expect(sentStreams).toHaveLength(1)
    expect(sentStreams[0].event.delta.thinking).toContain('product-manager workflow')
    expect(session.pendingThinkingText).toContain('product-manager workflow')
  })

  it('persists streamed thinking when the final assistant message omits thinking blocks', async () => {
    const storedMessages = []
    const manager = new AgentSessionManager(null, {})
    manager._safeSend = () => true
    manager.runner.normalizeMessage = (message) => message
    manager.sessionDatabase = {
      insertAgentMessage(_conversationId, message) {
        storedMessages.push(message)
      }
    }

    const session = new AgentSession({
      id: 'session-stream-thinking',
      type: AgentType.CHAT,
      title: 'Stream thinking'
    })
    session.dbConversationId = 1

    await manager._processMessage(session, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: {
          type: 'thinking_delta',
          thinking: 'first thought'
        }
      }
    })

    await manager._processMessage(session, {
      type: 'assistant_message',
      content: [{ type: 'text', text: 'final answer' }],
      uuid: 'assistant-with-stream-thinking'
    })

    await manager._processMessage(session, {
      type: 'assistant_message',
      content: [{ type: 'text', text: 'next answer' }],
      uuid: 'assistant-next'
    })

    expect(storedMessages[0]).toMatchObject({
      content: 'final answer',
      thinking: 'first thought'
    })
    expect(storedMessages[1]).toMatchObject({
      content: 'next answer',
      thinking: null
    })
  })

  it('persists streamed thinking on result when no assistant message arrives', async () => {
    const storedMessages = []
    const manager = new AgentSessionManager(null, {})
    manager._safeSend = () => true
    manager.runner.normalizeMessage = (message) => message
    manager.sessionDatabase = {
      insertAgentMessage(_conversationId, message) {
        storedMessages.push(message)
      },
      updateAgentConversation() {}
    }

    const session = new AgentSession({
      id: 'session-thinking-only-result',
      type: AgentType.CHAT,
      title: 'Thinking only result'
    })
    session.dbConversationId = 1

    await manager._processMessage(session, {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: {
          type: 'thinking_delta',
          thinking: 'thinking without final assistant message'
        }
      }
    })

    await manager._processMessage(session, {
      type: 'result',
      subtype: 'success',
      isError: false,
      result: '',
      totalCostUsd: 0,
      numTurns: 1
    })

    expect(storedMessages).toHaveLength(1)
    expect(storedMessages[0]).toMatchObject({
      content: null,
      thinking: 'thinking without final assistant message'
    })
  })

  it('silently saves the displayed investment report markdown only after the result arrives', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jedi-agent-report-autosave-'))
    try {
      const manager = new AgentSessionManager(null, {})
      manager._safeSend = () => true
      manager.runner.normalizeMessage = (message) => message

      const session = new AgentSession({
        id: 'session-report-autosave',
        type: AgentType.CHAT,
        title: 'Report autosave',
        cwd
      })

      const report = [
        '# 低空经济',
        '生成日期：2026年6月3日',
        '',
        '### §1. 投资意图拆解',
        '围绕低空经济寻找清华系早期机会。',
        '',
        '### §2. 项目线索',
        ':::field-card',
        '项目：低空经济项目',
        '来源依据：S1｜来源类型：公开资料｜来源名称：示例来源｜支撑事实：低空经济项目｜核实状态：待核实｜详情 URL：<a href="https://example.com" target="_blank" rel="noopener noreferrer">点击查看</a>',
        ':::'
      ].join('\n')

      await manager._processMessage(session, {
        type: 'assistant_message',
        content: [{ type: 'text', text: report }],
        uuid: 'assistant-report'
      })

      const reportPath = join(cwd, '低空经济.md')
      expect(existsSync(reportPath)).toBe(false)

      await manager._processMessage(session, {
        type: 'result',
        subtype: 'success',
        isError: false,
        result: '',
        totalCostUsd: 0,
        numTurns: 1
      })

      expect(readFileSync(reportPath, 'utf8')).toBe(`${report}\n`)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
