import React, { useCallback, useEffect, useState } from 'react'
import {
  fetchGoogleStatus,
  fetchIndexStatus,
  fetchSources,
  fetchStatus,
  launchTarget,
  revealTarget,
  sendChat,
} from './api'
import { ChatWorkspace } from './components/Chat/ChatWorkspace'
import { ContextMenu } from './components/ContextMenu/ContextMenu'
import { OnboardingWizard } from './components/Onboarding/OnboardingWizard'
import { PhotoLightbox } from './components/Lightbox/PhotoLightbox'
import { SearchScreen } from './components/Search/SearchScreen'
import { SettingsPage } from './components/Settings/SettingsPage'
import { Sidebar } from './components/Sidebar/Sidebar'
import { ScanIndicator } from './components/common/ScanIndicator'
import { useConversations } from './hooks/useConversations'
import type { ChatMessage, ConfiguredSource, ContextMenuState, GoogleStatus, IndexJobStatus, SearchResult } from './types'
import styles from './App.module.css'

type Screen = 'search' | 'chat' | 'settings'

const WINDOW_SIZES: Record<'search' | 'full', [number, number]> = {
  search: [780, 520],
  full: [1140, 780],
}

async function resizeWindow(kind: 'search' | 'full') {
  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
    const [w, h] = WINDOW_SIZES[kind]
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
  const [focusIndexing, setFocusIndexing] = useState(false)
  const [isOnboarding, setIsOnboarding] = useState(() => !localStorage.getItem('onboarded'))
  const [lightboxPhoto, setLightboxPhoto] = useState<{ path: string; filename: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, path: '', filename: '' })
  const [indexStatus, setIndexStatus] = useState<IndexJobStatus | null>(null)
  const [isChatLoading, setIsChatLoading] = useState(false)
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
    resizeWindow(screen === 'search' ? 'search' : 'full')
  }, [screen])

  useEffect(() => {
    let timer: number
    let wasRunning = false
    const poll = async () => {
      try {
        const status = await fetchIndexStatus()
        setIndexStatus(status)
        if (wasRunning && !status.is_running) reloadData()
        wasRunning = status.is_running
      } catch {
        // Backend not reachable yet
      }
      timer = window.setTimeout(poll, wasRunning ? 1000 : 3000)
    }
    poll()
    return () => clearTimeout(timer)
  }, [reloadData])

  const openSettings = (indexing = false) => {
    setFocusIndexing(indexing)
    setScreen('settings')
  }

  const startNewChat = () => {
    chats.select(null)
    setScreen('chat')
  }

  const handleSendMessage = async (text: string, conversationId?: string) => {
    const id = conversationId ?? chats.activeId ?? chats.create(text)
    chats.append(id, { id: `user_${Date.now()}`, sender: 'user', text, timestamp: Date.now() })
    setIsChatLoading(true)
    let reply: ChatMessage
    try {
      const res = await sendChat(text)
      reply = {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        text: res.answer,
        photos: res.photos || [],
        sources: res.sources || [],
        timestamp: Date.now(),
      }
    } catch (err: any) {
      reply = { id: `err_${Date.now()}`, sender: 'assistant', text: `Error: ${err.message}`, timestamp: Date.now() }
    }
    chats.append(id, reply)
    setIsChatLoading(false)
  }

  const askInChat = (query: string) => {
    setScreen('chat')
    if (query) handleSendMessage(query, chats.create(query))
    else chats.select(null)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setScreen('search')
      } else if (key === ',') {
        e.preventDefault()
        setScreen((prev) => (prev === 'settings' ? 'chat' : 'settings'))
      } else if (key === 'n') {
        e.preventDefault()
        chats.select(null)
        setScreen('chat')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chats.select])

  const handleContextMenu = (e: React.MouseEvent, path: string, filename: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ visible: true, x: e.clientX, y: e.clientY, path, filename })
  }

  const scanIndicator = <ScanIndicator status={indexStatus} onClick={() => openSettings(true)} />

  return (
    <div className={styles.appContainer}>
      {screen === 'search' ? (
        <SearchScreen
          accessory={scanIndicator}
          onOpen={openResult}
          onReveal={(p) => revealTarget(p)}
          onAskChat={askInChat}
          onOpenSettings={() => openSettings()}
          onContextMenu={handleContextMenu}
          onDragStart={startWindowDrag}
        />
      ) : (
        <>
          <div className={styles.unifiedHeaderDragStrip} data-tauri-drag-region onMouseDown={startWindowDrag} />
          <div className={styles.scanSlot}>{scanIndicator}</div>

          <Sidebar
            conversations={chats.conversations}
            activeId={chats.activeId}
            activeView={screen === 'settings' ? 'settings' : 'chat'}
            totalItems={totalItems}
            onNewChat={startNewChat}
            onSelectConversation={(id) => {
              chats.select(id)
              setScreen('chat')
            }}
            onDeleteConversation={chats.remove}
            onOpenSearch={() => setScreen('search')}
            onOpenSettings={() => openSettings()}
          />

          {screen === 'settings' ? (
            <SettingsPage
              onBack={() => setScreen('chat')}
              totalItems={totalItems}
              sources={sources}
              googleStatus={googleStatus}
              indexStatus={indexStatus}
              focusIndexing={focusIndexing}
              onRefreshSources={reloadData}
              onRefreshGoogleStatus={() => fetchGoogleStatus().then(setGoogleStatus)}
              onStartProgress={() => fetchIndexStatus().then(setIndexStatus)}
              onRevealTarget={(p) => revealTarget(p)}
            />
          ) : (
            <ChatWorkspace
              messages={chats.active?.messages ?? []}
              isLoading={isChatLoading}
              onSendMessage={(text) => handleSendMessage(text)}
              onOpenPhoto={(path, filename) => setLightboxPhoto({ path, filename })}
              onContextMenu={handleContextMenu}
              onRevealTarget={(p) => revealTarget(p)}
              onLaunchTarget={(p) => launchTarget(p)}
              onOpenResult={openResult}
            />
          )}
        </>
      )}

      {isOnboarding && (
        <OnboardingWizard
          onStartProgress={() => fetchIndexStatus().then(setIndexStatus)}
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
