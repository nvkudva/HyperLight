import React from 'react'
import type { ConfiguredSource, IndexJobInfo } from '../../types'
import { AppIcon, FolderIcon, ServerIcon } from '../common/Icons'
import styles from './SettingsPage.module.css'

interface SourcesTabProps {
  sources: ConfiguredSource[]
  availablePresets: string[]
  hasAppsSource: boolean
  isGlobalAlwaysOn: boolean
  manualPath: string
  onManualPathChange: (path: string) => void
  jobForSource: (s: ConfiguredSource) => IndexJobInfo | undefined
  onBrowseFinder: () => void
  onConnectVolumes: () => void
  onAddManual: (e?: React.FormEvent) => void
  onIndexPreset: (p: string) => void
  onIndexApps: () => void
  onToggleSourceWatch: (s: ConfiguredSource) => void
  onReveal: (path: string) => void
  onRescan: (s: ConfiguredSource) => void
  onRemoveSource: (path: string) => void
}

export const SourcesTab: React.FC<SourcesTabProps> = ({
  sources,
  availablePresets,
  hasAppsSource,
  isGlobalAlwaysOn,
  manualPath,
  onManualPathChange,
  jobForSource,
  onBrowseFinder,
  onConnectVolumes,
  onAddManual,
  onIndexPreset,
  onIndexApps,
  onToggleSourceWatch,
  onReveal,
  onRescan,
  onRemoveSource,
}) => (
  <div className={styles.panel}>
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderCol}>
          <h2 className={styles.cardTitle}>Add Location</h2>
          <p className={styles.cardSubtitle}>Add folders or drives to personal search.</p>
        </div>
      </div>

      <div className={styles.quickActionGrid}>
        <button className={styles.quickActionCard} onClick={onBrowseFinder}>
          <span className={`${styles.quickActionIcon} ${styles.iconAccent}`}>
            <FolderIcon className="w-4 h-4" />
          </span>
          <span>Choose Folder…</span>
        </button>
        <button className={styles.quickActionCard} onClick={onConnectVolumes}>
          <span className={`${styles.quickActionIcon} ${styles.iconNeutral}`}>
            <ServerIcon className="w-4 h-4" />
          </span>
          <span>Network Share</span>
        </button>
      </div>

      <form className={styles.pathForm} onSubmit={onAddManual}>
        <input
          type="text"
          className={styles.input}
          aria-label="Folder path"
          placeholder="Enter path manually (~/Documents, /Volumes/Share...)"
          value={manualPath}
          onChange={(e) => onManualPathChange(e.target.value)}
        />
        <button type="submit" className={`${styles.button} ${styles.primary}`}>
          Add
        </button>
      </form>

      {(availablePresets.length > 0 || !hasAppsSource) && (
        <div className={styles.chipRow}>
          <span className={styles.chipLabel}>Quick add:</span>
          {availablePresets.map((p) => (
            <button key={p} className={styles.chip} title={p} onClick={() => onIndexPreset(p)}>
              <FolderIcon className={styles.chipIcon} />
              {p.replace('~/', '')}
            </button>
          ))}
          {!hasAppsSource && (
            <button className={styles.chip} title="Index installed macOS applications" onClick={onIndexApps}>
              <AppIcon className={styles.chipIcon} />
              Apps
            </button>
          )}
        </div>
      )}
    </div>

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

            const job = jobForSource(s)
            return (
              <li key={s.path} className={styles.sourceCard}>
                <div className={styles.sourceInfo}>
                  <span className={`${styles.icon} ${isApp ? styles.iconIndigo : styles.iconAccent}`}>
                    {isApp ? <AppIcon className="w-4 h-4" /> : <FolderIcon className="w-4 h-4" />}
                  </span>
                  <div className={styles.sourceDetails}>
                    <span className={styles.sourceName}>{s.name}</span>
                    <span className={`${styles.badge} ${styles.badgeNeutral}`} title="Items indexed">
                      {s.items_count.toLocaleString()}
                    </span>
                    {isGlobalAlwaysOn && isWatchable && (
                      <span className={`${styles.badge} ${isWatchOn ? styles.badgeSuccess : styles.badgeNeutral}`}>
                        {isWatchOn ? '● Live' : 'Manual'}
                      </span>
                    )}
                    <span className={styles.sourcePath} title={s.path}>
                      {s.path}
                    </span>
                    {job?.state === 'running' && (
                      <span
                        className={styles.jobProgress}
                        title={job.total_files > 0 ? `Indexing file ${job.current_index.toLocaleString()} of ${job.total_files.toLocaleString()}` : 'Discovering files…'}
                      >
                        {job.total_files > 0 ? (
                          <>
                            <span className={styles.jobTrack}>
                              <span className={styles.jobFill} style={{ width: `${job.percent}%` }} />
                            </span>
                            <span className={styles.jobPercent}>{Math.round(job.percent)}%</span>
                          </>
                        ) : (
                          <span className={styles.jobPercent}>Starting…</span>
                        )}
                      </span>
                    )}
                    {job?.state === 'queued' && (
                      <span className={`${styles.badge} ${styles.badgeAccent}`}>Queued</span>
                    )}
                  </div>
                </div>

                <div className={styles.sourceControls}>
                  {isGlobalAlwaysOn && isWatchable && (
                    <label className={styles.switch} title={`Toggle continuous live sync for ${s.name}`}>
                      <input
                        type="checkbox"
                        checked={isWatchOn}
                        onChange={() => onToggleSourceWatch(s)}
                      />
                      <span className={styles.slider} />
                    </label>
                  )}

                  <button className={styles.button} onClick={() => onReveal(s.path)} title="Reveal in Finder">
                    Reveal
                  </button>
                  <button className={styles.button} onClick={() => onRescan(s)} title="Re-index this folder">
                    Rescan
                  </button>
                  <button
                    className={`${styles.button} ${styles.destructive}`}
                    onClick={() => onRemoveSource(s.path)}
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
)
