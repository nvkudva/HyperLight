import React, { useEffect, useState } from 'react'
import {
  fetchGoogleStatus,
  fetchIndexStatus,
  fetchSources,
  fetchStatus,
  launchTarget,
  revealTarget,
  sendChat,
  stopIndex,
} from './api'
import { ChatWorkspace } from './components/Chat/ChatWorkspace'
import { ContextMenu } from './components/ContextMenu/ContextMenu'
import { OnboardingWizard } from './components/Onboarding/OnboardingWizard'
import { PhotoLightbox } from './components/Lightbox/PhotoLightbox'
import { SettingsPage } from './components/Settings/SettingsPage'
import { Sidebar } from './components/Sidebar/Sidebar'
import { ProgressBar } from './components/common/ProgressBar'
import { SpotlightHud } from './components/Spotlight/SpotlightHud'
import type {
  ChatMessage,
  ConfiguredSource,
  ContextMenuState,
  GoogleStatus,
  IndexJobStatus,
  SearchResult,
} from './types'
import styles from './App.module.css'

export const App: React.FC = () => {
  const [sources, setSources] = useState<ConfiguredSource[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({
    connected: false,
    has_client_config: false,
  })

  // Modals & Panels
  const [isSpotlightOpen, setIsSpotlightOpen] = useState(false)
  const [view, setView] = useState<'chat' | 'settings'>('chat')
  const [isOnboarding, setIsOnboarding] = useState(() => !localStorage.getItem('onboarded'))
  const [lightboxPhoto, setLightboxPhoto] = useState<{ path: string; filename: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    path: '',
    filename: '',
  })

  // Indexing progress
  const [indexStatus, setIndexStatus] = useState<IndexJobStatus | null>(null)

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isChatLoading, setIsChatLoading] = useState(false)

  // Initial Data Load
  const reloadData = async () => {
    try {
      const [statsData, sourcesData, gData] = await Promise.all([
        fetchStatus(),
        fetchSources(),
        fetchGoogleStatus(),
      ])
      setTotalItems(statsData.total || 0)
      setSources(sourcesData.sources || [])
      setGoogleStatus(gData)
    } catch (err) {
      console.error('Error loading initial data:', err)
    }
  }

  useEffect(() => {
    reloadData()

    // Handle OAuth callback query params in URL
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('google_connected')) {
      setView('settings')
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [])

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsSpotlightOpen((prev) => !prev)
      } else if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setView((prev) => (prev === 'settings' ? 'chat' : 'settings'))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Polling index job status
  useEffect(() => {
    let timer: number | null = null

    const checkJob = async () => {
      try {
        const status = await fetchIndexStatus()
        setIndexStatus(status)
        if (status.is_running) {
          timer = window.setTimeout(checkJob, 500)
        } else {
          reloadData()
          // If finished or error, auto-clear after 10s or keep until dismissed
          if (status.status && !status.status.toLowerCase().includes('error')) {
            timer = window.setTimeout(() => setIndexStatus(null), 8000)
          }
        }
      } catch (err) {
        console.error(err)
      }
    }

    if (indexStatus?.is_running) {
      timer = window.setTimeout(checkJob, 500)
    }

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [indexStatus?.is_running])

  const handleStartProgress = () => {
    setIndexStatus({
      is_running: true,
      cancel_requested: false,
      current_folder: 'Scanning...',
      current_path: '',
      current_source: '',
      current_file: '',
      current_index: 0,
      total_files: 0,
      percent: 0,
      indexed_items: 0,
      status: 'Starting index...',
      state: 'running',
      error_code: '',
      is_cloud: false,
      queued: [],
    })
  }

  const handleSendMessage = async (text: string) => {
    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
    setIsChatLoading(true)

    try {
      const res = await sendChat(text)
      const assistantMsg: ChatMessage = {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        text: res.answer,
        photos: res.photos || [],
        sources: res.sources || [],
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        sender: 'assistant',
        text: `Error: ${err.message}`,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setIsChatLoading(false)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, path: string, filename: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      path,
      filename,
    })
  }

  const handleDragMouseDown = async (e: React.MouseEvent) => {
    // Only primary mouse button and not on controls
    if (e.button !== 0) return
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      await win.startDragging()
    } catch {
      // Ignore if not in Tauri webview
    }
  }

  return (
    <div className={styles.appContainer}>
      {/* Unified Apple Glass Header Drag Region */}
      <div
        className={styles.unifiedHeaderDragStrip}
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
      />

      {/* Background Indexing Banner */}
      {indexStatus && indexStatus.is_running && (
        <div className={styles.progressBanner}>
          <ProgressBar status={indexStatus.status} percent={indexStatus.percent}>
            <button className={styles.stopButton} onClick={() => stopIndex()}>
              Stop
            </button>
          </ProgressBar>
        </div>
      )}

      {/* Main Workspace */}
      <Sidebar
        sources={sources}
        totalItems={totalItems}
        onOpenSpotlight={() => setIsSpotlightOpen(true)}
        activeView={view}
        onOpenSettings={() => setView('settings')}
        onNewChat={() => (view === 'settings' ? setView('chat') : setMessages([]))}
        onContextMenu={handleContextMenu}
      />

      {view === 'settings' ? (
        <SettingsPage
          onBack={() => setView('chat')}
          totalItems={totalItems}
          sources={sources}
          googleStatus={googleStatus}
          indexStatus={indexStatus}
          onRefreshSources={reloadData}
          onRefreshGoogleStatus={() => fetchGoogleStatus().then(setGoogleStatus)}
          onStartProgress={handleStartProgress}
          onRevealTarget={(p) => revealTarget(p)}
        />
      ) : (
        <ChatWorkspace
          messages={messages}
          isLoading={isChatLoading}
          onSendMessage={handleSendMessage}
          onOpenPhoto={(path, filename) => setLightboxPhoto({ path, filename })}
          onContextMenu={handleContextMenu}
          onRevealTarget={(p) => revealTarget(p)}
          onLaunchTarget={(p) => launchTarget(p)}
        />
      )}

      {/* Modals & Overlays */}
      <SpotlightHud
        isOpen={isSpotlightOpen}
        onClose={() => setIsSpotlightOpen(false)}
        onSelectResult={(item: SearchResult) => {
          const kind = item.type ?? item.file_type
          if (kind === 'app' || kind === 'email' || item.path.startsWith('http')) {
            launchTarget(item.path)
          } else {
            revealTarget(item.path)
          }
          setIsSpotlightOpen(false)
        }}
        onContextMenu={handleContextMenu}
      />


      {isOnboarding && (
        <OnboardingWizard
          onStartProgress={handleStartProgress}
          onDone={() => {
            localStorage.setItem('onboarded', '1')
            setIsOnboarding(false)
          }}
        />
      )}

      <ContextMenu state={contextMenu} onClose={() => setContextMenu((prev) => ({ ...prev, visible: false }))} />

      <PhotoLightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />
    </div>
  )
}

export default App
