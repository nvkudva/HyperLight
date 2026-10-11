import React, { useCallback, useEffect, useState } from 'react'
import {
  disconnectGoogle,
  fetchDriveLocations,
  indexAppleMail,
  launchTarget,
  openFullDiskAccess,
  openInternetAccounts,
  startIndex,
  syncCloudDrive,
  syncCloudPhotos,
  syncGmail,
} from '../../api'
import { useGoogleSignIn } from '../../hooks/useGoogleSignIn'
import type { GoogleStatus, IndexJobStatus } from '../../types'
import { GoogleLogo } from '../common/Icons'
import ui from '../Settings/SettingsPage.module.css'
import styles from './GoogleAccountCard.module.css'

interface GoogleAccountCardProps {
  status: GoogleStatus
  indexStatus?: IndexJobStatus | null
  onRefreshStatus: () => void
  onShowToast: (msg: string, color?: string) => void
  onStartProgress: () => void
}

export const GoogleAccountCard: React.FC<GoogleAccountCardProps> = ({
  status,
  indexStatus,
  onRefreshStatus,
  onShowToast,
  onStartProgress,
}) => {
  const { signIn, isSigningIn } = useGoogleSignIn()
  const [driveLocations, setDriveLocations] = useState<Array<{ name: string; path: string; account: string }>>([])

  const loadDriveLocations = useCallback(async () => {
    try {
      setDriveLocations((await fetchDriveLocations()).locations)
    } catch {
      setDriveLocations([])
    }
  }, [])

  useEffect(() => {
    loadDriveLocations()
  }, [loadDriveLocations])

  const handleIndexDrive = async () => {
    for (const loc of driveLocations) {
      await startIndex(loc.path, 'google_drive', loc.name)
    }
    onShowToast('Indexing Google Drive folders...', 'emerald')
    onStartProgress()
  }

  const handleIndexMail = async () => {
    const res = await indexAppleMail()
    if (res.error === 'full_disk_access') {
      onShowToast(res.message || 'Grant Full Disk Access, then retry.', 'amber')
      openFullDiskAccess()
      return
    }
    if (res.error) {
      onShowToast(res.error, 'red')
      return
    }
    onShowToast('Indexing Apple Mail...', 'emerald')
    onStartProgress()
  }

  const handleSignIn = async () => {
    onShowToast('Opening Google Sign-In in browser...', 'blue')
    try {
      const st = await signIn()
      onShowToast(`Connected as ${st.user?.name || st.user?.email || 'Google user'}!`, 'emerald')
      onRefreshStatus()
    } catch (err: any) {
      onShowToast(err.message, 'red')
    }
  }

  const handleSyncDrive = async () => {
    onShowToast('Starting Google Drive cloud sync...', 'blue')
    try {
      const res = await syncCloudDrive()
      if (res.status === 'started') {
        onShowToast('Syncing Google Drive files...', 'emerald')
        onStartProgress()
      } else {
        onShowToast(res.message || 'Error starting Drive sync', 'amber')
      }
    } catch (err: any) {
      onShowToast(`Sync error: ${err.message}`, 'red')
    }
  }

  const handleSyncPhotos = async () => {
    try {
      const res = await syncCloudPhotos()
      if (res.error) {
        onShowToast(res.error, 'red')
        return
      }
      onShowToast('Pick the photos to index in the Google Photos window that just opened.', 'blue')
      onStartProgress()
    } catch (err: any) {
      onShowToast(`Sync error: ${err.message}`, 'red')
    }
  }

  const handleSyncGmail = async () => {
    await syncGmail()
    onShowToast('Syncing Gmail...', 'emerald')
    onStartProgress()
  }

  const handleDisconnect = async () => {
    onShowToast('Disconnecting Google Account...', 'blue')
    try {
      await disconnectGoogle()
      onShowToast('Google account disconnected.', 'slate')
      onRefreshStatus()
    } catch (err: any) {
      onShowToast(`Error: ${err.message}`, 'red')
    }
  }

  const cloudJob =
    indexStatus && ['google_photos_cloud', 'google_drive_cloud', 'gmail_cloud'].includes(indexStatus.current_source)
      ? indexStatus
      : null

  const renderSection = (rows: React.ReactNode) => (
    <section className={ui.section} aria-labelledby="settings-google">
      <h2 id="settings-google" className={ui.sectionHeader}>
        Google
      </h2>
      <div className={ui.group}>{rows}</div>
    </section>
  )

  const user = status.connected ? status.user : undefined

  return renderSection(
    <>
      <div className={ui.row}>
        <div className={ui.rowText}>
          <span className={ui.rowTitle}>Google Drive</span>
          <span className={ui.rowSubtitle}>
            {driveLocations.length
              ? `Drive for desktop · ${driveLocations.map((l) => l.account || l.name).join(', ')}`
              : 'Install Drive for desktop to search your Drive files.'}
          </span>
        </div>
        <div className={ui.rowControls}>
          {driveLocations.length ? (
            <button className={ui.button} onClick={handleIndexDrive}>
              Index
            </button>
          ) : (
            <>
              <button className={ui.button} onClick={loadDriveLocations}>
                Check Again
              </button>
              <button className={ui.button} onClick={() => launchTarget('https://www.google.com/drive/download/')}>
                Download…
              </button>
            </>
          )}
        </div>
      </div>

      <div className={ui.row}>
        <div className={ui.rowText}>
          <span className={ui.rowTitle}>Gmail</span>
          <span className={ui.rowSubtitle}>Add your Google account to Apple Mail, then index Mail.</span>
        </div>
        <div className={ui.rowControls}>
          <button className={ui.button} onClick={() => openInternetAccounts()}>
            Add Account…
          </button>
          <button className={ui.button} onClick={handleIndexMail}>
            Index Mail
          </button>
        </div>
      </div>

      <div className={ui.row}>
        <div className={ui.rowLabel}>
          <span className={styles.logoBadge}>
            <GoogleLogo className="w-3.5 h-3.5" />
          </span>
          <div className={ui.rowText}>
            <span className={ui.rowTitle}>Google Photos</span>
            <span className={ui.rowSubtitle}>
              {user
                ? 'Search an album name in the picker, then select its photos.'
                : status.has_client_config
                  ? 'Sign in, then choose the photos or albums to index.'
                  : 'Google sign-in is not configured in this build.'}
            </span>
          </div>
        </div>
        {user ? (
          <button className={ui.button} onClick={handleSyncPhotos}>
            Choose Photos…
          </button>
        ) : (
          <button
            className={`${ui.button} ${ui.primary}`}
            onClick={handleSignIn}
            disabled={isSigningIn || !status.has_client_config}
          >
            {isSigningIn ? 'Waiting for browser...' : 'Sign in with Google'}
          </button>
        )}
      </div>

      {user && status.full_access && (
        <>
          <div className={ui.row}>
            <span className={ui.rowTitle}>Google Drive (API)</span>
            <button className={ui.button} onClick={handleSyncDrive}>
              Sync
            </button>
          </div>
          <div className={ui.row}>
            <span className={ui.rowTitle}>Gmail (API)</span>
            <button className={ui.button} onClick={handleSyncGmail}>
              Sync
            </button>
          </div>
        </>
      )}

      {cloudJob?.is_running && (
        <div className={`${ui.row} ${ui.rowStacked}`} role="status">
          <div className={styles.progressHeader}>
            <span className={styles.progressText}>{cloudJob.status}</span>
            <span className={styles.progressPercent}>{Math.round(cloudJob.percent)}%</span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${cloudJob.percent}%` }} />
          </div>
        </div>
      )}
      {cloudJob && !cloudJob.is_running && cloudJob.status.toLowerCase().includes('error') && (
        <div className={`${ui.row} ${ui.rowStacked} ${styles.error}`} role="alert">
          <span className={styles.errorTitle}>Sync error</span>
          <span>{cloudJob.status.replace('Error during indexing: ', '')}</span>
          {cloudJob.status.toLowerCase().includes('permission not granted') && (
            <button
              className={`${ui.button} ${ui.primary} ${styles.fitContent}`}
              onClick={handleSignIn}
              disabled={isSigningIn}
            >
              {isSigningIn ? 'Waiting for browser...' : 'Sign in with Google to Authorize'}
            </button>
          )}
        </div>
      )}
      {cloudJob && !cloudJob.is_running && cloudJob.status.toLowerCase().includes('finished') && (
        <div className={`${ui.row} ${styles.success}`} role="status">
          ✓ {cloudJob.status}
        </div>
      )}

      {user && (
        <div className={ui.row}>
          <div className={ui.rowLabel}>
            <img
              src={user.picture || 'https://www.gstatic.com/images/branding/product/2x/avatar_square_grey_96dp.png'}
              className={styles.avatar}
              alt=""
            />
            <div className={ui.rowText}>
              <span className={ui.rowTitle}>{user.name || 'Google User'}</span>
              <span className={ui.rowSubtitle}>{user.email || ''}</span>
            </div>
          </div>
          <button className={`${ui.button} ${ui.destructive}`} onClick={handleDisconnect}>
            Disconnect
          </button>
        </div>
      )}
    </>
  )
}
