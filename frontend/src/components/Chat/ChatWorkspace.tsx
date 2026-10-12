import React, { useEffect, useRef, useState } from 'react'
import type { ChatMessage, SearchResult } from '../../types'
import { SearchIcon } from '../common/Icons'
import { AnswerBody } from './answerBody'
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
