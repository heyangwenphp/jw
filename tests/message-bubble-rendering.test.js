import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderMessageHtml } from '../src/renderer/utils/message-render-utils.js'

const readSource = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')

const getFirstClickableAnchor = (html) =>
  html.match(/<a class="clickable-link"[^>]*>/)?.[0] || ''

const getHandleLinkClickBody = (source) => {
  const handleStart = source.indexOf('const handleLinkClick = async')
  const handleEnd = source.indexOf('const formatTime')
  return source.slice(handleStart, handleEnd)
}

describe('message bubble rendering', () => {
  const messageBubbleSource = readSource('src/renderer/pages/main/components/agent/MessageBubble.vue')
  const streamingIndicatorSource = readSource('src/renderer/pages/main/components/agent/StreamingIndicator.vue')
  const markdownStyle = readSource('src/renderer/styles/markdown-preview.css')

  it('does not render an empty body for assistant thinking-only messages', () => {
    expect(messageBubbleSource).toContain('v-if="hasVisibleBubbleBody"')
    expect(messageBubbleSource).toContain('const hasVisibleBubbleBody = computed(() =>')
    expect(messageBubbleSource).toMatch(/renderedContent\.value\.trim\(\)\.length > 0/)
  })

  it('renders assistant thinking text instead of replacing it with a progress prompt', () => {
    expect(messageBubbleSource).toContain('const visibleThinkingText = computed(() =>')
    expect(messageBubbleSource).toContain('v-if="message.role === \'assistant\' && visibleThinkingText"')
    expect(messageBubbleSource).toContain('{{ visibleThinkingText }}')
  })

  it('keeps real assistant thinking visible when the assistant message also has body text', () => {
    expect(messageBubbleSource).toContain('v-if="message.role === \'assistant\' && visibleThinkingText"')
    expect(messageBubbleSource).not.toContain('visibleThinkingText && !hasVisibleBubbleBody')
  })

  it('keeps streaming thinking visible after answer text starts streaming', () => {
    expect(streamingIndicatorSource).toContain('v-if="visibleThinkingText"')
    expect(streamingIndicatorSource).not.toContain('visibleThinkingText && !visibleText')
  })

  it('keeps completed assistant thinking sections collapsed until expanded', () => {
    expect(messageBubbleSource).toContain('const isThinkingCollapsed = ref(true)')
    expect(messageBubbleSource).toContain('const toggleThinkingCollapse = () =>')
    expect(messageBubbleSource).toContain('@click="toggleThinkingCollapse"')
    expect(messageBubbleSource).toContain('v-show="!isThinkingCollapsed"')
    expect(messageBubbleSource).toContain('thinking-toggle-icon')
  })

  it('keeps streaming thinking expanded after answer text appears', () => {
    expect(streamingIndicatorSource).toContain('const isThinkingCollapsed = ref(false)')
    expect(streamingIndicatorSource).toContain('const toggleThinkingCollapse = () =>')
    expect(streamingIndicatorSource).toContain('@click="toggleThinkingCollapse"')
    expect(streamingIndicatorSource).toContain('v-show="!isThinkingCollapsed"')
    expect(streamingIndicatorSource).toContain('thinking-toggle-icon')
    expect(streamingIndicatorSource).toContain('watch(visibleText,')
    expect(streamingIndicatorSource).not.toContain('isThinkingCollapsed.value = true')
    expect(streamingIndicatorSource).not.toContain('const hasAutoCollapsedThinking')
  })

  it('removes leading line breaks before rendering bubble body content', () => {
    expect(renderMessageHtml('\nWhat does this report say?')).toBe('What does this report say?')
    expect(renderMessageHtml('\n\nWhat does this report say?')).toBe('What does this report say?')
  })

  it('repairs URLs split between protocol and slashes before rendering plain message content', () => {
    const html = renderMessageHtml('source:\nhttps\n//example.com/path?a=1')

    expect(html).toContain('data-href="https://example.com/path?a=1"')
    expect(html).not.toContain('https<br>//example.com')
  })

  it('links Windows PDF paths without swallowing following size notes', () => {
    const filePath = 'C:\\Users\\72361\\jedi-web-agent-output\\desktop\\conv-5f4c7fbc\\AI_report.pdf'
    const html = renderMessageHtml(`PDF generated at:\n\n${filePath} (about 279KB)`)

    expect(html).toContain(`data-href="${filePath}"`)
    expect(html).toContain(`>${filePath}</a>`)
    expect(html).toContain('(about 279KB)')
    expect(html).not.toContain(`${filePath} (about`)
  })

  it('renders PDF paths with adjacent preview and download actions', () => {
    const filePath = 'C:\\reports\\Alpha Radar.pdf'
    const html = renderMessageHtml(filePath)
    const pathAnchor = getFirstClickableAnchor(html)

    expect(html).toContain('data-file-kind="pdf"')
    expect(html).toContain(`>${filePath}</a>`)
    expect(pathAnchor).toContain('data-link-type="path"')
    expect(pathAnchor).toContain('data-file-kind="pdf"')
    expect(pathAnchor).not.toContain('data-link-action="download"')
    expect(html).toContain('data-link-action="download"')
    expect(html).toContain('data-link-action="preview"')
    expect(html).toContain('clickable-link-preview')
    expect(html).toContain('clickable-link-download')
  })

  it('keeps inline preview and download actions wide enough for Chinese labels', () => {
    const actionStyle = messageBubbleSource.match(/\.bubble-body :deep\(\.clickable-link-action\)\s*\{[\s\S]*?\n}/)?.[0] || ''

    expect(actionStyle).toContain('width: 50px;')
  })

  it('renders agent field-card rows without row borders', () => {
    const fieldCardRowStyle = markdownStyle.match(/\.jedi-markdown-preview \.field-card-row\s*\{[\s\S]*?\n}/)?.[0] || ''
    const fieldCardCellStyle = markdownStyle.match(/\.jedi-markdown-preview \.field-card-label,\s*\n\.jedi-markdown-preview \.field-card-value\s*\{[\s\S]*?\n}/)?.[0] || ''

    expect(messageBubbleSource).toContain('jedi-markdown-preview')
    expect(fieldCardRowStyle).toContain('display: grid;')
    expect(fieldCardRowStyle).toContain('min-height: 34px;')
    expect(fieldCardRowStyle).not.toContain('border-bottom')
    expect(fieldCardCellStyle).toContain('padding: 6px 10px;')
  })

  it('renders generated non-PDF document paths with download actions only', () => {
    const documentPaths = [
      ['C:\\reports\\memo.docx', 'word'],
      ['C:\\reports\\table.xlsx', 'spreadsheet'],
      ['C:\\reports\\deck.pptx', 'presentation'],
      ['C:\\reports\\daily.md', 'markdown'],
      ['C:\\reports\\rows.csv', 'spreadsheet'],
      ['C:\\reports\\page.html', 'html']
    ]

    for (const [filePath, fileKind] of documentPaths) {
      const html = renderMessageHtml(filePath)

      expect(html).toContain(`data-file-kind="${fileKind}"`)
      expect(html).toContain('data-link-action="download"')
      expect(html).toContain('clickable-link-download')
      expect(html).not.toContain('clickable-link-preview')

      const pathAnchor = getFirstClickableAnchor(html)
      expect(pathAnchor).toContain('data-link-type="path"')
      expect(pathAnchor).toContain(`data-file-kind="${fileKind}"`)
      expect(pathAnchor).not.toContain('data-link-action="download"')
    }
  })

  it('hides preview actions for generated non-PDF document paths', () => {
    const documentPaths = [
      ['C:\\reports\\memo.doc', 'word'],
      ['C:\\reports\\memo.docx', 'word'],
      ['C:\\reports\\table.xls', 'spreadsheet'],
      ['C:\\reports\\table.xlsx', 'spreadsheet'],
      ['C:\\reports\\deck.ppt', 'presentation'],
      ['C:\\reports\\deck.pptx', 'presentation'],
      ['C:\\reports\\daily.md', 'markdown'],
      ['C:\\reports\\notes.txt', 'text'],
      ['C:\\reports\\rows.csv', 'spreadsheet'],
      ['C:\\reports\\page.html', 'html']
    ]

    for (const [filePath, fileKind] of documentPaths) {
      const html = renderMessageHtml(filePath)

      expect(html).toContain(`data-file-kind="${fileKind}"`)
      expect(html).toContain('data-link-action="download"')
      expect(html).toContain('clickable-link-download')
      expect(html).not.toContain('clickable-link-preview')
    }
  })

  it('renders non-document file paths with download actions', () => {
    const html = renderMessageHtml('C:\\workspace\\src\\main.js')

    expect(html).toContain('class="clickable-link"')
    expect(html).toContain('data-file-kind="file"')
    expect(html).toContain('clickable-link-download')
    expect(html).not.toContain('clickable-link-preview')
  })

  it('normalizes safe HTML anchors in plain rendered message content', () => {
    const html = renderMessageHtml('<a href="https://news.qq.com/rain/a/20260130A04B6G00" target="_blank" rel="noopener noreferrer">详情链接</a>')

    expect(html).toContain('data-href="https://news.qq.com/rain/a/20260130A04B6G00"')
    expect(html).toContain('>详情链接</a>')
    expect(html).not.toContain('&lt;a href=')
    expect(html).not.toContain('target=&quot;_blank&quot;')
  })

  it('normalizes safe HTML anchors before streaming markdown is rendered', () => {
    expect(streamingIndicatorSource).toContain('normalizeSafeHtmlAnchors')
    expect(streamingIndicatorSource).toContain('renderMarkdownWithHighlight(normalizeSafeHtmlAnchors(markdown))')
  })

  it('wires message PDF links to download while keeping browser preview available', () => {
    expect(messageBubbleSource).toContain('downloadFileFromUrl')
    expect(messageBubbleSource).toContain('buildFileDownloadUrl')
    expect(messageBubbleSource).toContain("linkAction === 'preview'")
    expect(messageBubbleSource).toContain("linkAction === 'download'")
    expect(messageBubbleSource).toContain("'preview-path-link'")
    expect(messageBubbleSource).toContain("'download-path-link'")
  })

  it('routes ordinary PDF action clicks to browser preview or download instead of right-panel preview', () => {
    const handleLinkClickBody = getHandleLinkClickBody(messageBubbleSource)
    const ordinaryClickPathBranch = handleLinkClickBody.split('await window.electronAPI.openExternal(href)')[2] || ''

    expect(messageBubbleSource).toContain('buildWebRawFileUrl')
    expect(messageBubbleSource).toContain('openPathPreviewWindow')
    expect(ordinaryClickPathBranch).toContain("linkAction === 'download'")
    expect(ordinaryClickPathBranch).toContain('await downloadPath(resolvedPath)')
    expect(ordinaryClickPathBranch).toContain("linkAction === 'preview'")
    expect(ordinaryClickPathBranch).toContain('openPathPreviewWindow(resolvedPath, previewWindow)')
    expect(ordinaryClickPathBranch).toMatch(/if \(linkAction === 'download'\) \{[\s\S]*?await downloadPath\(resolvedPath\)[\s\S]*?return[\s\S]*?\}/)
    expect(ordinaryClickPathBranch).toMatch(/if \(linkAction === 'preview'\) \{[\s\S]*?openPathPreviewWindow\(resolvedPath, previewWindow\)[\s\S]*?return[\s\S]*?\}/)
  })

  it('keeps a pre-opened PDF preview window reachable instead of orphaning about:blank', () => {
    const openBlankStart = messageBubbleSource.indexOf('const openBlankPreviewWindow = () =>')
    const openBlankEnd = messageBubbleSource.indexOf('const buildPathPreviewUrl')
    const openBlankBody = messageBubbleSource.slice(openBlankStart, openBlankEnd)

    expect(openBlankBody).toContain("window.open('about:blank', '_blank')")
    expect(openBlankBody).toContain('previewWindow.opener = null')
    expect(openBlankBody).not.toContain("window.open('', '_blank', 'noopener,noreferrer')")
  })

  it('opens ordinary URL clicks externally instead of emitting right-panel previews', () => {
    const handleLinkClickBody = getHandleLinkClickBody(messageBubbleSource)

    expect(handleLinkClickBody.match(/await window\.electronAPI\.openExternal\(href\)/g)?.length).toBeGreaterThanOrEqual(2)
    expect(handleLinkClickBody).not.toContain("emit('preview-link'")
  })
})
