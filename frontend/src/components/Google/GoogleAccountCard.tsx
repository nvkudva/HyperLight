import React from "react";
import { ApiError, disconnectGoogle, indexAppleMail, indexDriveLocations, launchTarget, openSettingsPane, syncCloudDrive, syncCloudPhotos, syncGmail } from "../../api";
import { DRIVE_DOWNLOAD_URL, useDriveLocations } from "../../hooks/useDriveLocations";
import { useGoogleSignIn } from "../../hooks/useGoogleSignIn";
import type { GoogleStatus, IndexJobStatus } from "../../types";
import { CloudIcon, GoogleLogo, MailIcon, PhotoIcon } from "../common/Icons";
import { ProgressBar } from "../common/ProgressBar";
import ui from "../Settings/SettingsPage.module.css";
import styles from "./GoogleAccountCard.module.css";

interface GoogleAccountCardProps {
  status: GoogleStatus;
  indexStatus?: IndexJobStatus | null;
  onRefreshStatus: () => void;
  onShowToast: (msg: string, color?: string) => void;
  onStartProgress: () => void;
}

export const GoogleAccountCard: React.FC<GoogleAccountCardProps> = ({ status, indexStatus, onRefreshStatus, onShowToast, onStartProgress }) => {
  const { signIn, isSigningIn } = useGoogleSignIn();
  const { locations, reload: loadDriveLocations } = useDriveLocations();
  const driveLocations = locations ?? [];

  const handleIndexDrive = async () => {
    await indexDriveLocations(driveLocations);
    onShowToast("Indexing Google Drive folders...", "emerald");
    onStartProgress();
  };

  const handleIndexMail = async () => {
    try {
      await indexAppleMail();
    } catch (err) {
      if (err instanceof ApiError && err.code === "full_disk_access") {
        onShowToast(err.message, "amber");
        openSettingsPane("full-disk-access");
      } else {
        onShowToast((err as Error).message, "red");
      }
      return;
    }
    onShowToast("Indexing Apple Mail...", "emerald");
    onStartProgress();
  };

  const handleSignIn = async () => {
    onShowToast("Opening Google Sign-In in browser...", "blue");
    try {
      const st = await signIn();
      onShowToast(`Connected as ${st.user?.name || st.user?.email || "Google user"}!`, "emerald");
      onRefreshStatus();
    } catch (err: any) {
      onShowToast(err.message, "red");
    }
  };

  const handleSyncDrive = async () => {
    onShowToast("Starting Google Drive cloud sync...", "blue");
    try {
      await syncCloudDrive();
      onShowToast("Syncing Google Drive files...", "emerald");
      onStartProgress();
    } catch (err: any) {
      onShowToast(`Sync error: ${err.message}`, "red");
    }
  };

  const handleSyncPhotos = async () => {
    try {
      await syncCloudPhotos();
      onShowToast("Pick the photos to index in the Google Photos window that just opened.", "blue");
      onStartProgress();
    } catch (err: any) {
      onShowToast(`Sync error: ${err.message}`, "red");
    }
  };

  const handleSyncGmail = async () => {
    await syncGmail();
    onShowToast("Syncing Gmail...", "emerald");
    onStartProgress();
  };

  const handleDisconnect = async () => {
    onShowToast("Disconnecting Google Account...", "blue");
    try {
      await disconnectGoogle();
      onShowToast("Google account disconnected.", "slate");
      onRefreshStatus();
    } catch (err: any) {
      onShowToast(`Error: ${err.message}`, "red");
    }
  };

  const cloudJob = indexStatus?.is_cloud ? indexStatus : null;
  const user = status.connected ? status.user : undefined;

  return (
    <>
      <div className={ui.card} aria-labelledby="settings-google-account">
        <div className={ui.cardHeader}>
          <div className={ui.cardHeaderCol}>
            <h2 id="settings-google-account" className={ui.cardTitle}>
              Google Account
            </h2>
            <p className={ui.cardSubtitle}>Connect Google to index Photos, Drive and Gmail.</p>
          </div>
          {user && <span className={`${ui.badge} ${ui.badgeSuccess}`}>● Connected</span>}
        </div>

        {user ? (
          <div className={styles.accountRow}>
            <img src={user.picture || "https://www.gstatic.com/images/branding/product/2x/avatar_square_grey_96dp.png"} className={styles.avatar} alt="" />
            <div className={styles.accountText}>
              <span className={styles.accountName}>{user.name || "Google User"}</span>
              <span className={styles.accountEmail}>{user.email || ""}</span>
            </div>
            <button className={`${ui.button} ${ui.destructive}`} onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        ) : (
          <div className={styles.accountRow}>
            <span className={styles.logoBadge}>
              <GoogleLogo className="w-3.5 h-3.5" />
            </span>
            <div className={styles.accountText}>
              <span className={styles.accountName}>Not connected</span>
              <span className={styles.accountEmail}>{status.has_client_config ? "Sign in to enable Photos, Drive and Gmail sync." : "Google sign-in is not configured in this build."}</span>
            </div>
            <button className={`${ui.button} ${ui.primary}`} onClick={handleSignIn} disabled={isSigningIn || !status.has_client_config}>
              {isSigningIn ? "Waiting for browser..." : "Sign in with Google"}
            </button>
          </div>
        )}
      </div>

      <div className={ui.card} aria-labelledby="settings-cloud-services">
        <div className={ui.cardHeader}>
          <div className={ui.cardHeaderCol}>
            <h2 id="settings-cloud-services" className={ui.cardTitle}>
              Connected Services
            </h2>
            <p className={ui.cardSubtitle}>Index cloud content into local search.</p>
          </div>
        </div>

        <ul className={styles.serviceList}>
          <li className={styles.serviceRow}>
            <span className={`${styles.serviceIcon} ${styles.tintAccent}`}>
              <CloudIcon className="w-4 h-4" />
            </span>
            <div className={styles.serviceText}>
              <span className={styles.serviceTitle}>
                Google Drive
                {driveLocations.length > 0 && <span className={`${ui.badge} ${ui.badgeSuccess}`}>● Found</span>}
              </span>
              <span className={styles.serviceSubtitle}>{driveLocations.length ? `Drive for desktop · ${driveLocations.map((l) => l.account || l.name).join(", ")}` : "Install Drive for desktop to search your Drive files."}</span>
            </div>
            <div className={styles.serviceControls}>
              {driveLocations.length ? (
                <button className={ui.button} onClick={handleIndexDrive}>
                  Index
                </button>
              ) : (
                <>
                  <button className={ui.button} onClick={loadDriveLocations}>
                    Check Again
                  </button>
                  <button className={ui.button} onClick={() => launchTarget(DRIVE_DOWNLOAD_URL)}>
                    Download…
                  </button>
                </>
              )}
            </div>
          </li>

          <li className={styles.serviceRow}>
            <span className={`${styles.serviceIcon} ${styles.tintOrange}`}>
              <MailIcon className="w-4 h-4" />
            </span>
            <div className={styles.serviceText}>
              <span className={styles.serviceTitle}>Apple Mail</span>
              <span className={styles.serviceSubtitle}>Add your Google account to Apple Mail, then index Mail.</span>
            </div>
            <div className={styles.serviceControls}>
              <button className={ui.button} onClick={() => openSettingsPane("internet-accounts")}>
                Add Account…
              </button>
              <button className={ui.button} onClick={handleIndexMail}>
                Index Mail
              </button>
            </div>
          </li>

          <li className={styles.serviceRow}>
            <span className={`${styles.serviceIcon} ${styles.tintGreen}`}>
              <PhotoIcon className="w-4 h-4" />
            </span>
            <div className={styles.serviceText}>
              <span className={styles.serviceTitle}>
                Google Photos
                {!user && <span className={`${ui.badge} ${ui.badgeNeutral}`}>Sign-in required</span>}
              </span>
              <span className={styles.serviceSubtitle}>{user ? "Search an album name in the picker, then select its photos." : status.has_client_config ? "Sign in above, then choose the photos or albums to index." : "Google sign-in is not configured in this build."}</span>
            </div>
            {user && (
              <div className={styles.serviceControls}>
                <button className={ui.button} onClick={handleSyncPhotos}>
                  Choose Photos…
                </button>
              </div>
            )}
          </li>

          {user && status.full_access && (
            <>
              <li className={styles.serviceRow}>
                <span className={`${styles.serviceIcon} ${styles.tintIndigo}`}>
                  <CloudIcon className="w-4 h-4" />
                </span>
                <div className={styles.serviceText}>
                  <span className={styles.serviceTitle}>Google Drive (API)</span>
                  <span className={styles.serviceSubtitle}>Sync Drive files directly through the Google API.</span>
                </div>
                <div className={styles.serviceControls}>
                  <button className={ui.button} onClick={handleSyncDrive}>
                    Sync
                  </button>
                </div>
              </li>
              <li className={styles.serviceRow}>
                <span className={`${styles.serviceIcon} ${styles.tintIndigo}`}>
                  <MailIcon className="w-4 h-4" />
                </span>
                <div className={styles.serviceText}>
                  <span className={styles.serviceTitle}>Gmail (API)</span>
                  <span className={styles.serviceSubtitle}>Sync Gmail directly through the Google API.</span>
                </div>
                <div className={styles.serviceControls}>
                  <button className={ui.button} onClick={handleSyncGmail}>
                    Sync
                  </button>
                </div>
              </li>
            </>
          )}
        </ul>

        {cloudJob?.is_running && (
          <div className={styles.syncBlock}>
            <ProgressBar status={cloudJob.status} percent={cloudJob.percent} />
          </div>
        )}
        {cloudJob?.state === "error" && (
          <div className={`${styles.syncBlock} ${styles.error}`} role="alert">
            <span className={styles.errorTitle}>Sync error</span>
            <span>{cloudJob.status.replace("Error during indexing: ", "")}</span>
            {cloudJob.error_code === "reauth_required" && (
              <button className={`${ui.button} ${ui.primary} ${styles.fitContent}`} onClick={handleSignIn} disabled={isSigningIn}>
                {isSigningIn ? "Waiting for browser..." : "Sign in with Google to Authorize"}
              </button>
            )}
          </div>
        )}
        {cloudJob?.state === "finished" && (
          <div className={`${styles.syncBlock} ${styles.success}`} role="status">
            ✓ {cloudJob.status}
          </div>
        )}
      </div>
    </>
  );
};
