import React, { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../../api'
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
          placeholder="Search anything with Hyperlight..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {accessory}
        <button
          className={styles.iconButton}
          onClick={onOpenSettings}
          title="Settings (⌘,)"
          aria-label="Open settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </header>

      {flatItems.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>
            {hasQuery
              ? isSearching
                ? 'Searching…'
                : `No results for “${query}”`
              : 'Search files, photos, mail and apps'}
          </p>
          <p className={styles.emptySubtitle}>
            {hasQuery
              ? 'Try different keywords or press ⌘↩ to ask the AI'
              : 'Type keywords or press ⌘↩ to start a conversation'}
          </p>
        </div>
      ) : (
        <div className={styles.body}>
          <div className={`${styles.resultsList} custom-scroll`}>
            {Object.entries(categories).map(([catKey, items]) => {
              const baseOffset = offsets[catKey] ?? 0
              return (
                <div key={catKey} className={styles.categorySection}>
                  <div className={styles.categoryHeader}>
                    {CATEGORY_LABELS[catKey] ?? catKey}
                  </div>
                  {items.map((item, localIdx) => {
                    const globalIdx = baseOffset + localIdx
                    const isSelected = globalIdx === selected
                    return (
                      <div
                        id={`search-item-${globalIdx}`}
                        key={item.id ?? `${item.path}-${globalIdx}`}
                        className={`${styles.itemRow} ${isSelected ? styles.selected : ''}`}
                        onClick={() => {
                          setSelected(globalIdx)
                          onOpen(item)
                        }}
                        onContextMenu={(e) => onContextMenu(e, item.path, item.filename)}
                      >
                        {renderIcon(kindOf(item))}
                        <div className={styles.itemMeta}>
                          <span className={styles.itemTitle}>{item.filename}</span>
                          <span className={styles.itemSnippet}>
                            {item.content ? item.content.slice(0, 100) : item.path}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {current && (
            <aside className={styles.previewPanel}>
              {kindOf(current) === 'photo' && !failedPreviews.has(current.path) ? (
                <img
                  src={`${API_BASE}/api/preview?path=${encodeURIComponent(current.path)}`}
                  className={styles.previewImage}
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
                {!current.path.startsWith('http') && (\n                  <button className={styles.actionButton} onClick={() => onReveal(current.path)}>\n                    Show in Finder\n                  </button>\n                )}
              </div>
            </aside>
          )}
        </div>
      )}

      <footer className={styles.statusBar}>
        <span className={styles.brandStatus}>
          <img src="/hyperlight-icon.png" alt="" className={styles.statusIcon} />
          {hasQuery ? `${flatItems.length} results` : 'Hyperlight'}
        </span>
        <span>↑↓ Select · ↵ Open · ⌘R Show in Finder · ⌘↵ Ask in Chat</span>
      </footer>
    </div>
  )
}
