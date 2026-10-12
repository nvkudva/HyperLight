import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Conversation, SearchResult } from '../../types'
import { ResultCard } from './ResultCard'
import styles from './SearchScreen.module.css'

export interface FeedApi {
  scrollTo: (id: string) => void
}

interface SearchScreenProps {
  query: string
  onQueryChange: (q: string) => void
  registerKeyHandler: (h: (e: React.KeyboardEvent) => void) => void
  onOpen: (item: SearchResult) => void
  onReveal: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
  audioCategories?: Record<string, SearchResult[]> | null
  audioSearching?: boolean
  history: Conversation[]
  feedApiRef: { current: FeedApi | null }
}

export const SearchScreen: React.FC<SearchScreenProps> = ({
  query,
  onQueryChange,
  registerKeyHandler,
  onOpen,
  onReveal,
  onContextMenu,
  audioCategories = null,
  audioSearching = false,
  history,
  feedApiRef,
}) => {
  const feedRef = useRef<HTMLDivElement>(null)
  const q = query.trim()
  const isAudio = audioCategories !== null
  const hasQuery = q.length > 0 || isAudio
  const liveTitle = isAudio ? 'Voice search' : q

  const cards = useMemo(() => {
    const liveKey = liveTitle.toLowerCase()
    return history.filter(
      (c) => (c.kind ?? 'chat') === 'search' && (liveKey === '' || c.title.toLowerCase() !== liveKey)
    )
  }, [history, liveTitle])

  const scrollTo = useCallback((id: string) => {
    feedRef.current
      ?.querySelector(`#result-card-${CSS.escape(id)}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    feedApiRef.current = { scrollTo }
  })

  const cardCount = cards.length + (hasQuery ? 1 : 0)

  return (
    <div className={styles.screen}>
      {!hasQuery && cards.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>Start typing to search everything on this Mac.</p>
          <p className={styles.emptyHint}>
            Try “tax invoice 2025”, “photos of the beach” or “flight to Munich”.
          </p>
        </div>
      ) : (
        <div ref={feedRef} id="search-feed" className={`${styles.feed} custom-scroll`}>
          {hasQuery &&
            (isAudio ? (
              <ResultCard
                cardId="live"
                title="Voice search"
                query=""
                snapshot={audioCategories ?? undefined}
                snapshotSearching={audioSearching}
                eager
                onOpen={onOpen}
                onReveal={onReveal}
                onContextMenu={onContextMenu}
              />
            ) : (
              <ResultCard
                cardId="live"
                title={q}
                query={q}
                eager
                registerKeyHandler={registerKeyHandler}
                onQueryChange={onQueryChange}
                onOpen={onOpen}
                onReveal={onReveal}
                onContextMenu={onContextMenu}
              />
            ))}
          {cards.map((c) => (
            <ResultCard
              key={c.id}
              cardId={c.id}
              title={c.title}
              query={c.title}
              onOpen={onOpen}
              onReveal={onReveal}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}

      <footer className={styles.statusBar}>
        <span>{hasQuery || cards.length > 0 ? `${cardCount} result cards` : 'Local search'}</span>
        <span>↑↓ Select · ↵ Open · ⌘R Show in Finder</span>
      </footer>
    </div>
  )
}
