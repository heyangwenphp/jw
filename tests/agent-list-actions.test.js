import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('agent list actions', () => {
  const agentsTabSource = readSource('src/renderer/pages/main/components/RightPanel/tabs/AgentsTab.vue')
  const agentGroupSource = readSource('src/renderer/pages/main/components/RightPanel/tabs/agents/AgentGroup.vue')

  it('keeps a custom agent create entry visible when the agent list is empty', () => {
    const emptyStateMatch = agentsTabSource.match(/<div v-else-if="totalCount === 0" class="empty-state">[\s\S]*?<\/div>\s*<\/div>/)

    expect(emptyStateMatch?.[0] || '').toContain("@click=\"showCreateModal('user')\"")
    expect(emptyStateMatch?.[0] || '').toContain("t('rightPanel.agents.createUser')")
  })

  it('removes per-agent open-file actions from item operation buttons', () => {
    expect(agentGroupSource).not.toContain("t('rightPanel.agents.openFile')")
    expect(agentGroupSource).not.toContain("Icon name=\"externalLink\"")
    expect(agentGroupSource).not.toContain("$emit('openFile', agent)")
  })

  it('does not show open-folder icons at the end of editable agent group headers', () => {
    expect(agentGroupSource).not.toContain("t('rightPanel.agents.openFolder')")
    expect(agentGroupSource).not.toContain('Icon name="folderOpen"')
    expect(agentGroupSource).not.toContain("'open-folder'")
    expect(agentsTabSource).not.toContain('@open-folder=')
    expect(agentsTabSource).not.toContain('openAgentsFolder')
  })

  it('places the agent toggle after delete actions and pins it to the far right', () => {
    const switchIndex = agentGroupSource.indexOf('<n-switch')
    const actionsIndex = agentGroupSource.indexOf('<span class="agent-actions">')

    expect(actionsIndex).toBeGreaterThan(-1)
    expect(switchIndex).toBeGreaterThan(actionsIndex)
    expect(agentGroupSource).toContain('class="agent-toggle"')
    expect(agentGroupSource).toContain('margin-left: auto;')
  })

  it('shows an action hover title around the agent enabled toggle without replacing the switch click target', () => {
    const toggleWrapperMatch = agentGroupSource.match(/<span[\s\S]*?class="agent-toggle-hitbox"[\s\S]*?<\/span>/)
    const toggleWrapper = toggleWrapperMatch?.[0] || ''

    expect(toggleWrapper).toContain(":title=\"agent.disabled ? t('rightPanel.agents.enable') : t('rightPanel.agents.disable')\"")
    expect(toggleWrapper).toContain('@click.stop')
    expect(toggleWrapper).toContain('<n-switch')
    expect(toggleWrapper).toContain('class="agent-toggle"')
    expect(toggleWrapper).toContain("@update:value=\"(val) => $emit('toggle-disabled', agent, !val)\"")
  })

  it('updates agent enabled state optimistically and refreshes silently to avoid list flicker', () => {
    const toggleMatch = agentsTabSource.match(/const handleToggleDisabled = async \(agent, disabled\) => \{[\s\S]*?\n\}/)
    const loadMatch = agentsTabSource.match(/const loadAgents = async \(\{ silent = false \} = \{\}\) => \{[\s\S]*?\n\}/)

    expect(agentsTabSource).toContain('const setAgentDisabled =')
    expect(toggleMatch?.[0] || '').toContain('const previousDisabled = agent.disabled')
    expect(toggleMatch?.[0] || '').toContain('setAgentDisabled(agent, disabled)')
    expect(toggleMatch?.[0] || '').toContain('await loadAgents({ silent: true })')
    expect(toggleMatch?.[0] || '').not.toContain('await loadAgents()')
    expect(loadMatch?.[0] || '').toContain('if (!silent) loading.value = true')
  })

  it('shows public agents in their own read-only group and includes them in counts', () => {
    expect(agentsTabSource).toContain("public: []")
    expect(agentsTabSource).toContain('agents.value.public.length')
    expect(agentsTabSource).toContain('public: filterAgentList(agents.value.public, kw)')
    expect(agentsTabSource).toContain('group-key="public"')
    expect(agentsTabSource).toContain(":title=\"t('rightPanel.agents.publicAgents')\"")
    expect(agentsTabSource).toContain(":empty-text=\"t('rightPanel.agents.noPublicAgents')\"")
    expect(agentsTabSource).toContain('result.public || []')
    expect(agentsTabSource).toContain("arr.filter(a => a.source === 'public')")
  })

  it('labels built-in agents as official agents in capability settings', () => {
    const zhLocaleSource = readSource('src/renderer/locales/zh-CN.js')
    const enLocaleSource = readSource('src/renderer/locales/en-US.js')

    expect(agentsTabSource).toContain("t('rightPanel.agents.officialAgents')")
    expect(agentsTabSource).toContain("t('rightPanel.agents.noOfficialAgents')")
    expect(agentsTabSource).toContain('filteredAgents.builtIn.length === 0')
    expect(agentsTabSource).not.toContain('内置 Agent')
    expect(zhLocaleSource).toContain("officialAgents: '官方 Agents'")
    expect(zhLocaleSource).toContain("noOfficialAgents: '暂无官方 Agents'")
    expect(enLocaleSource).toContain("officialAgents: 'Official Agents'")
    expect(enLocaleSource).toContain("noOfficialAgents: 'No official agents'")
  })

  it('only shows management and disabled toggles for manageable agents', () => {
    expect(agentGroupSource).toContain('const canManageAgent =')
    expect(agentGroupSource).toContain('v-if="editable && canManageAgent(agent)"')
    expect(agentGroupSource).toContain('v-if="toggleable && canManageAgent(agent)"')
    expect(agentGroupSource).toContain('v-if="copy && agent.canCopy !== false"')
  })

  it('lets owners switch user agents between private and public', () => {
    expect(agentsTabSource).toContain('@toggle-visibility="handleToggleVisibility"')
    expect(agentsTabSource).toContain('window.electronAPI.updateAgentVisibility')
    expect(agentGroupSource).toContain('visibilityToggleable')
    expect(agentGroupSource).toContain("agent.visibility === 'public'")
    expect(agentGroupSource).toContain("$emit('toggle-visibility', agent, val ? 'public' : 'private')")
  })

  it('updates agent visibility optimistically and refreshes silently to avoid list flicker', () => {
    const toggleMatch = agentsTabSource.match(/const handleToggleVisibility = async \(agent, visibility\) => \{[\s\S]*?\n\}/)

    expect(agentsTabSource).toContain('const setAgentVisibility =')
    expect(toggleMatch?.[0] || '').toContain('const previousVisibility = agent.visibility')
    expect(toggleMatch?.[0] || '').toContain('setAgentVisibility(agent, visibility)')
    expect(toggleMatch?.[0] || '').toContain('await loadAgents({ silent: true })')
    expect(toggleMatch?.[0] || '').not.toContain('await loadAgents()')
  })
})
