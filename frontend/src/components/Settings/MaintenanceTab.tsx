import React from 'react'
import * as native from '../../native'
import shared from './SettingsShared.module.css'

interface MaintenanceTabProps {
  totalItems: number
  sourceCount: number
  isLiveScanning: boolean
  watchedCount: number
  voiceTranscription: boolean
  onToggleVoiceTranscription: () => void
  onClearDb: () => void
  onResetApp: () => void
}

export const MaintenanceTab: React.FC<MaintenanceTabProps> = ({
  totalItems,
  sourceCount,
  isLiveScanning,
  watchedCount,
  voiceTranscription,
  onToggleVoiceTranscription,
  onClearDb,
  onResetApp,
}) => {
  const [confirming, setConfirming] = React.useState(false)
  const [confirmingReset, setConfirmingReset] = React.useState(false)
  const [dockVisible, setDockVisible] = React.useState<boolean | null>(null)

  // The menu bar item can change this too, so re-read when the window regains focus.
  React.useEffect(() => {
    const read = () => void native.dockIconVisible().then(setDockVisible)
    read()
    window.addEventListener('focus', read)
    return () => window.removeEventListener('focus', read)
  }, [])

  const toggleDock = async () => {
    const next = !dockVisible
    setDockVisible(next)
    await native.setDockIconVisible(next)
  }

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
          <span className={shared.statValue}>{sourceCount}</span>
          <span className={shared.statLabel}>Configured Sources</span>
        </div>
        <div className={shared.statCard}>
          <span className={shared.statValue}>{isLiveScanning ? watchedCount : 'Off'}</span>
          <span className={shared.statLabel}>Live Watched Folders</span>
        </div>
      </div>
    </div>

    <div className={shared.card}>
      <div className={shared.cardHeader}>
        <div className={shared.cardHeaderCol}>
          <h2 className={shared.cardTitle}>Whisper transcription</h2>
          <p className={shared.cardSubtitle}>
            Transcribe voice searches with Whisper before matching. When off, searches use the raw audio only.
          </p>
        </div>
        <label className={shared.switch} title="Toggle Whisper transcription">
          <input
            type="checkbox"
            role="switch"
            aria-label="Whisper transcription"
            checked={voiceTranscription}
            onChange={onToggleVoiceTranscription}
          />
          <span className={shared.slider} />
        </label>
      </div>
    </div>

    {dockVisible !== null && (
      <div className={shared.card}>
        <div className={shared.cardHeader}>
          <div className={shared.cardHeaderCol}>
            <h2 className={shared.cardTitle}>Dock icon</h2>
            <p className={shared.cardSubtitle}>
              Show Hyperlight in the Dock while it runs. The menu bar icon is always there. You can also change this
              from the menu bar icon.
            </p>
          </div>
          <label className={shared.switch} title="Toggle Dock icon">
            <input
              type="checkbox"
              role="switch"
              aria-label="Dock icon"
              checked={dockVisible}
              onChange={toggleDock}
            />
            <span className={shared.slider} />
          </label>
        </div>
      </div>
    )}

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
