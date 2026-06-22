/**
 * Skills Manager - 技能管理
 *
 * 三级 Skills 架构:
 * 1. 官方全局 (只读): 来自已安装插件 ~/.claude/plugins/{plugin}/skills/
 *    调用方式: /plugin-name:skill-id
 * 2. 自定义全局 (可编辑): 来自用户目录 ~/.claude/skills/
 *    调用方式: /skill-id
 * 3. 工程级别 (可编辑): 来自项目目录 {project}/.claude/skills/
 *    调用方式: /skill-id
 */

const path = require('path')
const { ComponentScanner } = require('../../component-scanner')

// 导入 mixins
const { skillsUtilsMixin } = require('./utils')
const { skillsCrudMixin } = require('./crud')
const { skillsImportMixin } = require('./import')
const { skillsExportMixin } = require('./export')
const { skillsMarketMixin } = require('./market')

class SkillsManager extends ComponentScanner {
  constructor() {
    super()
    // 自定义全局 skills 目录
    this.userSkillsDir = path.join(this.claudeDir, 'skills')
    // 内置 skills 目录：从 zip 自动解压加载
    this.builtInSkillsDir = this._extractBuiltInSkills()
  }

  /**
   * 自动解压内置技能 zip 文件
   * 扫描 src/skills/ 目录下的所有 zip，解压后统一加载
   * dev 模式解压到源码同级目录，production 解压到 userData
   */
  _extractBuiltInSkills() {
    const fs = require('fs')
    const path = require('path')
    const { app } = require('electron')

    // 内置技能源目录
    // dev: 项目根目录 skills/
    // prod: extraResources 将 skills 放到 asar 外 resources/skills/
    const skillsSourceDir = app.isPackaged
      ? path.join(process.resourcesPath, 'skills')
      : path.join(__dirname, '../../../../skills')

    if (!fs.existsSync(skillsSourceDir)) {
      console.log('[SkillsManager] Built-in skills source dir not found:', skillsSourceDir)
      return null
    }

    const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL
    const extractDir = isDev
      ? path.join(__dirname, '../../../../skills-extracted')
      : path.join(app.getPath('userData'), 'built-in-skills')

    try {
      // 清空目标目录
      if (fs.existsSync(extractDir)) {
        fs.rmSync(extractDir, { recursive: true, force: true })
      }
      fs.mkdirSync(extractDir, { recursive: true })

      const items = fs.readdirSync(skillsSourceDir, { withFileTypes: true })
      const AdmZip = require('adm-zip')

      for (const item of items) {
        const itemPath = path.join(skillsSourceDir, item.name)

        if (item.isDirectory()) {
          // 技能文件夹：包含 SKILL.md 的直接复制
          const hasSkillMd = fs.existsSync(path.join(itemPath, 'SKILL.md')) ||
            fs.existsSync(path.join(itemPath, 'skill.md'))
          if (hasSkillMd) {
            const targetPath = path.join(extractDir, item.name)
            fs.cpSync(itemPath, targetPath, { recursive: true, force: true })
            console.log(`[SkillsManager] Copied skill folder: ${item.name}`)
          }
        } else if (item.isFile() && item.name.endsWith('.zip')) {
          // zip 文件：解压处理
          const zip = new AdmZip(itemPath)
          const entries = zip.getEntries()
          const hasRootSkillMd = entries.some(e =>
            !e.isDirectory && (e.entryName === 'SKILL.md' || e.entryName === 'skill.md')
          )

          if (hasRootSkillMd) {
            const skillId = path.basename(itemPath, '.zip').replace(/-\d+\.\d+\.\d+$/, '')
            const skillDir = path.join(extractDir, skillId)
            fs.mkdirSync(skillDir, { recursive: true })
            zip.extractAllTo(skillDir, true)
            console.log(`[SkillsManager] Extracted zip: ${item.name} → ${skillId}/`)
          } else {
            zip.extractAllTo(extractDir, true)
            console.log(`[SkillsManager] Extracted zip: ${item.name}`)
          }
        }
      }

      console.log(`[SkillsManager] Built-in skills loaded to: ${extractDir}`)
    } catch (err) {
      console.error('[SkillsManager] Failed to extract built-in skills:', err)
    }

    return extractDir
  }
}

// 混入所有功能模块
Object.assign(SkillsManager.prototype, skillsUtilsMixin)
Object.assign(SkillsManager.prototype, skillsCrudMixin)
Object.assign(SkillsManager.prototype, skillsImportMixin)
Object.assign(SkillsManager.prototype, skillsExportMixin)
Object.assign(SkillsManager.prototype, skillsMarketMixin)

module.exports = { SkillsManager }
