import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { iconPaths } from '../src/renderer/components/icons/index.js'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

const readPagesDistIconBundles = () => {
  const assetsDir = new URL('../src/renderer/pages-dist/assets/', import.meta.url)
  if (!existsSync(assetsDir)) return []
  return readdirSync(assetsDir)
    .filter((fileName) => /^Icon-.*\.js$/.test(fileName))
    .map((fileName) => readFileSync(new URL(fileName, assetsDir), 'utf8'))
}

describe('Agent IM channel icons', () => {
  it('defines clear icons for every supported IM channel', () => {
    for (const name of ['dingtalk', 'weixin', 'feishu']) {
      expect(iconPaths[name]).toEqual(expect.any(String))
      expect(iconPaths[name].length).toBeGreaterThan(80)
    }
  })

  it('uses recognizable upstream brand logo paths', () => {
    expect(iconPaths.dingtalk).toContain('fill="#4285F4"')
    expect(iconPaths.dingtalk).toContain('M1024 155.733')
    expect(iconPaths.weixin).toContain('fill="#9de60b"')
    expect(iconPaths.weixin).toContain('M4.062.98')
    expect(iconPaths.feishu).toContain('fill="#00D6B9"')
    expect(iconPaths.feishu).toContain('M12.9238 12.8029')
  })

  it('maps Feishu sessions to the Feishu icon in Agent chrome', () => {
    const leftPanelSource = readSource('src/renderer/pages/main/components/agent/AgentLeftContent.vue')
    const tabBarSource = readSource('src/renderer/pages/main/components/TabBar.vue')
    const chatTabSource = readSource('src/renderer/pages/main/components/AgentChatTab.vue')

    expect(leftPanelSource).toContain("if (conv.type === 'feishu') return 'feishu'")
    expect(leftPanelSource).toContain("if (source === 'feishu') return 'feishu'")
    expect(tabBarSource).toContain("sessionType === 'feishu'")
    expect(tabBarSource).toContain("return status === SessionStatus.ERROR ? 'xCircle' : 'feishu'")
    expect(chatTabSource).toContain("sessionType === 'feishu'")
    expect(chatTabSource).toContain('<Icon name="feishu" :size="14" />')
  })

  it('uses the current IM channel icon in the Agent input toolbar', () => {
    const toolbarSource = readSource('src/renderer/pages/main/components/agent/ChatInputToolbar.vue')

    expect(toolbarSource).toContain('<Icon :name="sessionToolbarIcon" :size="14" class="model-icon" />')
    expect(toolbarSource).toContain("if (props.sessionType === 'dingtalk') return 'dingtalk'")
    expect(toolbarSource).toContain("if (props.sessionType === 'weixin') return 'weixin'")
    expect(toolbarSource).toContain("if (props.sessionType === 'feishu') return 'feishu'")
  })

  it('shows the capability quick access entry in the Agent input toolbar', () => {
    const toolbarSource = readSource('src/renderer/pages/main/components/agent/ChatInputToolbar.vue')
    const quickAccessStart = toolbarSource.indexOf('class="cap-quick-access"')
    const quickAccessBlock = quickAccessStart >= 0
      ? toolbarSource.slice(Math.max(0, quickAccessStart - 80), quickAccessStart + 320)
      : ''

    expect(quickAccessStart).toBeGreaterThan(-1)
    expect(quickAccessBlock).not.toContain('v-if="false"')
    expect(quickAccessBlock).toContain("t('agent.capabilityManagement')")
    expect(quickAccessBlock).toContain('@click="toggleCapDropdown"')
  })

  it('keeps packaged Electron icon bundles in sync with source icons', () => {
    const iconBundles = readPagesDistIconBundles()
    if (iconBundles.length === 0) return
    const bundledIconSource = iconBundles.join('\n')

    expect(bundledIconSource).toContain(`dingtalk:'${iconPaths.dingtalk}'`)
    expect(bundledIconSource).toContain(`weixin:'${iconPaths.weixin}'`)
    expect(bundledIconSource).toContain(`feishu:'${iconPaths.feishu}'`)
    expect(bundledIconSource).not.toContain('<path d="M10 3v2"/><rect x="4" y="5" width="12" height="12" rx="2"/>')
  })
})
