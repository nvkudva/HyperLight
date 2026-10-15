import React, { useEffect, useState } from 'react'
import * as api from '../../api'
import * as native from '../../native'
import styles from './PermissionList.module.css'

const POLL_MS = 1500

interface PermissionStatus {
  fullDiskAccess: boolean | null
  keyboard: boolean | null
  microphone: boolean | null
}

function usePermissionStatus(): PermissionStatus {
  const [status, setStatus] = useState<PermissionStatus>({ fullDiskAccess: null, keyboard: null, microphone: null })

  useEffect(() => {
    const check = async () => {
      const [permissions, keyboard, microphone] = await Promise.all([
        api.fetchPermissions().catch(() => null),
        native.keyboardAccessGranted(),
        native.microphoneAccessGranted(),
      ])
      setStatus({ fullDiskAccess: permissions?.full_disk_access ?? null, keyboard, microphone })
    }
    void check()
    const timer = window.setInterval(() => void check(), POLL_MS)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [])

  return status
}

interface PermissionRowProps {
  title: string
  reason: string
  granted: boolean | null
  actionLabel: string
  onAllow: () => void
}

const PermissionRow: React.FC<PermissionRowProps> = ({ title, reason, granted, actionLabel, onAllow }) => (
  <div className={styles.row}>
    <div className={styles.text}>
      <span className={styles.title}>
        {title}
        {granted !== null && (
          <span className={granted ? styles.ok : styles.missing}>{granted ? 'Allowed' : 'Needs access'}</span>
        )}
      </span>
      <span className={styles.reason}>{reason}</span>
    </div>
    {!granted && (
      <button className={styles.action} onClick={onAllow}>
        {actionLabel}
      </button>
    )}
  </div>
)

export const PermissionList: React.FC = () => {
  const status = usePermissionStatus()
  return (
    <div className={styles.list}>
      <PermissionRow
        title="Full Disk Access"
        reason="Needed to index Apple Mail, Documents, Desktop and Downloads."
        granted={status.fullDiskAccess}
        actionLabel="Open Settings"
        onAllow={() => void api.openSettingsPane('full-disk-access')}
      />
      <PermissionRow
        title="Input Monitoring"
        reason="Lets the quick-search shortcut work in any app."
        granted={status.keyboard}
        actionLabel="Allow…"
        onAllow={() => void native.requestKeyboardAccess()}
      />
      <PermissionRow
        title="Microphone"
        reason="Used for voice search."
        granted={status.microphone}
        actionLabel="Allow…"
        onAllow={() => void native.requestMicrophoneAccess()}
      />
    </div>
  )
}
