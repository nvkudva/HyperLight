import React, { useEffect, useState } from 'react'
import type { ConfiguredSource, IndexJobInfo, IndexJobStatus } from '../../types'
import {
  AppIcon,
  CloudIcon,
  FolderIcon,
  GoogleLogo,
  RescanIcon,
  RevealIcon,
  TrashIcon,
} from '../common/Icons'
import styles from './SourcesTab.module.css'
import shared from './SettingsShared.module.css'

type ModalKind = 'folder' | 'cloud' | 'progress' | null

interface SourcesTabProps {
  sources: ConfiguredSource[]
  availablePresets: string[]
  hasAppsSource: boolean
  hasSettingsSource: boolean
  isGlobalAlwaysOn: boolean
  watchedCount: number
  totalItems: number
  indexStatus?: IndexJobStatus | null
  jobs: IndexJobInfo[]
  googleConnected: boolean
  manualPath: string
  onManualPathChange: (path: string) => void
  jobForSource: (s: ConfiguredSource) => IndexJobInfo | undefined
  onBrowseFinder: () => void
  onConnectVolumes: () => void
  onAddManual: (e?: React.FormEvent) => void
  onIndexPreset: (p: string) => void
  onIndexApps: () => void
  onIndexSettings: () => void
  onToggleAlwaysOn: () => void
  onToggleSourceWatch: (s: ConfiguredSource) => void
  onReveal: (path: string) => void
  onRescan: (s: ConfiguredSource) => void
  onRemoveSource: (path: string) => void
  onOpenCloudTab: () => void
}

const COMMON_FOLDERS: Array<{ label: string; path: string }> = [
  { label: 'Home', path: '~' },
  { label: 'Documents', path: '~/Documents' },
  { label: 'Desktop', path: '~/Desktop' },
  { label: 'Downloads', path: '~/Downloads' },
  { label: 'Pictures', path: '~/Pictures' },
  { label: 'Videos', path: '~/Movies' },
  { label: 'Music', path: '~/Music' },
]

const COMING_SOON_CLOUDS = ['iCloud Drive', 'Dropbox', 'OneDrive']

export const SourcesTab: React.FC<SourcesTabProps> = ({
  sources,
  availablePresets,
  hasAppsSource,
  hasSettingsSource,
  isGlobalAlwaysOn,
  watchedCount,
  totalItems,
  indexStatus,
  jobs,
  googleConnected,
  manualPath,
  onManualPathChange,
  jobForSource,
  onBrowseFinder,
  onConnectVolumes,
  onAddManual,
  onIndexPreset,
  onIndexApps,
  onIndexSettings,
  onToggleAlwaysOn,
  onToggleSourceWatch,
  onReveal,
  onRescan,
  onRemoveSource,
  onOpenCloudTab,
}) => {
  const [modal, setModal] = useState<ModalKind>(null)

  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])

  const runningJobs = jobs.filter((j) => j.state === 'running')
  const queuedJobs = jobs.filter((j) => j.state === 'queued')
  const filesRead = runningJobs.reduce((sum, j) => sum + (j.current_index || 0), 0)
  const isIndexing = indexStatus?.is_running || runningJobs.length > 0

  const addedPaths = new Set(sources.map((s) => s.path))
  const quickPresets = availablePresets.filter((p) => !addedPaths.has(p))

  const closeAnd = (fn: () => void) => () => {
    setModal(null)
    fn()
  }

  const statusSummary = isIndexing
    ? `${runningJobs.length} indexing · ${filesRead.toLocaleString()} files read`
    : `${totalItems.toLocaleString()} items indexed`

  return (
    <div className={shared.panel}>
      <div className={styles.sourcesToolbar}>
        <div className={shared.cardHeaderCol}>
          <h2 className={shared.cardTitle}>Sources</h2>
          <p className={shared.cardSubtitle}>
            {sources.length} {sources.length === 1 ? 'source' : 'sources'} · {totalItems.toLocaleString()} items
          </p>
        </div>
        <div className={styles.toolbarRight}>
          <button
            className={styles.liveStatusPill}
            onClick={() => setModal('progress')}
            title="Show indexing progress details"
          >
            <span className={`${styles.liveDot} ${isIndexing ? styles.liveDotActive : ''}`} />
            <span>{statusSummary}</span>
          </button>
          <span className={styles.liveLabel}>Live scanning</span>
          <label className={shared.switch} title={isGlobalAlwaysOn ? 'Disable real-time indexing' : 'Enable real-time indexing'}>
            <input type="checkbox" role="switch" checked={isGlobalAlwaysOn} onChange={onToggleAlwaysOn} aria-label="Real-time indexing" />
            <span className={shared.slider} />
          </label>
        </div>
      </div>

      <div className={styles.addSourceRow}>
        <button className={styles.addSourceCard} onClick={() => setModal('folder')}>
          <span className={`${styles.quickActionIcon} ${shared.iconAccent}`}>
            <FolderIcon className="w-4 h-4" />
          </span>
          <span className={styles.addSourceText}>
            <span className={styles.addSourceTitle}>Add Folder</span>
            <span className={styles.addSourceSubtitle}>Local folders or network drives</span>
          </span>
        </button>
        <button className={styles.addSourceCard} onClick={() => setModal('cloud')}>
          <span className={`${styles.quickActionIcon} ${shared.iconGreen}`}>
            <CloudIcon className="w-4 h-4" />
          </span>
          <span className={styles.addSourceText}>
            <span className={styles.addSourceTitle}>Add Cloud Account</span>
            <span className={styles.addSourceSubtitle}>
              {googleConnected ? 'Google connected · manage' : 'Google, iCloud, Dropbox…'}
            </span>
          </span>
        </button>
      </div>

      <div className={shared.card}>
        <div className={shared.cardHeader}>
          <div className={shared.cardHeaderCol}>
            <h2 className={shared.cardTitle}>Added Sources</h2>
            <p className={shared.cardSubtitle}>
              {isGlobalAlwaysOn
                ? `Live scan watching ${watchedCount} ${watchedCount === 1 ? 'location' : 'locations'}`
                : 'Real-time indexing is paused'}
            </p>
          </div>
        </div>

        {sources.length === 0 ? (
          <div className={shared.emptyState}>No sources yet. Add a folder or cloud account above.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.sourcesTable}>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Path</th>
                  <th scope="col" className={styles.numCol}>Files</th>
                  <th scope="col" className={styles.numCol}>Live scan</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const isApp = s.source_type === 'macos_system'
                  const isWatchable = s.watchable
                  const isWatchOn = s.watch_enabled !== false
                  const job = jobForSource(s)
                  return (
                    <tr key={s.path}>
                      <td>
                        <span className={styles.cellSource}>
                          <span className={`${shared.icon} ${isApp ? shared.iconIndigo : shared.iconAccent}`}>
                            {isApp ? <AppIcon className="w-4 h-4" /> : <FolderIcon className="w-4 h-4" />}
                          </span>
                          <span className={shared.sourceName}>{s.name}</span>
                          {job?.state === 'running' && (
                            <span className={styles.jobInline} title={`Indexing file ${job.current_index.toLocaleString()} of ${job.total_files.toLocaleString()}`}>
                              <span className={styles.jobTrack}>
                                <span className={styles.jobFill} style={{ width: `${job.percent}%` }} />
                              </span>
                              <span className={styles.jobPercent}>{Math.round(job.percent)}%</span>
                            </span>
                          )}
                          {job?.state === 'queued' && (
                            <span className={`${shared.badge} ${shared.badgeAccent}`}>Queued</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <span className={shared.sourcePath} title={s.path}>{s.path}</span>
                      </td>
                      <td className={styles.numCol}>
                        <span className={styles.filesCount}>{s.items_count.toLocaleString()}</span>
                      </td>
                      <td className={styles.numCol}>
                        {isGlobalAlwaysOn && isWatchable ? (
                          <label className={shared.switch} title={`Toggle live scan for ${s.name}`}>
                            <input
                              role="switch"
                              type="checkbox"
                              checked={isWatchOn}
                              onChange={() => onToggleSourceWatch(s)}
                              aria-label={`Live scan for ${s.name}`}
                            />
                            <span className={shared.slider} />
                          </label>
                        ) : (
                          <span className={styles.liveDash} title={isApp ? 'System source' : 'Not watchable'}>—</span>
                        )}
                      </td>
                      <td>
                        <span className={styles.rowActions}>
                          <button className={styles.iconButton} onClick={() => onReveal(s.path)} title="Reveal in Finder" aria-label={`Reveal ${s.name} in Finder`}>
                            <RevealIcon className="w-4 h-4" />
                          </button>
                          <button className={styles.iconButton} onClick={() => onRescan(s)} title="Re-index this source" aria-label={`Re-index ${s.name}`}>
                            <RescanIcon className="w-4 h-4" />
                          </button>
                          <button
                            className={`${styles.iconButton} ${styles.iconButtonDanger}`}
                            onClick={() => onRemoveSource(s.path)}
                            title="Remove from index"
                            aria-label={`Remove ${s.name}`}
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div className={styles.modalOverlay} onClick={() => setModal(null)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={modal === 'folder' ? 'Add folder' : modal === 'cloud' ? 'Add cloud account' : 'Indexing progress'}
            onClick={(e) => e.stopPropagation()}
          >
            {modal === 'folder' && (
              <>
                <div className={styles.modalHeader}>
                  <div>
                    <h3 className={shared.cardTitle}>Add Folder</h3>
                    <p className={shared.cardSubtitle}>Pick a common location, browse, or enter a path.</p>
                  </div>
                  <button className={styles.iconButton} onClick={() => setModal(null)} aria-label="Close">✕</button>
                </div>
                <button className={`${shared.button} ${shared.primary} ${styles.fullWidth}`} onClick={closeAnd(onBrowseFinder)}>
                  Choose Folder… (system picker)
                </button>
                <div className={styles.modalSectionTitle}>Common folders</div>
                <ul className={styles.modalList}>
                  {COMMON_FOLDERS.map((f) => (
                    <li key={f.path} className={styles.modalRow}>
                      <span className={`${shared.icon} ${shared.iconAccent}`}>
                        <FolderIcon className="w-4 h-4" />
                      </span>
                      <span className={styles.modalRowText}>
                        <span className={shared.sourceName}>{f.label}</span>
                        <span className={shared.sourcePath}>{f.path}</span>
                      </span>
                      <button className={shared.button} onClick={closeAnd(() => onIndexPreset(f.path))}>
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
                {quickPresets.length > 0 && (
                  <>
                    <div className={styles.modalSectionTitle}>Suggested</div>
                    <div className={styles.chipRow}>
                      {quickPresets.map((p) => (
                        <button key={p} className={styles.chip} title={p} onClick={closeAnd(() => onIndexPreset(p))}>
                          <FolderIcon className={styles.chipIcon} />
                          {p.replace('~/', '')}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className={styles.modalSectionTitle}>Advanced</div>
                <form className={styles.pathForm} onSubmit={(e) => { onAddManual(e); setModal(null) }}>
                  <input
                    type="text"
                    className={styles.input}
                    aria-label="Folder path"
                    placeholder="~/Documents, /Volumes/Share…"
                    value={manualPath}
                    onChange={(e) => onManualPathChange(e.target.value)}
                  />
                  <button type="submit" className={`${shared.button} ${shared.primary}`}>Add</button>
                </form>
                <div className={styles.modalRowButtons}>
                  <button className={shared.button} onClick={closeAnd(onConnectVolumes)}>Network Share…</button>
                  {!hasAppsSource && (
                    <button className={shared.button} onClick={closeAnd(onIndexApps)}>Index Applications</button>
                  )}
                  {!hasSettingsSource && (
                    <button className={shared.button} onClick={closeAnd(onIndexSettings)}>Index Settings</button>
                  )}
                </div>
              </>
            )}

            {modal === 'cloud' && (
              <>
                <div className={styles.modalHeader}>
                  <div>
                    <h3 className={shared.cardTitle}>Add Cloud Account</h3>
                    <p className={shared.cardSubtitle}>Connect a cloud account to index its files.</p>
                  </div>
                  <button className={styles.iconButton} onClick={() => setModal(null)} aria-label="Close">✕</button>
                </div>
                <ul className={styles.modalList}>
                  <li className={styles.modalRow}>
                    <span className={`${shared.icon} ${shared.iconGreen}`}>
                      <GoogleLogo className="w-4 h-4" />
                    </span>
                    <span className={styles.modalRowText}>
                      <span className={shared.sourceName}>
                        Google
                        {googleConnected && <span className={`${shared.badge} ${shared.badgeSuccess}`}>● Connected</span>}
                      </span>
                      <span className={shared.sourcePath}>Drive · Photos · Gmail</span>
                    </span>
                    <button
                      className={`${shared.button} ${googleConnected ? '' : shared.primary}`}
                      onClick={() => { setModal(null); onOpenCloudTab() }}
                    >
                      {googleConnected ? 'Manage' : 'Connect'}
                    </button>
                  </li>
                  {COMING_SOON_CLOUDS.map((name) => (
                    <li key={name} className={`${styles.modalRow} ${styles.modalRowDisabled}`}>
                      <span className={`${shared.icon} ${shared.iconNeutral}`}>
                        <CloudIcon className="w-4 h-4" />
                      </span>
                      <span className={styles.modalRowText}>
                        <span className={shared.sourceName}>{name}</span>
                        <span className={shared.sourcePath}>Cloud storage sync</span>
                      </span>
                      <span className={`${shared.badge} ${shared.badgeNeutral}`}>Coming soon</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {modal === 'progress' && (
              <>
                <div className={styles.modalHeader}>
                  <div>
                    <h3 className={shared.cardTitle}>Indexing Progress</h3>
                    <p className={shared.cardSubtitle}>
                      {isIndexing
                        ? `${runningJobs.length} running · ${queuedJobs.length} queued · ${filesRead.toLocaleString()} files read`
                        : 'Indexer is idle. All sources are up to date.'}
                    </p>
                  </div>
                  <button className={styles.iconButton} onClick={() => setModal(null)} aria-label="Close">✕</button>
                </div>
                {runningJobs.length === 0 && queuedJobs.length === 0 ? (
                  <div className={shared.emptyState}>Nothing indexing right now.</div>
                ) : (
                  <ul className={styles.modalList}>
                    {runningJobs.map((j) => (
                      <li key={j.path || j.name} className={styles.modalRow}>
                        <span className={`${shared.icon} ${shared.iconAccent}`}>
                          <FolderIcon className="w-4 h-4" />
                        </span>
                        <span className={styles.modalRowText}>
                          <span className={shared.sourceName}>{j.name}</span>
                          <span className={shared.sourcePath} title={j.path || j.name}>
                            {j.total_files > 0
                              ? `${j.current_index.toLocaleString()} / ${j.total_files.toLocaleString()} files · ${Math.round(j.percent)}%`
                              : 'Discovering files…'}
                          </span>
                          {j.total_files > 0 && (
                            <span className={styles.jobTrackWide}>
                              <span className={styles.jobFill} style={{ width: `${j.percent}%` }} />
                            </span>
                          )}
                        </span>
                        <span className={`${shared.badge} ${shared.badgeSuccess}`}>● Running</span>
                      </li>
                    ))}
                    {queuedJobs.map((j) => (
                      <li key={j.path || j.name} className={styles.modalRow}>
                        <span className={`${shared.icon} ${shared.iconNeutral}`}>
                          <FolderIcon className="w-4 h-4" />
                        </span>
                        <span className={styles.modalRowText}>
                          <span className={shared.sourceName}>{j.name}</span>
                          <span className={shared.sourcePath}>Waiting to start</span>
                        </span>
                        <span className={`${shared.badge} ${shared.badgeAccent}`}>Queued</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
