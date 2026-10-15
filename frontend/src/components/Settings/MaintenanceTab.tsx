import React from 'react'
import type { ConfiguredSource } from '../../types'
import shared from './SettingsShared.module.css'

interface MaintenanceTabProps {
  totalItems: number
  sources: ConfiguredSource[]
  localSources: ConfiguredSource[]
  onClearDb: () => void
  onResetApp: () => void
}

export const MaintenanceTab: React.FC<MaintenanceTabProps> = ({
  totalItems,
  sources,
  localSources,
  onClearDb,
  onResetApp,
}) => {
  const [confirming, setConfirming] = React.useState(false)
  const [confirmingReset, setConfirmingReset] = React.useState(false)
  return (
  <div className={shared.panel}>
    <div className={shared.card}>
      <div className={shared.cardHeader}>
        <div className={shared.cardHeaderCol}>
          <h2 className={shared.cardTitle}>Index Metrics</h2>
          <p className={shared.cardSubtitle}>Local LanceDB vector store statistics</p>
        </div>
      </div>

      <div className={shared.statGrid}>
        <div className={shared.statCard}>
          <span className={shared.statValue}>{totalItems.toLocaleString()}</span>
          <span className={shared.statLabel}>Total Indexed Items</span>
        </div>
        <div className={shared.statCard}>
          <span className={shared.statValue}>{sources.length}</span>
          <span className={shared.statLabel}>Configured Sources</span>
        </div>
        <div className={shared.statCard}>
          <span className={shared.statValue}>
            {localSources.filter((s) => s.watch_enabled !== false).length}
          </span>
          <span className={shared.statLabel}>Live Watched Folders</span>
        </div>
      </div>
    </div>

    <div className={shared.card}>
      <div className={shared.cardHeader}>
        <div className={shared.cardHeaderCol}>
          <h2 className={shared.cardTitle} style={{ color: 'var(--red)' }}>
            Reset Search Database
          </h2>
          <p className={shared.cardSubtitle}>
            Wipe the entire local LanceDB vector index. Your configured source folders will remain intact and
            can be re-indexed.
          </p>
        </div>
        {!confirming && (
          <button className={`${shared.button} ${shared.destructive}`} onClick={() => setConfirming(true)}>
            Reset Database…
          </button>
        )}
      </div>
      {confirming && (
        <div className={shared.cardHeader}>
          <p className={shared.cardSubtitle}>
            This is not dangerous. Your files are never touched — only the search index is wiped, and you can
            always index everything again.
          </p>
          <button
            className={`${shared.button} ${shared.destructive}`}
            onClick={() => {
              setConfirming(false)
              onClearDb()
            }}
          >
            Yes, Reset Database
          </button>
          <button className={shared.button} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
    <div className={shared.card}>
      <div className={shared.cardHeader}>
        <div className={shared.cardHeaderCol}>
          <h2 className={shared.cardTitle} style={{ color: 'var(--red)' }}>
            Reset Everything
          </h2>
          <p className={shared.cardSubtitle}>
            Erase the index, all sources, settings, Google sign-in and caches. Hyperlight restarts like a fresh
            install and shows the setup wizard again.
          </p>
        </div>
        {!confirmingReset && (
          <button className={`${shared.button} ${shared.destructive}`} onClick={() => setConfirmingReset(true)}>
            Reset Everything…
          </button>
        )}
      </div>
      {confirmingReset && (
        <div className={shared.cardHeader}>
          <p className={shared.cardSubtitle}>
            Your files are never touched. macOS permissions stay as granted; revoke them in System Settings if
            you want those reset too.
          </p>
          <button
            className={`${shared.button} ${shared.destructive}`}
            onClick={() => {
              setConfirmingReset(false)
              onResetApp()
            }}
          >
            Yes, Reset Everything
          </button>
          <button className={shared.button} onClick={() => setConfirmingReset(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  </div>
  )
}
