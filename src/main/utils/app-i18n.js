const MAIN_I18N = {
  'zh-CN': {
    app: {
      modes: {
        agent: 'Jedi Agent'
      },
      windows: {
        main: '舆情监控',
        profileManager: 'API 配置管理 - Jedi',
        globalSettings: '全局设置 - Jedi',
        appearanceSettings: '外观设置 - Jedi',
        settingsWorkbench: '能力管理 - Jedi',
        providerManager: '服务商管理 - Jedi',
        sessionManager: '会话查询 - Jedi',
        updateManager: '关于 - Jedi',
        dingtalkSettings: '钉钉桥接设置 - Jedi',
        modelSettings: '模型设置 - Jedi'
      },
      tray: {
        tooltip: 'Jedi',
        show: '显示主窗口',
        hide: '隐藏主窗口',
        quit: '退出'
      },
      dialogs: {
        selectProjectFolder: '选择项目文件夹',
        selectDirectory: '选择目录',
        selectFile: '选择文件',
        selectFiles: '选择多个文件',
        exportSession: '导出会话',
        saveImage: '保存图片',
        markdown: 'Markdown',
        json: 'JSON',
        allFiles: '所有文件',
        pngImage: 'PNG 图片'
      },
      probeSessionTitle: 'API 测试探针'
    }
  },
  'en-US': {
    app: {
      modes: {
        agent: 'Jedi Agent'
      },
      windows: {
        main: '舆情监控',
        profileManager: 'API Profile Manager - Jedi',
        globalSettings: 'Global Settings - Jedi',
        appearanceSettings: 'Appearance Settings - Jedi',
        settingsWorkbench: 'Capability Management - Jedi',
        providerManager: 'Provider Manager - Jedi',
        sessionManager: 'Session Browser - Jedi',
        updateManager: 'About - Jedi',
        dingtalkSettings: 'DingTalk Bridge Settings - Jedi',
        modelSettings: 'Model Settings - Jedi'
      },
      tray: {
        tooltip: 'Jedi',
        show: 'Show Main Window',
        hide: 'Hide Main Window',
        quit: 'Quit'
      },
      dialogs: {
        selectProjectFolder: 'Select Project Folder',
        selectDirectory: 'Select Directory',
        selectFile: 'Select File',
        selectFiles: 'Select Files',
        exportSession: 'Export Session',
        saveImage: 'Save Image',
        markdown: 'Markdown',
        json: 'JSON',
        allFiles: 'All Files',
        pngImage: 'PNG Image'
      },
      probeSessionTitle: 'API Test Probe'
    }
  }
}

function getMainLocale(configManager) {
  return configManager?.getConfig?.()?.settings?.locale || 'zh-CN'
}

function resolveKeyPath(target, key) {
  return String(key || '')
    .split('.')
    .reduce((value, part) => (value && typeof value === 'object' ? value[part] : undefined), target)
}

function tMain(configManager, key, params = {}) {
  const locale = getMainLocale(configManager)
  const dict = MAIN_I18N[locale] || MAIN_I18N['zh-CN']
  const fallbackDict = MAIN_I18N['zh-CN']
  const template = resolveKeyPath(dict, key) || resolveKeyPath(fallbackDict, key) || key

  if (typeof template !== 'string') return key

  return template.replace(/\{(\w+)\}/g, (_, name) => (
    params[name] !== undefined ? String(params[name]) : `{${name}}`
  ))
}

module.exports = {
  getMainLocale,
  tMain
}
