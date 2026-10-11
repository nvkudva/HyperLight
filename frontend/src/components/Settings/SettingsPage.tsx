import React, { useEffect, useRef, useState } from 'react'
import {
  browseFolder,
  clearDatabase,
  fetchNetworkVolumes,
  removeSource,
  indexApps,
  startIndex,
} from '../../api'
import type { ConfiguredSource, GoogleStatus, IndexJobStatus } from '../../types'
import { AppIcon, FolderIcon, ServerIcon } from '../common/Icons'
import { GoogleAccountCard } from '../Google/GoogleAccountCard'
import styles from './SettingsPage.module.css'

const PRESETS = ['~/Documents', '~/Desktop', '~/Downloads', '~/Pictures']

const STATUS_CLASS: Record<string, string> = {
  blue: styles.statusInfo,
  emerald: styles.statusSuccess,
  red: styles.statusError,
  amber: styles.statusWarning,
  slate: styles.statusNeutral,
}

interface SettingsPageProps {
  onBack: () => void
  totalItems: number
  sources: ConfiguredSource[]
  googleStatus: GoogleStatus
  indexStatus?: IndexJobStatus | null
  onRefreshSources: () => void
  onRefreshGoogleStatus: () => void
  onStartProgress: () => void
  onRevealTarget: (path: string) => void
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  onBack,
  totalItems,
  sources,
  googleStatus,
  indexStatus,
  onRefreshSources,
  onRefreshGoogleStatus,
  onStartProgress,
  onRevealTarget,
}) => {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [manualPath, setManualPath] = useState('')
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const showToast = (msg: string, color = 'blue') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 5000)
  }

  const handleAddManual = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!manualPath.trim()) {
      showToast('Please enter a valid folder path.', 'amber')
      return
    }
    showToast(`Adding '${manualPath.trim()}'...`, 'blue')
    try {
      const res = await startIndex(manualPath.trim(), 'local')
      if (res.error) {
        showToast(res.error, 'red')
        return
      }
      setManualPath('')
      showToast(res.status === 'queued' ? `Queued '${res.name}'.` : `Indexing started for '${res.name}'!`, 'emerald')
      onStartProgress()
      onRefreshSources()
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
      const data = await indexApps()
      showToast(`Indexed ${data.indexed_apps} macOS applications!`, 'emerald')
      onRefreshSources()
    } catch (err: any) {
      showToast(`Error indexing apps: ${err.message}`, 'red')
    }
  }

  const handleIndexPreset = (p: string) => {
    showToast(`Indexing ${p}...`, 'blue')
    startIndex(p, 'local')
      .then(() => {
        showToast(`Started index for ${p}`, 'emerald')
        onStartProgress()
        onRefreshSources()
      })
      .catch((err) => showToast(err.message, 'red'))
  }

  const handleRescan = (s: ConfiguredSource) => {
    showToast(`Rescanning ${s.name}...`, 'blue')
    startIndex(s.path, s.source_type, s.name)
      .then(() => onStartProgress())
      .catch((err) => showToast(err.message, 'red'))
  }

  return (
    <main className={`${styles.page} custom-scroll`}>
      <div className={styles.content}>
        <header className={styles.pageHeader}>
          <button className={styles.backButton} onClick={onBack} aria-label="Back to chat" title="Back to chat">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
            Settings
          </h1>
        </header>

        {toast && (
          <div role="status" className={`${styles.status} ${STATUS_CLASS[toast.color] ?? styles.statusInfo}`}>
            {toast.msg}
          </div>
        )}

        <section className={styles.section} aria-labelledby="settings-add">
          <h2 id="settings-add" className={styles.sectionHeader}>
            Add a location
          </h2>
          <div className={styles.group}>
            <div className={styles.row}>
              <form className={styles.pathForm} onSubmit={handleAddManual}>
                <input
                  type="text"
                  className={styles.input}
                  aria-label="Folder or network share path"
                  placeholder="~/Documents or /Volumes/Share"
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                />
                <button type="submit" className={`${styles.button} ${styles.primary}`}>
                  Add
                </button>
              </form>
            </div>
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <span className={`${styles.icon} ${styles.iconAccent}`}>
                  <FolderIcon className="w-3.5 h-3.5" />
                </span>
                <span className={styles.rowTitle}>Folder in Finder</span>
              </div>
              <button className={styles.button} onClick={handleBrowseFinder}>
                Choose…
              </button>
            </div>
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <span className={`${styles.icon} ${styles.iconNeutral}`}>
                  <ServerIcon className="w-3.5 h-3.5" />
                </span>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>Network share</span>
                  <span className={styles.rowSubtitle}>/Volumes</span>
                </div>
              </div>
              <button className={styles.button} onClick={handleConnectVolumes}>
                Connect…
              </button>
            </div>
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <span className={`${styles.icon} ${styles.iconIndigo}`}>
                  <AppIcon className="w-3.5 h-3.5" />
                </span>
                <div className={styles.rowText}>
                  <span className={styles.rowTitle}>macOS apps</span>
                  <span className={styles.rowSubtitle}>/Applications</span>
                </div>
              </div>
              <button className={styles.button} onClick={handleIndexApps}>
                Index
              </button>
            </div>
            <div className={styles.row}>
              <span className={styles.rowTitle}>Quick add</span>
              <div className={styles.chips}>
                {PRESETS.map((p) => (
                  <button key={p} className={styles.button} onClick={() => handleIndexPreset(p)}>
                    {p.replace('~/', '')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="settings-sources">
          <h2 id="settings-sources" className={styles.sectionHeader}>
            Indexed locations
          </h2>
          <ul className={styles.group}>
            {sources.length === 0 ? (
              <li className={`${styles.row} ${styles.empty}`}>No sources configured yet.</li>
            ) : (
              sources.map((s) => {
                const isApp = s.source_type === 'macos_system'
                return (
                  <li key={s.path} className={styles.row}>
                    <div className={styles.rowLabel}>
                      <span className={`${styles.icon} ${isApp ? styles.iconIndigo : styles.iconAccent}`}>
                        {isApp ? <AppIcon className="w-3.5 h-3.5" /> : <FolderIcon className="w-3.5 h-3.5" />}
                      </span>
                      <div className={styles.rowText}>
                        <span className={styles.rowTitle}>{s.name}</span>
                        <span className={styles.rowSubtitle} title={s.path}>
                          {s.path} • {s.items_count.toLocaleString()} items
                        </span>
                      </div>
                    </div>
                    <div className={styles.rowControls}>
                      <button className={styles.button} onClick={() => onRevealTarget(s.path)}>
                        Reveal
                      </button>
                      <button className={styles.button} onClick={() => handleRescan(s)}>
                        Rescan
                      </button>
                      <button
                        className={`${styles.button} ${styles.destructive}`}
                        onClick={() => handleRemoveSource(s.path)}
                        aria-label={`Remove ${s.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })
            )}
          </ul>
        </section>

        <GoogleAccountCard
          status={googleStatus}
          indexStatus={indexStatus}
          onRefreshStatus={onRefreshGoogleStatus}
          onShowToast={showToast}
          onStartProgress={onStartProgress}
        />

        <section className={styles.section} aria-labelledby="settings-index">
          <h2 id="settings-index" className={styles.sectionHeader}>
            Index
          </h2>
          <div className={styles.group}>
            <div className={styles.row}>
              <span className={styles.rowTitle}>Items indexed</span>
              <span className={styles.value}>{totalItems.toLocaleString()}</span>
            </div>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowTitle}>Reset database</span>
                <span className={styles.rowSubtitle}>Wipe the search index to start fresh.</span>
              </div>
              <button className={`${styles.button} ${styles.destructive}`} onClick={handleClearDb}>
                Reset…
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
