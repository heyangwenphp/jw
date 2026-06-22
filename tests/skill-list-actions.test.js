import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('skill list actions', () => {
  const skillGroupSource = readSource('src/renderer/pages/main/components/RightPanel/tabs/skills/SkillGroup.vue')
  const skillsTabSource = readSource('src/renderer/pages/main/components/RightPanel/tabs/SkillsTab.vue')

  it('does not show open-folder icons at the end of editable skill group headers', () => {
    expect(skillGroupSource).not.toContain("t('rightPanel.skills.openFolder')")
    expect(skillGroupSource).not.toContain("Icon name=\"folderOpen\"")
    expect(skillGroupSource).not.toContain("'open-folder'")
    expect(skillsTabSource).not.toContain('@open-folder=')
    expect(skillsTabSource).not.toContain('openSkillsFolder')
  })

  it('removes per-skill open-file actions from item operation buttons', () => {
    expect(skillGroupSource).not.toContain("t('rightPanel.skills.openFile')")
    expect(skillGroupSource).not.toContain("Icon name=\"externalLink\"")
    expect(skillGroupSource).not.toContain("$emit('openFile', skill)")
  })

  it('places the skill toggle after delete actions and pins it to the far right', () => {
    const switchIndex = skillGroupSource.indexOf('<n-switch')
    const actionsIndex = skillGroupSource.indexOf('<span class="skill-actions">')

    expect(actionsIndex).toBeGreaterThan(-1)
    expect(switchIndex).toBeGreaterThan(actionsIndex)
    expect(skillGroupSource).toContain('class="skill-toggle"')
    expect(skillGroupSource).toContain('margin-left: auto;')
  })

  it('shows an action hover title around the skill enabled toggle without replacing the switch click target', () => {
    const toggleWrapperMatch = skillGroupSource.match(/<span[\s\S]*?class="skill-toggle-hitbox"[\s\S]*?<\/span>/)
    const toggleWrapper = toggleWrapperMatch?.[0] || ''

    expect(toggleWrapper).toContain(":title=\"skill.disabled ? t('rightPanel.skills.enable') : t('rightPanel.skills.disable')\"")
    expect(toggleWrapper).toContain('@click.stop')
    expect(toggleWrapper).toContain('<n-switch')
    expect(toggleWrapper).toContain('class="skill-toggle"')
    expect(toggleWrapper).toContain("@update:value=\"(val) => $emit('toggle-disabled', skill, !val)\"")
  })

  it('updates skill enabled state optimistically and refreshes silently to avoid list flicker', () => {
    const toggleMatch = skillsTabSource.match(/const handleToggleDisabled = async \(skill, disabled\) => \{[\s\S]*?\n\}/)
    const loadMatch = skillsTabSource.match(/const loadSkills = async \(\{ silent = false \} = \{\}\) => \{[\s\S]*?\n\}/)

    expect(skillsTabSource).toContain('const setSkillDisabled =')
    expect(toggleMatch?.[0] || '').toContain('const previousDisabled = skill.disabled')
    expect(toggleMatch?.[0] || '').toContain('setSkillDisabled(skill, disabled)')
    expect(toggleMatch?.[0] || '').toContain('await loadSkills({ silent: true })')
    expect(toggleMatch?.[0] || '').not.toContain('await loadSkills()')
    expect(loadMatch?.[0] || '').toContain('if (!silent) loading.value = true')
  })

  it('shows public skills in their own read-only group and includes them in counts', () => {
    expect(skillsTabSource).toContain("public: []")
    expect(skillsTabSource).toContain('skills.value.public.length')
    expect(skillsTabSource).toContain('public: filterSkillList(skills.value.public, kw)')
    expect(skillsTabSource).toContain('group-key="public"')
    expect(skillsTabSource).toContain(":title=\"t('rightPanel.skills.publicSkills')\"")
    expect(skillsTabSource).toContain(":empty-text=\"t('rightPanel.skills.noPublicSkills')\"")
    expect(skillsTabSource).toContain('result.public || []')
    expect(skillsTabSource).toContain("arr.filter(s => s.source === 'public')")
  })

  it('labels built-in skills as official skills in capability settings', () => {
    const zhLocaleSource = readSource('src/renderer/locales/zh-CN.js')
    const enLocaleSource = readSource('src/renderer/locales/en-US.js')

    expect(skillsTabSource).toContain("t('rightPanel.skills.builtInSkills')")
    expect(zhLocaleSource).toContain("builtInSkills: '官方技能'")
    expect(enLocaleSource).toContain("builtInSkills: 'Official Skills'")
    expect(zhLocaleSource).not.toContain("builtInSkills: '内置技能'")
    expect(enLocaleSource).not.toContain("builtInSkills: 'Built-in Skills'")
  })

  it('only shows management and disabled toggles for manageable skills', () => {
    expect(skillGroupSource).toContain('const canManageSkill =')
    expect(skillGroupSource).toContain('v-if="editable && canManageSkill(skill)"')
    expect(skillGroupSource).toContain('v-if="toggleable && canManageSkill(skill)"')
    expect(skillGroupSource).toContain('v-if="copy && skill.canCopy !== false"')
  })

  it('lets owners switch user skills between private and public', () => {
    expect(skillsTabSource).toContain('@toggle-visibility="handleToggleVisibility"')
    expect(skillsTabSource).toContain('window.electronAPI.updateSkillVisibility')
    expect(skillGroupSource).toContain('visibilityToggleable')
    expect(skillGroupSource).toContain("skill.visibility === 'public'")
    expect(skillGroupSource).toContain("$emit('toggle-visibility', skill, val ? 'public' : 'private')")
  })

  it('updates skill visibility optimistically and refreshes silently to avoid list flicker', () => {
    const toggleMatch = skillsTabSource.match(/const handleToggleVisibility = async \(skill, visibility\) => \{[\s\S]*?\n\}/)

    expect(skillsTabSource).toContain('const setSkillVisibility =')
    expect(toggleMatch?.[0] || '').toContain('const previousVisibility = skill.visibility')
    expect(toggleMatch?.[0] || '').toContain('setSkillVisibility(skill, visibility)')
    expect(toggleMatch?.[0] || '').toContain('await loadSkills({ silent: true })')
    expect(toggleMatch?.[0] || '').not.toContain('await loadSkills()')
  })
})
