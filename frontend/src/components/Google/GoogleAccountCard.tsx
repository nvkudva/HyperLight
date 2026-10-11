import React, { useState } from 'react'
import {
  disconnectGoogle,
  fetchGoogleAuthUrl,
  quickConnectGoogle,
  saveGoogleConfig,
  syncCloudDrive,
  syncCloudPhotos,
} from '../../api'
import type { GoogleStatus, IndexJobStatus } from '../../types'
import { CloudIcon, GoogleLogo, PhotoIcon, SettingsIcon } from '../common/Icons'
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
  const [showCreds, setShowCreds] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const handleQuickLink = async () => {
    onShowToast('Linking active Mac Google account...', 'blue')
    try {
      const res = await quickConnectGoogle()
      if (res.status === 'success' && res.user) {
        onShowToast(`Connected as ${res.user.name || res.user.email}!`, 'emerald')
        onRefreshStatus()
      } else {
        onShowToast(res.error || 'No active account found. Please sign in via Google.', 'amber')
      }
    } catch (err: any) {
      onShowToast(`Quick link error: ${err.message}`, 'red')
    }
  }

  const handleSignIn = async () => {
    onShowToast('Opening Google Sign-In...', 'blue')
    try {
      const res = await fetchGoogleAuthUrl()
      if (res.url) {
        window.open(res.url, '_blank', 'width=550,height=650')
      } else if (res.error) {
        onShowToast(res.error, 'red')
        setShowCreds(true)
      }
    } catch (err: any) {
      onShowToast(`Login error: ${err.message}`, 'red')
    }
  }

  const handleSaveCreds = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      onShowToast('Please enter both Client ID and Client Secret.', 'amber')
      return
    }
    try {
      await saveGoogleConfig(clientId.trim(), clientSecret.trim())
      onShowToast('Google credentials saved!', 'emerald')
      setShowCreds(false)
      onRefreshStatus()
    } catch (err: any) {
      onShowToast(`Error saving credentials: ${err.message}`, 'red')
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
    onShowToast('Starting Google Photos cloud sync...', 'blue')
    try {
      const res = await syncCloudPhotos()
      if (res.status === 'started') {
        onShowToast('Syncing Google Photos library...', 'emerald')
        onStartProgress()
      } else {
        onShowToast(res.message || 'Error starting Photos sync', 'amber')
      }
    } catch (err: any) {
      onShowToast(`Sync error: ${err.message}`, 'red')
    }
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

  if (status.connected && status.user) {
    const user = status.user
    const pic = user.picture || 'https://www.gstatic.com/images/branding/product/2x/avatar_square_grey_96dp.png'

    return (
      <div className={styles.card}>
        <div className={styles.row}>
          <div className={styles.leftGroup}>
            <img src={pic} className={styles.avatar} alt="Avatar" />
            <div>
              <div className={styles.nameRow}>
                <span className={styles.userName}>{user.name || 'Google User'}</span>
                <span className={styles.connectedPill}>● Connected</span>
              </div>
              <div className={styles.userEmail}>{user.email || ''}</div>
            </div>
          </div>

          <div className={styles.actionsGroup}>
            <button className={styles.syncDriveBtn} onClick={handleSyncDrive}>
              <CloudIcon className="w-3.5 h-3.5" />
              <span>Sync Drive</span>
            </button>
            <button className={styles.syncPhotosBtn} onClick={handleSyncPhotos}>
              <PhotoIcon className="w-3.5 h-3.5" />
              <span>Sync Photos</span>
            </button>
            <button className={styles.disconnectBtn} onClick={handleDisconnect} title="Disconnect Account">
              &times;
            </button>
          </div>
        </div>

        {indexStatus && (indexStatus.current_source === 'google_photos_cloud' || indexStatus.current_source === 'google_drive_cloud') && (
          <div>
            {indexStatus.is_running && (
              <div className={styles.statusBox}>
                <div className={styles.statusHeader}>
                  <span className={styles.statusText}>{indexStatus.status}</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{Math.round(indexStatus.percent)}%</span>
                </div>
                <div className={styles.progressBarContainer}>
                  <div className={styles.progressBar} style={{ width: `${indexStatus.percent}%` }} />
                </div>
              </div>
            )}
            {!indexStatus.is_running && indexStatus.status.toLowerCase().includes('error') && (
              <div className={styles.errorBox}>
                <div className={styles.errorHeader}>
                  <span>⚠️ Sync Error</span>
                </div>
                <div>{indexStatus.status.replace('Error during indexing: ', '')}</div>
                {indexStatus.status.toLowerCase().includes('permission not granted') && (
                  <button className={styles.errorActionBtn} onClick={handleSignIn}>
                    Sign in with Google to Authorize
                  </button>
                )}
              </div>
            )}
            {!indexStatus.is_running && indexStatus.status.toLowerCase().includes('finished') && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.6875rem', color: '#15803d', fontWeight: 600 }}>
                ✓ {indexStatus.status}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <div className={styles.leftGroup}>
          <div className={styles.googleLogoBadge}>
            <GoogleLogo className="w-4 h-4" />
          </div>
          <div>
            <div className={styles.userName}>Google Drive & Google Photos</div>
            <div className={styles.userEmail}>Sign in to search cloud Drive docs & Photos library.</div>
          </div>
        </div>

        <div className={styles.actionsGroup}>
          <button className={styles.quickLinkBtn} onClick={handleQuickLink} title="Link active Mac Google account">
            <span>⚡ Quick Link</span>
          </button>
          <button className={styles.signInBtn} onClick={handleSignIn}>
            <span>Sign in with Google</span>
          </button>
          <button
            className={styles.configToggleBtn}
            onClick={() => setShowCreds(!showCreds)}
            title="OAuth Credentials Config"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {showCreds && (
        <div className={styles.credsPanel}>
          <div style={{ fontSize: '0.625rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
            OAuth 2.0 Client Credentials
          </div>
          <div className={styles.credsInputs}>
            <input
              type="text"
              placeholder="Google Client ID"
              className={styles.inputField}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
            <input
              type="password"
              placeholder="Google Client Secret"
              className={styles.inputField}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.625rem', color: '#94a3b8' }}>Default: Google Desktop App / ADC</span>
            <button className={styles.saveCredsBtn} onClick={handleSaveCreds}>
              Save Credentials
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
