import React, { useState } from 'react'
import type { Conversation } from '../../types'
import { SearchIcon, SettingsIcon } from '../common/Icons'
import styles from './Sidebar.module.css'

interface SidebarProps {
  conversations: Conversation[]
  activeId: string | null
  activeView: 'chat' | 'settings'
  totalItems: number
  onNewChat: () => void
  onSelectConversation: (id: string) => void
  onDeleteConversation: (id: string) => void
  onOpenSearch: () => void
  onOpenSettings: () => void
}

const DAY = 24 * 60 * 60 * 1000
const MIN_WIDTH = 200
const MAX_WIDTH = 420
const DEFAULT_WIDTH = 240

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w))

function groupLabel(ts: number): string {
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  if (ts >= startOfToday) return 'Today'
  if (ts >= startOfToday - DAY) return 'Yesterday'
  if (ts >= startOfToday - 7 * DAY) return 'Previous 7 days'
  return 'Older'
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeId,
  activeView,
  totalItems,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onOpenSearch,
  onOpenSettings,
}) => {
  const [width, setWidth] = useState(() => clampWidth(Number(localStorage.getItem('sidebarWidth')) || DEFAULT_WIDTH))

  const commitWidth = (w: number) => {
    const next = clampWidth(w)
    setWidth(next)
    localStorage.setItem('sidebarWidth', String(next))
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => setWidth(clampWidth(startWidth + ev.clientX - startX))
    const onUp = (ev: PointerEvent) => {
      commitWidth(startWidth + ev.clientX - startX)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  const handleResizeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') commitWidth(width - 16)
    else if (e.key === 'ArrowRight') commitWidth(width + 16)
  }

  const groups: Array<[string, Conversation[]]> = []
  for (const conv of conversations) {
    const label = groupLabel(conv.updatedAt)
    const last = groups[groups.length - 1]
    if (last && last[0] === label) last[1].push(conv)
    else groups.push([label, [conv]])
  }

  return (\n    <aside className={styles.sidebar} style={{ width }}>
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={handleResizeKey}
        onDoubleClick={() => commitWidth(DEFAULT_WIDTH)}
      />
      <div className={styles.topSection}>
        <div className={styles.brandHeader}>
          <img src="/hyperlight-icon.png" alt="Hyperlight" className={styles.brandIcon} />
          <div className={styles.brandInfo}>
            <span className={styles.brandTitle}>Hyperlight</span>
            <span className={styles.brandSubtitle}>Personal AI</span>
          </div>
        </div>

        <div className={styles.navGroup}>
          <button className={styles.navButton} onClick={onNewChat}>
            <span>New chat</span>
            <span className={styles.shortcutPill}>⌘N</span>
          </button>
          <button className={styles.navButton} onClick={onOpenSearch}>
            <span className={styles.navLabel}>
              <SearchIcon className={styles.navIcon} />
              Search
            </span>
            <span className={styles.shortcutPill}>⌘K</span>
          </button>
        </div>

        <nav className={`${styles.history} custom-scroll`} aria-label="Chat history">
          {conversations.length === 0 ? (
            <div className={styles.emptyHint}>Your conversations will appear here.</div>
          ) : (
            groups.map(([label, convs]) => (
              <div key={label} className={styles.historyGroup}>
                <div className={styles.sectionHeader}>{label}</div>
                {convs.map((c) => {
                  const isActive = activeView === 'chat' && c.id === activeId
                  return (
                    <div key={c.id} className={`${styles.historyItem} ${isActive ? styles.historyItemActive : ''}`}>
                      <button
                        className={styles.historyTitle}
                        onClick={() => onSelectConversation(c.id)}
                        aria-current={isActive ? 'page' : undefined}
                        title={c.title}
                      >
                        {c.title}
                      </button>
                      <button
                        className={styles.deleteButton}
                        onClick={() => onDeleteConversation(c.id)}
                        aria-label={`Delete “${c.title}”`}
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </nav>
      </div>

      <div className={styles.footerSection}>
        <span className={styles.statsText}>{totalItems.toLocaleString()} items indexed</span>
        <button
          className={`${styles.settingsTrigger} ${activeView === 'settings' ? styles.settingsActive : ''}`}
          onClick={onOpenSettings}
          title="Settings (⌘,)"
          aria-label="Settings"
          aria-current={activeView === 'settings' ? 'page' : undefined}
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>
    </aside>
  )
}
