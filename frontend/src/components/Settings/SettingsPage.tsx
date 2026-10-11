import React, { useEffect, useRef, useState } from 'react'
import {
  browseFolder,
  clearDatabase,
  fetchAppSettings,
  fetchNetworkVolumes,
  indexApps,
  removeSource,
  startIndex,
  stopIndex,
  toggleSourceWatch,
  updateAppSettings,
} from '../../api'
import type { AppSettings, ConfiguredSource, GoogleStatus, IndexJobStatus } from '../../types'
import {
  AppIcon,
  CloudIcon,
  DatabaseIcon,
  FolderIcon,
  ServerIcon,
  ZapIcon,
} from '../common/Icons'
import { GoogleAccountCard } from '../Google/GoogleAccountCard'
import { ProgressBar } from '../common/ProgressBar'
import styles from './SettingsPage.module.css'

const PRESETS = ['~/Documents', '~/Desktop', '~/Downloads', '~/Pictures']

const STATUS_CLASS: Record<string, string> = {
  blue: styles.statusInfo,
  emerald: styles.statusSuccess,
  red: styles.statusError,
  amber: styles.statusWarning,
  slate: styles.statusNeutral,
}

type SettingsTab = 'sources' | 'scanning' | 'cloud' | 'maintenance'

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
  focusIndexing?: boolean
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
  focusIndexing,
}) => {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>(focusIndexing ? 'scanning' : 'sources')
  const [manualPath, setManualPath] = useState('')
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null)
  const [appSettings, setAppSettings] = useState<AppSettings>({
    always_on_scanning: true,
    watched_paths_count: 0,
  })

  // Load app settings
  useEffect(() => {
    fetchAppSettings()
      .then(setAppSettings)
      .catch((err) => console.error('Failed to load app settings:', err))
  }, [])

  useEffect(() => {
    if (focusIndexing) {
      setActiveTab('scanning')
    } else {
      titleRef.current?.focus()
    }
  }, [focusIndexing])

  const showToast = (msg: string, color = 'blue') => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 5000)
  }

  const handleToggleAlwaysOn = async () => {
    const nextVal = !appSettings.always_on_scanning
    setAppSettings((prev) => ({ ...prev, always_on_scanning: nextVal }))
    try {
      const updated = await updateAppSettings({ always_on_scanning: nextVal })
      setAppSettings(updated)
      showToast(
        nextVal
          ? 'Always-on real-time scanning enabled.'
          : 'Always-on scanning paused. Folder changes will not auto-index.',
        nextVal ? 'emerald' : 'slate'
      )
    } catch (err: any) {
      setAppSettings((prev) => ({ ...prev, always_on_scanning: !nextVal }))
      showToast(`Failed to update setting: ${err.message}`, 'red')
    }
  }

  const handleToggleSourceWatch = async (s: ConfiguredSource) => {
    const nextVal = s.watch_enabled === false
    showToast(
      nextVal ? `Enabled live sync for ${s.name}` : `Paused live sync for ${s.name}`,
      nextVal ? 'emerald' : 'slate'
    )
    try {
      await toggleSourceWatch(s.path, nextVal)
      onRefreshSources()
      fetchAppSettings().then(setAppSettings).catch(() => {})
    } catch (err: any) {
      showToast(`Error updating source: ${err.message}`, 'red')
    }
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
    if (!confirm('Are you sure you want to clear all indexed items? This will reset your database.')) return
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

  const localSources = sources.filter((s) => s.source_type !== 'macos_system')
  const isGlobalAlwaysOn = appSettings.always_on_scanning

  return (
    <main className={`${styles.page} custom-scroll`}>
      <div className={styles.content}>
        {/* Header */}
        <header className={styles.pageHeader}>
          <div className={styles.headerLeft}>
            <button className={styles.backButton} onClick={onBack} aria-label="Back" title="Back">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
              Settings
            </h1>
          </div>
          <div className={styles.headerMeta}>
            <span>{totalItems.toLocaleString()} items</span>
            {isGlobalAlwaysOn && <span className={styles.tabDot} title="Live Real-Time Watching Active" />}
          </div>
        </header>

        {/* Apple Segmented Navigation */}
        <nav className={styles.tabBar} aria-label="Settings categories">
          <button
            className={`${styles.tabButton} ${activeTab === 'sources' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('sources')}
          >
            <span className={styles.tabIcon}>
              <FolderIcon className="w-3.5 h-3.5" />
            </span>
            <span>Sources</span>
          </button>
          <button
            className={`${styles.tabButton} ${activeTab === 'scanning' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('scanning')}
          >
            <span className={styles.tabIcon}>
              <ZapIcon className="w-3.5 h-3.5" />
            </span>
            <span>Real-Time Scanning</span>
            {indexStatus?.is_running && <span className={styles.tabDot} />}
          </button>
          <button
            className={`${styles.tabButton} ${activeTab === 'cloud' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('cloud')}
          >
            <span className={styles.tabIcon}>
              <CloudIcon className="w-3.5 h-3.5" />
            </span>
            <span>Cloud & Accounts</span>
          </button>
          <button
            className={`${styles.tabButton} ${activeTab === 'maintenance' ? styles.tabButtonActive : ''}`}
            onClick={() => setActiveTab('maintenance')}
          >
            <span className={styles.tabIcon}>
              <DatabaseIcon className="w-3.5 h-3.5" />
            </span>
            <span>Maintenance</span>
          </button>
        </nav>

        {toast && (
          <div role="status" className={`${styles.status} ${STATUS_CLASS[toast.color] ?? styles.statusInfo}`}>
            {toast.msg}
          </div>
        )}

        {/* TAB 1: SOURCES & FOLDERS */}
        {activeTab === 'sources' && (
          <div className={styles.panel}>
            {/* Add Location Card */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderCol}>
                  <h2 className={styles.cardTitle}>Add Location</h2>
                  <p className={styles.cardSubtitle}>Choose folders or external drives to include in personal search.</p>
                </div>
              </div>

              {/* Quick Actions */}
              <div className={styles.quickActionGrid}>
                <button className={styles.quickActionCard} onClick={handleBrowseFinder}>
                  <span className={`${styles.quickActionIcon} ${styles.iconAccent}`}>
                    <FolderIcon className="w-4 h-4" />
                  </span>
                  <span>Choose Folder…</span>
                </button>
                <button className={styles.quickActionCard} onClick={handleConnectVolumes}>
                  <span className={`${styles.quickActionIcon} ${styles.iconNeutral}`}>
                    <ServerIcon className="w-4 h-4" />
                  </span>
                  <span>Network Share</span>
                </button>
                <button className={styles.quickActionCard} onClick={handleIndexApps}>
                  <span className={`${styles.quickActionIcon} ${styles.iconIndigo}`}>
                    <AppIcon className="w-4 h-4" />
                  </span>
                  <span>macOS Apps</span>
                </button>
              </div>

              {/* Manual Input */}
              <form className={styles.pathForm} onSubmit={handleAddManual}>
                <input
                  type="text"
                  className={styles.input}
                  aria-label="Folder path"
                  placeholder="Enter path manually (~/Documents, /Volumes/Share...)"
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                />
                <button type="submit" className={`${styles.button} ${styles.primary}`}>
                  Add
                </button>
              </form>

              {/* Presets */}
              <div className={styles.chipRow}>
                <span style={{ fontSize: '0.75rem', color: 'var(--label-2)' }}>Quick add:</span>
                {PRESETS.map((p) => (
                  <button key={p} className={styles.chip} onClick={() => handleIndexPreset(p)}>
                    {p.replace('~/', '')}
                  </button>
                ))}
              </div>
            </div>

            {/* Indexed Locations */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderCol}>
                  <h2 className={styles.cardTitle}>Indexed Locations</h2>
                  <p className={styles.cardSubtitle}>
                    {sources.length} active {sources.length === 1 ? 'source' : 'sources'} configured.
                  </p>
                </div>
              </div>

              {sources.length === 0 ? (
                <div className={styles.emptyState}>No locations added yet. Choose a folder above to start indexing.</div>
              ) : (
                <ul className={styles.sourceList}>
                  {sources.map((s) => {
                    const isApp = s.source_type === 'macos_system'
                    const isWatchable = !isApp && !s.path.startsWith('http')
                    const isWatchOn = s.watch_enabled !== false

                    return (
                      <li key={s.path} className={styles.sourceCard}>
                        <div className={styles.sourceInfo}>
                          <span className={`${styles.icon} ${isApp ? styles.iconIndigo : styles.iconAccent}`}>
                            {isApp ? <AppIcon className="w-4 h-4" /> : <FolderIcon className="w-4 h-4" />}
                          </span>
                          <div className={styles.sourceDetails}>
                            <div className={styles.sourceNameRow}>
                              <span className={styles.sourceName}>{s.name}</span>
                              <span className={`${styles.badge} ${styles.badgeNeutral}`}>
                                {s.items_count.toLocaleString()} items
                              </span>
                              {isGlobalAlwaysOn && isWatchable && (
                                <span
                                  className={`${styles.badge} ${isWatchOn ? styles.badgeSuccess : styles.badgeNeutral}`}
                                >
                                  {isWatchOn ? '● Live' : 'Manual'}
                                </span>
                              )}
                            </div>
                            <span className={styles.sourcePath} title={s.path}>
                              {s.path}
                            </span>
                          </div>
                        </div>

                        <div className={styles.sourceControls}>
                          {/* If Always-on is globally active, show per-source live toggle */}
                          {isGlobalAlwaysOn && isWatchable && (
                            <label className={styles.switch} title={`Toggle continuous live sync for ${s.name}`}>
                              <input
                                type="checkbox"
                                checked={isWatchOn}
                                onChange={() => handleToggleSourceWatch(s)}
                              />
                              <span className={styles.slider} />
                            </label>
                          )}

                          <button className={styles.button} onClick={() => onRevealTarget(s.path)} title="Reveal in Finder">
                            Reveal
                          </button>
                          <button className={styles.button} onClick={() => handleRescan(s)} title="Re-index this folder">
                            Rescan
                          </button>
                          <button
                            className={`${styles.button} ${styles.destructive}`}
                            onClick={() => handleRemoveSource(s.path)}
                            title="Remove from index"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: REAL-TIME SCANNING */}
        {activeTab === 'scanning' && (
          <div className={styles.panel}>
            {/* Master Switch Card */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderCol}>
                  <div className={styles.sourceNameRow}>
                    <h2 className={styles.cardTitle}>Always-On Scanning</h2>
                    <span
                      className={`${styles.badge} ${isGlobalAlwaysOn ? styles.badgeSuccess : styles.badgeNeutral}`}
                    >
                      {isGlobalAlwaysOn
                        ? `● Active (${appSettings.watched_paths_count ?? localSources.length} watching)`
                        : 'Paused'}
                    </span>
                  </div>
                  <p className={styles.cardSubtitle}>
                    Uses macOS kernel FSEvents to automatically detect and index newly added, modified, or deleted files
                    in real-time without requiring manual rescans.
                  </p>
                </div>
                <label className={styles.switch} title="Toggle master always-on scanning">
                  <input
                    type="checkbox"
                    checked={isGlobalAlwaysOn}
                    onChange={handleToggleAlwaysOn}
                  />
                  <span className={styles.slider} />
                </label>
              </div>
            </div>

            {/* Per-Source Settings (shown only when Always-On is enabled) */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderCol}>
                  <h2 className={styles.cardTitle}>Source Watch Rules</h2>
                  <p className={styles.cardSubtitle}>
                    {isGlobalAlwaysOn
                      ? 'Enable or disable continuous real-time watching for each individual location:'
                      : 'Always-on scanning is currently paused. Enable the master toggle above to manage per-source rules.'}
                  </p>
                </div>
              </div>

              {isGlobalAlwaysOn ? (
                localSources.length === 0 ? (
                  <div className={styles.emptyState}>No local folders configured to watch.</div>
                ) : (
                  <ul className={styles.sourceList}>
                    {localSources.map((s) => {
                      const isWatchOn = s.watch_enabled !== false
                      return (
                        <li key={s.path} className={styles.sourceCard}>
                          <div className={styles.sourceInfo}>
                            <span className={`${styles.icon} ${isWatchOn ? styles.iconGreen : styles.iconNeutral}`}>
                              <FolderIcon className="w-4 h-4" />
                            </span>
                            <div className={styles.sourceDetails}>
                              <div className={styles.sourceNameRow}>
                                <span className={styles.sourceName}>{s.name}</span>
                                <span className={`${styles.badge} ${isWatchOn ? styles.badgeSuccess : styles.badgeNeutral}`}>
                                  {isWatchOn ? 'Live Watching' : 'Manual Scan Only'}
                                </span>
                              </div>
                              <span className={styles.sourcePath} title={s.path}>
                                {s.path}
                              </span>
                            </div>
                          </div>

                          <div className={styles.sourceControls}>
                            <label className={styles.switch} title={`Toggle continuous watching for ${s.name}`}>
                              <input
                                type="checkbox"
                                checked={isWatchOn}
                                onChange={() => handleToggleSourceWatch(s)}
                              />
                              <span className={styles.slider} />
                            </label>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )
              ) : (
                <div className={styles.bannerNotice}>
                  <span>⏸️</span>
                  <span>
                    Continuous watching is stopped. When you turn Always-on Scanning on, you can select which folders to
                    watch automatically.
                  </span>
                </div>
              )}
            </div>

            {/* Active Indexing Monitor */}
            <div className={styles.card} id="settings-indexing">
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderCol}>
                  <h2 className={styles.cardTitle}>Indexing Activity</h2>
                  <p className={styles.cardSubtitle}>
                    {indexStatus?.is_running
                      ? `Scanning ${indexStatus.current_folder || 'files'}...`
                      : 'Background indexer is currently idle.'}
                  </p>
                </div>
                {indexStatus?.is_running && (
                  <button className={`${styles.button} ${styles.destructive}`} onClick={() => stopIndex()}>
                    Stop Indexing
                  </button>
                )}
              </div>

              {indexStatus?.is_running ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <ProgressBar status={indexStatus.status} percent={indexStatus.percent} />
                  <div className={styles.statGrid}>
                    <div className={styles.statCard}>
                      <span className={styles.statValue}>
                        {indexStatus.current_index.toLocaleString()} / {indexStatus.total_files.toLocaleString()}
                      </span>
                      <span className={styles.statLabel}>Files Processed</span>
                    </div>
                    <div className={styles.statCard}>
                      <span className={styles.statValue}>{indexStatus.percent.toFixed(0)}%</span>
                      <span className={styles.statLabel}>Completion</span>
                    </div>
                  </div>
                  {indexStatus.current_file && (
                    <div className={styles.bannerNotice}>
                      <span>📄</span>
                      <span className={styles.truncate} title={indexStatus.current_file}>
                        Current: {indexStatus.current_file}
                      </span>
                    </div>
                  )}
                  {indexStatus.queued.length > 0 && (
                    <div className={styles.bannerNotice}>
                      <span>⏳</span>
                      <span className={styles.truncate}>Queued: {indexStatus.queued.join(', ')}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.bannerNotice}>
                  <span>✓</span>
                  <span>{indexStatus?.status || 'All indexed folders are up to date.'}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: CLOUD & ACCOUNTS */}
        {activeTab === 'cloud' && (
          <div className={styles.panel}>
            <GoogleAccountCard
              status={googleStatus}
              indexStatus={indexStatus}
              onRefreshStatus={onRefreshGoogleStatus}
              onShowToast={showToast}
              onStartProgress={onStartProgress}
            />
          </div>
        )}

        {/* TAB 4: MAINTENANCE & STORAGE */}
        {activeTab === 'maintenance' && (
          <div className={styles.panel}>
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderCol}>
                  <h2 className={styles.cardTitle}>Index Metrics</h2>
                  <p className={styles.cardSubtitle}>Local LanceDB vector store statistics</p>
                </div>
              </div>

              <div className={styles.statGrid}>
                <div className={styles.statCard}>
                  <span className={styles.statValue}>{totalItems.toLocaleString()}</span>
                  <span className={styles.statLabel}>Total Indexed Items</span>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statValue}>{sources.length}</span>
                  <span className={styles.statLabel}>Configured Sources</span>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statValue}>
                    {localSources.filter((s) => s.watch_enabled !== false).length}
                  </span>
                  <span className={styles.statLabel}>Live Watched Folders</span>
                </div>
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardHeaderCol}>
                  <h2 className={styles.cardTitle} style={{ color: 'var(--red)' }}>
                    Reset Search Database
                  </h2>
                  <p className={styles.cardSubtitle}>
                    Wipe the entire local LanceDB vector index. Your configured source folders will remain intact and
                    can be re-indexed.
                  </p>
                </div>
                <button className={`${styles.button} ${styles.destructive}`} onClick={handleClearDb}>
                  Reset Database…
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
