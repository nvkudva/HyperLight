// Lightweight Markdown subset renderer (headings, lists, tables, code, inline).

export function looksLikeHtml(s: string): boolean {
  return /<(p|div|table|ul|ol|li|h[1-6]|img|a|pre|blockquote|strong|em|code)(\s[^>]*)?>/i.test(s)
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderInline(s: string): string {
  let out = escapeHtml(s)
  out = out.replace(/`([^`]+?)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/~~([^~]+?)~~/g, '<s>$1</s>')
  out = out.replace(/(^|[^*\w])\*([^*\n]+?)\*/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^\w])_([^_\n]+?)_/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]]+?)\]\((https?:[^)\s]+|mailto:[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>')
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>')
  return out
}

export function markdownToHtml(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let inFence = false
  let fenceBuf: string[] = []
  let listTag = ''
  const closeList = () => {
    if (listTag) {
      html.push(`</${listTag}>`)
      listTag = ''
    }
  }
  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line.trim())) {
      if (inFence) {
        html.push(`<pre><code>${escapeHtml(fenceBuf.join('\n'))}</code></pre>`)
        fenceBuf = []
        inFence = false
      } else {
        closeList()
        inFence = true
      }
      i += 1
      continue
    }
    if (inFence) {
      fenceBuf.push(line)
      i += 1
      continue
    }
    const trimmed = line.trim()
    if (!trimmed) {
      closeList()
      i += 1
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      i += 1
      continue
    }
    if (/^&gt;|^>/.test(trimmed)) {
      closeList()
      const quotes: string[] = []
      while (i < lines.length && /^>/.test(lines[i].trim())) {
        quotes.push(lines[i].trim().replace(/^>\s?/, ''))
        i += 1
      }
      html.push(`<blockquote>${quotes.map((q) => renderInline(q)).join('<br />')}</blockquote>`)
      continue
    }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?[\s:|-]*$/.test(lines[i + 1]) && isTableRow(lines[i + 1])) {
      closeList()
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const head = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]))
        i += 1
      }
      html.push(
        `<table><thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      )
      continue
    }
    const ul = /^[-*•]\s+(.*)$/.exec(trimmed)
    const ol = /^\d+[.)]\s+(.*)$/.exec(trimmed)
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol'
      if (listTag !== tag) {
        closeList()
        html.push(`<${tag}>`)
        listTag = tag
      }
      html.push(`<li>${renderInline((ul ?? ol)![1])}</li>`)
      i += 1
      continue
    }
    closeList()
    html.push(`<p>${renderInline(trimmed)}</p>`)
    i += 1
  }
  closeList()
  if (inFence) html.push(`<pre><code>${escapeHtml(fenceBuf.join('\n'))}</code></pre>`)
  return html.join('')
}

