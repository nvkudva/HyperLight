import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchGoogleStatus,
  fetchSources,
  fetchStatus,
  launchTarget,
  revealTarget,
} from './api'
import { ContextMenu } from './components/ContextMenu/ContextMenu'
import { SearchScreen } from './components/Search/SearchScreen'
import { TopBar, type TopTab } from './components/TopBar/TopBar'
import { ScanIndicator } from './components/common/ScanIndicator'
import { useConversations } from './hooks/useConversations'
import { useIndexPolling } from './hooks/useIndexPolling'

const SettingsPage = React.lazy(() =>
  import('./components/Settings/SettingsPage').then((m) => ({ default: m.SettingsPage }))
)
const OnboardingWizard = React.lazy(() =>
  import('./components/Onboarding/OnboardingWizard').then((m) => ({ default: m.OnboardingWizard }))
)
const PhotoLightbox = React.lazy(() =>
  import('./components/Lightbox/PhotoLightbox').then((m) => ({ default: m.PhotoLightbox }))
)
import type { ConfiguredSource, ContextMenuState, GoogleStatus, SearchResult } from './types'
import styles from './App.module.css'

type Screen = 'search' | 'settings'

const UNIFIED_WINDOW_SIZE: [number, number] = [1140, 780]

async function resizeWindow() {
  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
    const [w, h] = UNIFIED_WINDOW_SIZE
    await getCurrentWindow().setSize(new LogicalSize(w, h))
  } catch {
    // Not running inside Tauri
  }
}

async function startWindowDrag(e: React.MouseEvent) {
  if (e.button !== 0) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().startDragging()
  } catch {
    // Not running inside Tauri
  }
}

function openResult(item: SearchResult) {
  launchTarget(item.path)
}

export const App: React.FC = () => {
  const [sources, setSources] = useState<ConfiguredSource[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({ connected: false, has_client_config: false })
  const [screen, setScreen] = useState<Screen>('search')
  const [query, setQuery] = useState('')
  const [audioCategories, setAudioCategories] = useState<Record<string, SearchResult[]> | null>(null)
  const [audioSearching, setAudioSearching] = useState(false)
  const [focusIndexing, setFocusIndexing] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchKeyHandler = useRef<(e: React.KeyboardEvent) => void>(() => {})
  const [isOnboarding, setIsOnboarding] = useState(() => !localStorage.getItem('onboarded'))
  const [lightboxPhoto, setLightboxPhoto] = useState<{ path: string; filename: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, path: '', filename: '' })
  const chats = useConversations()

  const reloadData = useCallback(async () => {
    try {
      const [statsData, sourcesData, gData] = await Promise.all([fetchStatus(), fetchSources(), fetchGoogleStatus()])
      setTotalItems(statsData.total || 0)
      setSources(sourcesData.sources || [])
      setGoogleStatus(gData)
    } catch (err) {
      console.error('Error loading initial data:', err)
    }
  }, [])

  useEffect(() => {
    reloadData()
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('google_connected')) {
      setScreen('settings')
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [reloadData])

  useEffect(() => {
    resizeWindow()
    searchInputRef.current?.focus()
  }, [])

  const { status: indexStatus, refresh: refreshIndexStatus } = useIndexPolling(reloadData)

  const openSettings = (indexing = false) => {
    setFocusIndexing(indexing)
    setScreen('settings')
  }

  const selectTab = (tab: TopTab) => {
    if (tab === 'settings') setFocusIndexing(false)
    setScreen(tab)
    if (tab === 'search') searchInputRef.current?.focus()
  }

  const handleTopBarQueryChange = (q: string) => {
    if (screen !== 'search') setScreen('search')
    setAudioCategories(null)
    setAudioSearching(false)
    setQuery(q)
  }

  const handleAudioSearching = () => {
    setScreen('search')
    setQuery('')
    setAudioCategories(null)
    setAudioSearching(true)
  }

  const handleAudioResults = (categories: Record<string, SearchResult[]>, transcript?: string) => {
    setScreen('search')
    setQuery('')
    setAudioCategories(categories)
    setAudioSearching(false)
    if (transcript?.trim()) chats.recordSearch(transcript)
  }

  const recordSearch = chats.recordSearch
  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const timer = window.setTimeout(() => recordSearch(q), 1000)
    return () => clearTimeout(timer)
  }, [query, recordSearch])

  const handleTopBarKeyDown = (e: React.KeyboardEvent) => {
    if (screen === 'search') searchKeyHandler.current(e)
    else if (e.key === 'Enter') setScreen('search')
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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

  const handleContextMenu = (e: React.MouseEvent, path: string, filename: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, path, filename })
  }

  const scanIndicator = <ScanIndicator status={indexStatus} onClick={() => openSettings(true)} />

  return (
    <div className={styles.appContainer}>
      <TopBar
        query={query}
        onQueryChange={handleTopBarQueryChange}
        onInputKeyDown={handleTopBarKeyDown}
        inputRef={searchInputRef}
        activeTab={screen}
        onSelectTab={selectTab}
        accessory={scanIndicator}
        onDragStart={startWindowDrag}
        onAudioResults={handleAudioResults}
        onAudioSearching={handleAudioSearching}
      />

      <div className={styles.contentRow}>
        {screen === 'search' ? (
          <SearchScreen
            query={query}
            onQueryChange={handleTopBarQueryChange}
            audioCategories={audioCategories}
            audioSearching={audioSearching}
            registerKeyHandler={(h) => {
              searchKeyHandler.current = h
            }}
            onOpen={openResult}
            onReveal={(p) => revealTarget(p)}
            onContextMenu={handleContextMenu}
          />
        ) : (
          <React.Suspense fallback={null}>
          <SettingsPage
            totalItems={totalItems}
            sources={sources}
            googleStatus={googleStatus}
            indexStatus={indexStatus}
            focusIndexing={focusIndexing}
            onRefreshSources={reloadData}
            onRefreshGoogleStatus={() => fetchGoogleStatus().then(setGoogleStatus)}
            onStartProgress={refreshIndexStatus}
            onRevealTarget={(p) => revealTarget(p)}
          />
          </React.Suspense>
        )}
      </div>

      {isOnboarding && (
        <React.Suspense fallback={null}>
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
      <React.Suspense fallback={null}>
        <PhotoLightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />
      </React.Suspense>
    </div>
  )
}

export default App
