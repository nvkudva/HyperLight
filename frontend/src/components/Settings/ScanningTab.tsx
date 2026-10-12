import React from 'react'
import { stopIndex } from '../../api'
import type { ConfiguredSource, IndexJobInfo, IndexJobStatus } from '../../types'
import { FolderIcon } from '../common/Icons'
import { ProgressBar } from '../common/ProgressBar'
import styles from './SettingsPage.module.css'

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
  <div className={styles.panel}>
    <div className={styles.duoGrid}>
      <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderCol}>
          <div className={styles.sourceNameRow}>
            <h2 className={styles.cardTitle}>Always-On Scanning</h2>
            <span
              className={`${styles.badge} ${isGlobalAlwaysOn ? styles.badgeSuccess : styles.badgeNeutral}`}
            >
              {isGlobalAlwaysOn
                ? `● Active (${watchedCount} watching)`
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
            onChange={onToggleAlwaysOn}
          />
          <span className={styles.slider} />
        </label>
      </div>
      </div>

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
            {queuedJobs.length > 0 && (
              <div className={styles.queueList}>
                <span className={styles.queueTitle}>Up next</span>
                {queuedJobs.map((j) => (
                  <div key={j.path || j.name} className={styles.queueRow}>
                    <span className={styles.queueName} title={j.path || j.name}>
                      {j.name}
                    </span>
                    <span className={`${styles.badge} ${styles.badgeAccent}`}>Queued</span>
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

    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardHeaderCol}>
          <h2 className={styles.cardTitle}>Source Watch Rules</h2>
          <p className={styles.cardSubtitle}>
            {isGlobalAlwaysOn
              ? 'Enable or disable continuous real-time watching for each individual location:'
              : 'Always-on scanning is currently paused. Enable the master toggle to manage per-source rules.'}
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
                      <span className={styles.sourceName}>{s.name}</span>
                      <span className={`${styles.badge} ${isWatchOn ? styles.badgeSuccess : styles.badgeNeutral}`}>
                        {isWatchOn ? '● Live' : 'Manual'}
                      </span>
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
                        onChange={() => onToggleSourceWatch(s)}
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
  </div>
)
