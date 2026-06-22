import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('main left settings menu', () => {
  const leftPanelSource = readSource('src/renderer/pages/main/components/LeftPanel.vue')
  const footerSource = readSource('src/renderer/pages/main/components/LeftPanelFooter.vue')
  const projectLibraryWorkbenchSource = readSource('src/renderer/pages/main/components/project-library/ProjectLibraryWorkbench.vue')

  it('exposes capability settings to logged-in users and admin settings only to the admin phone', () => {
    const settingsOptions = leftPanelSource.match(
      /const settingsOptions = computed\(\(\) =>([\s\S]*?)\)/
    )?.[1]

    expect(settingsOptions).toBeTruthy()
    const superAdminStart = leftPanelSource.indexOf('if (isSuperAdmin.value) {')
    const loggedInStartAfterAdmin = leftPanelSource.indexOf('if (currentUser.value) {', superAdminStart)
    const superAdminBlock = leftPanelSource.slice(superAdminStart, loggedInStartAfterAdmin)
    const loggedInBlock = leftPanelSource.slice(loggedInStartAfterAdmin, leftPanelSource.indexOf('return options', loggedInStartAfterAdmin))
    expect(leftPanelSource).toContain('isSuperAdmin')
    expect(leftPanelSource).toContain("const ADMIN_PHONE = '15527109305'")
    expect(leftPanelSource).toContain("normalizePhone(currentUser.value?.phone) === ADMIN_PHONE")
    expect(leftPanelSource).toContain('if (currentUser.value) {')
    expect(leftPanelSource).toContain("key: 'model-settings'")
    expect(leftPanelSource).toContain("key: 'im-bot-settings'")
    expect(leftPanelSource).toContain("key: 'project-management'")
    expect(leftPanelSource).toContain("key: 'capability-settings'")
    expect(leftPanelSource).not.toContain("key: 'midea-yq-monitor'")
    expect(leftPanelSource).not.toContain("{ label: '美的舆情监控', key: 'midea-yq-monitor'")
    expect(superAdminBlock).not.toContain("key: 'midea-yq-monitor'")
    expect(loggedInBlock).not.toContain("key: 'midea-yq-monitor'")
    expect(settingsOptions).not.toContain('isAdminMode')
    expect(leftPanelSource).not.toContain("key: 'global-settings'")
    expect(leftPanelSource).not.toContain("key: 'appearance-settings'")
  })

  it('shows account actions in the bottom settings menu for logged-in users', () => {
    expect(leftPanelSource).toContain(':show-settings="showFooterSettings"')
    expect(leftPanelSource).toContain("key: 'account-info'")
    expect(leftPanelSource).toContain("key: 'logout'")
    expect(leftPanelSource).toContain('currentUser')
    expect(footerSource).toContain('showSettings')
    expect(footerSource).toContain('v-if="showSettings"')
  })

  it('removes the agent capability settings surface from the main shell', () => {
    expect(leftPanelSource).not.toContain('CapabilityModal')
    expect(leftPanelSource).not.toContain('showCapabilityModal')
    expect(leftPanelSource).not.toContain('@open-capability')
    expect(footerSource).not.toContain('open-capability')
    expect(footerSource).not.toContain('hasCapabilityUpdate')
  })

  it('routes admin settings through admin checks and capability settings for logged-in users', () => {
    expect(leftPanelSource).toContain("if (key === 'model-settings' && !isSuperAdmin.value) return")
    expect(leftPanelSource).toContain("if (key === 'im-bot-settings' && !isSuperAdmin.value) return")
    expect(leftPanelSource).toContain("if (key === 'project-management' && !isSuperAdmin.value) return")
    expect(leftPanelSource).not.toContain("if (key === 'midea-yq-monitor' && !isSuperAdmin.value) return")
    expect(leftPanelSource).toMatch(/case 'model-settings':[\s\S]*?window\.electronAPI\.openModelSettings\(\)/)
    expect(leftPanelSource).toMatch(/case 'im-bot-settings':[\s\S]*?window\.electronAPI\.openIMBotSettings\(\)/)
    expect(leftPanelSource).toMatch(/case 'project-management':[\s\S]*?openProjectManagement/)
    expect(leftPanelSource).not.toContain("case 'midea-yq-monitor'")
    expect(leftPanelSource).toMatch(/case 'capability-settings':[\s\S]*?window\.electronAPI\.openSettingsWorkbench\(\)/)
    expect(leftPanelSource).not.toContain("case 'global-settings'")
    expect(leftPanelSource).not.toContain("case 'appearance-settings'")
  })

  it('removes the Midea monitor entry from the project-library footer settings menu', () => {
    expect(projectLibraryWorkbenchSource).toContain("normalizePhone(currentUser.value?.phone) === ADMIN_PHONE")
    expect(projectLibraryWorkbenchSource).not.toContain("{ label: '美的舆情监控', key: 'midea-yq-monitor'")
    expect(projectLibraryWorkbenchSource).not.toContain("if (key === 'midea-yq-monitor' && !isSuperAdmin.value) return")
    expect(projectLibraryWorkbenchSource).not.toContain("detail: { type: 'midea-yq-monitor' }")
  })
})

describe('main settings overlay', () => {
  const mainContentSource = readSource('src/renderer/pages/main/components/MainContent.vue')

  it('renders model, IM bot, capability, and project management settings in the web overlay', () => {
    expect(mainContentSource).toContain('ModelSettingsContent')
    expect(mainContentSource).toContain('IMTab')
    expect(mainContentSource).toContain('SettingsWorkbenchContent')
    expect(mainContentSource).toContain('ProjectManagementContent')
    expect(mainContentSource).toContain('MideaYqMonitorContent')
    expect(mainContentSource).not.toContain("settingsActiveTab === 'midea-yq-monitor'")
    expect(mainContentSource).not.toContain('GlobalSettingsContent')
    expect(mainContentSource).not.toContain('AppearanceSettingsContent')
    expect(mainContentSource).not.toContain("settingsActiveTab === 'global'")
    expect(mainContentSource).not.toContain("settingsActiveTab === 'appearance'")
    expect(mainContentSource).toContain("settingsActiveTab === 'capability'")
    expect(mainContentSource).toContain("settingsActiveTab === 'im'")
    expect(mainContentSource).toContain("settingsActiveTab === 'project'")
  })

  it('accepts capability web settings events for logged-in users and admin settings only for the admin phone', () => {
    expect(mainContentSource).toContain('authGetCurrentUser')
    expect(mainContentSource).toContain("if (!currentUser) return")
    expect(mainContentSource).toContain("const ADMIN_PHONE = '15527109305'")
    expect(mainContentSource).toContain('const isAdminPhone = isAdminPhoneValue(currentUser.phone)')
    expect(mainContentSource).toContain("normalizePhone(phone) === ADMIN_PHONE")
    expect(mainContentSource).not.toContain('settingsNavigationTabs')
    expect(mainContentSource).not.toContain('settings-modal-tabs')
    expect(mainContentSource).toContain("if (requestedTab === 'model' && !isAdminPhone) return")
    expect(mainContentSource).toContain("if (requestedTab === 'im' && !isAdminPhone) return")
    expect(mainContentSource).toContain("if (requestedTab === 'project' && !isAdminPhone) return")
    expect(mainContentSource).not.toContain("if (requestedTab === 'midea-yq-monitor' && !isAdminPhone) return")
    expect(mainContentSource).not.toContain('getIsAdminMode')
    expect(mainContentSource).toContain("['model', 'im', 'capability', 'project']")
    expect(mainContentSource).not.toContain("settingsActiveTab === 'midea-yq-monitor'")
    expect(mainContentSource).toMatch(/validSettingsTabs[\s\S]*includes/)
  })

  it('exposes web project management and IM bot openers through the electron polyfill', () => {
    const polyfillSource = readSource('src/renderer/client-api/electron-polyfill.js')
    expect(polyfillSource).toContain('openProjectManagement')
    expect(polyfillSource).toContain("detail: { type: 'project' }")
    expect(polyfillSource).toContain('openIMBotSettings: () =>')
    expect(polyfillSource).toContain("detail: { type: 'im' }")
    expect(polyfillSource).toContain("detail: { type: 'capability', tab: options?.tab }")
  })
})

describe('settings workbench header', () => {
  const workbenchSource = readSource('src/renderer/pages/settings-workbench/components/SettingsWorkbenchContent.vue')
  const zhLocaleSource = readSource('src/renderer/locales/zh-CN.js')
  const enLocaleSource = readSource('src/renderer/locales/en-US.js')

  it('does not show a standalone header refresh button', () => {
    const headerTemplate = workbenchSource.match(
      /<div class="settings-header">([\s\S]*?)<\/div>\s*<div class="workbench-panel">/
    )?.[1]

    expect(headerTemplate).toBeTruthy()
    expect(headerTemplate).not.toContain('refreshCurrentTab')
    expect(headerTemplate).not.toContain("t('common.refresh')")
    expect(workbenchSource).not.toContain('const refreshCurrentTab =')
  })

  it('keeps a narrowed settings workbench subtitle', () => {
    expect(workbenchSource).toContain('header-subtitle')
    expect(workbenchSource).toContain("t('settingsWorkbench.subtitle')")
    expect(zhLocaleSource).toContain("subtitle: '集中管理 Skills / Agents'")
    expect(zhLocaleSource).not.toContain("subtitle: '集中管理 Skills / Agents / Settings'")
    expect(zhLocaleSource).not.toContain('跨模式集中管理 Skills / Agents / Hooks / Plugins / Settings')
    expect(enLocaleSource).toContain("subtitle: 'Manage Skills / Agents'")
    expect(enLocaleSource).not.toContain("subtitle: 'Manage Skills / Agents / Settings'")
    expect(enLocaleSource).not.toContain('Manage Skills / MCP / Agents / Hooks / Plugins / Settings across modes')
  })

  it('does not nest the Midea monitor inside capability workbench tabs', () => {
    expect(workbenchSource).not.toContain('MideaYqMonitor')
    expect(workbenchSource).not.toContain("{ id: 'midea-yq-monitor'")
    expect(workbenchSource).not.toContain("label: '美的舆情监控'")
  })
})

describe('Midea public-opinion monitor settings content', () => {
  const monitorSource = readSource('src/renderer/pages/main/components/settings/MideaYqMonitorContent.vue')
  const apiSource = readSource('src/renderer/client-api/api.js')
  const polyfillSource = readSource('src/renderer/client-api/electron-polyfill.js')

  it('uses paginated monitor loading with 20 rows by default', () => {
    expect(monitorSource).toContain('const pageSize = ref(20)')
    expect(monitorSource).toContain('const currentPage = ref(1)')
    expect(monitorSource).toContain('page: currentPage.value')
    expect(monitorSource).toContain('pageSize: pageSize.value')
    expect(monitorSource).toContain('totalItems')
    expect(monitorSource).toContain('listMideaYqItems')
  })

  it('supports publish date range filters for Midea monitor items', () => {
    expect(monitorSource).toContain('publishStartFilter')
    expect(monitorSource).toContain('publishEndFilter')
    expect(monitorSource).toContain('type="datetime-local"')
    expect(monitorSource).toContain('aria-label="发布时间开始"')
    expect(monitorSource).toContain('aria-label="发布时间结束"')
    expect(monitorSource).toContain("query.set('publishStart', options.publishStart)")
    expect(monitorSource).toContain("query.set('publishEnd', options.publishEnd)")
    expect(apiSource).toContain("query.set('publishStart', options.publishStart)")
    expect(apiSource).toContain("query.set('publishEnd', options.publishEnd)")
  })

  it('shows all rows as manually processable', () => {
    expect(monitorSource).toContain('processItem(item)')
    expect(monitorSource).toContain('processingItemId')
    expect(monitorSource).toContain('markItemProcessing')
    expect(monitorSource).toContain('applyTaskToItem')
    expect(monitorSource).not.toContain("push.status === 'failed'")
    expect(monitorSource).toContain('处理')
    expect(monitorSource).not.toContain('retryTask(push)')
    expect(monitorSource).not.toContain('重试')
  })

  it('shows processed Midea fields instead of request ids in the monitor table', () => {
    expect(monitorSource).not.toContain('<th>Request ID</th>')
    expect(monitorSource).toContain('<th>摘要</th>')
    expect(monitorSource).toContain('<th>情感属性</th>')
    expect(monitorSource).toContain('<th>推送标识</th>')
    expect(monitorSource).toContain('<th>完整标签</th>')
    expect(monitorSource).toContain('<th>投诉编号</th>')
    expect(monitorSource).toContain('<th>AI总结</th>')
    expect(monitorSource).toContain('<th>AI研判</th>')
    expect(monitorSource).toContain('item.newsEmotion')
    expect(monitorSource).toContain('item.pushFlag')
    expect(monitorSource).toContain('item.fullLabel')
    expect(monitorSource).toContain('item.summary')
    expect(monitorSource).toContain('item.complaintNo')
    expect(monitorSource).toContain('item.aiSummary')
    expect(monitorSource).toContain('item.aiJudgement')
  })

  it('keeps processed Midea fields inside detail JSON and protects them from empty patches', () => {
    expect(monitorSource).toContain('selectedPreviewData')
    expect(monitorSource).toContain('推送标识:')
    expect(monitorSource).toContain('完整标签:')
    expect(monitorSource).toContain('AI研判:')
    expect(monitorSource).not.toContain('推送日志:')
    expect(monitorSource).toContain('mergeItemPatch')
    expect(monitorSource).toContain('processedFieldKeys')
    expect(monitorSource).toContain('firstValue(item.summary')
    expect(monitorSource).toContain('firstValue(item.fullLabel')
    expect(monitorSource).toContain('firstValue(item.aiSummary')
    expect(monitorSource).toContain('firstValue(item.aiJudgement')
  })

  it('uses a near full-width detail modal for Midea monitor data', () => {
    expect(monitorSource).toContain('width: min(85vw, 1280px)')
  })

  it('exposes list and process APIs for Midea items', () => {
    expect(apiSource).toContain('listMideaYqItems')
    expect(apiSource).toContain('processMideaYqItem')
    expect(apiSource).toContain('pushMideaYqItem')
    expect(apiSource).toContain('/api/aipin-data/admin/items')
    expect(apiSource).toContain('/api/aipin-data/admin/items/${encodeURIComponent(itemId)}/process')
    expect(apiSource).toContain('/api/aipin-data/admin/items/${encodeURIComponent(itemId)}/push')
    expect(polyfillSource).toContain('listMideaYqItems')
    expect(polyfillSource).toContain('processMideaYqItem')
    expect(polyfillSource).toContain('pushMideaYqItem')
  })
})

describe('web model settings profile saves', () => {
  const polyfillSource = readSource('src/renderer/client-api/electron-polyfill.js')
  const useProfilesSource = readSource('src/renderer/composables/useProfiles.js')

  it('adapts Electron-style profile update payloads to the REST API signature', () => {
    expect(polyfillSource).toContain('updateAPIProfile as apiUpdateAPIProfile')
    expect(polyfillSource).toContain('const updateAPIProfileBridge = (payload, maybeUpdates) =>')
    expect(polyfillSource).toContain('return apiUpdateAPIProfile(profileId, updates)')
    expect(polyfillSource).toContain('updateAPIProfile: updateAPIProfileBridge')
  })

  it('does not report profile save success when the backend update returns false', () => {
    expect(useProfilesSource).toContain('if (result === false || result?.success === false)')
  })
})
