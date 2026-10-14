import React, { useEffect, useMemo, useRef, useState } from 'react'
import { flattenBuckets, useLiveSearch } from '../../hooks/useLiveSearch'
import type { SearchBucket, SearchResult } from '../../types'
import {
  AppIcon,
  AudioIcon,
  BookmarkIcon,
  CalendarIcon,
  ContactIcon,
  DocumentIcon,
  PhotoIcon,
  VideoIcon,
} from '../common/Icons'
import { ResultThumbnail, VISUAL_PREVIEW } from './ResultThumbnail'
import { TextPreview } from './TextPreview'
import styles from './SearchScreen.module.css'

const ICONS: Record<string, [React.FC<{ className?: string }>, string]> = {
  app: [AppIcon, styles.indigo],
  contact: [ContactIcon, styles.green],
  calendar: [CalendarIcon, styles.red],
  photo: [PhotoIcon, styles.orange],
  video: [VideoIcon, styles.red],
  audio: [AudioIcon, styles.indigo],
  text: [DocumentIcon, styles.accent],
  bookmark: [BookmarkIcon, styles.accent],
}

export interface ResultCardProps {
  cardId: string
  title: string
  query: string
  snapshot?: SearchBucket[]
  snapshotSearching?: boolean
  eager?: boolean
  plain?: boolean
  registerKeyHandler?: (h: (e: React.KeyboardEvent) => void) => void
  onOpen: (item: SearchResult) => void
  onReveal: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
}

const PHOTOS_COLLAPSED = 12

const kindOf = (item: SearchResult) => item.type ?? item.file_type ?? 'document'

function highlight(text: string, terms: string[]): React.ReactNode {
  const clean = terms.map((t) => t.trim()).filter((t) => t.length > 1)
  if (!clean.length) return text
  const pattern = new RegExp(`(${clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? <mark key={i}>{part}</mark> : part
  )
}

export const ResultCard: React.FC<ResultCardProps> = React.memo(
  ({
    cardId,
    title,
    query,
    snapshot,
    snapshotSearching = false,
    eager = false,
    plain = false,
    registerKeyHandler,
    onOpen,
    onReveal,
    onContextMenu,
  }) => {
    const rootRef = useRef<HTMLElement>(null)
    const [nearby, setNearby] = useState(eager)

    useEffect(() => {
      if (eager) return
      const el = rootRef.current
      if (!el || typeof IntersectionObserver === 'undefined') {
        setNearby(true)
        return
      }
      const ob = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            setNearby(true)
            ob.disconnect()
          }
        },
        { rootMargin: '600px' }
      )
      ob.observe(el)
      return () => ob.disconnect()
    }, [eager])

    const live = useLiveSearch(snapshot ? '' : query, 150, nearby)
    const allBuckets = snapshot ?? live.buckets
    const isSearching = snapshot ? snapshotSearching : live.isSearching

    const [photosExpanded, setPhotosExpanded] = useState(false)
    const buckets = useMemo(
      () =>
        photosExpanded
          ? allBuckets
          : allBuckets.map((b) => (b.kind === 'photo' ? { ...b, items: b.items.slice(0, PHOTOS_COLLAPSED) } : b)),
      [allBuckets, photosExpanded]
    )
    const hiddenPhotos = (allBuckets.find((b) => b.kind === 'photo')?.items.length ?? 0) - PHOTOS_COLLAPSED

    const [selected, setSelected] = useState(0)
    const flatItems = useMemo(() => flattenBuckets(buckets), [buckets])

    const [seenBuckets, setSeenBuckets] = useState(buckets)
    if (seenBuckets !== buckets) {
      setSeenBuckets(buckets)
      setSelected(0)
    }

    const current = flatItems[selected]
    const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set())

    const itemId = (index: number) => `search-item-${cardId}-${index}`

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!flatItems.length) return
        const next = (selected + (e.key === 'ArrowDown' ? 1 : -1) + flatItems.length) % flatItems.length
        setSelected(next)
        document.getElementById(itemId(next))?.scrollIntoView({ block: 'nearest' })
      } else if (e.key === 'Enter' && current) {
        e.preventDefault()
        onOpen(current)
      } else if (e.key === 'r' && e.metaKey && current) {
        e.preventDefault()
        onReveal(current.path)
      }
    }

    useEffect(() => {
      if (!registerKeyHandler) return
      registerKeyHandler(handleKeyDown)
      return () => registerKeyHandler(() => {})
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, flatItems, current])

    useEffect(() => {
      if (!eager) return
      const input = document.getElementById('unified-search-input')
      if (current) input?.setAttribute('aria-activedescendant', itemId(selected))
      else input?.removeAttribute('aria-activedescendant')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eager, current, selected])

    const renderIcon = (kind: string, extra = '') => {
      const [Icon, tint] = ICONS[kind] ?? [DocumentIcon, styles.accent]
      return <Icon className={`${styles.itemIcon} ${tint} ${extra}`} />
    }

    return (
      <section
        ref={rootRef}
        id={`result-card-${cardId}`}
        className={plain ? styles.resultCardPlain : styles.resultCard}
        aria-label={title}
      >
        {!plain && (
          <header className={styles.resultCardHeader}>
            <span className={styles.resultCardTitle}>{title}</span>
            <span className={styles.resultCardMeta}>{isSearching ? 'Searching…' : `${flatItems.length} results`}</span>
          </header>
        )}
        {!nearby || (isSearching && flatItems.length === 0) ? (
          <p className={styles.emptyNote}>{isSearching || !nearby ? 'Searching…' : 'No results'}</p>
        ) : flatItems.length === 0 ? (
          <p className={styles.emptyNote}>No results</p>
        ) : (
          <div className={styles.resultCardBody}>
            <div role="listbox" className={`${styles.results} custom-scroll`}>
              {buckets.map((bucket, bucketIdx) => {
                const offset = buckets.slice(0, bucketIdx).reduce((n, b) => n + b.items.length, 0)
                return (
                  <div key={bucket.kind} role="group" aria-label={bucket.label}>
                    <div className={styles.categoryTitle}>{bucket.label}</div>
                    {bucket.items.map((item, idx) => {
                      const index = offset + idx
                      const isSelected = index === selected
                      const terms = item.matched_terms?.length
                        ? item.matched_terms
                        : query.split(/\s+/)
                      const desc = item.excerpt || item.path
                      return (
                        <div
                          key={item.path || idx}
                          id={itemId(index)}
                          role="option"
                          aria-selected={isSelected}
                          className={`${styles.itemRow} ${isSelected ? styles.itemSelected : ''}`}
                          onMouseEnter={() => setSelected(index)}
                          onClick={() => setSelected(index)}
                          onDoubleClick={() => onOpen(item)}
                          onContextMenu={(e) => onContextMenu(e, item.path, item.filename)}
                        >
                          <ResultThumbnail path={item.path} fallback={renderIcon(kindOf(item))} />
                          <div className={styles.itemText}>
                            <div className={styles.itemTitle}>{highlight(item.filename, terms)}</div>
                            <div className={styles.itemDesc}>{highlight(desc, terms)}</div>
                          </div>
                        </div>
                      )
                    })}
                    {bucket.kind === 'photo' && !photosExpanded && hiddenPhotos > 0 && (
                      <button className={styles.showMore} onClick={() => setPhotosExpanded(true)}>
                        Show {hiddenPhotos} more photos
                      </button>
                    )}
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
                ) : kindOf(current) === 'photo' && !failedPreviews.has(current.path) ? (
                  <img
                    className={styles.previewImage}
                    src={`/api/thumbnail?path=${encodeURIComponent(current.path)}`}
                    alt={current.filename}
                    loading="lazy"
                    onError={() => setFailedPreviews((prev) => new Set(prev).add(current.path))}
                  />
                ) : VISUAL_PREVIEW.test(current.path) && !failedPreviews.has(current.path) ? (
                  <img
                    key={current.path}
                    className={styles.previewImage}
                    src={`/api/preview?path=${encodeURIComponent(current.path)}`}
                    alt={`Preview of ${current.filename}`}
                    loading="lazy"
                    onError={() => setFailedPreviews((prev) => new Set(prev).add(current.path))}
                  />
                ) : (
                  <div className={styles.previewIconWrap}>{renderIcon(kindOf(current), styles.previewIcon)}</div>
                )}
                <h2 className={styles.previewTitle}>{current.filename}</h2>
                <p className={styles.previewPath}>{current.path}</p>
                {current.content && !['photo', 'video', 'audio'].includes(kindOf(current)) && (!VISUAL_PREVIEW.test(current.path) || failedPreviews.has(current.path)) && (
                  <TextPreview path={current.path} snippet={current.content} />
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
      </section>
    )
  }
)
