#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const hljs = require('highlight.js/lib/core')
const javascript = require('highlight.js/lib/languages/javascript')
const typescript = require('highlight.js/lib/languages/typescript')
const python = require('highlight.js/lib/languages/python')
const xml = require('highlight.js/lib/languages/xml')
const cssLang = require('highlight.js/lib/languages/css')
const json = require('highlight.js/lib/languages/json')
const markdown = require('highlight.js/lib/languages/markdown')
const bash = require('highlight.js/lib/languages/bash')
const powershell = require('highlight.js/lib/languages/powershell')
const { marked } = require('marked')

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', cssLang)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('powershell', powershell)

const LANG_ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  html: 'xml',
  htm: 'xml',
  vue: 'xml',
  svg: 'xml',
  sh: 'bash',
  shell: 'bash',
  ps1: 'powershell',
  ps: 'powershell',
  plaintext: null,
  text: null,
  txt: null
}

let markedConfigured = false

const escapeHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#x27;')

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
  (_match, attrs, rawLabel) => {
    const hrefMatch = String(attrs || '').match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
    const href = decodeBasicHtmlEntities(hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || '').trim()
    if (!/^https?:\/\//i.test(href)) return ''

    const label = decodeBasicHtmlEntities(stripHtmlTags(rawLabel)).trim() || href
    const safeHref = href.replace(/>/g, '%3E')
    return `[${escapeMarkdownLinkLabel(label)}](<${safeHref}>)`
  }
)

const normalizeLang = (lang) => {
  if (!lang) return null
  const lower = String(lang).toLowerCase().trim()
  if (lower in LANG_ALIASES) return LANG_ALIASES[lower]
  return lower
}

const highlightCode = (code = '', lang = '') => {
  const normalized = normalizeLang(lang)
  if (normalized && hljs.getLanguage(normalized)) {
    try {
      return hljs.highlight(code, { language: normalized }).value
    } catch {
      return escapeHtml(code)
    }
  }
  if (normalized === null) return escapeHtml(code)
  try {
    return hljs.highlightAuto(code).value
  } catch {
    return escapeHtml(code)
  }
}

const renderCodeBlockWithLines = (code = '', lang = '') => {
  const displayLang = lang || 'plaintext'
  const highlighted = highlightCode(String(code || '').replace(/\n$/, ''), lang)
  return `<div class="hljs-code-wrapper" data-lang="${escapeHtml(displayLang)}">
    <div class="hljs-code-header">
      <span class="hljs-lang-label">${escapeHtml(displayLang)}</span>
    </div>
    <div class="hljs-code-body">
      <pre class="hljs"><code class="language-${escapeHtml(normalizeLang(lang) || displayLang)}">${highlighted}</code></pre>
    </div>
  </div>`
}

const ensureMarkedConfigured = () => {
  if (markedConfigured) return
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
    if (
      rows.length > 0 &&
      /^[-*]\s+/.test(line) &&
      (!rows[rows.length - 1].value || /^[-*]\s+/m.test(rows[rows.length - 1].value))
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
    return `<div class="field-card-row">
      ${label}
      <div class="field-card-value">${renderMarkdownFragment(row.value || '未查到')}</div>
    </div>`
  }).join('')

  return `<div class="field-card">${rowHtml}</div>`
}

const renderMarkdownFieldCards = (content = '') => {
  const cards = []
  const markdownBody = String(content || '').replace(/(?:^|\n):::\s*field-card\s*\n([\s\S]*?)(?:\n:::|$)/g, (_match, body) => {
    const token = `JEDI_MARKDOWN_FIELD_CARD_${cards.length}_TOKEN`
    cards.push({ token, html: renderFieldCard(body) })
    return `\n\n${token}\n\n`
  })
  return { markdown: markdownBody, cards }
}

const renderMarkdownContentHtml = (content = '') => {
  ensureMarkedConfigured()
  const { markdown: markdownBody, cards } = renderMarkdownFieldCards(normalizeSafeHtmlAnchors(content || ''))
  let html = marked.parse(markdownBody, { headerIds: false, mangle: false })
  cards.forEach(({ token, html: cardHtml }) => {
    html = html.split(`<p>${token}</p>`).join(cardHtml)
    html = html.split(token).join(cardHtml)
  })
  return html
}

const markdownPreviewCss = () => `
:root {
  --text-color: #202124;
  --text-color-muted: #6b7280;
  --bg-color: #ffffff;
  --bg-color-secondary: #f6f8fa;
  --bg-color-tertiary: #eef1f4;
  --border-color: #d8dee4;
  --primary-color: #0969da;
  --error-color: #c62828;
}

@page {
  size: A4;
  margin: 18mm 16mm;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  color: var(--text-color);
  background: var(--bg-color);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
}

.markdown-preview {
  padding: 16px 20px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-color);
  background: var(--bg-color);
}

.markdown-preview h1 { font-size: 1.6em; font-weight: 700; margin: 0.8em 0 0.4em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.3em; }
.markdown-preview h2 { font-size: 1.4em; font-weight: 700; margin: 0.8em 0 0.4em; border-bottom: 1px solid var(--border-color); padding-bottom: 0.2em; }
.markdown-preview h3 { font-size: 1.2em; font-weight: 600; margin: 0.6em 0 0.3em; }
.markdown-preview h4 { font-size: 1.1em; font-weight: 600; margin: 0.5em 0 0.2em; }
.markdown-preview h5 { font-size: 1em; font-weight: 600; margin: 0.4em 0 0.2em; }
.markdown-preview h6 { font-size: 0.95em; font-weight: 600; margin: 0.4em 0 0.2em; color: var(--text-color-muted); }
.markdown-preview p { margin: 0.5em 0; }
.markdown-preview blockquote { margin: 0.5em 0; padding: 4px 16px; border-left: 4px solid var(--primary-color); background: var(--bg-color-secondary); border-radius: 0 4px 4px 0; }
.markdown-preview ul,
.markdown-preview ol { margin: 0.5em 0; padding-left: 2em; }
.markdown-preview li { margin: 0.2em 0; }
.markdown-preview a { color: var(--primary-color); text-decoration: none; overflow-wrap: anywhere; }
.markdown-preview a:hover { text-decoration: underline; }
.markdown-preview hr { border: none; border-top: 1px solid var(--border-color); margin: 1em 0; }
.markdown-preview .field-card {
  width: 100%;
  margin: 10px 0 14px;
  border-top: 1px solid var(--border-color);
  font-size: 14px;
  break-inside: avoid;
}
.markdown-preview .field-card-row {
  display: grid;
  grid-template-columns: minmax(110px, 28%) minmax(0, 1fr);
  min-height: 38px;
  border-bottom: 1px solid var(--border-color);
}
.markdown-preview .field-card-label,
.markdown-preview .field-card-value {
  min-width: 0;
  padding: 8px 10px;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.markdown-preview .field-card-label {
  font-weight: 700;
  color: var(--text-color);
}
.markdown-preview .field-card-value {
  color: var(--text-color);
}
.markdown-preview table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 13px; break-inside: avoid; }
.markdown-preview th,
.markdown-preview td { border: 1px solid var(--border-color); padding: 6px 12px; text-align: left; vertical-align: top; }
.markdown-preview th { background: var(--bg-color-secondary); font-weight: 600; }
.markdown-preview tr:nth-child(even) { background: var(--bg-color-secondary); }
.markdown-preview img { max-width: 100%; border-radius: 4px; margin: 0.5em 0; }
.markdown-preview code:not(pre code) { background: var(--bg-color-tertiary); padding: 2px 6px; border-radius: 3px; font-family: "Consolas", "Monaco", monospace; font-size: 0.9em; }
.markdown-preview pre { margin: 0.5em 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.markdown-preview .hljs-code-wrapper { margin: 0.5em 0; font-size: 13px; border: 1px solid var(--border-color); border-radius: 4px; overflow: hidden; break-inside: avoid; }
.markdown-preview .hljs-code-header { padding: 4px 8px; color: var(--text-color-muted); background: var(--bg-color-secondary); border-bottom: 1px solid var(--border-color); font-size: 12px; }
.markdown-preview .hljs-code-body { background: #f6f8fa; }
.markdown-preview .hljs { margin: 0; padding: 10px 12px; background: transparent; }
.markdown-preview .markdown-error { color: var(--error-color); }
`

const renderMarkdownToPreviewHtml = (content = '', options = {}) => {
  const title = options.title || 'Markdown Preview'
  const baseHref = options.baseDir ? pathToFileURL(path.resolve(options.baseDir) + path.sep).href : ''
  const baseTag = baseHref ? `<base href="${escapeHtml(baseHref)}">` : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${baseTag}
  <title>${escapeHtml(title)}</title>
  <style>${markdownPreviewCss()}</style>
</head>
<body>
  <main class="markdown-preview">
${renderMarkdownContentHtml(content)}
  </main>
</body>
</html>`
}

const parseArgs = (argv = []) => {
  const args = { input: '', output: '', title: '' }
  const positional = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--input' || arg === '-i') {
      args.input = argv[++index] || ''
    } else if (arg === '--output' || arg === '-o') {
      args.output = argv[++index] || ''
    } else if (arg === '--title') {
      args.title = argv[++index] || ''
    } else if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (String(arg || '').startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`)
    } else {
      positional.push(arg)
    }
  }

  args.input = args.input || positional[0] || ''
  args.output = args.output || positional[1] || ''
  if (!args.output && args.input) {
    const parsed = path.parse(args.input)
    args.output = path.join(parsed.dir, `${parsed.name}.pdf`)
  }

  if (args.input) args.input = path.resolve(process.cwd(), args.input)
  if (args.output) args.output = path.resolve(process.cwd(), args.output)
  return args
}

const renderMarkdownToPdf = async ({ input, output, title = '' }) => {
  if (!input) throw new Error('Missing input markdown path')
  if (!output) throw new Error('Missing output PDF path')
  const markdownContent = fs.readFileSync(input, 'utf8')
  const html = renderMarkdownToPreviewHtml(markdownContent, {
    title: title || path.basename(input, path.extname(input)),
    baseDir: path.dirname(input)
  })

  fs.mkdirSync(path.dirname(output), { recursive: true })
  const { chromium } = require('playwright')
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 1280 } })
    await page.setContent(html, { waitUntil: 'networkidle' })
    await page.pdf({
      path: output,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    })
  } finally {
    await browser.close()
  }
  return output
}

const printHelp = () => {
  console.log([
    'Usage: node scripts/render-markdown-preview-pdf.js <input.md> [output.pdf]',
    '       node scripts/render-markdown-preview-pdf.js --input report.md --output report.pdf --title "Report"',
    '',
    'Exports Markdown through the same .markdown-preview layout used by Jedi preview.'
  ].join('\n'))
}

if (require.main === module) {
  ;(async () => {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) {
      printHelp()
      return
    }
    const output = await renderMarkdownToPdf(args)
    console.log(`PDF generated: ${output}`)
  })().catch(error => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = {
  markdownPreviewCss,
  parseArgs,
  renderMarkdownContentHtml,
  renderMarkdownToPdf,
  renderMarkdownToPreviewHtml
}
