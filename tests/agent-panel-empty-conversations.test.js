import { describe, expect, it, vi, afterEach } from 'vitest'
import { useAgentPanel } from '../src/renderer/composables/useAgentPanel.js'

const collectGroupedConversationIds = (groups) => [
  ...groups.today,
  ...groups.yesterday,
  ...groups.older
].map(conv => conv.id)

describe('useAgentPanel empty conversation visibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides newly created manual chat conversations until the user sends content', async () => {
    const now = new Date().toISOString()
    vi.stubGlobal('window', {
      electronAPI: {
        listAgentSessions: vi.fn(async () => [
          {
            id: 'empty-manual',
            type: 'chat',
            source: 'manual',
            status: 'idle',
            title: '',
            messageCount: 0,
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'sent-manual',
            type: 'chat',
            source: 'manual',
            status: 'idle',
            title: 'Hello',
            messageCount: 1,
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'sending-manual',
            type: 'chat',
            source: 'manual',
            status: 'streaming',
            title: '',
            messageCount: 0,
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'empty-dingtalk',
            type: 'dingtalk',
            source: 'dingtalk',
            status: 'idle',
            title: '',
            messageCount: 0,
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'report-followup',
            type: 'chat',
            source: 'report-followup',
            status: 'idle',
            title: '周报',
            messageCount: 3,
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'report-mode',
            type: 'chat',
            source: 'manual',
            reportMode: 'weekly-report',
            reportFilePath: 'C:\\reports\\weekly.md',
            status: 'idle',
            title: '周报',
            messageCount: 3,
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'report-mode-duplicate',
            type: 'chat',
            source: 'manual',
            reportMode: 'weekly-report',
            reportFilePath: 'C:\\reports\\weekly.md',
            status: 'idle',
            title: '周报',
            messageCount: 3,
            createdAt: now,
            updatedAt: now
          }
        ])
      }
    })

    const panel = useAgentPanel()
    await panel.loadConversations()

    expect(collectGroupedConversationIds(panel.groupedConversations.value)).toEqual([
      'sent-manual',
      'sending-manual',
      'empty-dingtalk',
      'report-followup',
      'report-mode'
    ])
  })

  it('shows a newly completed manual chat after it receives a result event', () => {
    const now = new Date().toISOString()
    vi.stubGlobal('window', { electronAPI: {} })

    const panel = useAgentPanel()
    panel.conversations.value = [
      {
        id: 'completed-manual',
        type: 'chat',
        source: 'manual',
        status: 'idle',
        title: 'Hello',
        messageCount: 0,
        createdAt: now,
        updatedAt: now
      }
    ]

    const bumped = panel.bumpConversation('completed-manual')

    expect(bumped).toBe(true)
    expect(panel.conversations.value[0].messageCount).toBe(1)
    expect(collectGroupedConversationIds(panel.groupedConversations.value)).toEqual([
      'completed-manual'
    ])
  })
})
