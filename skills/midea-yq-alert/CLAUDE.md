# Claude Code Entry

This project is the Claude Code wrapper for the Midea public-opinion alert skill.

## Non-Negotiable Source Of Truth

- Do not rewrite, simplify, or reinterpret the business rules from memory.
- Treat `SKILL.md` and the files under `references/` as the authoritative skill content.
- This `CLAUDE.md` is only a Claude Code runtime adapter. It does not change the original skill logic.
- If the user asks to update rules, edit the relevant skill/reference files directly and preserve the existing structure.

## When To Use This Project

Use this skill whenever the user asks you to process Midea/美的 related monitoring data, customer reporting examples, public-opinion alerts, platform fields, label classification, report/no-report decisions, crisis level, high-sensitive prefix,摘要, AI总结, or AI研判.

Typical inputs include:

- A single舆情 item pasted in chat.
- Monitoring-system fields such as title, summary, `news_content`, link, platform, author, author ID, IP, interactions, system tags, or reported-history records.
- Customer case documents or historical report examples.
- Questions about C端、子品牌、中国区域服务、B端、集团、高管、二级市场, platform cleaning, or tag boundaries.

## Required Reading Flow

1. Read `SKILL.md` first.
2. Route the case by scenario.
3. Read only the necessary reference files:
   - Labels and title format: `references/label-format.md`
   - Report/no-report, duplicate, level, high-sensitive: `references/decision-rules.md`
   - Group, executives, secondary market: `references/corporate-and-executive.md`
   - C端, 中国区域服务, 子品牌: `references/consumer-and-subbrand.md`
   - B端: `references/b2b-business.md`
   - Subject scope and exclusions: `references/business-map.md`
   - Product/business-line mapping: `references/product-category-map.md`
   - Platform fields and dedupe: `references/platform-cleaning.md`
   - Summary and writing style: `references/writing-rules.md`
   - Output template and case-library rules: `references/output-template.md`, `references/examples-index.md`
4. Use examples only when the user asks for cases or when a boundary needs historical customer style. If an example conflicts with the current rule files, current rules win.

## Claude Code Operating Notes

- Prefer `rg` to locate a rule or keyword before opening large example files.
- Do not load all case libraries at once. They are large and should be searched first.
- Keep answers in Chinese unless the user asks otherwise.
- When judging a pasted item, produce the final customer-facing answer directly, not an internal plan.
- When uncertain because fields are missing or evidence conflicts, output `结论：需人工复核` and explain the missing evidence.
- Never invent labels outside the current tag pool. Put unmatched detail into摘要、AI总结或AI研判.
- Preserve exact customer punctuation for fixed labels, especially `【高敏❗】`.

## Output Contract

For a reportable item, include:

- `结论：报送`
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

For non-report, duplicate, or uncertain items, output one of:

- `结论：不报送`
- `结论：暂不重复报送`
- `结论：需人工复核`

Always include the reason in a concise, customer-understandable way.
