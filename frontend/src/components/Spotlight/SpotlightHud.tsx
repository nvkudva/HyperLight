import React, { useEffect, useRef, useState } from 'react'
import { searchSpotlight } from '../../api'
import type { SearchResult } from '../../types'
import { AppIcon, BookmarkIcon, CalendarIcon, ContactIcon, DocumentIcon, PhotoIcon, SearchIcon } from '../common/Icons'
import styles from './SpotlightHud.module.css'

interface SpotlightHudProps {
  isOpen: boolean
  onClose: () => void
  onSelectResult: (result: SearchResult) => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
}

export const SpotlightHud: React.FC<SpotlightHudProps> = ({
  isOpen,
  onClose,
  onSelectResult,
  onContextMenu,
}) => {
  const [query, setQuery] = useState('')
  const [categories, setCategories] = useState<Record<string, SearchResult[]>>({})
  const [totalMatches, setTotalMatches] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceTimer = useRef<number | null>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setCategories({})
      setTotalMatches(0)
    }
  }, [isOpen])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)

    if (debounceTimer.current) clearTimeout(debounceTimer.current)

    if (!val.trim()) {
      setCategories({})
      setTotalMatches(0)
      return
    }

    debounceTimer.current = window.setTimeout(async () => {
      try {
        const res = await searchSpotlight(val.trim(), 30)
        setCategories(res.categories || {})
        setTotalMatches(res.total_matches || 0)
      } catch (err) {
        console.error('Spotlight search error:', err)
      }
    }, 100)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen) return null

  const renderIcon = (type: string) => {
    switch (type) {
      case 'app':
        return <AppIcon className="w-4 h-4 text-indigo-500" />
      case 'contact':
        return <ContactIcon className="w-4 h-4 text-emerald-500" />
      case 'calendar':
        return <CalendarIcon className="w-4 h-4 text-rose-500" />
      case 'photo':
        return <PhotoIcon className="w-4 h-4 text-amber-500" />
      case 'webloc':
      case 'bookmark':
        return <BookmarkIcon className="w-4 h-4 text-sky-500" />
      default:
        return <DocumentIcon className="w-4 h-4 text-blue-500" />
    }
  }

  const categoryLabels: Record<string, string> = {
    app: 'Applications',
    contact: 'Contacts',
    calendar: 'Calendar Events',
    document: 'Documents & Notes',
    photo: 'Photos & Images',
    webloc: 'Bookmarks & Web',
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.searchHeader}>
          <SearchIcon className="w-4 h-4 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder="Spotlight Search..."
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          <span className={styles.escPill}>ESC</span>
        </div>

        <div className={`${styles.resultsArea} custom-scroll`}>
          {!query.trim() ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              Type to search apps, contacts, events, files, and photos across your Mac...
            </div>
          ) : totalMatches === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              No matches found for "{query}".
            </div>
          ) : (
            Object.entries(categories).map(([catKey, items]) => {
              if (!items || items.length === 0) return null
              return (
                <div key={catKey} className={styles.categoryGroup}>
                  <div className={styles.categoryTitle}>{categoryLabels[catKey] || catKey}</div>
                  {items.map((item, idx) => (
                    <div
                      key={item.path || idx}
                      className={styles.itemRow}
                      onClick={() => onSelectResult(item)}
                      onContextMenu={(e) => onContextMenu(e, item.path, item.filename)}
                    >
                      <div className={styles.itemLeft}>
                        {renderIcon(catKey)}
                        <div>
                          <div className={styles.itemTitle}>{item.filename}</div>
                          <div className={styles.itemDesc}>{item.excerpt || item.path}</div>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.625rem', color: '#0071e3', fontWeight: 600 }}>
                        {catKey === 'app' ? 'Open' : 'Reveal'}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>

        <div className={styles.statusBar}>
          <span>{totalMatches} matches</span>
          <span>↵ Open • ⌘R Reveal • Esc Close</span>
        </div>
      </div>
    </div>
  )
}
