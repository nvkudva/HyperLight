import React, { useEffect, useRef, useState } from 'react'
import { revealTarget, searchSpotlight } from '../../api'
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
  const [selected, setSelected] = useState(0)
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
        setSelected(0)
      } catch (err) {
        console.error('Spotlight search error:', err)
      }
    }, 100)
  }

  const flatItems = Object.values(categories).flatMap((items) => items || [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!flatItems.length) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      const next = (selected + step + flatItems.length) % flatItems.length
      setSelected(next)
      document.getElementById(`spotlight-item-${next}`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' && flatItems[selected]) {
      e.preventDefault()
      onSelectResult(flatItems[selected])
    } else if (e.key === 'r' && e.metaKey && flatItems[selected]) {
      e.preventDefault()
      revealTarget(flatItems[selected].path)
    }
  }

  if (!isOpen) return null

  const renderIcon = (type: string) => {
    switch (type) {
      case 'app':
        return <AppIcon className={`${styles.itemIcon} ${styles.indigo}`} />
      case 'contact':
        return <ContactIcon className={`${styles.itemIcon} ${styles.green}`} />
      case 'calendar':
        return <CalendarIcon className={`${styles.itemIcon} ${styles.red}`} />
      case 'photo':
        return <PhotoIcon className={`${styles.itemIcon} ${styles.orange}`} />
      case 'webloc':
      case 'bookmark':
        return <BookmarkIcon className={`${styles.itemIcon} ${styles.accent}`} />
      default:
        return <DocumentIcon className={`${styles.itemIcon} ${styles.accent}`} />
    }
  }

  const categoryLabels: Record<string, string> = {
    app: 'Applications',
    contact: 'Contacts',
    calendar: 'Calendar Events',
    email: 'Mail',
    document: 'Documents & Notes',
    photo: 'Photos & Images',
    webloc: 'Bookmarks & Web',
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.searchHeader}>
          <SearchIcon className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder="Spotlight Search"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded={flatItems.length > 0}
            aria-controls="spotlight-results"
            aria-activedescendant={flatItems.length ? `spotlight-item-${selected}` : undefined}
          />
        </div>

        {query.trim() && (
          <div id="spotlight-results" role="listbox" className={`${styles.resultsArea} custom-scroll`}>
            {totalMatches === 0 ? (
              <div className={styles.emptyState}>No results for “{query}”</div>
            ) : (
              Object.entries(categories).map(([catKey, items]) => {
                if (!items || items.length === 0) return null
                const offset = flatItems.indexOf(items[0])
                return (
                  <div key={catKey} role="group" aria-label={categoryLabels[catKey] || catKey} className={styles.categoryGroup}>
                    <div className={styles.categoryTitle}>{categoryLabels[catKey] || catKey}</div>
                    {items.map((item, idx) => {
                      const index = offset + idx
                      return (
                        <div
                          key={item.path || idx}
                          id={`spotlight-item-${index}`}
                          role="option"
                          aria-selected={index === selected}
                          className={`${styles.itemRow} ${index === selected ? styles.itemSelected : ''}`}
                          onMouseMove={() => setSelected(index)}
                          onClick={() => onSelectResult(item)}
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
              })
            )}
          </div>
        )}

        {totalMatches > 0 && (
          <div className={styles.statusBar}>
            <span>{totalMatches} results</span>
            <span>↵ Open · ⌘R Show in Finder · Esc Close</span>
          </div>
        )}
      </div>
    </div>
  )
}
