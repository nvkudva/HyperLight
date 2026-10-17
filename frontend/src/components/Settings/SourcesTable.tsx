import React, { useEffect, useState } from 'react'
import type { SourceActions } from '../../hooks/useSourceActions'
import type { ConfiguredSource, IndexJobInfo } from '../../types'
import { AppIcon, FolderIcon, RescanIcon, RevealIcon, TrashIcon, XIcon } from '../common/Icons'
import styles from './SourcesTab.module.css'
import shared from './SettingsShared.module.css'

const CONFIRM_RESET_MS = 4000

interface SourcesTableProps {
  sources: ConfiguredSource[]
  isGlobalAlwaysOn: boolean
  jobForSource: (s: ConfiguredSource) => IndexJobInfo | undefined
  actions: SourceActions
  onToggleSourceWatch: (s: ConfiguredSource) => void
}

const JobProgress: React.FC<{ job: IndexJobInfo }> = ({ job }) => {
  if (job.state === 'queued') return <span className={`${shared.badge} ${shared.badgeAccent}`}>Queued</span>
  return (
    <span className={styles.jobInline} title={`Indexing file ${job.current_index.toLocaleString()} of ${job.total_files.toLocaleString()}`}>
      <span className={styles.jobTrack}>
        <span className={styles.jobFill} style={{ width: `${job.percent}%` }} />
      </span>
      <span className={styles.jobPercent}>{Math.round(job.percent)}%</span>
    </span>
  )
}

const RemoveButton: React.FC<{ source: ConfiguredSource; onRemove: () => void }> = ({ source, onRemove }) => {
  const [isConfirming, setIsConfirming] = useState(false)

  useEffect(() => {
    if (!isConfirming) return
    const timer = window.setTimeout(() => setIsConfirming(false), CONFIRM_RESET_MS)
    return () => clearTimeout(timer)
  }, [isConfirming])

  if (!isConfirming) {
    return (
      <button
        className={`${styles.iconButton} ${styles.iconButtonDanger} ${styles.destructiveAction}`}
        onClick={() => setIsConfirming(true)}
        title="Remove from index"
        aria-label={`Remove ${source.name}`}
      >
        <TrashIcon className="w-4 h-4" />
      </button>
    )
  }
  return (
    <span className={`${styles.rowActions} ${styles.destructiveAction}`}>
      <button className={styles.confirmRemove} onClick={onRemove} aria-label={`Confirm removing ${source.name}`} autoFocus>
        Remove?
      </button>
      <button className={styles.iconButton} onClick={() => setIsConfirming(false)} title="Cancel" aria-label="Cancel removal">
        <XIcon className="w-4 h-4" />
      </button>
    </span>
  )
}

const SourceRow: React.FC<SourcesTableProps & { source: ConfiguredSource }> = ({
  source,
  isGlobalAlwaysOn,
  jobForSource,
  actions,
  onToggleSourceWatch,
}) => {
  const isApp = source.source_type === 'macos_system'
  const job = jobForSource(source)
  return (
    <tr>
      <td>
        <span className={styles.cellSource}>
          <span className={`${shared.icon} ${isApp ? shared.iconIndigo : shared.iconAccent}`}>
            {isApp ? <AppIcon className="w-4 h-4" /> : <FolderIcon className="w-4 h-4" />}
          </span>
          <span className={shared.sourceName} title={source.path}>{source.name}</span>
          {job && <JobProgress job={job} />}
        </span>
      </td>
      <td className={styles.pathCol}>
        <span className={shared.sourcePath} title={source.path}>{source.path}</span>
      </td>
      <td className={styles.numCol}>
        <span className={styles.filesCount}>{source.items_count.toLocaleString()}</span>
      </td>
      <td className={styles.numCol}>
        {isGlobalAlwaysOn && source.watchable ? (
          <label className={shared.switch} title={`Toggle live scan for ${source.name}`}>
            <input
              role="switch"
              type="checkbox"
              checked={source.watch_enabled !== false}
              onChange={() => onToggleSourceWatch(source)}
              aria-label={`Live scan for ${source.name}`}
            />
            <span className={shared.slider} />
          </label>
        ) : (
          <span className={styles.liveDash} title={isApp ? 'System source' : 'Not watchable'}>—</span>
        )}
      </td>
      <td>
        <span className={styles.rowActions}>
          <button className={styles.iconButton} onClick={() => actions.reveal(source.path)} title="Reveal in Finder" aria-label={`Reveal ${source.name} in Finder`}>
            <RevealIcon className="w-4 h-4" />
          </button>
          <button
            className={styles.iconButton}
            onClick={() => actions.rescan(source)}
            disabled={!!job}
            title={job ? 'Already indexing' : 'Re-index this source'}
            aria-label={`Re-index ${source.name}`}
          >
            <RescanIcon className="w-4 h-4" />
          </button>
          <RemoveButton source={source} onRemove={() => actions.remove(source.path)} />
        </span>
      </td>
    </tr>
  )
}

export const SourcesTable: React.FC<SourcesTableProps> = (props) => (
  <div className={styles.tableWrap}>
    <table className={styles.sourcesTable}>
      <thead>
        <tr>
          <th scope="col">Source</th>
          <th scope="col" className={styles.pathCol}>Path</th>
          <th scope="col" className={styles.numCol}>Items</th>
          <th scope="col" className={styles.numCol}>Live scan</th>
          <th scope="col">
            <span className={styles.srOnly}>Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {props.sources.map((source) => (
          <SourceRow key={source.path} {...props} source={source} />
        ))}
      </tbody>
    </table>
  </div>
)
