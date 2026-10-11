import React from 'react'
import type { ConfiguredSource } from '../../types'
import { AppIcon, FolderIcon, SearchIcon, SettingsIcon } from '../common/Icons'
import styles from './Sidebar.module.css'

interface SidebarProps {
  sources: ConfiguredSource[]
  totalItems: number
  activeView: 'chat' | 'settings'
  onOpenSpotlight: () => void
  onOpenSettings: () => void
  onNewChat: () => void
  onContextMenu: (e: React.MouseEvent, path: string, filename: string) => void
}

export const Sidebar: React.FC<SidebarProps> = ({
  sources,
  totalItems,
  activeView,
  onOpenSpotlight,
  onOpenSettings,
  onNewChat,
  onContextMenu,
}) => {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.topSection}>
        <div className={styles.brandRow}>
          <div className={styles.brandIcon}>
            <SearchIcon className="w-4 h-4" />
          </div>
          <div>
            <div className={styles.brandTitle}>Smart Search</div>
            <div className={styles.brandSubtitle}>Apple Silicon Personal Index</div>
          </div>
        </div>

        <div className={styles.navGroup}>
          <button
            className={`${styles.navButton} ${activeView === 'chat' ? styles.navButtonActive : ''}`}
            onClick={onNewChat}
            aria-current={activeView === 'chat' ? 'page' : undefined}
          >
            <span>Chat Search</span>
            <span className={styles.shortcutPill}>New</span>
          </button>
          <button className={styles.navButton} onClick={onOpenSpotlight}>
            <span>Spotlight HUD</span>
            <span className={styles.shortcutPill}>⌘K</span>
          </button>
          <button
            className={`${styles.navButton} ${activeView === 'settings' ? styles.navButtonActive : ''}`}
            onClick={onOpenSettings}
            aria-current={activeView === 'settings' ? 'page' : undefined}
          >
            <span>Settings</span>
            <span className={styles.shortcutPill}>⌘,</span>
          </button>
        </div>

        <div className={styles.sectionHeader}>Indexed Locations</div>
        <div className={`${styles.sourcesList} custom-scroll`}>
          {sources.length === 0 ? (
            <div style={{ padding: '0.5rem', fontSize: '0.6875rem', color: 'var(--label-3)' }}>
              No sources added.
            </div>
          ) : (
            sources.map((s) => {
              const isApp = s.source_type === 'macos_system'
              return (
                <div
                  key={s.path}
                  className={styles.sourceItem}
                  onContextMenu={(e) => onContextMenu(e, s.path, s.name)}
                >
                  <div className={styles.sourceLeft}>
                    {isApp ? (
                      <AppIcon className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    ) : (
                      <FolderIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    )}
                    <span className={styles.sourceName}>{s.name}</span>
                  </div>
                  <span className={styles.sourceCount}>{s.items_count.toLocaleString()}</span>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className={styles.footerSection}>
        <span className={styles.statsText}>{totalItems.toLocaleString()} items indexed</span>
        <button
          className={styles.settingsTrigger}
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>
    </aside>
  )
}
