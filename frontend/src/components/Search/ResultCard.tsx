import React, { useEffect, useMemo, useRef, useState } from 'react'
import { flattenBuckets, useLiveSearch } from '../../hooks/useLiveSearch'
import { useRecordSearch } from '../../hooks/useRecordSearch'
import type { SearchBucket, SearchResult } from '../../types'
import {
  AppIcon,
  AudioIcon,
  BookmarkIcon,
  CalendarIcon,
  ContactIcon,
  DocumentIcon,
  MailIcon,
  PhotoIcon,
  SettingsIcon,
  VideoIcon,
} from '../common/Icons'
import { ResultThumbnail, VISUAL_PREVIEW } from './ResultThumbnail'
import { TextPreview } from './TextPreview'
import styles from './SearchScreen.module.css'

const ICONS: Record<string, [React.FC<{ className?: string }>, string]> = {
  app: [AppIcon, styles.indigo],
  setting: [SettingsIcon, styles.indigo],
  contact: [ContactIcon, styles.green],
  calendar: [CalendarIcon, styles.red],
  photo: [PhotoIcon, styles.orange],
  video: [VideoIcon, styles.red],
  audio: [AudioIcon, styles.indigo],
  text: [DocumentIcon, styles.accent],
  bookmark: [BookmarkIcon, styles.accent],
  email: [MailIcon, styles.accent],
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
  onSearched?: (query: string) => void
  onOpen: (item: SearchResult) => void
  onReveal: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
}

const COLLAPSED_LIMITS: Record<string, number> = { photo: 12, email: 3 }
const COLLAPSED_NOUNS: Record<string, string> = { photo: 'photos', email: 'emails' }

const kindOf = (item: SearchResult) => item.type ?? item.file_type ?? 'document'
const isSystemEntry = (item: SearchResult) => ['app', 'setting'].includes(kindOf(item))
// Mail and calendar results live in opaque .emlx/.ics files; their path says nothing useful.
const hasMeaninglessPath = (item: SearchResult) => ['email', 'calendar'].includes(kindOf(item))

const displayName = (item: SearchResult) =>
  (kindOf(item) === 'calendar' && item.metadata?.summary ? item.metadata.summary : item.filename ?? '').replace(/\.app$/i, '')

function formatIcsDate(raw: string): string {
  const match = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(raw)
  if (!match) return raw
  const [, year, month, day, hour, minute] = match
  return hour ? `${year}-${month}-${day} ${hour}:${minute}` : `${year}-${month}-${day}`
}

function describe(item: SearchResult): string {
  const meta = item.metadata ?? {}
  if (kindOf(item) === 'email') return [meta.from, meta.date].filter(Boolean).join(' · ')
  if (kindOf(item) === 'calendar') return [meta.start && formatIcsDate(meta.start), meta.location].filter(Boolean).join(' · ')
  return item.excerpt || item.path
}

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
    onSearched,
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
    useRecordSearch(query, !snapshot && nearby && !isSearching && !live.hasFailed, onSearched)

    const [failedPhotos, setFailedPhotos] = useState<Set<string>>(() => new Set())
    const [expandedKinds, setExpandedKinds] = useState<Set<string>>(new Set())
    const loadablePhotos = useMemo(
      () =>
        allBuckets.map((b) =>
          b.kind === 'photo' ? { ...b, items: b.items.filter((item) => !failedPhotos.has(item.path)) } : b
        ),
      [allBuckets, failedPhotos]
    )
    const buckets = useMemo(
      () =>
        loadablePhotos.map((b) => {
          const collapsedLimit = COLLAPSED_LIMITS[b.kind]
          if (collapsedLimit && !expandedKinds.has(b.kind)) return { ...b, items: b.items.slice(0, collapsedLimit) }
          if (b.kind === 'app' || b.kind === 'setting') return { ...b, items: b.items.slice(0, 2) }
          return b
        }),
      [loadablePhotos, expandedKinds]
    )
    const hiddenCount = (kind: string) => {
      const total = loadablePhotos.find((b) => b.kind === kind)?.items.length ?? 0
      return expandedKinds.has(kind) ? 0 : Math.max(0, total - (COLLAPSED_LIMITS[kind] ?? total))
    }

    const [selected, setSelected] = useState(0)
    const flatItems = useMemo(() => flattenBuckets(buckets), [buckets])

    const [seenBuckets, setSeenBuckets] = useState(buckets)
    if (seenBuckets !== buckets) {
      setSeenBuckets(buckets)
      setSelected(0)
    }

    const current = flatItems[selected]
    const [failedPreviews, setFailedPreviews] = useState<Set<string>>(() => new Set())
    const showTextPreview =
      !!current &&
      !!current.content &&
      !['photo', 'video', 'audio'].includes(kindOf(current)) &&
      (!VISUAL_PREVIEW.test(current.path) || failedPreviews.has(current.path))

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

    // Arrows work with focus anywhere outside inputs and buttons; the search
    // box path above already covers focus inside it.
    useEffect(() => {
      if (!registerKeyHandler) return
      const onWindowKey = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null
        if (
          t &&
          (t.tagName === 'INPUT' ||
            t.tagName === 'TEXTAREA' ||
            t.tagName === 'SELECT' ||
            t.tagName === 'BUTTON' ||
            t.isContentEditable)
        )
          return
        handleKeyDown(e as unknown as React.KeyboardEvent)
      }
      window.addEventListener('keydown', onWindowKey)
      return () => window.removeEventListener('keydown', onWindowKey)
    })

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
            <span className={styles.resultCardMeta}>
              {live.hasFailed ? 'Unavailable' : isSearching ? 'Searching…' : `${flatItems.length} results`}
            </span>
          </header>
        )}
        {live.hasFailed ? (
          <p role="alert" className={styles.emptyNote}>
            Search unavailable. Check that Hyperlight is running, then try again.
          </p>
        ) : !nearby || (isSearching && flatItems.length === 0) ? (
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
                    {bucket.kind === 'photo' ? (
                      <div className={styles.photoGrid}>
                        {bucket.items.map((item, idx) => {
                          const index = offset + idx
                          const isSelected = index === selected
                          return (
                            <img
                              key={item.path || idx}
                              id={itemId(index)}
                              role="option"
                              aria-selected={isSelected}
                              className={`${styles.photoCell} ${isSelected ? styles.photoCellSelected : ''}`}
                              src={`/api/thumbnail?path=${encodeURIComponent(item.path)}`}
                              alt={item.filename}
                              loading="lazy"
                              onMouseEnter={() => setSelected(index)}
                              onClick={() => setSelected(index)}
                              onDoubleClick={() => onOpen(item)}
                              onContextMenu={(e) => onContextMenu(e, item.path, item.filename)}
                              onError={() => setFailedPhotos((prev) => new Set(prev).add(item.path))}
                            />
                          )
                        })}
                      </div>
                    ) : (
                    bucket.items.map((item, idx) => {
                      const index = offset + idx
                      const isSelected = index === selected
                      const terms = item.matched_terms?.length
                        ? item.matched_terms
                        : query.split(/\s+/)
                      const desc = describe(item)
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
                            <div className={styles.itemTitle}>{highlight(displayName(item), terms)}</div>
                            {!isSystemEntry(item) && desc && (
                              <div className={styles.itemDesc}>{highlight(desc, terms)}</div>
                            )}
                          </div>
                        </div>
                      )
                    })
                    )}
                    {hiddenCount(bucket.kind) > 0 && (
                      <button
                        className={styles.showMore}
                        onClick={() => setExpandedKinds((prev) => new Set(prev).add(bucket.kind))}
                      >
                        Show {hiddenCount(bucket.kind)} more {COLLAPSED_NOUNS[bucket.kind]}
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
                ) : kindOf(current) === 'app' && !failedPreviews.has(current.path) ? (
                  <img
                    key={current.path}
                    className={styles.previewImage}
                    src={`/api/preview?path=${encodeURIComponent(current.path)}`}
                    alt={`Icon of ${displayName(current)}`}
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
                ) : showTextPreview ? null : (
                  <div className={styles.previewIconWrap}>{renderIcon(kindOf(current), styles.previewIcon)}</div>
                )}
                <h2 className={styles.previewTitle}>{displayName(current)}</h2>
                {!showTextPreview && !isSystemEntry(current) && !hasMeaninglessPath(current) && <p className={styles.previewPath}>{current.path}</p>}
                {showTextPreview && (
                  <TextPreview path={current.path} snippet={current.content ?? ''} />
                )}
                <div className={styles.previewActions}>
                  <button className={`${styles.actionButton} ${styles.primary}`} onClick={() => onOpen(current)}>
                    Open
                  </button>
                  {!current.path.startsWith('http') && kindOf(current) !== 'setting' && (
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
