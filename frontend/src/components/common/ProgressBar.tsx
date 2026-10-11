import React from 'react'
import styles from './ProgressBar.module.css'

interface ProgressBarProps {
  status: string
  percent: number
  children?: React.ReactNode
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ status, percent, children }) => (
  <div className={styles.progress} role="status">
    <div className={styles.header}>
      <span className={styles.status}>{status}</span>
      <div className={styles.trailing}>
        <span className={styles.percent}>{Math.round(percent)}%</span>
        {children}
      </div>
    </div>
    <div className={styles.track}>
      <div className={styles.bar} style={{ width: `${percent}%` }} />
    </div>
  </div>
)
