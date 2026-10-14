import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import type { VoiceResult } from '../../hooks/useSearchSession'
import type { Conversation, SearchResult } from '../../types'
import { ResultCard } from './ResultCard'
import styles from './SearchScreen.module.css'

export interface FeedApi {
  scrollTo: (id: string) => void
}

interface SearchScreenProps {
  query: string
  registerKeyHandler: (h: (e: React.KeyboardEvent) => void) => void
  onOpen: (item: SearchResult) => void
  onReveal: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
  voiceResult: VoiceResult | null
  voiceSearching: boolean
  history: Conversation[]
  feedApiRef: { current: FeedApi | null }
  feedMode: boolean
}

export const SearchScreen: React.FC<SearchScreenProps> = ({
  query,
  registerKeyHandler,
  onOpen,
  onReveal,
  onContextMenu,
  voiceResult,
  voiceSearching,
  history,
  feedApiRef,
  feedMode,
}) => {
  const feedRef = useRef<HTMLDivElement>(null)
  const q = query.trim()
  const isAudio = voiceResult !== null
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

  const liveCard = hasQuery ? (
    isAudio ? (
      <ResultCard
        cardId="live"
        title={voiceResult.transcript ? `Voice: “${voiceResult.transcript}”` : 'Voice search'}
        query={voiceResult.transcript}
        snapshot={voiceResult.buckets}
        snapshotSearching={voiceSearching}
        eager
        plain={!feedMode}
        registerKeyHandler={registerKeyHandler}
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
        plain={!feedMode}
        registerKeyHandler={registerKeyHandler}
        onOpen={onOpen}
        onReveal={onReveal}
        onContextMenu={onContextMenu}
      />
    )
  ) : null

  if (!feedMode) {
    return (
      <div className={styles.screen}>
        {!hasQuery ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>Start typing to search everything on this Mac.</p>
            <p className={styles.emptyHint}>
              Try “tax invoice 2025”, “photos of the beach” or “flight to Munich”.
            </p>
          </div>
        ) : (
          <>
            {isAudio && (
              <p className={styles.voiceTranscript}>
                {voiceResult.transcript ? `Matched: “${voiceResult.transcript}”` : 'No matches yet'}
              </p>
            )}
            {liveCard}
          </>
        )}

        <footer className={styles.statusBar}>
          <span>{hasQuery ? q : 'Local search'}</span>
          <span>↑↓ Select · ↵ Open · ⌘R Show in Finder</span>
        </footer>
      </div>
    )
  }

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
        <div ref={feedRef} id="search-feed" className={styles.feed}>
          {liveCard}
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
