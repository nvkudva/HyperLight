import React, { useEffect, useRef, useState } from 'react'
import type { ChatMessage, SearchResult } from '../../types'
import { SearchIcon } from '../common/Icons'
import { ChatInput } from './ChatInput'
import { KIND_LABELS, KIND_TINT, groupResults, initials, renderTile } from './kinds'
import type { ResultKind } from './kinds'
import styles from './ChatWorkspace.module.css'

interface ChatWorkspaceProps {
  messages: ChatMessage[]
  isLoading: boolean
  onSendMessage: (text: string) => void
  onOpenPhoto: (path: string, filename: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
  onRevealTarget: (path: string) => void
  onLaunchTarget: (path: string) => void
  onOpenResult: (item: SearchResult) => void
}

const DOC_PREVIEW = /\.(pdf|docx?|pptx?|xlsx?|key|pages|numbers|rtf|txt|md|csv)$/i

function looksLikeHtml(s: string): boolean {
  return /<(p|div|table|ul|ol|li|h[1-6]|img|a|pre|blockquote|strong|em|code)(\s[^>]*)?>/i.test(s)
}

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'hr',
])

function sanitizeHtml(dirty: string): string {
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderInline(s: string): string {
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

function markdownToHtml(src: string): string {
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

const AnswerBody: React.FC<{ text: string }> = ({ text }) => {
  const html = React.useMemo(() => {
    const raw = looksLikeHtml(text) ? sanitizeHtml(text) : markdownToHtml(text)
    return { __html: raw }
  }, [text])
  return <div className={styles.richText} dangerouslySetInnerHTML={html} />
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  messages,
  isLoading,
  onSendMessage,
  onOpenPhoto,
  onContextMenu,
  onRevealTarget,
  onLaunchTarget,
  onOpenResult,
}) => {
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set())
  const messagesRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const prevLenRef = useRef(0)
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    if (messages.length !== prevLenRef.current) {
      prevLenRef.current = messages.length
      stickRef.current = true
    }
    if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, isLoading])

  const handleScroll = () => {
    const el = messagesRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const renderGroup = (kind: ResultKind, items: SearchResult[]) => {
    switch (kind) {
      case 'photo':
        return (
          <div className={styles.photoGrid}>
            {items.map((p, idx) => (
              <div
                key={p.path || idx}
                className={styles.photoCard}
                onClick={() => onOpenPhoto(p.path, p.filename)}
                onContextMenu={(e) => onContextMenu(e, p.path, p.filename)}
              >
                <img
                  src={`/api/thumbnail?path=${encodeURIComponent(p.path)}`}
                  alt={p.filename}
                  className={styles.photoImg}
                  loading="lazy"
                />
                <div className={styles.photoOverlay}>
                  <span className={styles.photoFilename}>{p.filename}</span>
                </div>
              </div>
            ))}
          </div>
        )
      case 'video':
        return (
          <div className={styles.videoGrid}>
            {items.map((v, idx) => (
              <div
                key={v.path || idx}
                className={styles.videoTile}
                onClick={() => onOpenResult(v)}
                onContextMenu={(e) => onContextMenu(e, v.path, v.filename)}
              >
                <span className={styles.videoPosterWrap}>
                  <img
                    src={`/api/preview?path=${encodeURIComponent(v.path)}`}
                    alt={v.filename}
                    className={styles.videoPoster}
                    loading="lazy"
                  />
                  <span className={styles.playBadge} aria-hidden="true" />
                </span>
                <span className={styles.videoName}>{v.filename}</span>
              </div>
            ))}
          </div>
        )
      case 'audio':
        return (
          <div className={styles.audioList}>
            {items.map((a, idx) => (
              <div
                key={a.path || idx}
                className={styles.audioRow}
                onContextMenu={(e) => onContextMenu(e, a.path, a.filename)}
              >
                {renderTile('audio')}
                <span className={styles.audioName} title={a.filename}>
                  {a.filename}
                </span>
                <audio
                  className={styles.audioPlayer}
                  src={`/api/media?path=${encodeURIComponent(a.path)}`}
                  controls
                  preload="none"
                />
              </div>
            ))}
          </div>
        )
      case 'app':
        return (
          <div className={styles.sourcesList}>
            {items.map((s, idx) => (
              <div
                key={s.path || idx}
                className={styles.entityCard}
                onClick={() => onLaunchTarget(s.path)}
                onContextMenu={(e) => onContextMenu(e, s.path, s.filename)}
              >
                <div className={styles.entityLeft}>
                  {renderTile('app')}
                  <div>
                    <div className={styles.entityTitle}>{s.filename}</div>
                    <div className={styles.entitySub}>{s.excerpt || 'Application'}</div>
                  </div>
                </div>
                <span className={styles.openAction}>Open</span>
              </div>
            ))}
          </div>
        )
      case 'contact':
        return (
          <div className={styles.sourcesList}>
            {items.map((s, idx) => (
              <div
                key={s.path || idx}
                className={styles.entityCard}
                onClick={() => onRevealTarget(s.path)}
                onContextMenu={(e) => onContextMenu(e, s.path, s.filename)}
              >
                <div className={styles.entityLeft}>
                  <span className={`${styles.contactAvatar} ${styles[KIND_TINT.contact]}`} aria-hidden="true">
                    {initials(s.filename)}
                  </span>
                  <div>
                    <div className={styles.entityTitle}>{s.filename.replace(/\.vcf$/i, '')}</div>
                    <div className={styles.entitySub}>{s.excerpt || s.path}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      case 'document': {
        const withPreview = items.filter((s) => DOC_PREVIEW.test(s.path ?? '') && !failedPreviews.has(s.path))
        const withoutPreview = items.filter((s) => !DOC_PREVIEW.test(s.path ?? '') || failedPreviews.has(s.path))
        return (
          <>
            {withPreview.length > 0 && (
              <div className={styles.docGrid}>
                {withPreview.map((s, idx) => (
                  <div
                    key={s.path || idx}
                    className={styles.docCard}
                    onClick={() => onOpenResult(s)}
                    onContextMenu={(e) => onContextMenu(e, s.path, s.filename)}
                  >
                    <span className={styles.docThumbWrap}>
                      <img
                        src={`/api/preview?path=${encodeURIComponent(s.path)}`}
                        alt={`Preview of ${s.filename}`}
                        className={styles.docThumb}
                        loading="lazy"
                        onError={() => setFailedPreviews((prev) => new Set(prev).add(s.path))}
                      />
                      <span className={styles.docExt}>{(s.filename.split('.').pop() ?? '').toUpperCase().slice(0, 4)}</span>
                    </span>
                    <span className={styles.docBody}>
                      <span className={styles.docName} title={s.filename}>
                        {s.filename}
                      </span>
                      {s.excerpt && (
                        <span className={styles.docExcerpt} title={s.excerpt}>
                          {s.excerpt}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {withoutPreview.length > 0 && (
              <div className={styles.sourcesList}>
                {withoutPreview.map((s, idx) => (
                  <div
                    key={s.path || idx}
                    className={styles.entityCard}
                    onClick={() => onOpenResult(s)}
                    onContextMenu={(e) => onContextMenu(e, s.path, s.filename)}
                  >
                    <div className={styles.entityLeft}>
                      {renderTile(kind)}
                      <div>
                        <div className={styles.entityTitle}>{s.filename}</div>
                        <div className={styles.entitySub}>{s.excerpt || s.path}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )
      }
      default:
        return (
          <div className={styles.sourcesList}>
            {items.map((s, idx) => (
              <div
                key={s.path || idx}
                className={styles.entityCard}
                onClick={() => onRevealTarget(s.path)}
                onContextMenu={(e) => onContextMenu(e, s.path, s.filename)}
              >
                <div className={styles.entityLeft}>
                  {renderTile(kind)}
                  <div>
                    <div className={styles.entityTitle}>{s.filename}</div>
                    <div className={styles.entitySub}>{s.excerpt || s.path}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
    }
  }

  return (
    <main className={styles.workspace}>
      <div ref={messagesRef} onScroll={handleScroll} className={`${styles.messagesArea} custom-scroll`}>
        {messages.length === 0 ? (
          <div className={styles.welcomeContainer}>
            <div className={styles.welcomeBadge}>
              <SearchIcon className="w-6 h-6" />
            </div>
            <h2 className={styles.welcomeTitle}>Search Everything on Your Mac</h2>
            <p className={styles.welcomeSubtitle}>
              Ask questions about documents, find photos with natural queries, or look up apps & contacts with Apple Silicon local AI.
            </p>
            <div className={styles.promptPillsRow}>
              {[
                'Find photos taken in the evening',
                'What are my key tax and invoice documents?',
                'Show all installed applications',
                'Search presentation decks and notes',
              ].map((prompt) => (
                <button
                  key={prompt}
                  className={styles.promptPill}
                  onClick={() => onSendMessage(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const groups = m.sender === 'assistant' ? groupResults(m.photos ?? [], m.sources ?? []) : []
            return (
              <div key={m.id}>
                {m.sender === 'user' ? (
                  <div className={styles.userBubbleWrapper}>
                    <div className={styles.userBubble}>{m.text}</div>
                  </div>
                ) : (
                  <div className={styles.assistantWrapper}>
                    <div className={styles.assistantAvatar}>
                      <SearchIcon className="w-3.5 h-3.5" />
                    </div>
                    <div className={styles.assistantContent}>
                      {m.text && (
                        <div className={styles.assistantAnswerCard}>
                          <AnswerBody text={m.text} />
                        </div>
                      )}
                      {groups.map(([kind, items]) => (
                        <div key={kind} className={styles.resultSection}>
                          {groups.length > 1 && <div className={styles.sectionHeader}>{KIND_LABELS[kind]}</div>}
                          {renderGroup(kind, items)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}

        {isLoading && (
          <div className={styles.assistantWrapper}>
            <div className={styles.assistantAvatar}>
              <SearchIcon className="w-3.5 h-3.5" />
            </div>
            <div className={styles.typing} role="status" aria-label="Thinking">
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
            </div>
          </div>
        )}
      </div>

      <ChatInput
        isLoading={isLoading}
        onSendMessage={onSendMessage}
        onOpenResult={onOpenResult}
        onContextMenu={onContextMenu}
      />
    </main>
  )
}
