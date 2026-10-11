import React, { useState } from 'react'
import type { ChatMessage } from '../../types'
import { AppIcon, BookmarkIcon, CalendarIcon, ContactIcon, DocumentIcon, SearchIcon } from '../common/Icons'
import styles from './ChatWorkspace.module.css'

interface ChatWorkspaceProps {
  messages: ChatMessage[]
  isLoading: boolean
  onSendMessage: (text: string) => void
  onOpenPhoto: (path: string, filename: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
  onRevealTarget: (path: string) => void
  onLaunchTarget: (path: string) => void
}

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  messages,
  isLoading,
  onSendMessage,
  onOpenPhoto,
  onContextMenu,
  onRevealTarget,
  onLaunchTarget,
}) => {
  const [inputText, setInputText] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() || isLoading) return
    onSendMessage(inputText.trim())
    setInputText('')
  }

  const renderEntityIcon = (type?: string, filename = '') => {
    const t = (type || '').toLowerCase()
    const fn = filename.toLowerCase()
    if (t === 'app' || fn.endsWith('.app')) return <AppIcon className="w-3.5 h-3.5 text-indigo-500" />
    if (t === 'contact' || fn.endsWith('.vcf')) return <ContactIcon className="w-3.5 h-3.5 text-emerald-500" />
    if (t === 'calendar' || fn.endsWith('.ics')) return <CalendarIcon className="w-3.5 h-3.5 text-rose-500" />
    if (t === 'webloc' || fn.endsWith('.webloc')) return <BookmarkIcon className="w-3.5 h-3.5 text-sky-500" />
    return <DocumentIcon className="w-3.5 h-3.5 text-blue-500" />
  }

  return (
    <main className={styles.workspace}>
      <div className={`${styles.messagesArea} custom-scroll`}>
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
          messages.map((m) => (
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
                    {m.text && <div className={styles.assistantAnswerCard}>{m.text}</div>}

                    {m.photos && m.photos.length > 0 && (
                      <div className={styles.photoGrid}>
                        {m.photos.map((p, idx) => (
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
                    )}

                    {m.sources && m.sources.length > 0 && (
                      <div className={styles.sourcesList}>
                        {m.sources.map((s, idx) => (
                          <div
                            key={s.path || idx}
                            className={styles.entityCard}
                            onClick={() => (s.file_type === 'app' ? onLaunchTarget(s.path) : onRevealTarget(s.path))}
                            onContextMenu={(e) => onContextMenu(e, s.path, s.filename)}
                          >
                            <div className={styles.entityLeft}>
                              {renderEntityIcon(s.file_type, s.filename)}
                              <div>
                                <div className={styles.entityTitle}>{s.filename}</div>
                                <div className={styles.entitySub}>{s.excerpt || s.path}</div>
                              </div>
                            </div>
                            <span style={{ fontSize: '0.6875rem', color: 'var(--accent)', fontWeight: 600 }}>
                              {s.file_type === 'app' ? 'Open' : 'Reveal'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className={styles.assistantWrapper}>
            <div className={styles.assistantAvatar}>
              <SearchIcon className="w-3.5 h-3.5" />
            </div>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'rgba(var(--surface-rgb), 0.6)', borderRadius: '0.75rem' }}>
              <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--label-3)' }} />
              <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--label-3)' }} />
              <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--label-3)' }} />
            </div>
          </div>
        )}
      </div>

      <div className={styles.inputBarWrapper}>
        <form className={styles.inputBar} onSubmit={handleSubmit}>
          <input
            type="text"
            className={styles.textInput}
            placeholder="Ask anything, find photos, or search files..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />
          <button type="submit" className={styles.sendButton} disabled={!inputText.trim() || isLoading}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
            </svg>
          </button>
        </form>
      </div>
    </main>
  )
}
