import React, { useEffect, useRef, useState } from 'react'
import { useLiveSearch } from '../../hooks/useLiveSearch'
import type { SearchResult } from '../../types'
import {
  AppIcon,
  AudioIcon,
  BookmarkIcon,
  CalendarIcon,
  ContactIcon,
  DocumentIcon,
  PhotoIcon,
  SearchIcon,
  SettingsIcon,
  VideoIcon,
} from '../common/Icons'
import styles from './SearchScreen.module.css'

const CATEGORY_LABELS: Record<string, string> = {
  app: 'Applications',
  contact: 'Contacts',
  calendar: 'Calendar events',
  email: 'Mail',
  document: 'Documents',
  photo: 'Photos',
  video: 'Videos',
  audio: 'Audio',
  webloc: 'Bookmarks',
}

const ICONS: Record<string, [React.FC<{ className?: string }>, string]> = {
  app: [AppIcon, styles.indigo],
  contact: [ContactIcon, styles.green],
  calendar: [CalendarIcon, styles.red],
  photo: [PhotoIcon, styles.orange],
  video: [VideoIcon, styles.red],
  audio: [AudioIcon, styles.indigo],
  webloc: [BookmarkIcon, styles.accent],
  bookmark: [BookmarkIcon, styles.accent],
}

const VISUAL_PREVIEW = /\.(pdf|docx?|pptx?|xlsx?|key|pages|numbers|rtf|heic|png|jpe?g|gif|webp|tiff?)$/i

interface SearchScreenProps {
  accessory?: React.ReactNode
  onOpen: (item: SearchResult) => void
  onReveal: (path: string) => void
  onAskChat: (query: string) => void
  onOpenSettings: () => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
  onDragStart: (e: React.MouseEvent) => void
}

export const SearchScreen: React.FC<SearchScreenProps> = ({
  accessory,
  onOpen,
  onReveal,
  onAskChat,
  onOpenSettings,
  onContextMenu,
  onDragStart,
}) => {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { categories, flatItems, offsets, isSearching } = useLiveSearch(query)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelected(0)
  }, [categories])

  const current = flatItems[selected]
  const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set())

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery('')
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!flatItems.length) return
      const next = (selected + (e.key === 'ArrowDown' ? 1 : -1) + flatItems.length) % flatItems.length
      setSelected(next)
      document.getElementById(`search-item-${next}`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      if (query.trim()) onAskChat(query.trim())
    } else if (e.key === 'Enter' && current) {
      e.preventDefault()
      onOpen(current)
    } else if (e.key === 'r' && e.metaKey && current) {
      e.preventDefault()
      onReveal(current.path)
    }
  }

  const renderIcon = (kind: string, extra = '') => {
    const [Icon, tint] = ICONS[kind] ?? [DocumentIcon, styles.accent]
    return <Icon className={`${styles.itemIcon} ${tint} ${extra}`} />
  }

  const kindOf = (item: SearchResult) => item.type ?? item.file_type ?? 'document'
  const hasQuery = query.trim().length > 0

  return (
    <div className={styles.screen}>
      <header
        className={styles.header}
        data-tauri-drag-region
        onMouseDown={(e) => e.target === e.currentTarget && onDragStart(e)}
      >
        <SearchIcon className={styles.searchIcon} />
        <input
          ref={inputRef}
          type="text"
          className={styles.searchInput}
          placeholder="Search files, photos, mail and apps"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={flatItems.length > 0}
          aria-controls="search-results"
          aria-activedescendant={current ? `search-item-${selected}` : undefined}
        />
        {accessory}
        <button
          className={styles.chatButton}
          onClick={() => onAskChat(query.trim())}
          title="Open chat (⌘↩ asks this query)"
        >
          {hasQuery ? 'Ask in Chat' : 'Chat'}
        </button>
        <button className={styles.iconButton} onClick={onOpenSettings} aria-label="Settings" title="Settings">
          <SettingsIcon className={styles.settingsIcon} />
        </button>
      </header>

      {!hasQuery ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Start typing to search everything on this Mac.</p>
          <p className={styles.emptyHint}>
            Try “tax invoice 2025”, “photos of the beach” or “flight to Munich”. Press ⌘↩ to ask the question in chat.
          </p>
        </div>
      ) : flatItems.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{isSearching ? 'Searching…' : `No results for “${query}”`}</p>
          {!isSearching && (
            <button className={styles.linkButton} onClick={() => onAskChat(query.trim())}>
              Ask in chat instead
            </button>
          )}
        </div>
      ) : (
        <div className={styles.body}>
          <div id="search-results" role="listbox" className={`${styles.results} custom-scroll`}>
            {Object.entries(categories).map(([catKey, items]) => {
              if (!items?.length) return null
              return (
                <div key={catKey} role="group" aria-label={CATEGORY_LABELS[catKey] || catKey}>
                  <div className={styles.categoryTitle}>{CATEGORY_LABELS[catKey] || catKey}</div>
                  {items.map((item, idx) => {
                    const index = offsets[catKey] + idx
                    const isSelected = index === selected
                    return (
                      <div
                        key={item.path || idx}
                        id={`search-item-${index}`}
                        role="option"
                        aria-selected={isSelected}
                        className={`${styles.itemRow} ${isSelected ? styles.itemSelected : ''}`}
                        onMouseEnter={() => setSelected(index)}
                        onClick={() => onOpen(item)}
                        onContextMenu={(e) => onContextMenu(e, item.path, item.filename)}
                      >
                        {renderIcon(catKey)}
                        <div className={styles.itemText}>
                          <div className={styles.itemTitle}>{item.filename}</div>
                          <div className={styles.itemDesc}>{item.excerpt || item.path}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {current && (
            <aside className={`${styles.preview} custom-scroll`} aria-label="Preview">
              {kindOf(current) === 'video' ? (
                <video
                  key={current.path}
                  className={styles.previewImage}
                  src={`/api/media?path=${encodeURIComponent(current.path)}`}
                  poster={`/api/preview?path=${encodeURIComponent(current.path)}`}
                  controls
                  preload="metadata"
                />
              ) : kindOf(current) === 'audio' ? (
                <>
                  <div className={styles.previewIconWrap}>{renderIcon('audio', styles.previewIcon)}</div>
                  <audio
                    key={current.path}
                    className={styles.previewAudio}
                    src={`/api/media?path=${encodeURIComponent(current.path)}`}
                    controls
                    preload="metadata"
                  />
                </>
              ) : kindOf(current) === 'photo' ? (
                <img
                  className={styles.previewImage}
                  src={`/api/thumbnail?path=${encodeURIComponent(current.path)}`}
                  alt={current.filename}
                />
              ) : VISUAL_PREVIEW.test(current.path) && !failedPreviews.has(current.path) ? (
                <img
                  key={current.path}
                  className={styles.previewImage}
                  src={`/api/preview?path=${encodeURIComponent(current.path)}`}
                  alt={`Preview of ${current.filename}`}
                  onError={() => setFailedPreviews((prev) => new Set(prev).add(current.path))}
                />
              ) : (
                <div className={styles.previewIconWrap}>{renderIcon(kindOf(current), styles.previewIcon)}</div>
              )}
              <h2 className={styles.previewTitle}>{current.filename}</h2>
              <p className={styles.previewPath}>{current.path}</p>
              {current.content && !['photo', 'video', 'audio'].includes(kindOf(current)) && (!VISUAL_PREVIEW.test(current.path) || failedPreviews.has(current.path)) && (
                <p className={styles.previewContent}>{current.content.slice(0, 700)}</p>
              )}
              <div className={styles.previewActions}>
                <button className={`${styles.actionButton} ${styles.primary}`} onClick={() => onOpen(current)}>
                  Open
                </button>
                {!current.path.startsWith('http') && (
                  <button className={styles.actionButton} onClick={() => onReveal(current.path)}>
                    Show in Finder
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      <footer className={styles.statusBar}>
        <span>{hasQuery ? `${flatItems.length} results` : 'Local search'}</span>
        <span>↑↓ Select · ↵ Open · ⌘R Show in Finder · ⌘↩ Ask in Chat</span>
      </footer>
    </div>
  )
}
