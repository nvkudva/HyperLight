// Allowlist HTML sanitizer for assistant answers and metadata snippets.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'hr',
])

export function sanitizeHtml(dirty: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = dirty
  const walk = (node: Node) => {
    const els = Array.from(node.childNodes)
    for (const child of els) {
      if (child.nodeType === Node.COMMENT_NODE) {
        node.removeChild(child)
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) {
        const frag = document.createDocumentFragment()
        while (el.firstChild) frag.appendChild(el.firstChild)
        node.replaceChild(frag, el)
        walk(frag)
        continue
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on') || name === 'style') {
          el.removeAttribute(attr.name)
          continue
        }
        if ((tag === 'a' || tag === 'img') && (name === 'href' || name === 'src')) {
          const v = attr.value.trim()
          if (/^\s*javascript:/i.test(v)) el.removeAttribute(attr.name)
          continue
        }
        if (!['href', 'src', 'alt', 'title', 'colspan', 'rowspan'].includes(name)) {
          el.removeAttribute(attr.name)
        }
      }
      if (tag === 'a') {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      }
      walk(el)
    }
  }
  walk(tpl.content)
  return tpl.innerHTML
}

