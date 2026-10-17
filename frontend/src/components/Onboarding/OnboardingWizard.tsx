import React, { useEffect, useState } from 'react'
import * as api from '../../api'
import { DRIVE_DOWNLOAD_URL, useDriveLocations } from '../../hooks/useDriveLocations'
import { useModalDialog } from '../../hooks/useModalDialog'
import { PermissionList } from '../Permission/PermissionList'
import type { DriveLocation } from '../../types'
import styles from './OnboardingWizard.module.css'

const LOCAL_FOLDERS = [
  { key: 'documents', label: 'Documents', path: '~/Documents' },
  { key: 'desktop', label: 'Desktop', path: '~/Desktop' },
  { key: 'downloads', label: 'Downloads', path: '~/Downloads' },
  { key: 'pictures', label: 'Pictures', path: '~/Pictures' },
]

interface OnboardingWizardProps {
  onStartProgress: () => void
  onDone: () => void
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onStartProgress, onDone }) => {
  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<Record<string, boolean>>({
    documents: true,
    desktop: true,
    appleMail: true,
    apps: true,
    settings: true,
    icloud: true,
  })
  const { locations: driveLocations, reload: checkDrive } = useDriveLocations()
  const [icloudLocations, setIcloudLocations] = useState<DriveLocation[]>([])
  const [needsDiskAccess, setNeedsDiskAccess] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const { dialogRef, handleKeyDown } = useModalDialog(onDone, step)

  useEffect(() => {
    if (driveLocations) setPicked((p) => ({ ...Object.fromEntries(driveLocations.map((l) => [l.path, true])), ...p }))
  }, [driveLocations])

  useEffect(() => {
    api.fetchICloudLocations()
      .then((res) => {
        setIcloudLocations(res.locations)
        if (res.locations.length) setPicked((p) => ({ ...p, icloud: p.icloud ?? true }))
      })
      .catch(() => setIcloudLocations([]))
  }, [])

  const toggle = (key: string) => setPicked((p) => ({ ...p, [key]: !p[key] }))

  const checkbox = (key: string, label: string) => (
    <label key={key} className={styles.option}>
      <input type="checkbox" checked={!!picked[key]} onChange={() => toggle(key)} />
      <span>{label}</span>
    </label>
  )

  const startIndexing = async () => {
    if (starting) return
    setStarting(true)
    setStartError(null)
    try {
      if (picked.appleMail) await api.indexAppleMail()
      if (picked.apps) await api.indexApps()
      if (picked.settings) await api.indexSettings()
      await Promise.all([
        ...LOCAL_FOLDERS.filter((f) => picked[f.key]).map((f) => api.startIndex(f.path, 'local', f.label)),
        api.indexDriveLocations((driveLocations ?? []).filter((l) => picked[l.path])),
        ...(picked.icloud && icloudLocations.length ? [api.indexICloudLocations(icloudLocations)] : []),
      ])
      onStartProgress()
      setStep(1)
    } catch (err) {
      if (err instanceof api.ApiError && err.code === 'full_disk_access') {
        setNeedsDiskAccess(true)
        api.openSettingsPane('full-disk-access').catch(() => {})
      } else {
        setStartError((err as Error).message)
      }
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className={styles.overlay}>
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onKeyDown={handleKeyDown}
      >
        <div className={styles.dots}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i === step ? styles.dotActive : styles.dot} />
          ))}
        </div>

        {step === 0 && (
          <>
            <h1 id="onboarding-title" className={styles.title}>What should I search?</h1>
            <p className={styles.subtitle}>Everything stays on this Mac. You can change this later in Settings.</p>
            <div className={styles.options}>
              {LOCAL_FOLDERS.map((f) => checkbox(f.key, f.label))}
              {checkbox('appleMail', 'Apple Mail')}
              {checkbox('apps', 'Applications')}
              {checkbox('settings', 'System Settings')}
              {icloudLocations.length > 0 && checkbox('icloud', 'iCloud Drive')}
              {(driveLocations ?? []).map((l) => checkbox(l.path, l.name))}
            </div>
            {driveLocations && driveLocations.length === 0 && (
              <div className={styles.driveHint}>
                <p className={styles.subtitle}>Install Google Drive for desktop and sign in to search it too.</p>
                <div className={styles.linkRow}>
                  <button className={styles.linkBtn} onClick={() => api.launchTarget(DRIVE_DOWNLOAD_URL)}>
                    Get Google Drive
                  </button>
                  <button className={styles.linkBtn} onClick={checkDrive}>
                    Check again
                  </button>
                </div>
              </div>
            )}
            {needsDiskAccess && (
              <div className={styles.notice}>
                Apple Mail needs Full Disk Access. Turn it on for Hyperlight, then continue.
                <button className={styles.linkBtn} onClick={() => api.openSettingsPane('full-disk-access')}>
                  Open Privacy Settings
                </button>
              </div>
            )}
            {startError && (
              <p className={styles.error} role="alert">
                {startError}
              </p>
            )}
            <div className={styles.footer}>
              <button className={styles.secondaryBtn} onClick={onDone}>
                Skip for now
              </button>
              <button className={styles.primaryBtn} onClick={startIndexing} disabled={starting}>
                Start indexing
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 id="onboarding-title" className={styles.title}>Allow access</h1>
            <p className={styles.subtitle}>Hyperlight works best with these permissions. macOS asks once; you can change them later in Settings → Permissions.</p>
            <PermissionList />
            <div className={styles.footer}>
              <button className={styles.secondaryBtn} onClick={onDone}>
                Skip for now
              </button>
              <button className={styles.primaryBtn} onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 id="onboarding-title" className={styles.title}>You're set</h1>
            <p className={styles.subtitle}>
              Indexing runs in the background. Press <kbd>⌘K</kbd> to search anywhere.
            </p>
            <div className={styles.footer}>
              <button className={styles.primaryBtn} onClick={onDone}>
                Start searching
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
