import { describe, expect, it } from 'vitest'
import {
  compactThinkingText,
  sanitizeAgentVisibleText,
  sanitizeThinkingText,
  summarizeThinkingStatus
} from '../src/renderer/utils/agent-thinking-display.js'

describe('agent visible text sanitizer', () => {
  it('removes PDF generation waiting lines from visible report text', () => {
    const sanitized = sanitizeAgentVisibleText([
      '# 清华系早期投资机会研判报告',
      '',
      '现在为您生成 PDF 报告。',
      '',
      'PDF报告已生成成功。',
      'C:\\reports\\清华系早期投资机会研判报告.pdf'
    ].join('\n'))

    expect(sanitized).not.toContain('现在为您生成 PDF 报告')
    expect(sanitized).toContain('PDF报告已生成成功。')
    expect(sanitized).toContain('C:\\reports\\清华系早期投资机会研判报告.pdf')
  })

  it('hides routine research progress status prompts', () => {
    expect(summarizeThinkingStatus('正在检索并核验公开来源...')).toBe('')
    expect(summarizeThinkingStatus('正在整理项目线索...')).toBe('')
    expect(summarizeThinkingStatus('正在核验清华系关联...')).toBe('')
    expect(summarizeThinkingStatus('正在整理研判报告...')).toBe('')
  })

  it('removes generic progress and workflow thinking prompts', () => {
    const sanitized = sanitizeThinkingText([
      '正在整理项目线索...',
      '第一步：核验公司工商与融资来源。',
      '正在处理请求...',
      '正在检索并核验公开来源...',
      '正在核验清华系关联...'
    ].join('\n'))

    expect(sanitized).not.toContain('正在整理项目线索')
    expect(sanitized).not.toContain('正在处理请求')
    expect(sanitized).not.toContain('正在检索并核验公开来源')
    expect(sanitized).not.toContain('正在核验清华系关联')
    expect(sanitized).not.toContain('第一步：核验公司工商与融资来源。')
  })

  it('hides obsolete HTML-to-PDF workflow chatter', () => {
    const sanitized = sanitizeAgentVisibleText([
      '用户多次要求重新生成PDF报告。',
      '我已经完成了HTML的重新生成和PDF的重新生成。让我验证一下PDF文件是否正确生成。',
      'C:\\reports\\final.pdf'
    ].join('\n'))

    expect(sanitized).toContain('用户多次要求重新生成PDF报告。')
    expect(sanitized).toContain('C:\\reports\\final.pdf')
    expect(sanitized).not.toContain('HTML的重新生成')
    expect(sanitized).not.toContain('验证一下PDF文件')
  })

  it('hides missing relative renderer and ad-hoc markdown-to-html script chatter', () => {
    const sanitized = sanitizeAgentVisibleText([
      '用户要求重新生成PDF，根据系统约束，我必须使用固定命令。',
      '但是这个脚本在当前目录中不存在。',
      '1. 重新创建Python脚本将Markdown转为HTML',
      'md_to_html_v2.py',
      'C:\\reports\\final.pdf'
    ].join('\n'))

    expect(sanitized).toContain('用户要求重新生成PDF')
    expect(sanitized).toContain('C:\\reports\\final.pdf')
    expect(sanitized).not.toContain('当前目录中不存在')
    expect(sanitized).not.toContain('重新创建Python脚本')
    expect(sanitized).not.toContain('md_to_html_v2.py')
  })

  it('hides report-generation workflow chatter from thinking details', () => {
    const compacted = compactThinkingText([
      '我已经收集了大量关于 LiberAI 和刘松铭的信息。现在让我整理并生成完整的早期投资机会研判报告。',
      '现在按照技能要求生成报告：',
      '1. 即时状态：已输出',
      '2. 报告骨架：需要输出标题、日期、投资意图拆解、项目线索',
      '3. 项目线索：由于刘松铭和林凡淇已明确归属于 LiberAI 企业，同一赛道下只展示企业标的',
      '我需要确保不使用 Markdown 表格，并且 URL 使用 HTML 格式 target="_blank"。'
    ].join('\n'))

    expect(compacted).not.toContain('技能要求')
    expect(compacted).not.toBe('正在整理研判报告...')
    expect(compacted).not.toContain('我需要确保不使用 Markdown 表格')
    expect(compacted).not.toContain('...')
  })

  it('hides Tsinghua verification workflow steps from thinking details', () => {
    const compacted = compactThinkingText([
      '第一步：核验清华系关联，先比对团队成员公开履历。',
      '第二步：核验公司工商信息和融资来源。',
      '第三步：检查公开报道是否能支持商业化信号。',
      '第四步：排除纯活动和无法确认关联的对象。'
    ].join('\n'))

    expect(compacted).not.toContain('第一步：核验清华系关联')
    expect(compacted).not.toContain('第二步：核验公司工商信息')
    expect(compacted).not.toBe('正在核验清华系关联...')
    expect(compacted).not.toContain('第四步：排除纯活动和无法确认关联')
    expect(compacted).not.toContain('...')
  })

  it('hides local lead-source lookup and report drafting chatter', () => {
    const leaked = [
      '按照技能要求，我先从本地清华公号库检索项目线索，生成候选池。',
      '表结构确认完毕。现在从本地库检索清华创业相关文章。',
      '现在查询清华创业相关项目线索。',
      '发现了好几个有潜力的项目。让我进一步查看关键文章的详细内容，同时扩大搜索。',
      '很多结构化字段为空，我需要直接查看文章的 content_text 和 llm_extraction_json 字段获取详细信息。',
      '继续深入获取更多项目的详细内容。',
      '还需要获取 FacePhys 文章和几个补充项目。',
      '现在我已收集到足够的本地项目数据。让我检查几个关键信息的联网验证。'
    ].join('\n')

    expect(sanitizeThinkingText(leaked)).toBe('')
    expect(sanitizeAgentVisibleText(leaked)).toBe('')
    expect(compactThinkingText(leaked)).toBe('')
  })

  it('shows up to ten thinking lines without a character limit', () => {
    const longLine = `long-${'x'.repeat(260)}`
    const compacted = compactThinkingText([
      longLine,
      'line-02',
      'line-03',
      'line-04',
      'line-05',
      'line-06',
      'line-07',
      'line-08',
      'line-09',
      'line-10',
      'line-11'
    ].join('\n'))

    expect(compacted).toContain(longLine)
    expect(compacted).toContain('line-10')
    expect(compacted).not.toContain('line-11')
    expect(compacted).toMatch(/\n\.\.\.$/)
  })

  it('hides pre-report workflow thinking when thinking already contains report body promoted to visible content', () => {
    const compacted = compactThinkingText([
      '先核验 LiberAI 团队和融资线索，避免把纯活动材料放进项目线索。',
      '再整理可公开验证的来源链接。',
      '',
      '# LiberAI（刘松铭团队）',
      '',
      '## 1. 投资意图拆解',
      'LiberAI 处于具身智能与物理世界模型交叉方向。',
      '',
      '## 2. 项目线索',
      ':::field-card',
      '名称：LiberAI',
      ':::'
    ].join('\n'))

    expect(compacted).not.toContain('先核验 LiberAI 团队和融资线索')
    expect(compacted).not.toContain('再整理可公开验证的来源链接')
    expect(compacted).not.toBe('正在整理报告正文...')
    expect(compacted).not.toContain('# LiberAI')
  })

  it('drops investment lead candidate ranking chatter before the formal report title', () => {
    const leaked = [
      '主体类型：科研团队/企业（博睿康需确认）。',
      '',
      'Lead Score: 92 / Alpha Score: 90 (全球首款，行业极早期)',
      '清华关联：洪波教授，清华生物医学工程学院',
      '从搜索结果看，未磁科技成立于2020年，创始人信息没有明确提及清华。',
      '让我再考虑一下：',
      '我倾向于选择未磁科技，因为其商业价值最高。',
      '报告标题：清华早期创业项目线索分析报告（2026年6月12日）',
      '建议动作：',
      'NEO: meet —— 直接约洪波教授团队沟通博睿康产业化进展和后续融资计划',
      '现在编写Markdown报告。',
      '',
      '# 清华早期创业项目线索分析报告（2026年6月12日）',
      '',
      '## 一、项目线索统计',
      '- **项目总数**：3个'
    ].join('\n')

    const sanitized = sanitizeAgentVisibleText(leaked)

    expect(sanitized).toContain('# 清华早期创业项目线索分析报告')
    expect(sanitized).toContain('## 一、项目线索统计')
    expect(sanitized).not.toContain('主体类型：科研团队/企业')
    expect(sanitized).not.toContain('Lead Score: 92')
    expect(sanitized).not.toContain('从搜索结果看')
    expect(sanitized).not.toContain('我倾向于')
    expect(sanitized).not.toContain('现在编写Markdown报告')
  })

  it('hides database field-order debugging chatter from visible output', () => {
    const leaked = [
      '我看到问题了 - 之前的查询把`topic`字段导出时错位了。因为在输出中，Topic字段显示的是置信度数值（如 58.0, 66.0等），而不是真正的topic名称。',
      '看起来字段索引可能有问题。让我重新验证数据库字段顺序。',
      '',
      '从表结构中看，字段顺序是：',
      '1. id',
      '2. article_source',
      '3. account_id',
      '4. account_name',
      '',
      '# 清华早期创业项目线索分析报告（2026年6月12日）',
      '',
      '## 一、项目线索统计'
    ].join('\n')

    const sanitized = sanitizeAgentVisibleText(leaked)

    expect(sanitized).toContain('# 清华早期创业项目线索分析报告')
    expect(sanitized).not.toContain('我看到问题了')
    expect(sanitized).not.toContain('字段导出时错位')
    expect(sanitized).not.toContain('字段索引')
    expect(sanitized).not.toContain('字段顺序是')
    expect(sanitized).not.toContain('article_source')
  })
})
