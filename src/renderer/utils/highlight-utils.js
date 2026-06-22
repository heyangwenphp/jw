import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import sql from 'highlight.js/lib/languages/sql'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import bash from 'highlight.js/lib/languages/bash'
import powershell from 'highlight.js/lib/languages/powershell'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import { marked } from 'marked'
import { isSourceReferenceLabel, isSourceReferenceLine, renderSourceReferenceIcons } from './source-reference-render-utils'
import { normalizeInlineReportFieldParagraphs } from './investment-report-format-utils'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', c)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('dockerfile', dockerfile)

const LANG_ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  html: 'xml',
  htm: 'xml',
  vue: 'xml',
  svg: 'xml',
  jsx: 'javascript',
  tsx: 'typescript',
  'c++': 'cpp',
  h: 'cpp',
  hpp: 'cpp',
  ps1: 'powershell',
  ps: 'powershell',
  docker: 'dockerfile',
  plaintext: null,
  text: null,
  txt: null
}

const escapeHtml = (str = '') => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

export const normalizeLang = (lang) => {
  if (!lang) return null
  const lower = lang.toLowerCase().trim()
  if (lower in LANG_ALIASES) return LANG_ALIASES[lower]
  return lower
}

export const highlightCode = (code, lang) => {
  const normalized = normalizeLang(lang)
  if (normalized && hljs.getLanguage(normalized)) {
    try {
      return hljs.highlight(code, { language: normalized }).value
    } catch {
      return escapeHtml(code)
    }
  }
  if (normalized === null) {
    return escapeHtml(code)
  }
  try {
    const result = hljs.highlightAuto(code)
    return result.value
  } catch {
    return escapeHtml(code)
  }
}

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1', 'cmd', 'bat'])

const isShellLang = (lang) => {
  if (!lang) return false
  const lower = lang.toLowerCase().trim()
  return SHELL_LANGS.has(lower) || SHELL_LANGS.has(LANG_ALIASES[lower])
}

export const renderCodeBlockWithLines = (code, lang) => {
  const normalized = normalizeLang(lang)
  const displayLang = lang || 'plaintext'
  const trimmed = code.replace(/\n$/, '')
  const highlighted = highlightCode(trimmed, lang)
  const lineCount = trimmed.split('\n').length
  const lineNumbers = Array.from({ length: lineCount }, (_, i) =>
    `<span class="hljs-line-num">${i + 1}</span>`
  ).join('')

  const escapedCode = escapeHtml(trimmed)
  const runBtn = isShellLang(lang)
    ? `<button class="hljs-action-btn hljs-run-btn" data-action="run" data-code="${escapedCode}" title="Run in terminal"><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5,3 17,10 5,17"/></svg></button>`
    : ''

  return `<div class="hljs-code-wrapper" data-lang="${escapeHtml(displayLang)}">
    <div class="hljs-code-header">
      <span class="hljs-lang-label">${escapeHtml(displayLang)}</span>
      <div class="hljs-code-actions">
        <button class="hljs-action-btn hljs-copy-btn" data-action="copy" data-code="${escapedCode}" title="Copy code"><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="11" height="11" rx="1"/><path d="M3 14V4a1 1 0 0 1 1-1h10"/></svg></button>
        ${runBtn}
      </div>
    </div>
    <div class="hljs-code-body">
      <div class="hljs-line-numbers">${lineNumbers}</div>
      <pre class="hljs"><code class="language-${escapeHtml(normalized || displayLang)}">${highlighted}</code></pre>
    </div>
  </div>`
}

let markedConfigured = false

const decodeBasicHtmlEntities = (value = '') => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#x27;/g, "'")
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')

const stripHtmlTags = (value = '') => String(value || '').replace(/<[^>]*>/g, '')

const escapeMarkdownLinkLabel = (value = '') => String(value || '').replace(/([\\[\]])/g, '\\$1')

const normalizeSafeHtmlAnchors = (text = '') => String(text || '').replace(
  /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
  (match, attrs, rawLabel) => {
    const hrefMatch = String(attrs || '').match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    const href = decodeBasicHtmlEntities(hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || '').trim()
    if (!/^https?:\/\//i.test(href)) return ''

    const label = decodeBasicHtmlEntities(stripHtmlTags(rawLabel)).trim() || href
    const safeHref = href.replace(/>/g, '%3E')
    return `[${escapeMarkdownLinkLabel(label)}](<${safeHref}>)`
  }
)

const ensureMarkedConfigured = () => {
  if (!markedConfigured) {
    marked.use({
      renderer: {
        code({ text, lang }) {
          return renderCodeBlockWithLines(text, lang)
        },
        html() {
          return ''
        }
      }
    })
    markedConfigured = true
  }
}

const renderMarkdownFragment = (value = '') => {
  ensureMarkedConfigured()
  const html = marked.parse(normalizeSafeHtmlAnchors(value || ''), { headerIds: false, mangle: false }).trim()
  const paragraphMatch = html.match(/^<p>([\s\S]*)<\/p>$/)
  return paragraphMatch ? paragraphMatch[1] : html
}

const renderFieldCard = (body = '') => {
  const rows = []
  const appendToLastRow = (line) => {
    if (rows.length === 0) {
      rows.push({ label: '', value: line })
      return
    }
    rows[rows.length - 1].value = [
      rows[rows.length - 1].value,
      line
    ].filter(Boolean).join('\n')
  }

  String(body || '').split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line) return

    const normalizedLine = line.replace(/^[-*]\s+/, '')
    const headingMatch = normalizedLine.match(/^【([^】]{1,80})】$/)
    if (headingMatch) {
      rows.push({
        label: headingMatch[1].trim(),
        value: ''
      })
      return
    }

    if (
      rows.length > 0 &&
      /^[-*]\s+/.test(line) &&
      (!rows[rows.length - 1].value || /^[-*]\s+/m.test(rows[rows.length - 1].value))
    ) {
      appendToLastRow(line)
      return
    }

    if (
      rows.length > 0 &&
      isSourceReferenceLabel(rows[rows.length - 1].label) &&
      isSourceReferenceLine(normalizedLine)
    ) {
      appendToLastRow(line)
      return
    }

    const isLinkLine = /^<a\b/i.test(normalizedLine) ||
      /^\[[^\]]+\]\(/.test(normalizedLine) ||
      /^https?:\/\//i.test(normalizedLine)
    const match = isLinkLine ? null : normalizedLine.match(/^([^:：]{1,80})[:：]\s*(.*)$/)
    if (match) {
      rows.push({
        label: match[1].trim(),
        value: match[2].trim()
      })
      return
    }

    appendToLastRow(line)
  })

  if (rows.length === 0) return ''

  const rowHtml = rows.map((row) => {
    const label = row.label
      ? `<div class="field-card-label">${escapeHtml(row.label)}</div>`
      : ''
    const sourceReferenceHtml = isSourceReferenceLabel(row.label)
      ? renderSourceReferenceIcons(row.value)
      : ''
    return `<div class="field-card-row">
      ${label}
      <div class="field-card-value">${sourceReferenceHtml || renderMarkdownFragment(row.value || '未查到')}</div>
    </div>`
  }).join('')

  return `<div class="field-card">${rowHtml}</div>`
}

const renderMarkdownFieldCards = (content = '') => {
  const cards = []
  const markdown = String(content || '').replace(/(?:^|\n):::\s*field-card\s*\n([\s\S]*?)(?:\n:::|$)/g, (_match, body) => {
    const token = `JEDI_MARKDOWN_FIELD_CARD_${cards.length}_TOKEN`
    cards.push({
      token,
      html: renderFieldCard(body)
    })
    return `\n\n${token}\n\n`
  })

  return { markdown, cards }
}

const renderPlainSourceReferenceBlocks = (content = '') => {
  const lines = String(content || '').split(/\r?\n/)
  const refs = []
  const output = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^(\s*(?:\d+\.\s*)?信息来源[:：]\s*)([\s\S]*)$/)
    if (!match) {
      output.push(line)
      continue
    }

    const sourceLines = []
    const inlineValue = match[2].trim()
    if (isSourceReferenceLine(inlineValue)) {
      sourceLines.push(inlineValue)
    } else if (inlineValue && !/^无|未查到|待验证|未提供/.test(inlineValue)) {
      output.push(line)
      continue
    }

    let cursor = index + 1
    while (cursor < lines.length && isSourceReferenceLine(lines[cursor].trim())) {
      sourceLines.push(lines[cursor].trim())
      cursor += 1
    }

    if (sourceLines.length === 0) {
      output.push(line)
      continue
    }

    const token = `JEDI_SOURCE_REFERENCES_${refs.length}_TOKEN`
    refs.push({
      token,
      html: renderSourceReferenceIcons(sourceLines.join('\n'))
    })
    output.push(`${match[1]}${token}`)
    index = cursor - 1
  }

  return {
    markdown: output.join('\n'),
    refs
  }
}

const INVESTMENT_REPORT_SECTION_PATTERN = /(?:投资意图拆解|项目线索|Alpha Signal|行动建议|缺失信息与风险|来源依据)/

const normalizePlainInvestmentReportMarkdown = (content = '') => {
  const text = String(content || '')
  if (!INVESTMENT_REPORT_SECTION_PATTERN.test(text)) return text

  const lines = text.split(/\r?\n/)
  const firstTextIndex = lines.findIndex(line => line.trim())
  const secondTextIndex = lines.findIndex((line, index) => index > firstTextIndex && line.trim())
  const shouldPromoteTitle = firstTextIndex >= 0 &&
    secondTextIndex >= 0 &&
    !/^#{1,6}\s+/.test(lines[firstTextIndex].trim()) &&
    !/^:::\s*\w*/.test(lines[firstTextIndex].trim()) &&
    (/^生成日期[：:]/.test(lines[secondTextIndex].trim()) || INVESTMENT_REPORT_SECTION_PATTERN.test(lines[secondTextIndex]))

  return lines.map((line, index) => {
    const trimmed = line.trim()
    if (shouldPromoteTitle && index === firstTextIndex) {
      return `# ${trimmed}`
    }

    if (/^#{1,6}\s+/.test(trimmed)) return line
    if (!/^\S/.test(line)) return line

    const sectionMatch = trimmed.match(/^((?:§\s*)?\d+[\.\、]\s*(?:投资意图拆解|项目线索|Alpha Signal\s*分析?|行动建议(?:与工作流队列)?|缺失信息与风险))$/)
    if (sectionMatch) {
      return `### ${sectionMatch[1]}`
    }

    return line
  }).join('\n')
}

const PROJECT_LEADS_DETAIL_SECTION_PATTERN = /项目线索介绍|项目明细|项目详情/
const PROJECT_LEAD_TITLE_PATTERN = /^\d+\.\s+\S[\s\S]{0,120}$/

const addClassToHtmlTag = (tag = '', className = '') => {
  if (/\sclass=/.test(tag)) {
    return tag.replace(/\sclass=(["'])(.*?)\1/, (match, quote, classes) => (
      classes.split(/\s+/).includes(className)
        ? match
        : ` class=${quote}${classes} ${className}${quote}`
    ))
  }
  return tag.replace(/>$/, ` class="${className}">`)
}

const enhanceInvestmentLeadProjectTitleHeadings = (html = '') => {
  let isInProjectLeadsDetailSection = false
  return String(html || '').replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (match, level, attrs, body) => {
    const headingText = decodeBasicHtmlEntities(stripHtmlTags(body)).trim()
    const headingLevel = Number(level)
    if (headingLevel <= 2) {
      isInProjectLeadsDetailSection = PROJECT_LEADS_DETAIL_SECTION_PATTERN.test(headingText)
      return match
    }

    if (
      isInProjectLeadsDetailSection &&
      headingLevel === 3 &&
      PROJECT_LEAD_TITLE_PATTERN.test(headingText)
    ) {
      return `${addClassToHtmlTag(`<h${level}${attrs}>`, 'project-lead-title')}${body}</h${level}>`
    }

    return match
  })
}

const INVESTMENT_LEADS_SUMMARY_HEADERS = ['序号', '项目名称', '主体类型', '核心赛道', '融资阶段', '核心亮点']

const enhanceInvestmentLeadsSummaryTables = (html = '') => String(html || '').replace(
  /<table>([\s\S]*?)<\/table>/g,
  (match, body) => {
    const headerCells = Array.from(String(body || '').matchAll(/<th(?:\s[^>]*)?>([\s\S]*?)<\/th>/g))
      .map(cell => decodeBasicHtmlEntities(stripHtmlTags(cell[1])).trim())

    const isInvestmentLeadsSummary = INVESTMENT_LEADS_SUMMARY_HEADERS.every((header, index) => headerCells[index] === header)
    if (!isInvestmentLeadsSummary) return match

    return `<table class="investment-leads-summary-table">${body}</table>`
  }
)

export const renderMarkdownWithHighlight = (content) => {
  ensureMarkedConfigured()
  const normalizedContent = normalizeInlineReportFieldParagraphs(
    normalizePlainInvestmentReportMarkdown(normalizeSafeHtmlAnchors(content || ''))
  )
  const { markdown: fieldCardMarkdown, cards } = renderMarkdownFieldCards(normalizedContent)
  const { markdown, refs } = renderPlainSourceReferenceBlocks(fieldCardMarkdown)
  let html = marked.parse(markdown, { headerIds: false, mangle: false })
  cards.forEach(({ token, html: cardHtml }) => {
    html = html.split(`<p>${token}</p>`).join(cardHtml)
    html = html.split(token).join(cardHtml)
  })
  refs.forEach(({ token, html: refHtml }) => {
    html = html.split(`<p>${token}</p>`).join(refHtml)
    html = html.split(token).join(refHtml)
  })
  return enhanceInvestmentLeadsSummaryTables(enhanceInvestmentLeadProjectTitleHeadings(html))
}
