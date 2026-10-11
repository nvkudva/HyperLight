import React, { useState } from 'react'
import {
  browseFolder,
  clearDatabase,
  fetchNetworkVolumes,
  removeSource,
  startIndex,
} from '../../api'
import type { ConfiguredSource, GoogleStatus, IndexJobStatus } from '../../types'
import { AppIcon, CloudIcon, FolderIcon, ServerIcon } from '../common/Icons'
import { GoogleAccountCard } from '../Google/GoogleAccountCard'
import styles from './SettingsSheet.module.css'

interface SettingsSheetProps {
  isOpen: boolean
  onClose: () => void
  sources: ConfiguredSource[]
  googleStatus: GoogleStatus
  indexStatus?: IndexJobStatus | null
  onRefreshSources: () => void
  onRefreshGoogleStatus: () => void
  onStartProgress: () => void
  onRevealTarget: (path: string) => void
}

export const SettingsSheet: React.FC<SettingsSheetProps> = ({
  isOpen,
  onClose,
  sources,
  googleStatus,
  indexStatus,
  onRefreshSources,
  onRefreshGoogleStatus,
  onStartProgress,
  onRevealTarget,
}) => {
  const [manualPath, setManualPath] = useState('')
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null)

  const showToast = (msg: string, color = 'blue') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 5000)
  }

  const handleAddManual = async () => {
    if (!manualPath.trim()) {
      showToast('Please enter a valid folder path.', 'amber')
      return
    }
    showToast(`Adding '${manualPath.trim()}'...`, 'blue')
    try {
      const res = await startIndex(manualPath.trim(), 'local')
      if (res.status === 'started') {
        setManualPath('')
        showToast(`Indexing started for '${res.name}'!`, 'emerald')
        onStartProgress()
        onRefreshSources()
      } else if (res.message) {
        showToast(res.message, 'amber')
      } else if (res.error) {
        showToast(res.error, 'red')
      }
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'red')
    }
  }

  const handleBrowseFinder = async () => {
    showToast('Opening Finder folder picker...', 'blue')
    try {
      const res = await browseFolder('Select a folder to index in Smart Personal Search')
      if (res.path && !res.canceled) {
        showToast(`Selected '${res.name}'. Indexing...`, 'emerald')
        await startIndex(res.path, 'local', res.name)
        onStartProgress()
        onRefreshSources()
      } else if (res.canceled) {
        showToast('Folder selection canceled.', 'slate')
      }
    } catch (err: any) {
      showToast(`Finder error: ${err.message}`, 'red')
    }
  }

  const handleConnectVolumes = async () => {
    showToast('Scanning mounted network volumes...', 'blue')
    try {
      const res = await fetchNetworkVolumes()
      if (res.volumes && res.volumes.length > 0) {
        const v = res.volumes[0]
        showToast(`Connecting network volume '${v.name}'...`, 'emerald')
        await startIndex(v.path, 'network_volume', v.name)
        onStartProgress()
        onRefreshSources()
      } else {
        showToast('No mounted volumes in /Volumes. Select your share in Finder...', 'blue')
        await handleBrowseFinder()
      }
    } catch (err: any) {
      showToast(`Volume scan error: ${err.message}`, 'red')
    }
  }

  const handleRemoveSource = async (path: string) => {
    showToast('Removing source...', 'blue')
    try {
      await removeSource(path)
      showToast('Source removed.', 'emerald')
      onRefreshSources()
    } catch (err: any) {
      showToast(`Error removing source: ${err.message}`, 'red')
    }
  }

  const handleClearDb = async () => {
    if (!confirm('Are you sure you want to clear all indexed items?')) return
    showToast('Clearing vector database...', 'blue')
    try {
      await clearDatabase()
      showToast('Database reset.', 'slate')
      onRefreshSources()
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'red')
    }
  }

  const handleIndexApps = async () => {
    showToast('Indexing macOS applications...', 'blue')
    try {
      const res = await fetch('/api/index-apps', { method: 'POST' })
      const data = await res.json()
      showToast(`Indexed ${data.indexed_apps} macOS applications!`, 'emerald')
      onRefreshSources()
    } catch (err: any) {
      showToast(`Error indexing apps: ${err.message}`, 'red')
    }
  }

  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`${styles.modal} custom-scroll`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <div className={styles.title}>Connected Sources</div>
            <div className={styles.subtitle}>Folders, cloud accounts, and drives indexed for search.</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Manual Path Bar */}
        <div className={styles.manualPathSection}>
          <label className={styles.sectionLabel}>Add Folder / Cloud / Network Share</label>
          <div className={styles.pathRow}>
            <input
              type="text"
              className={styles.pathInput}
              placeholder="Type or paste path (e.g. ~/Documents, /Volumes/Share)..."
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddManual()}
            />
            <button className={styles.addBtn} onClick={handleAddManual}>
              Add
            </button>
          </div>
          {toast && (
            <div
              className={`${styles.toast} ${
                toast.color === 'emerald'
                  ? styles.toastEmerald
                  : toast.color === 'red'
                  ? styles.toastRed
                  : toast.color === 'amber'
                  ? styles.toastAmber
                  : toast.color === 'slate'
                  ? styles.toastSlate
                  : styles.toastBlue
              }`}
            >
              {toast.msg}
            </div>
          )}
        </div>

        {/* Google Account Card */}
        <GoogleAccountCard
          status={googleStatus}
          indexStatus={indexStatus}
          onRefreshStatus={onRefreshGoogleStatus}
          onShowToast={showToast}
          onStartProgress={onStartProgress}
        />

        {/* Quick Connect Cards */}
        <div className={styles.quickGrid}>
          <div className={styles.quickCard} onClick={handleBrowseFinder}>
            <div className={styles.iconSquircle} style={{ background: '#eff6ff', color: '#0071e3' }}>
              <FolderIcon className="w-4 h-4" />
            </div>
            <span className={styles.quickCardTitle}>Browse Finder</span>
            <span className={styles.quickCardSub}>Pick folder</span>
          </div>

          <div className={styles.quickCard} onClick={handleConnectVolumes}>
            <div className={styles.iconSquircle} style={{ background: '#f1f5f9', color: '#475569' }}>
              <ServerIcon className="w-4 h-4" />
            </div>
            <span className={styles.quickCardTitle}>Network Share</span>
            <span className={styles.quickCardSub}>/Volumes</span>
          </div>

          <div className={styles.quickCard} onClick={handleIndexApps}>
            <div className={styles.iconSquircle} style={{ background: '#eef2ff', color: '#6366f1' }}>
              <AppIcon className="w-4 h-4" />
            </div>
            <span className={styles.quickCardTitle}>macOS Apps</span>
            <span className={styles.quickCardSub}>/Applications</span>
          </div>

          <div
            className={styles.quickCard}
            onClick={() => {
              if (googleStatus.connected) {
                showToast('Google account already connected!', 'emerald')
              } else {
                showToast('Use the Google section above to sign in.', 'blue')
              }
            }}
          >
            <div className={styles.iconSquircle} style={{ background: '#f0f9ff', color: '#0284c7' }}>
              <CloudIcon className="w-4 h-4" />
            </div>
            <span className={styles.quickCardTitle}>Google Drive</span>
            <span className={styles.quickCardSub}>{googleStatus.connected ? 'Connected' : 'Sign In'}</span>
          </div>
        </div>

        {/* Presets */}
        <div className={styles.presetsRow}>
          <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
            Presets:
          </span>
          {['~/Documents', '~/Desktop', '~/Downloads', '~/Pictures'].map((p) => (
            <button
              key={p}
              className={styles.presetChip}
              onClick={() => {
                showToast(`Indexing ${p}...`, 'blue')
                startIndex(p, 'local')
                  .then(() => {
                    showToast(`Started index for ${p}`, 'emerald')
                    onStartProgress()
                    onRefreshSources()
                  })
                  .catch((err) => showToast(err.message, 'red'))
              }}
            >
              {p.replace('~/', '')}
            </button>
          ))}
        </div>

        {/* Active Sources Table */}
        <div className={styles.sectionLabel}>Active Locations</div>
        <div className={`${styles.sourcesTable} custom-scroll`}>
          {sources.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1rem', fontSize: '0.75rem', color: '#94a3b8' }}>
              No sources configured yet.
            </div>
          ) : (
            sources.map((s) => {
              const isApp = s.source_type === 'macos_system'
              return (
                <div key={s.path} className={styles.sourceRow}>
                  <div className={styles.sourceInfo}>
                    <div
                      className={styles.iconSquircle}
                      style={{
                        background: isApp ? '#eef2ff' : '#eff6ff',
                        color: isApp ? '#6366f1' : '#0071e3',
                      }}
                    >
                      {isApp ? <AppIcon className="w-3.5 h-3.5" /> : <FolderIcon className="w-3.5 h-3.5" />}
                    </div>
                    <div className={styles.sourceDetails}>
                      <div className={styles.sourceTitle}>{s.name}</div>
                      <div className={styles.sourcePath}>
                        {s.path} • {s.items_count.toLocaleString()} items
                      </div>
                    </div>
                  </div>
                  <div className={styles.sourceActions}>
                    <button
                      className={styles.sourceActionBtn}
                      onClick={() => onRevealTarget(s.path)}
                    >
                      Reveal
                    </button>
                    <button
                      className={styles.sourceActionBtn}
                      onClick={() => {
                        showToast(`Rescanning ${s.name}...`, 'blue')
                        startIndex(s.path, s.source_type, s.name)
                          .then(() => onStartProgress())
                          .catch((err) => showToast(err.message, 'red'))
                      }}
                    >
                      Rescan
                    </button>
                    <button
                      className={styles.sourceDeleteBtn}
                      onClick={() => handleRemoveSource(s.path)}
                      title="Remove source"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Reset Database */}
        <div className={styles.footer}>
          <span>Wipe search index to start fresh</span>
          <button className={styles.resetBtn} onClick={handleClearDb}>
            Reset Database
          </button>
        </div>
      </div>
    </div>
  )
}
