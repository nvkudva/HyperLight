import React from 'react'
import { stopIndex } from '../../api'
import type { ConfiguredSource, IndexJobInfo, IndexJobStatus } from '../../types'
import { FolderIcon } from '../common/Icons'
import { ProgressBar } from '../common/ProgressBar'
import styles from './ScanningTab.module.css'
import shared from './SettingsShared.module.css'

interface ScanningTabProps {
  isGlobalAlwaysOn: boolean
  watchedCount: number
  localSources: ConfiguredSource[]
  indexStatus?: IndexJobStatus | null
  queuedJobs: IndexJobInfo[]
  onToggleAlwaysOn: () => void
  onToggleSourceWatch: (s: ConfiguredSource) => void
}

export const ScanningTab: React.FC<ScanningTabProps> = ({
  isGlobalAlwaysOn,
  watchedCount,
  localSources,
  indexStatus,
  queuedJobs,
  onToggleAlwaysOn,
  onToggleSourceWatch,
}) => (
  <div className={shared.panel}>
    <div className={styles.duoGrid}>
      <div className={shared.card}>
      <div className={shared.cardHeader}>
        <div className={shared.cardHeaderCol}>
          <div className={styles.sourceNameRow}>
            <h2 className={shared.cardTitle}>Always-On Scanning</h2>
            <span
              className={`${shared.badge} ${isGlobalAlwaysOn ? shared.badgeSuccess : shared.badgeNeutral}`}
            >
              {isGlobalAlwaysOn
                ? `● Active (${watchedCount} watching)`
                : 'Paused'}
            </span>
          </div>
          <p className={shared.cardSubtitle}>
            Uses macOS kernel FSEvents to automatically detect and index newly added, modified, or deleted files
            in real-time without requiring manual rescans.
          </p>
        </div>
        <label className={shared.switch} title="Toggle master always-on scanning">
          <input
            role="switch"
            aria-label="Toggle master always-on scanning"
            type="checkbox"
            checked={isGlobalAlwaysOn}
            onChange={onToggleAlwaysOn}
          />
          <span className={shared.slider} />
        </label>
      </div>
      </div>

      <div className={shared.card} id="settings-indexing">
        <div className={shared.cardHeader}>
          <div className={shared.cardHeaderCol}>
            <h2 className={shared.cardTitle}>Indexing Activity</h2>
            <p className={shared.cardSubtitle}>
              {indexStatus?.is_running
                ? `Scanning ${indexStatus.current_folder || 'files'}...`
                : 'Background indexer is currently idle.'}
            </p>
          </div>
          {indexStatus?.is_running && (
            <button className={`${shared.button} ${shared.destructive}`} onClick={() => stopIndex()}>
              Stop Indexing
            </button>
          )}
        </div>

        {indexStatus?.is_running ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <ProgressBar status={indexStatus.status} percent={indexStatus.percent} />
            <div className={shared.statGrid}>
              <div className={shared.statCard}>
                <span className={shared.statValue}>
                  {indexStatus.current_index.toLocaleString()} / {indexStatus.total_files.toLocaleString()}
                </span>
                <span className={shared.statLabel}>Files Processed</span>
              </div>
              <div className={shared.statCard}>
                <span className={shared.statValue}>{indexStatus.percent.toFixed(0)}%</span>
                <span className={shared.statLabel}>Completion</span>
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
            {queuedJobs.length > 0 && (
              <div className={styles.queueList}>
                <span className={styles.queueTitle}>Up next</span>
                {queuedJobs.map((j) => (
                  <div key={j.path || j.name} className={styles.queueRow}>
                    <span className={styles.queueName} title={j.path || j.name}>
                      {j.name}
                    </span>
                    <span className={`${shared.badge} ${shared.badgeAccent}`}>Queued</span>
                  </div>
                ))}
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

    <div className={shared.card}>
      <div className={shared.cardHeader}>
        <div className={shared.cardHeaderCol}>
          <h2 className={shared.cardTitle}>Source Watch Rules</h2>
          <p className={shared.cardSubtitle}>
            {isGlobalAlwaysOn
              ? 'Enable or disable continuous real-time watching for each individual location:'
              : 'Always-on scanning is currently paused. Enable the master toggle to manage per-source rules.'}
          </p>
        </div>
      </div>

      {isGlobalAlwaysOn ? (
        localSources.length === 0 ? (
          <div className={shared.emptyState}>No local folders configured to watch.</div>
        ) : (
          <ul className={styles.sourceList}>
            {localSources.map((s) => {
              const isWatchOn = s.watch_enabled !== false
              return (
                <li key={s.path} className={shared.sourceCard}>
                  <div className={styles.sourceInfo}>
                    <span className={`${shared.icon} ${isWatchOn ? shared.iconGreen : shared.iconNeutral}`}>
                      <FolderIcon className="w-4 h-4" />
                    </span>
                    <div className={styles.sourceDetails}>
                      <span className={shared.sourceName}>{s.name}</span>
                      <span className={`${shared.badge} ${isWatchOn ? shared.badgeSuccess : shared.badgeNeutral}`}>
                        {isWatchOn ? '● Live' : 'Manual'}
                      </span>
                      <span className={shared.sourcePath} title={s.path}>
                        {s.path}
                      </span>
                    </div>
                  </div>

                  <div className={shared.sourceControls}>
                    <label className={shared.switch} title={`Toggle continuous watching for ${s.name}`}>
                      <input
                        role="switch"
                        aria-label={`Toggle continuous watching for ${s.name}`}
                        type="checkbox"
                        checked={isWatchOn}
                        onChange={() => onToggleSourceWatch(s)}
                      />
                      <span className={shared.slider} />
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
  </div>
)
