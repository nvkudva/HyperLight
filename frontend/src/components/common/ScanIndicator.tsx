import React from 'react'
import type { IndexJobStatus } from '../../types'
import styles from './ScanIndicator.module.css'

interface ScanIndicatorProps {
  status: IndexJobStatus | null
  onClick: () => void
}

export const ScanIndicator: React.FC<ScanIndicatorProps> = ({ status, onClick }) => {
  if (!status?.is_running) return null
  const percent = Math.round(status.percent)
  const label = status.current_folder ? `Indexing ${status.current_folder}` : 'Indexing'
  return (
    <button
      className={styles.pill}
      onClick={onClick}
      title={`${status.status} — click for details`}
      aria-label={`${label}, ${percent}% — show indexing details`}
    >
      <span className={styles.ring} style={{ ['--p' as string]: `${percent}%` }} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
      <span className={styles.percent}>{percent}%</span>
    </button>
  )
}
