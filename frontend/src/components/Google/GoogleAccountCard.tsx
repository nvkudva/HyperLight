import React from "react";
import { ApiError, indexAppleMail, indexDriveLocations, launchTarget, openSettingsPane, toggleSourceWatch } from "../../api";
import { DRIVE_DOWNLOAD_URL, useDriveLocations } from "../../hooks/useDriveLocations";
import type { ConfiguredSource } from "../../types";
import { CloudIcon, MailIcon } from "../common/Icons";
import ui from "../Settings/SettingsPage.module.css";
import shared from "../Settings/SettingsShared.module.css";
import styles from "./GoogleAccountCard.module.css";

interface GoogleAccountCardProps {
  sources: ConfiguredSource[];
  onRefreshSources: () => void;
  onShowToast: (msg: string, color?: string) => void;
  onStartProgress: () => void;
}

const isOn = (rows: ConfiguredSource[]) => rows.length > 0 && rows.every((s) => s.watch_enabled !== false);

export const GoogleAccountCard: React.FC<GoogleAccountCardProps> = ({ sources, onRefreshSources, onShowToast, onStartProgress }) => {
  const { locations, reload: loadDriveLocations } = useDriveLocations();
  const driveLocations = locations ?? [];
  const driveSources = sources.filter((s) => s.source_type === "google_drive" && !s.path.startsWith("http"));
  const mailSources = sources.filter((s) => s.source_type === "apple_mail");

  const setWatch = async (rows: ConfiguredSource[], enabled: boolean) => {
    await Promise.all(rows.map((s) => toggleSourceWatch(s.path, enabled)));
    onRefreshSources();
  };

  const handleToggleDrive = async () => {
    try {
      if (isOn(driveSources)) {
        await setWatch(driveSources, false);
        onShowToast("Google Drive indexing disabled.", "slate");
      } else if (driveSources.length) {
        await setWatch(driveSources, true);
        onShowToast("Google Drive indexing enabled.", "emerald");
      } else {
        await indexDriveLocations(driveLocations);
        onShowToast("Indexing Google Drive folders...", "emerald");
        onStartProgress();
        onRefreshSources();
      }
    } catch (err) {
      onShowToast((err as Error).message, "red");
    }
  };

  const handleToggleMail = async () => {
    try {
      if (isOn(mailSources)) {
        await setWatch(mailSources, false);
        onShowToast("Apple Mail indexing disabled.", "slate");
        return;
      }
      if (mailSources.length) {
        await setWatch(mailSources, true);
        onShowToast("Apple Mail indexing enabled.", "emerald");
        return;
      }
      await indexAppleMail();
      onShowToast("Indexing Apple Mail...", "emerald");
      onStartProgress();
      onRefreshSources();
    } catch (err) {
      if (err instanceof ApiError && err.code === "full_disk_access") {
        onShowToast(err.message, "amber");
        openSettingsPane("full-disk-access");
      } else {
        onShowToast((err as Error).message, "red");
      }
    }
  };

  return (
    <div className={ui.card} aria-labelledby="settings-cloud-services">
      <div className={ui.cardHeader}>
        <div className={ui.cardHeaderCol}>
          <h2 id="settings-cloud-services" className={ui.cardTitle}>
            Cloud Services
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
              <label className={shared.switch} title="Toggle Google Drive indexing">
                <input type="checkbox" role="switch" checked={isOn(driveSources)} onChange={handleToggleDrive} aria-label="Google Drive indexing" />
                <span className={shared.slider} />
              </label>
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
            <span className={styles.serviceSubtitle}>Add your accounts to Apple Mail, then turn on indexing.</span>
          </div>
          <div className={styles.serviceControls}>
            <button className={ui.button} onClick={() => openSettingsPane("internet-accounts")}>
              Add Account…
            </button>
            <label className={shared.switch} title="Toggle Apple Mail indexing">
              <input type="checkbox" role="switch" checked={isOn(mailSources)} onChange={handleToggleMail} aria-label="Apple Mail indexing" />
              <span className={shared.slider} />
            </label>
          </div>
        </li>
      </ul>
    </div>
  );
};
