import { describe, expect, it } from 'vitest'
import { renderAssistantMessageContent } from '../src/renderer/utils/agent-message-display.js'

describe('agent assistant message display', () => {
  it('hides PDF waiting text and renders preview/download actions for a standalone PDF path', () => {
    const pdfPath = 'C:\\Users\\72361\\Desktop\\jedi_web\\jedi_web\\具身硬件赛道早期团队——清华系早期投资机会研判报告.pdf'
    const html = renderAssistantMessageContent([
      '核实状态说明：本报告基于已有知识库生成，部分最新融资状态、公司运营状态、产品参数等标记为 [待验证]，建议在投资跟进前通过工商信息查询、直接访谈、官网/公众号核实等方式人工确认。',
      '',
      '现在为您生成 PDF 报告。',
      '',
      pdfPath
    ].join('\n'))

    expect(html).not.toContain('现在为您生成 PDF 报告')
    expect(html).toContain(`data-href="${pdfPath}"`)
    expect(html).toContain('data-link-action="preview"')
    expect(html).toContain('data-link-action="download"')
    expect(html).toContain('clickable-link-preview')
    expect(html).toContain('clickable-link-download')
  })

  it('repairs URLs split between protocol and slashes before rendering assistant content', () => {
    const html = renderAssistantMessageContent([
      '来源依据：',
      'https',
      '//www.qcc.com/firm/6dd73b6ea87c8428ca3e6b975b8e0469.html（企查查工商信息）'
    ].join('\n'))

    expect(html).toContain('https://www.qcc.com/firm/6dd73b6ea87c8428ca3e6b975b8e0469.html')
    expect(html).not.toContain('https<br>//www.qcc.com')
  })
  it('normalizes safe HTML detail links before rendering assistant markdown', () => {
    const html = renderAssistantMessageContent([
      '**发布时间/访问时间**',
      '2026年1月30日',
      '**详情 URL**',
      '<a href="https://news.qq.com/rain/a/20260130A04B6G00" target="_blank" rel="noopener noreferrer">详情链接</a>',
      '**支撑的事实**',
      '刘松铭获首届腾讯"青云奖学金"'
    ].join('\n'))

    expect(html).toContain('<a href="https://news.qq.com/rain/a/20260130A04B6G00"')
    expect(html).toContain('>详情链接</a>')
    expect(html).not.toContain('&lt;a href=')
    expect(html).not.toContain('target="_blank" rel="noopener noreferrer"&gt;')
  })

  it('breaks inline investment lead header fields in assistant bubbles', () => {
    const html = renderAssistantMessageContent([
      '# 清华早期创业项目线索分析报告',
      '',
      '项目名称：容芯致远 — 以GPU为中心的下一代AI计算机架构 一句话简介：不做GPU，而是把计算机的"骨架"从以CPU为中心切换为以GPU为中心，设计AGC架构芯片彻底解决AI大模型训练/推理的算力利用率瓶颈 标签：AI芯片架构 / 清华电子系 / 架构重构 / AGC芯片 / 天使轮 综合评分：Lead Score: 76 / Alpha Score: 85 / 优先级: 3 / 信息置信度: 中'
    ].join('\n'))

    expect(html).toContain('项目名称：容芯致远 — 以GPU为中心的下一代AI计算机架构<br>')
    expect(html).toContain('一句话简介：不做GPU，而是把计算机的&quot;骨架&quot;从以CPU为中心切换为以GPU为中心，设计AGC架构芯片彻底解决AI大模型训练/推理的算力利用率瓶颈<br>')
    expect(html).toContain('标签：AI芯片架构 / 清华电子系 / 架构重构 / AGC芯片 / 天使轮<br>')
    expect(html).toContain('综合评分：Lead Score: 76 / Alpha Score: 85 / 优先级: 3 / 信息置信度: 中')
    expect(html).not.toContain('Alpha Score: 85 /<br>优先级')
  })

  it('keeps bold investment lead header field lines visually separated', () => {
    const html = renderAssistantMessageContent([
      '**项目名称**：FacePhys（北京微面科技有限公司）— 非接触式生理与情绪感知基座模型',
      '**一句话简介**：通过普通RGB摄像头实时无接触检测心率、呼吸、情绪等120+项生理指标，为机器人、智能座舱、康养医疗提供"读懂人"的底层感知能力',
      '**标签**：具身智能 / 情感计算 / rPPG / 清华00后创业 / 天使轮'
    ].join('\n'))

    expect(html).toContain('<strong>项目名称</strong>：FacePhys（北京微面科技有限公司）— 非接触式生理与情绪感知基座模型<br>')
    expect(html).toContain('<strong>一句话简介</strong>：通过普通RGB摄像头实时无接触检测心率、呼吸、情绪等120+项生理指标，为机器人、智能座舱、康养医疗提供&quot;读懂人&quot;的底层感知能力<br>')
    expect(html).toContain('<strong>标签</strong>：具身智能 / 情感计算 / rPPG / 清华00后创业 / 天使轮')
  })

  it('renders source URL lists inside field cards as clickable source names with icons', () => {
    const html = renderAssistantMessageContent([
      ':::field-card',
      '来源依据：',
      'S1｜来源类型：GitHub｜来源名称：thu-ml/RoboticsDiffusionTransformer｜支撑事实：开源仓库｜核实状态：已核实｜详情 URL：<a href="https://github.com/thu-ml/RoboticsDiffusionTransformer" target="_blank" rel="noopener noreferrer">GitHub: thu-ml/RoboticsDiffusionTransformer</a>',
      'S2｜来源类型：论文｜来源名称：RDT-1B论文｜支撑事实：论文来源｜核实状态：已核实｜详情 URL：<a href="https://arxiv.org/abs/2410.07864" target="_blank" rel="noopener noreferrer">arXiv: RDT-1B论文</a>',
      ':::'
    ].join('\n'))

    expect(html).toContain('class="source-reference-chip clickable-link"')
    expect(html).toContain('class="source-reference-name">thu-ml/RoboticsDiffusionTransformer</span>')
    expect(html).toContain('class="source-reference-name">RDT-1B论文</span>')
    expect(html).toContain('data-href="https://github.com/thu-ml/RoboticsDiffusionTransformer"')
    expect(html).toContain('data-href="https://arxiv.org/abs/2410.07864"')
    expect(html).toContain('title="来源类型：GitHub')
    expect(html).toContain('来源名称：thu-ml/RoboticsDiffusionTransformer')
    expect(html).toContain('核实状态：已核实')
    expect(html).not.toContain('S1｜来源类型')
    expect(html).not.toContain('GitHub: thu-ml/RoboticsDiffusionTransformer</a>')
    expect(html).not.toContain('<div class="field-card-label">&lt;a href')
    expect(html).not.toContain('<div class="field-card-label">[GitHub')
  })

  it('does not keep the missing placeholder when an empty field is filled by following lines', () => {
    const html = renderAssistantMessageContent([
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
})
