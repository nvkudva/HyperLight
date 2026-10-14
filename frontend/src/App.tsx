import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchGoogleStatus,
  fetchSources,
  fetchStatus,
  launchTarget,
  revealTarget,
  warmup,
} from './api'
import { ContextMenu } from './components/ContextMenu/ContextMenu'
import { SearchScreen, type FeedApi } from './components/Search/SearchScreen'
import { Sidebar } from './components/Sidebar/Sidebar'
import { TopBar, type TopTab } from './components/TopBar/TopBar'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ScanIndicator } from './components/common/ScanIndicator'
import { useConversations } from './hooks/useConversations'
import { useIndexPolling } from './hooks/useIndexPolling'
import { useSearchSession } from './hooks/useSearchSession'
import * as native from './native'

const SettingsPage = React.lazy(() =>
  import('./components/Settings/SettingsPage').then((m) => ({ default: m.SettingsPage }))
)
const OnboardingWizard = React.lazy(() =>
  import('./components/Onboarding/OnboardingWizard').then((m) => ({ default: m.OnboardingWizard }))
)
import type { ConfiguredSource, ContextMenuState, GoogleStatus, SearchResult } from './types'
import styles from './App.module.css'

type Screen = 'search' | 'settings'

function openResult(item: SearchResult) {
  launchTarget(item.path)
}

const DOUBLE_ESCAPE_MS = 500

export const App: React.FC = () => {
  const [sources, setSources] = useState<ConfiguredSource[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({ connected: false, has_client_config: false })
  const [screen, setScreen] = useState<Screen>('search')
  const [focusIndexing, setFocusIndexing] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchKeyHandler = useRef<(e: React.KeyboardEvent) => void>(() => {})
  const [isOnboarding, setIsOnboarding] = useState(() => !localStorage.getItem('onboarded'))
  const [historyOpen, setHistoryOpen] = useState(false)
  const [backendDown, setBackendDown] = useState(false)
  const feedApiRef = useRef<FeedApi | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, path: '', filename: '' })
  const chats = useConversations()
  const session = useSearchSession(chats.recordSearch, () => setScreen('search'))
  const screenRef = useRef(screen)
  const cancelSearchRef = useRef(session.cancelSearch)
  const cancelVoiceRef = useRef(session.cancelVoice)
  const lastEscapeRef = useRef(0)
  useEffect(() => {
    cancelVoiceRef.current = session.cancelVoice
    screenRef.current = screen
    cancelSearchRef.current = session.cancelSearch
  })

  const reloadData = useCallback(async () => {
    try {
      const [statsData, sourcesData, gData] = await Promise.all([fetchStatus(), fetchSources(), fetchGoogleStatus()])
      setTotalItems(statsData.total || 0)
      setSources(sourcesData.sources || [])
      setGoogleStatus(gData)
      setBackendDown(false)
    } catch (err) {
      console.error('Error loading initial data:', err)
      setBackendDown(true)
    }
  }, [])

  useEffect(() => {
    reloadData()
    warmup().catch(() => {})
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('google_connected')) {
      setScreen('settings')
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [reloadData])

  useEffect(() => {
    native.resizeWindow()
    searchInputRef.current?.focus()
  }, [])

  const { status: indexStatus, refresh: refreshIndexStatus } = useIndexPolling(reloadData)

  const openSettings = (indexing = false) => {
    setFocusIndexing(indexing)
    setScreen('settings')
  }

  const selectTab = (tab: TopTab) => {
    if (tab === 'settings') setFocusIndexing(false)
    setScreen(tab === screen ? 'search' : tab)
    if (tab === 'search' || tab === screen) searchInputRef.current?.focus()
  }

  const handleTopBarQueryChange = (q: string) => {
    if (screen !== 'search') setScreen('search')
    session.setQuery(q)
  }

  native.useHotkey((voiceOn) => {
    setScreen('search')
    session.clearVoice()
    searchInputRef.current?.focus()
    const v = session.voice
    if (voiceOn && !v.listening && v.supported) v.toggle()
  })

  native.useOpenViewRequest((view) => {
    setFocusIndexing(false)
    if (view === 'settings') {
      setScreen('settings')
    } else {
      setScreen('search')
      setHistoryOpen(true)
    }
  })

  const handleTopBarKeyDown = (e: React.KeyboardEvent) => {
    if (screen === 'search') searchKeyHandler.current(e)
    else if (e.key === 'Enter') setScreen('search')
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && screenRef.current === 'search') {
        const now = performance.now()
        if (now - lastEscapeRef.current < DOUBLE_ESCAPE_MS) cancelVoiceRef.current()
        else cancelSearchRef.current()
        lastEscapeRef.current = now
        searchInputRef.current?.focus()
        return
      }
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setScreen('search')
        searchInputRef.current?.focus()
      } else if (key === ',') {
        e.preventDefault()
        setScreen((prev) => (prev === 'settings' ? 'search' : 'settings'))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, filename: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, path, filename })
  }, [])

  const registerSearchKeyHandler = useCallback((h: (e: React.KeyboardEvent) => void) => {
    searchKeyHandler.current = h
  }, [])

  const scanIndicator = <ScanIndicator status={indexStatus} onClick={() => openSettings(true)} />

  const loadingFallback = (
    <div role="status" style={{ padding: '2rem', textAlign: 'center', color: 'var(--label-2)' }}>
      Loading…
    </div>
  )

  return (
    <ErrorBoundary>
    <div className={styles.appContainer}>
      {backendDown && (
        <div
          role="alert"
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--red-tint)',
            color: 'var(--red)',
            fontSize: '0.8125rem',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span>Hyperlight’s search service isn’t responding. It may still be starting.</span>
          <button onClick={() => void reloadData()} style={{ cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )}
      <TopBar
        query={session.query}
        onQueryChange={handleTopBarQueryChange}
        onInputKeyDown={handleTopBarKeyDown}
        inputRef={searchInputRef}
        activeTab={screen}
        onSelectTab={selectTab}
        historyOpen={historyOpen}
        onToggleHistory={() => {
          if (screen !== 'search') {
            setScreen('search')
            setHistoryOpen(true)
          } else {
            setHistoryOpen((v) => !v)
          }
        }}
        accessory={scanIndicator}
        onDragStart={native.startWindowDrag}
        onActivateSearch={() => {
          setScreen('search')
          setHistoryOpen(false)
        }}
        voice={session.voice}
      />

      <div className={styles.contentRow}>
        {screen === 'search' ? (
          <>
            {historyOpen && (
              <Sidebar
                conversations={chats.conversations}
                totalItems={totalItems}
                onSelectConversation={(id) => feedApiRef.current?.scrollTo(id)}
                onDeleteConversation={chats.remove}
              />
            )}
            <SearchScreen
              query={session.query}
              voiceResult={session.voiceResult}
              voiceSearching={session.voice.searching}
              registerKeyHandler={registerSearchKeyHandler}
              onOpen={openResult}
              onReveal={revealTarget}
              onContextMenu={handleContextMenu}
              history={chats.conversations}
              feedApiRef={feedApiRef}
              feedMode={historyOpen}
            />
          </>
        ) : (
          <React.Suspense fallback={loadingFallback}>
          <SettingsPage
            totalItems={totalItems}
            sources={sources}
            googleStatus={googleStatus}
            indexStatus={indexStatus}
            focusIndexing={focusIndexing}
            onRefreshSources={reloadData}
            onStartProgress={refreshIndexStatus}
            onRevealTarget={(p) => revealTarget(p)}
          />
          </React.Suspense>
        )}
      </div>

      {isOnboarding && (
        <React.Suspense fallback={loadingFallback}>
          <OnboardingWizard
            onStartProgress={refreshIndexStatus}
            onDone={() => {
              localStorage.setItem('onboarded', '1')
              setIsOnboarding(false)
            }}
          />
        </React.Suspense>
      )}

      <ContextMenu state={contextMenu} onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))} />
    </div>
    </ErrorBoundary>
  )
}

export default App
