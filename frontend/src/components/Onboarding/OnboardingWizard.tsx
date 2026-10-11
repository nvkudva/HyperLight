import React, { useEffect, useState } from 'react'
import * as api from '../../api'
import styles from './OnboardingWizard.module.css'

const LOCAL_FOLDERS = [
  { key: 'documents', label: 'Documents', path: '~/Documents' },
  { key: 'desktop', label: 'Desktop', path: '~/Desktop' },
  { key: 'downloads', label: 'Downloads', path: '~/Downloads' },
  { key: 'pictures', label: 'Pictures', path: '~/Pictures' },
]

const DRIVE_DOWNLOAD_URL = 'https://www.google.com/drive/download/'

type DriveLocation = { name: string; path: string; account: string }

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
  })
  const [driveLocations, setDriveLocations] = useState<DriveLocation[] | null>(null)
  const [needsDiskAccess, setNeedsDiskAccess] = useState(false)

  const checkDrive = async () => {
    const res = await api.fetchDriveLocations()
    setDriveLocations(res.locations)
    setPicked((p) => ({ ...p, ...Object.fromEntries(res.locations.map((l) => [l.path, true])) }))
  }

  useEffect(() => {
    checkDrive()
  }, [])

  const toggle = (key: string) => setPicked((p) => ({ ...p, [key]: !p[key] }))

  const checkbox = (key: string, label: string) => (
    <label key={key} className={styles.option}>
      <input type="checkbox" checked={!!picked[key]} onChange={() => toggle(key)} />
      <span>{label}</span>
    </label>
  )

  const startIndexing = async () => {
    if (picked.appleMail) {
      const res = await api.indexAppleMail()
      if (res.error === 'full_disk_access') {
        setNeedsDiskAccess(true)
        setStep(0)
        return
      }
    }
    for (const f of LOCAL_FOLDERS) {
      if (picked[f.key]) await api.startIndex(f.path, 'local', f.label)
    }
    for (const loc of driveLocations ?? []) {
      if (picked[loc.path]) await api.startIndex(loc.path, 'google_drive', loc.name)
    }
    onStartProgress()
    setStep(2)
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.dots}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i === step ? styles.dotActive : styles.dot} />
          ))}
        </div>

        {step === 0 && (
          <>
            <h1 className={styles.title}>What should I search?</h1>
            <p className={styles.subtitle}>Everything stays on this Mac. You can change this later in Settings.</p>
            <div className={styles.options}>
              {LOCAL_FOLDERS.map((f) => checkbox(f.key, f.label))}
              {checkbox('appleMail', 'Apple Mail')}
            </div>
            {needsDiskAccess && (
              <div className={styles.notice}>
                Apple Mail needs Full Disk Access. Turn it on for Smart Personal Search, then continue.
                <button className={styles.linkBtn} onClick={() => api.openFullDiskAccess()}>
                  Open Privacy Settings
                </button>
              </div>
            )}
            <div className={styles.footer}>
              <button className={styles.primaryBtn} onClick={() => setStep(1)}>
                Continue
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className={styles.title}>Google Drive</h1>
            {driveLocations && driveLocations.length > 0 ? (
              <>
                <p className={styles.subtitle}>Found Google Drive on this Mac. Its files are searched like any folder.</p>
                <div className={styles.options}>{driveLocations.map((l) => checkbox(l.path, l.name))}</div>
              </>
            ) : (
              <>
                <p className={styles.subtitle}>
                  Install Google Drive for desktop and sign in. Your Drive then appears as a folder on this Mac, and I can
                  search it without any extra permissions.
                </p>
                <div className={styles.footer} style={{ justifyContent: 'center' }}>
                  <button className={styles.secondaryBtn} onClick={() => api.launchTarget(DRIVE_DOWNLOAD_URL)}>
                    Get Google Drive
                  </button>
                  <button className={styles.secondaryBtn} onClick={checkDrive}>
                    Check again
                  </button>
                </div>
              </>
            )}
            <div className={styles.footer}>
              <button className={styles.secondaryBtn} onClick={() => setStep(0)}>
                Back
              </button>
              <button className={styles.primaryBtn} onClick={startIndexing}>
                {driveLocations?.length ? 'Start indexing' : 'Skip & start'}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className={styles.title}>You're set</h1>
            <p className={styles.subtitle}>
              Indexing runs in the background. Press <kbd>⌘K</kbd> to search anywhere, or ask a question in chat.
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
