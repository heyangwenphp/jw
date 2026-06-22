import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderMarkdownWithHighlight } from '../src/renderer/utils/highlight-utils.js'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

describe('markdown field-card rendering', () => {
  it('renders field-card containers without showing container markers', () => {
    const html = renderMarkdownWithHighlight([
      '## 标的一：LiberAI',
      '',
      ':::field-card',
      '主体名称：LiberAI（北京将闲科技有限公司）',
      '关联人物：刘松铭（创始人兼CEO）、林凡淇（联合创始人）',
      '置信度：高',
      ':::'
    ].join('\n'))

    expect(html).toContain('class="field-card"')
    expect(html).toContain('class="field-card-label">主体名称</div>')
    expect(html).toContain('LiberAI（北京将闲科技有限公司）')
    expect(html).not.toContain(':::field-card')
    expect(html).not.toContain('<p>:::</p>')
  })

  it('renders field-card source references as clickable source names with icons', () => {
    const html = renderMarkdownWithHighlight([
      ':::field-card',
      '来源依据：',
      'S1｜来源类型：GitHub｜来源名称：thu-ml/RoboticsDiffusionTransformer｜支撑事实：开源仓库｜核实状态：已核实｜详情 URL：<a href="https://github.com/thu-ml/RoboticsDiffusionTransformer" target="_blank" rel="noopener noreferrer">GitHub: thu-ml/RoboticsDiffusionTransformer</a>',
      'S2｜来源类型：论文｜来源名称：RDT-1B论文｜支撑事实：论文来源｜核实状态：已核实｜详情 URL：<a href="https://arxiv.org/abs/2410.07864" target="_blank" rel="noopener noreferrer">arXiv: RDT-1B论文</a>',
      ':::'
    ].join('\n'))

    expect(html).toContain('class="field-card-label">来源依据</div>')
    expect(html).toContain('class="source-reference-chip clickable-link"')
    expect(html).toContain('class="source-reference-name">thu-ml/RoboticsDiffusionTransformer</span>')
    expect(html).toContain('class="source-reference-name">RDT-1B论文</span>')
    expect(html).toContain('href="https://github.com/thu-ml/RoboticsDiffusionTransformer"')
    expect(html).toContain('href="https://arxiv.org/abs/2410.07864"')
    expect(html).toContain('title="来源类型：GitHub')
    expect(html).toContain('来源名称：thu-ml/RoboticsDiffusionTransformer')
    expect(html).toContain('核实状态：已核实')
    expect(html).not.toContain('S1｜来源类型')
    expect(html).not.toContain('GitHub: thu-ml/RoboticsDiffusionTransformer</a>')
    expect(html).not.toContain('class="field-card-label">[GitHub')
    expect(html).not.toContain('&lt;a href=')
  })

  it('renders numbered report information sources as clickable source names with icons', () => {
    const html = renderMarkdownWithHighlight([
      '#### 五、投资研判',
      '19. 投资亮点：清华系成果转化线索明确。',
      '20. 核心风险：商业化进展待验证。',
      '21. 信息来源：',
      'S1｜来源类型：公众号文章｜来源名称：清华挑战杯项目展示｜支撑事实：确认项目展示与清华关联｜核实状态：已核实｜详情URL：http://mp.weixin.qq.com/s/example',
      'S2｜来源类型：融资报道｜来源名称：示例融资报道｜支撑事实：确认融资轮次｜核实状态：待核实｜详情 URL：<a href="https://example.com/report" target="_blank" rel="noopener noreferrer">融资报道</a>',
      '22. 信息置信度：中',
      '23. 建议动作：confirm_then_meet'
    ].join('\n'))

    expect(html).toContain('<li>信息来源：<a class="source-reference-chip clickable-link"')
    expect(html).toContain('class="source-reference-chip clickable-link"')
    expect(html).toContain('class="source-reference-name">清华挑战杯项目展示</span>')
    expect(html).toContain('class="source-reference-name">示例融资报道</span>')
    expect(html).toContain('data-href="http://mp.weixin.qq.com/s/example"')
    expect(html).toContain('data-href="https://example.com/report"')
    expect(html).toContain('title="来源类型：公众号文章')
    expect(html).not.toContain('S1｜来源类型')
    expect(html).not.toContain('确认项目展示与清华关联｜核实状态')
    expect(html).not.toContain('>融资报道</a>')
    expect(html).toContain('<li>信息置信度：中</li>')
  })

  it('does not keep the missing placeholder when an empty field is filled by following lines', () => {
    const html = renderMarkdownWithHighlight([
      ':::field-card',
      '关联任务：',
      '- 任务一：核验公司工商信息',
      '- 任务二：补充融资来源',
      '其他字段：',
      '后续已有明确数据',
      ':::'
    ].join('\n'))

    expect(html).toContain('class="field-card-label">关联任务</div>')
    expect(html).toContain('任务一：核验公司工商信息')
    expect(html).toContain('任务二：补充融资来源')
    expect(html).toContain('后续已有明确数据')
    expect(html).not.toContain('未查到')
  })

  it('renders plain investment report outlines as headings in previews', () => {
    const html = renderMarkdownWithHighlight([
      '沧州市实验小学西校区',
      '生成日期：2026年6月8日',
      '',
      '1. 投资意图拆解',
      '本次研判围绕用户指定的项目展开。',
      '',
      '2. 项目线索',
      '项目为公共教育建筑。'
    ].join('\n'))

    expect(html).toContain('<h1>沧州市实验小学西校区</h1>')
    expect(html).toContain('<h3>1. 投资意图拆解</h3>')
    expect(html).toContain('<h3>2. 项目线索</h3>')
    expect(html).not.toContain('<ol>')
  })

  it('renders scheduled report outlines without requiring a generated date line', () => {
    const html = renderMarkdownWithHighlight([
      '日报(2026年6月4日)',
      '',
      '1. 项目线索',
      '项目为清华系早期线索。',
      '',
      '2. Alpha Signal 分析',
      '存在早期验证窗口。'
    ].join('\n'))

    expect(html).toContain('<h1>日报(2026年6月4日)</h1>')
    expect(html).toContain('<h3>1. 项目线索</h3>')
    expect(html).toContain('<h3>2. Alpha Signal 分析</h3>')
    expect(html).not.toContain('生成日期')
    expect(html).not.toContain('<ol>')
  })

  it('breaks inline Alpha, action, and risk fields onto separate rendered lines', () => {
    const html = renderMarkdownWithHighlight([
      '4. 行动建议与工作流队列',
      '',
      'P2 — supplement_search：低空智联网/UTM方向补充扫描',
      '目标：补充搜索清华电子工程系、自动化系在低空智联网和UTM方向的创业团队和成果转化项目。 描述：当前项目线索中基础设施层标的偏少，需专项扫描。 预计工作量：2-3天。 是否阻塞：否。',
      '',
      '5. 缺失信息与风险',
      '',
      'Gap1：低空智联网/UTM方向清华系标的不足',
      '关联线索：本报告仅覆盖两个低空基础设施相关标的。 缺失信息：清华电子工程系和自动化系相关成果转化项目。 优先级：高。 是否阻塞：否。 建议动作：专项补充搜索。',
      '',
      '2. Alpha Signal 分析',
      '',
      'A1：差异化技术路线',
      '线索：清华系团队具备早期成果转化信号。 为什么主流程可能低估：主流资本尚未充分识别。 为什么不是噪声：已有来源事实支撑。 最小验证动作：联系团队核验。 是否需要人工背书：是。'
    ].join('\n'))

    expect(html).toContain('目标：补充搜索清华电子工程系、自动化系在低空智联网和UTM方向的创业团队和成果转化项目。<br>')
    expect(html).toContain('描述：当前项目线索中基础设施层标的偏少，需专项扫描。<br>')
    expect(html).toContain('预计工作量：2-3天。<br>')
    expect(html).toContain('关联线索：本报告仅覆盖两个低空基础设施相关标的。<br>')
    expect(html).toContain('缺失信息：清华电子工程系和自动化系相关成果转化项目。<br>')
    expect(html).toContain('建议动作：专项补充搜索。')
    expect(html).toContain('线索：清华系团队具备早期成果转化信号。<br>')
    expect(html).toContain('为什么主流程可能低估：主流资本尚未充分识别。<br>')
    expect(html).toContain('最小验证动作：联系团队核验。<br>')
  })

  it('breaks inline investment lead header fields onto separate rendered lines', () => {
    const html = renderMarkdownWithHighlight([
      '项目名称：容芯致远 — 以GPU为中心的下一代AI计算机架构 一句话简介：不做GPU，而是把计算机的"骨架"从以CPU为中心切换为以GPU为中心，设计AGC架构芯片彻底解决AI大模型训练/推理的算力利用率瓶颈 标签：AI芯片架构 / 清华电子系 / 架构重构 / AGC芯片 / 天使轮 综合评分：Lead Score: 76 / Alpha Score: 85 / 优先级: 3 / 信息置信度: 中'
    ].join('\n'))

    expect(html).toContain('项目名称：容芯致远 — 以GPU为中心的下一代AI计算机架构<br>')
    expect(html).toContain('一句话简介：不做GPU，而是把计算机的&quot;骨架&quot;从以CPU为中心切换为以GPU为中心')
    expect(html).toContain('标签：AI芯片架构 / 清华电子系 / 架构重构 / AGC芯片 / 天使轮<br>')
    expect(html).toContain('综合评分：Lead Score: 76 / Alpha Score: 85 / 优先级: 3 / 信息置信度: 中')
  })

  it('marks investment leads summary tables for compact column widths', () => {
    const html = renderMarkdownWithHighlight([
      '| 序号 | 项目名称 | 主体类型 | 核心赛道 | 融资阶段 | 核心亮点 |',
      '| -- | ---- | -- | ---- | ---- | ---------------- |',
      '| 1 | 示例项目 | 企业 | AI | 天使轮 | 清华系团队具备早期产品验证 |'
    ].join('\n'))

    expect(html).toContain('<table class="investment-leads-summary-table">')
  })

  it('styles investment leads summary table columns in markdown previews', () => {
    const markdownStyle = readSource('src/renderer/styles/markdown-preview.css')

    expect(markdownStyle).toContain('.jedi-markdown-preview .investment-leads-summary-table th:nth-child(1)')
    expect(markdownStyle).toContain('width: 80px;')
    expect(markdownStyle).toContain('.jedi-markdown-preview .investment-leads-summary-table th:nth-child(6)')
    expect(markdownStyle).toContain('width: 34%;')
  })

  it('highlights project lead titles without changing numbered detail fields', () => {
    const html = renderMarkdownWithHighlight([
      '# 清华早期创业项目线索分析报告',
      '',
      '## 二、项目线索介绍',
      '',
      '### 1. NEO脑机接口系统',
      '项目名称：NEO脑机接口系统',
      '一句话简介：面向脑机接口的系统方案。',
      '',
      '#### 一、项目基础信息',
      '1. 主体类型：科研团队',
      '2. 核心业务方向：脑机接口',
      '#### 五、投资研判',
      '19. 投资亮点：清华系线索明确',
      '',
      '### 2. 清力技术（自超滑）',
      '项目名称：清力技术（自超滑）',
      '一句话简介：面向先进材料的产业化项目。'
    ].join('\n'))

    expect(html).toContain('<h3 class="project-lead-title">1. NEO脑机接口系统</h3>')
    expect(html).toContain('<h3 class="project-lead-title">2. 清力技术（自超滑）</h3>')
    expect(html).toContain('<h4>五、投资研判</h4>')
    expect(html).toContain('<li>主体类型：科研团队</li>')
    expect(html).not.toContain('<h4 class="project-lead-title">五、投资研判</h4>')
  })

  it('styles field cards in markdown preview surfaces', () => {
    const filePreviewSource = readSource('src/renderer/pages/main/components/AgentRightPanel/FilePreview.vue')
    const markdownStyle = readSource('src/renderer/styles/markdown-preview.css')

    expect(filePreviewSource).toContain('class="markdown-preview jedi-markdown-preview"')
    expect(markdownStyle).toContain('.jedi-markdown-preview .field-card')
    expect(markdownStyle).toContain('.jedi-markdown-preview .field-card-label')
    expect(markdownStyle).toContain('.jedi-markdown-preview .source-reference-chip')
    expect(markdownStyle).toContain('.jedi-markdown-preview .source-reference-name')
    expect(markdownStyle).toContain('.jedi-markdown-preview .source-reference-link')
    expect(markdownStyle).toContain('.jedi-markdown-preview .project-lead-title')
    expect(markdownStyle).toContain('margin: 32px 0 14px;')
    expect(markdownStyle).toContain('border-left: 4px solid var(--primary-color);')
    expect(markdownStyle).toContain('.jedi-markdown-preview h4')
    expect(markdownStyle).toContain('.jedi-markdown-preview h4::before')
    expect(markdownStyle).toContain('border-radius: 4px 0 0 4px;')
    expect(markdownStyle).toContain('background: var(--primary-color);')
    expect(markdownStyle).not.toContain('border-left: 3px solid var(--primary-color);')
    expect(markdownStyle).not.toContain('border-bottom: 1px solid var(--border-color);')
  })
})
