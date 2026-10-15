import React, { useEffect, useState } from 'react'
import { fetchDriveLocations, fetchICloudLocations } from '../../api'
import type { ConfiguredSource, DriveLocation, IndexJobInfo, IndexJobStatus } from '../../types'
import {
  AppIcon,
  CloudIcon,
  FolderIcon,
  MailIcon,
  RescanIcon,
  RevealIcon,
  TrashIcon,
} from '../common/Icons'
import settingsStyles from './SettingsPage.module.css'
import styles from './SourcesTab.module.css'
import shared from './SettingsShared.module.css'

type ModalKind = 'add' | 'progress' | null

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
  manualPath: string
  onManualPathChange: (path: string) => void
  jobForSource: (s: ConfiguredSource) => IndexJobInfo | undefined
  onBrowseFinder: () => void
  onAddManual: (e?: React.FormEvent) => void
  onIndexPreset: (p: string) => void
  onIndexApps: () => void
  onIndexSettings: () => void
  onIndexICloud: (locations: DriveLocation[]) => void
  onIndexDrive: (locations: DriveLocation[]) => void
  onIndexAppleMail: () => void
  onToggleAlwaysOn: () => void
  onToggleSourceWatch: (s: ConfiguredSource) => void
  onReveal: (path: string) => void
  onRescan: (s: ConfiguredSource) => void
  onRemoveSource: (path: string) => void
  titleRef: React.Ref<HTMLHeadingElement>
}

const COMING_SOON_CLOUDS = ['Dropbox', 'OneDrive']

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
  manualPath,
  onManualPathChange,
  jobForSource,
  onBrowseFinder,
  onAddManual,
  onIndexPreset,
  onIndexApps,
  onIndexSettings,
  onIndexICloud,
  onIndexDrive,
  onIndexAppleMail,
  onToggleAlwaysOn,
  onToggleSourceWatch,
  onReveal,
  onRescan,
  onRemoveSource,
  titleRef,
}) => {
  const [modal, setModal] = useState<ModalKind>(null)
  const [icloudLocations, setIcloudLocations] = useState<DriveLocation[]>([])
  const [driveLocations, setDriveLocations] = useState<DriveLocation[]>([])

  useEffect(() => {
    fetchICloudLocations()
      .then((res) => setIcloudLocations(res.locations))
      .catch(() => setIcloudLocations([]))
    fetchDriveLocations()
      .then((res) => setDriveLocations(res.locations))
      .catch(() => setDriveLocations([]))
  }, [])

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
  const filesParsed = runningJobs.reduce((sum, j) => sum + (j.parsed_files || 0), 0)
  const isIndexing = indexStatus?.is_running || runningJobs.length > 0

  const addedPaths = new Set(sources.map((s) => s.path))
  const hasMailSource = sources.some((s) => s.source_type === 'apple_mail')
  const quickPresets = availablePresets.filter((p) => !addedPaths.has(p))

  const closeAnd = (fn: () => void) => () => {
    setModal(null)
    fn()
  }

  const statusSummary = isIndexing
    ? `${runningJobs.length} indexing · ${filesRead.toLocaleString()} files read`
    : 'Idle · up to date'

  return (
    <div className={shared.panel}>
      <header className={styles.sourcesHeader}>
        <div className={styles.sourcesHeading}>
          <h1 ref={titleRef} tabIndex={-1} className={settingsStyles.title}>
            Sources
          </h1>
          <button className={`${shared.button} ${shared.primary}`} onClick={() => setModal('add')}>
            + Add Source
          </button>
        </div>
        <div className={styles.headerStatus}>
          <span className={styles.statusLine}>
            {sources.length} {sources.length === 1 ? 'source' : 'sources'} · {totalItems.toLocaleString()} items scanned
          </span>
          <button
            className={styles.liveStatusPill}
            onClick={() => setModal('progress')}
            title="Show indexing progress details"
          >
            <span className={`${styles.liveDot} ${isIndexing ? styles.liveDotActive : ''}`} />
            <span>{statusSummary}</span>
            {isIndexing && filesParsed > filesRead && (
              <span className={styles.parsedCount} title="Files parsed so far; embedding catches up">
                {filesParsed.toLocaleString()} parsed
              </span>
            )}
          </button>
          <span className={styles.liveToggle}>
            <span className={styles.liveLabel}>Live scanning</span>
            <label className={shared.switch} title={isGlobalAlwaysOn ? 'Disable real-time indexing' : 'Enable real-time indexing'}>
              <input type="checkbox" role="switch" checked={isGlobalAlwaysOn} onChange={onToggleAlwaysOn} aria-label="Real-time indexing" />
              <span className={shared.slider} />
            </label>
          </span>
        </div>
      </header>

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
                          <button
                            className={styles.iconButton}
                            onClick={() => onRescan(s)}
                            disabled={!!job}
                            title={job ? 'Already indexing' : 'Re-index this source'}
                            aria-label={`Re-index ${s.name}`}
                          >
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
            aria-label={modal === 'add' ? 'Add source' : 'Indexing progress'}
            onClick={(e) => e.stopPropagation()}
          >
            {modal === 'add' && (
              <>
                <div className={styles.modalHeader}>
                  <div>
                    <h3 className={shared.cardTitle}>Add Source</h3>
                    <p className={shared.cardSubtitle}>Folders, services, or cloud drives synced to this Mac.</p>
                  </div>
                  <button className={styles.iconButton} onClick={() => setModal(null)} aria-label="Close">✕</button>
                </div>
                <button className={`${shared.button} ${shared.primary} ${styles.fullWidth}`} onClick={closeAnd(onBrowseFinder)}>
                  Choose Folder… (system picker)
                </button>

                {quickPresets.length > 0 && (
                  <>
                    <div className={styles.modalSectionTitle}>Common folders</div>
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
                <div className={styles.modalSectionTitle}>Services</div>
                <ul className={styles.modalList}>
                  <li className={styles.modalRow}>
                    <span className={`${shared.icon} ${shared.iconAccent}`}>
                      <MailIcon className="w-4 h-4" />
                    </span>
                    <span className={styles.modalRowText}>
                      <span className={shared.sourceName}>Apple Mail</span>
                      <span className={shared.sourcePath}>Needs Full Disk Access</span>
                    </span>
                    {hasMailSource ? (
                      <span className={`${shared.badge} ${shared.badgeSuccess}`}>Added</span>
                    ) : (
                      <button className={shared.button} onClick={closeAnd(onIndexAppleMail)}>Index</button>
                    )}
                  </li>
                  <li className={styles.modalRow}>
                    <span className={`${shared.icon} ${shared.iconIndigo}`}>
                      <AppIcon className="w-4 h-4" />
                    </span>
                    <span className={styles.modalRowText}>
                      <span className={shared.sourceName}>Applications</span>
                      <span className={shared.sourcePath}>Installed macOS apps</span>
                    </span>
                    {hasAppsSource ? (
                      <span className={`${shared.badge} ${shared.badgeSuccess}`}>Added</span>
                    ) : (
                      <button className={shared.button} onClick={closeAnd(onIndexApps)}>Index</button>
                    )}
                  </li>
                  <li className={styles.modalRow}>
                    <span className={`${shared.icon} ${shared.iconIndigo}`}>
                      <AppIcon className="w-4 h-4" />
                    </span>
                    <span className={styles.modalRowText}>
                      <span className={shared.sourceName}>System Settings</span>
                      <span className={shared.sourcePath}>macOS settings panes</span>
                    </span>
                    {hasSettingsSource ? (
                      <span className={`${shared.badge} ${shared.badgeSuccess}`}>Added</span>
                    ) : (
                      <button className={shared.button} onClick={closeAnd(onIndexSettings)}>Index</button>
                    )}
                  </li>
                </ul>

                <div className={styles.modalSectionTitle}>Cloud drives · via sync app</div>
                <ul className={styles.modalList}>
                  {driveLocations.map((loc) => (
                    <li key={loc.path} className={styles.modalRow}>
                      <span className={`${shared.icon} ${shared.iconGreen}`}>
                        <CloudIcon className="w-4 h-4" />
                      </span>
                      <span className={styles.modalRowText}>
                        <span className={shared.sourceName}>Google Drive</span>
                        <span className={shared.sourcePath}>{loc.path} · via sync app</span>
                      </span>
                      {addedPaths.has(loc.path) ? (
                        <span className={`${shared.badge} ${shared.badgeSuccess}`}>Added</span>
                      ) : (
                        <button className={`${shared.button} ${shared.primary}`} onClick={() => { setModal(null); onIndexDrive(driveLocations) }}>
                          Index
                        </button>
                      )}
                    </li>
                  ))}
                  {icloudLocations.map((loc) => (
                    <li key={loc.path} className={styles.modalRow}>
                      <span className={`${shared.icon} ${shared.iconNeutral}`}>
                        <CloudIcon className="w-4 h-4" />
                      </span>
                      <span className={styles.modalRowText}>
                        <span className={shared.sourceName}>iCloud Drive</span>
                        <span className={shared.sourcePath}>{loc.path} · via sync app</span>
                      </span>
                      {addedPaths.has(loc.path) ? (
                        <span className={`${shared.badge} ${shared.badgeSuccess}`}>Added</span>
                      ) : (
                        <button className={`${shared.button} ${shared.primary}`} onClick={() => { setModal(null); onIndexICloud(icloudLocations) }}>
                          Index
                        </button>
                      )}
                    </li>
                  ))}
                  {COMING_SOON_CLOUDS.map((name) => (
                    <li key={name} className={`${styles.modalRow} ${styles.modalRowDisabled}`}>
                      <span className={`${shared.icon} ${shared.iconNeutral}`}>
                        <CloudIcon className="w-4 h-4" />
                      </span>
                      <span className={styles.modalRowText}>
                        <span className={shared.sourceName}>{name}</span>
                        <span className={shared.sourcePath}>Via sync app</span>
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
                              ? `${j.current_index.toLocaleString()} / ${j.total_files.toLocaleString()} files · ${Math.round(j.percent)}%${
                                  (j.parsed_files ?? 0) > j.current_index ? ` · ${j.parsed_files?.toLocaleString()} parsed` : ''
                                }`
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
