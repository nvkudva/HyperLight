import React, { useEffect, useState } from 'react'
import * as native from '../../native'
import styles from './PermissionHelper.module.css'

const POLL_MS = 1000
const CLOSE_DELAY_MS = 1200

// Floating card shown beside System Settings: dragging the icon into the
// Input Monitoring list grants access in one gesture.
export const PermissionHelper: React.FC = () => {
  const [granted, setGranted] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if ((await native.keyboardAccessGranted()) === true) setGranted(true)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!granted) return
    const timer = window.setTimeout(() => void native.closePermissionHelper(), CLOSE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [granted])

  return (
    <div className={styles.card} onMouseDown={(e) => e.target === e.currentTarget && void native.startWindowDrag(e)}>
      <button className={styles.close} onClick={() => void native.closePermissionHelper()} aria-label="Close">
        ×
      </button>
      <img
        className={`${styles.icon} ${granted ? styles.done : ''}`}
        src="/hyperlight-icon.png"
        alt="Hyperlight"
        draggable={false}
        onMouseDown={(e) => {
          e.preventDefault()
          if (!granted) void native.startPermissionDrag()
        }}
      />
      <div className={styles.text}>
        <strong>{granted ? 'All set' : 'Drag Hyperlight into the list'}</strong>
        <span>
          {granted
            ? 'Input Monitoring is allowed.'
            : 'Drop the icon onto the Input Monitoring list above, then switch it on.'}
        </span>
      </div>
    </div>
  )
}
