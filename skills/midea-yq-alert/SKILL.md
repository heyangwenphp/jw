---
name: midea-yq-alert
description: 美的集团国内全网舆情监测预警报送判定与客户报送格式生成。Use when the user asks Codex to process any Midea/美的相关舆情数据 from monitoring systems, web media, social platforms, short video platforms, forums, complaint channels, search/news feeds, user comments, repost chains, AI初筛数据、预警候选池、已报送台账或客户报送案例；判断是否报送或不报送、识别重复/传播链、判定危机等级和高敏、按客户标签池生成推送标题、摘要、AI总结、AI研判。适用于全网平台中触发美的品牌的负面、敏感、不利对比、投诉、监管、资本市场、高管、C端、B端、子品牌等风险点的舆情；同时支持小红书/黑猫/消费保/12315等高发平台的字段清洗和案例库维护。
version: "1.0.0"
---

# 美的舆情预警报送判定

本 Skill 是美的品牌监测预警服务的智能判定层：把监测系统召回的信息，转换成客户可直接阅读和报送的结论、标签、摘要、AI总结和AI研判。

## 触发说明

Codex 的 skill 触发主要依赖 YAML frontmatter 中的 `description` 字段；不要另写 `trigger:` 字段。用户只要提出以下任一任务，都应使用本 Skill：

- 处理一条或多条来自全网任意平台的美的相关舆情，判断报送/不报送。
- 把美的AI监测系统数据整理成客户报送格式。
- 生成或校正美的舆情推送标题、标签、摘要、AI总结、AI研判。
- 判断C端、集团/高管、二级市场、B端、子品牌等风险场景的打标；平台不限，只要负面、敏感或不利落点指向美的，就进入判定。
- 对小红书、12315、黑猫、消费保等高发平台执行额外字段清洗，但这些平台不是监测范围上限。
- 将客户已报送案例整理进案例库，并用于后续口径校准。

## 核心原则

- 以语义判断为准，不以单个关键词、系统情感、AI预标签或平台来源直接定报送结论。
- 每条结论必须形成完整链路：`主体是谁 -> 事件是什么 -> 负面/敏感落点在哪里 -> 对美的客户有什么风险`。
- 输出统一使用客户报送格式，不沿用系统填表标签、旧标签或临时自造标签。
- `news_content` 是主体确认、风险落点、反误报、反漏报、摘要重写和去重签名的关键字段；正文缺失时必须标记不确定性。
- 不确定、不完整、互相矛盾或无法写出可解释理由时，输出 `需人工复核`。

## Required Workflow

1. **读取输入字段**：标题、摘要、`news_content`、链接、发布时间、发布平台、发布人、发布人ID、IP属地、互动数据、系统预标签、已报送台账。
2. **确认主体相关性**：判断内容是否明确指向美的集团、美的体系品牌/产品/服务/业务/高管/关联公司。主体范围见 [business-map.md](references/business-map.md)，产品业务线归属优先查 [product-category-map.md](references/product-category-map.md)。
3. **识别场景类型**：在高管/集团、二级市场、C端产品、中国区域服务、B端业务、子品牌、平台投诉、普通误召回之间分流。
4. **去重和传播链判断**：优先用投诉编号、平台内容ID、规范化链接、内容签名和传播链判断是否重复。规则见 [platform-cleaning.md](references/platform-cleaning.md)。
5. **判定报送状态**：输出 `报送`、`不报送`、`暂不重复报送` 或 `需人工复核`。报送/不报送边界见 [decision-rules.md](references/decision-rules.md)。
6. **判定等级和高敏**：按就高原则判定 `异常事件`、`危机`、`重大危机`，并独立判断是否加 `【高敏❗】`。规则见 [decision-rules.md](references/decision-rules.md)。
7. **生成客户标签**：按场景读取对应打标分册：
   - 高管、集团、二级市场：见 [corporate-and-executive.md](references/corporate-and-executive.md)
   - C端产品、中国区域服务、子品牌：见 [consumer-and-subbrand.md](references/consumer-and-subbrand.md)
   - B端业务：见 [b2b-business.md](references/b2b-business.md)
   - 统一标签格式和标签池：见 [label-format.md](references/label-format.md)
8. **清洗发布字段**：按平台清洗发布ID、链接、IP属地、投诉编号和摘要噪声。规则见 [platform-cleaning.md](references/platform-cleaning.md)。
9. **重写摘要、AI总结、AI研判**：摘要尽量50字左右，最长100字；AI总结忠实事实；AI研判站在美的客户视角。写法见 [writing-rules.md](references/writing-rules.md)。
10. **按模板输出并质检**：使用 [output-template.md](references/output-template.md)，再执行本文件的最终质检清单。

## Reference Coverage

原长版规则已拆入分册，主文件只保留执行路径：

- 报送输出格式、四段/五段、高敏前缀、标签池：见 [label-format.md](references/label-format.md)。
- 报送/不报送、反误报、反漏报、去重、等级、高敏：见 [decision-rules.md](references/decision-rules.md)。
- 集团、高管、二级市场：见 [corporate-and-executive.md](references/corporate-and-executive.md)。
- C端产品、中国区域服务、子品牌：见 [consumer-and-subbrand.md](references/consumer-and-subbrand.md)。
- B端业务、安得智联、美云智数等：见 [b2b-business.md](references/b2b-business.md)。
- 主体范围、排除主体、事业部和高管人物库：见 [business-map.md](references/business-map.md)。
- 产品类别、业务线和二级标签核准：见 [product-category-map.md](references/product-category-map.md)。
- 小红书、黑猫、消费保、12315、发布ID、IP属地、链接和去重键：见 [platform-cleaning.md](references/platform-cleaning.md)。
- 摘要、AI总结、AI研判写法：见 [writing-rules.md](references/writing-rules.md)。
- 输出模板和案例库维护：见 [output-template.md](references/output-template.md) 与 [examples-index.md](references/examples-index.md)。

## Scenario Routing

优先级从高到低：

1. 涉及何享健、方洪波、王建国、顾炎民、管金伟等创始人/高管的任免、离职、薪酬、减持、名誉、争议、诉讼、监管、战略连续性等，读取 [corporate-and-executive.md](references/corporate-and-executive.md)。
2. 涉及集团经营、财报、资本运作、投资并购、监管、诉讼、组织治理、集团品牌整体声誉，读取 [corporate-and-executive.md](references/corporate-and-executive.md)。
3. 涉及股价、证券社区、投资者讨论、机构观点、科陆/万东/能源等资本市场内容，先按二级市场规则分流，读取 [corporate-and-executive.md](references/corporate-and-executive.md)。
4. 涉及家用空调、冰箱、洗衣机、小家电、厨热、微烤等C端产品，读取 [consumer-and-subbrand.md](references/consumer-and-subbrand.md)。
5. 涉及客服、售后、安装、门店、价保、补贴、官方渠道、整体服务体系且无法归入具体产品线，读取 [consumer-and-subbrand.md](references/consumer-and-subbrand.md)。
6. 涉及COLMO、小天鹅、华凌、东芝白电/厨热/微烤、WAHIN、Coolfree、酷风、比佛利等美的体系子品牌，读取 [consumer-and-subbrand.md](references/consumer-and-subbrand.md)；东芝电视默认排除。
7. 涉及工业技术、楼宇科技、机器人与自动化、安得智联、美云智数、万东医疗、锐珂医疗、科陆/合康/美的能源、美智光电等B端或其他业务，读取 [b2b-business.md](references/b2b-business.md)。
8. 涉及小红书、黑猫、消费保、12315、微博、抖音、今日头条等平台字段清洗，读取 [platform-cleaning.md](references/platform-cleaning.md)。
9. 需要参考成品案例时，按场景读取 [examples-index.md](references/examples-index.md)。

## Output Contract

每次处理必须输出以下四类之一：

- `结论：报送`
- `结论：不报送`
- `结论：暂不重复报送`
- `结论：需人工复核`

报送时必须包含：

- 推送标题
- 发布时间
- 发布平台
- 发布人
- 发布ID
- IP属地
- 链接
- 摘要
- 传播情况
- `【AI总结】`
- `【AI研判】`

不报送、重复和人工复核也必须写明可解释原因。

## Final QA Checklist

输出前逐项检查：

1. 结论是否为四类之一。
2. 报送理由是否能说清 `主体-事件-负面落点-客户风险`。
3. 推送标题是否完全来自客户标签池或固定映射，未自造标签。
4. 高敏前缀是否精确为 `【高敏❗】`，没有写成 `【高敏】`、`【高敏!】`、`【高敏 ❗】` 或 `【高敏❗️】`。
5. 非高管集团层面是否使用四段式；高管和其他常规场景是否使用五段式。
6. 发布平台是否与当前链接/采集页面一致，没有被正文中的投诉来源覆盖。
7. 发布ID是否只保留账号ID、投诉编号或登记编号本体，没有混入平台名、链接、字段名、昵称或括号说明。
8. IP属地缺失时是否写 `IP属地：无`，且没有猜测为中国。
9. 摘要是否尽量50字左右、最长100字，且不重复平台、作者、发布时间、发布ID等元数据。
10. AI总结是否忠实原文，没有补充不存在的诉求、监管、回应、结果或处理动作。
11. AI研判是否站在美的客户视角，没有出现 `建议报送`、`建议推送`、`推送` 等内部流程话术。
12. 若正文缺失、主体不明、标签池不匹配或证据冲突，是否输出 `需人工复核`。
