import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('home navigation and WeChat hint source contract', () => {
  it('wires the left sidebar Home request to the Midea monitor page state', () => {
    const mainContent = readSource('src/renderer/pages/main/components/MainContent.vue')
    const leftPanel = readSource('src/renderer/pages/main/components/LeftPanel.vue')
    const agentLeftContent = readSource('src/renderer/pages/main/components/agent/AgentLeftContent.vue')

    expect(agentLeftContent).toContain("emit('home-request')")
    expect(agentLeftContent).toContain('home-nav-item')
    expect(agentLeftContent).toContain('美的舆情推送监控')
    expect(agentLeftContent).not.toContain('<span>首页</span>')
    expect(agentLeftContent).not.toContain('项目库')
    expect(agentLeftContent).not.toContain('project-library-request')
    expect(leftPanel).toContain('@home-request="emit(\'home-request\')"')
    expect(leftPanel).not.toContain('@project-library-request')
    expect(mainContent).toContain('@home-request="handleHomeRequest"')
    expect(mainContent).not.toContain('@project-library-request')
    expect(mainContent).toContain("activeTabId.value = 'welcome'")
    expect(mainContent).toContain('class="midea-home-state"')
    expect(mainContent).toContain('<MideaYqMonitorContent />')
  })

  it('shows a blocking WeChat browser guide with copy-link fallback', () => {
    const mainContent = readSource('src/renderer/pages/main/components/MainContent.vue')

    expect(mainContent).toContain('isWeChatBrowser')
    expect(mainContent).toContain('MicroMessenger')
    expect(mainContent).toContain('window.electronAPI?.platform')
    expect(mainContent).toContain('showWechatBrowserGuide')
    expect(mainContent).toContain('wechat-browser-overlay')
    expect(mainContent).toContain('请在浏览器中打开')
    expect(mainContent).toContain('复制当前链接')
    expect(mainContent).toContain('handleCopyWechatBrowserLink')
    expect(mainContent).not.toContain('wechat-secondary-btn')
    expect(mainContent).not.toContain('dismissWechatBrowserGuide')
    expect(mainContent).not.toContain('wechatBrowserGuideDismissed')
    expect(mainContent).not.toContain('if (window.electronAPI) return false')
    expect(mainContent).not.toContain('wechat-browser-hint')
  })

  it('keeps the WeChat copy-link button readable on hover', () => {
    const mainContent = readSource('src/renderer/pages/main/components/MainContent.vue')
    const hoverRule = mainContent.match(/\.wechat-primary-btn:hover\s*\{([^}]+)\}/s)?.[1] || ''

    expect(hoverRule).toContain('background: var(--primary-color-hover)')
    expect(hoverRule).toContain('border-color: var(--primary-color-hover)')
    expect(hoverRule).toContain('color: #ffffff')
    expect(hoverRule).not.toContain('--primary-hover')
  })

  it('uses the Midea monitor content on the Home page', () => {
    const mainContent = readSource('src/renderer/pages/main/components/MainContent.vue')

    expect(mainContent).toContain('home-main-area')
    expect(mainContent).toContain('.midea-home-state :deep(.midea-monitor-content)')
    expect(mainContent).not.toContain("<h2>{{ t('agent.welcomeTitle') }}</h2>")
  })

  it('does not render the welcome page as a top tab anymore', () => {
    const tabBar = readSource('src/renderer/pages/main/components/TabBar.vue')

    expect(tabBar).not.toContain('class="tab welcome-tab"')
    expect(tabBar).not.toContain("t('main.welcome')")
  })
})

describe('Agent conversation list simplification source contract', () => {
  it('keeps delete but removes visible model switching, rename, close, and double-click rename from rows', () => {
    const agentLeftContent = readSource('src/renderer/pages/main/components/agent/AgentLeftContent.vue')

    expect(agentLeftContent).toContain('@click.stop="handleDelete(conv)"')
    expect(agentLeftContent).not.toContain('@dblclick="startRename(conv)"')
    expect(agentLeftContent).not.toContain('class="profile-badge"')
    expect(agentLeftContent).not.toContain('class="action-btn rename-btn"')
    expect(agentLeftContent).not.toContain('class="action-btn close-btn"')
    expect(agentLeftContent).not.toContain('@click.stop="toggleProfileDropdown(conv, $event)"')
  })

  it('keeps execution status hidden from conversation rows', () => {
    const agentLeftContent = readSource('src/renderer/pages/main/components/agent/AgentLeftContent.vue')

    expect(agentLeftContent).not.toContain('class="conv-status-pill"')
    expect(agentLeftContent).not.toContain('getConversationStatusMeta(conv)')
    expect(agentLeftContent).not.toContain("label: '执行中'")
    expect(agentLeftContent).not.toContain("label: '失败'")
    expect(agentLeftContent).not.toContain("label: '完成'")
  })
})
