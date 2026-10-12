import React from 'react'
import type { ConfiguredSource } from '../../types'
import styles from './SettingsPage.module.css'

interface MaintenanceTabProps {
  totalItems: number
  sources: ConfiguredSource[]
  localSources: ConfiguredSource[]
  onClearDb: () => void
}

export const MaintenanceTab: React.FC<MaintenanceTabProps> = ({
  totalItems,
  sources,
  localSources,
  onClearDb,
}) => (
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
        <button className={`${styles.button} ${styles.destructive}`} onClick={onClearDb}>
          Reset Database…
        </button>
      </div>
    </div>
  </div>
)
