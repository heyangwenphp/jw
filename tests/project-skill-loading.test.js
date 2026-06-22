import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { ComponentScanner } = require('../src/main/component-scanner.js')

describe('project skill loading', () => {
  it('parses the early investment research project skill frontmatter from project skill paths', () => {
    const scanner = new ComponentScanner()
    for (const projectSkillsDir of [
      join(process.cwd(), '.codex', 'skills'),
      join(process.cwd(), 'skills')
    ]) {
      const skills = scanner.scanSkillDirectories(projectSkillsDir)
      const skill = skills.find(item => item.id === 'early-investment-research')

      expect(skill).toBeTruthy()
      expect(skill.frontmatter).toEqual(expect.objectContaining({
        name: 'early-investment-research'
      }))
      expect(skill.frontmatter?.description).toBeTruthy()
    }
  })

  it('requires markdown-first staged report display without default extra file creation', () => {
    for (const skillPath of [
      join(process.cwd(), '.codex', 'skills', 'early-investment-research', 'SKILL.md'),
      join(process.cwd(), 'skills', 'early-investment-research', 'SKILL.md')
    ]) {
      const content = readFileSync(skillPath, 'utf8')

      expect(content).toContain('Agent 对话中的可见输出只能是报告正文内容本身')
      expect(content).toContain('采用分阶段增量交付')
      expect(content).toContain('Markdown 文件写入为静默副作用')
      expect(content).toContain('每条搜索线索生成一个 Markdown 文档')
      expect(content).toContain('Agent 在对话中展示最终报告正文后，由宿主应用后台静默生成最终报告 Markdown 文件')
      expect(content).not.toContain('最终报告 Markdown 文件必须在对话中展示最终完整报告前生成')
      expect(content).toContain('本节标题必须固定为 `### 2. 项目线索`')
      expect(content).toContain('不要使用 Markdown 表格')
      expect(content).toContain('scripts/render-markdown-preview-pdf.js')
      expect(content).toContain('report.html')
      expect(content).toContain('gen-pdf.js')
      expect(content).toContain('默认不生成 PDF、HTML、Docx 或其他文件')
    }
  })

  it('keeps internal source details out of early-investment-research visible instructions', () => {
    for (const skillPath of [
      join(process.cwd(), '.codex', 'skills', 'early-investment-research', 'SKILL.md'),
      join(process.cwd(), 'skills', 'early-investment-research', 'SKILL.md')
    ]) {
      const content = readFileSync(skillPath, 'utf8')

      expect(content).not.toContain('sqlite')
      expect(content).not.toContain('wechat_765.sqlite')
      expect(content).toContain('内部线索源的文件名、扩展名、存储类型、查询语句、表名和路径均不得出现在可见回复、思考过程、报告正文或来源字段中')
      expect(content).toContain('不要在会话中披露内部线索源的检索细节')
    }
  })

  it('requires target display titles to use target labels and prefer project names', () => {
    for (const skillPath of [
      join(process.cwd(), '.codex', 'skills', 'early-investment-research', 'SKILL.md'),
      join(process.cwd(), 'skills', 'early-investment-research', 'SKILL.md')
    ]) {
      const content = readFileSync(skillPath, 'utf8')

      expect(content).toContain('标的展示标题命名')
      expect(content).toContain('项目字段有单个项目 → `## 标的一：项目名称`')
      expect(content).toContain('项目字段有多个项目 → `## 标的一：第一个项目名称`')
      expect(content).toContain('项目字段为空 → `## 标的一：团体名称`')
      expect(content).toContain('团体名称为空 → 依次使用机构/实验室/公司、关联人物兜底')
    }
  })
})
