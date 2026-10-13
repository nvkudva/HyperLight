import React, { useEffect, useRef, useState } from 'react'
import {
  browseFolder,
  clearDatabase,
  fetchAppSettings,
  fetchNetworkVolumes,
  indexApps,
  removeSource,
  startIndex,
  toggleSourceWatch,
  updateAppSettings,
} from '../../api'
import type { AppSettings, ConfiguredSource, GoogleStatus, IndexJobStatus } from '../../types'
import {
  ChatIcon,
  CloudIcon,
  DatabaseIcon,
  FolderIcon,
  KeyboardIcon,
  ZapIcon,
} from '../common/Icons'
import { GoogleAccountCard } from '../Google/GoogleAccountCard'
import { AssistantTab } from './AssistantTab'
import { MaintenanceTab } from './MaintenanceTab'
import { ScanningTab } from './ScanningTab'
import { ShortcutsTab, saveHotkeyPatch } from './ShortcutsTab'
import { SourcesTab } from './SourcesTab'
import { activeJobs, availablePresets } from './settingsUtils'
import styles from './SettingsPage.module.css'

const STATUS_CLASS: Record<string, string> = {
  blue: styles.statusInfo,
  emerald: styles.statusSuccess,
  red: styles.statusError,
  amber: styles.statusWarning,
  slate: styles.statusNeutral,
}

type SettingsTab = 'sources' | 'scanning' | 'cloud' | 'assistant' | 'shortcuts' | 'maintenance'

const TABS: Array<{ id: SettingsTab; label: string; icon: React.FC<{ className?: string }>; tint: string }> = [
  { id: 'sources', label: 'Sources', icon: FolderIcon, tint: styles.iconAccent },
  { id: 'scanning', label: 'Real-Time Scanning', icon: ZapIcon, tint: styles.iconOrange },
  { id: 'cloud', label: 'Cloud & Accounts', icon: CloudIcon, tint: styles.iconGreen },
  { id: 'assistant', label: 'Assistant', icon: ChatIcon, tint: styles.iconAccent },
  { id: 'shortcuts', label: 'Shortcuts', icon: KeyboardIcon, tint: styles.iconIndigo },
  { id: 'maintenance', label: 'Maintenance', icon: DatabaseIcon, tint: styles.iconIndigo },
]

interface SettingsPageProps {
  totalItems: number
  sources: ConfiguredSource[]
  googleStatus: GoogleStatus
  indexStatus?: IndexJobStatus | null
  onRefreshSources: () => void
  onRefreshGoogleStatus: () => void
  onStartProgress: () => void
  onRevealTarget: (path: string) => Promise<{ success: boolean; path: string }>
  focusIndexing?: boolean
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  totalItems,
  sources,
  googleStatus,
  indexStatus,
  onRefreshSources,
  onRefreshGoogleStatus,
  onStartProgress,
  onRevealTarget,
  focusIndexing,
}) => {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>(focusIndexing ? 'scanning' : 'sources')
  const [manualPath, setManualPath] = useState('')
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null)
  const [appSettings, setAppSettings] = useState<AppSettings>({
    always_on_scanning: true,
    custom_instructions: '',
    hotkey_enabled: true,
    hotkey: 'double_ctrl',
    hotkey_voice: true,
    watched_paths_count: 0,
  })
  const [draftInstructions, setDraftInstructions] = useState('')
  const [savingInstructions, setSavingInstructions] = useState(false)

  // Load app settings
  useEffect(() => {
    fetchAppSettings()
      .then((s) => {
        setAppSettings(s)
        setDraftInstructions(s.custom_instructions ?? '')
      })
      .catch((err) => console.error('Failed to load app settings:', err))
  }, [])

  useEffect(() => {
    if (focusIndexing) {
      setActiveTab('scanning')
    } else {
      titleRef.current?.focus()
    }
  }, [focusIndexing])

  const toastTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  const showToast = (msg: string, color = 'blue') => {
    setToast({ msg, color })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 5000)
  }

  const handleReveal = async (path: string) => {
    try {
      const res = await onRevealTarget(path)
      if (!res.success) showToast(`Could not reveal '${path}' in Finder.`, 'red')
    } catch (err: any) {
      showToast(`Reveal failed: ${err.message}`, 'red')
    }
  }

  const handleToggleAlwaysOn = async () => {
    const nextVal = !appSettings.always_on_scanning
    setAppSettings((prev) => ({ ...prev, always_on_scanning: nextVal }))
    try {
      const updated = await updateAppSettings({ always_on_scanning: nextVal })
      setAppSettings(updated)
      showToast(
        nextVal
          ? 'Always-on real-time scanning enabled.'
          : 'Always-on scanning paused. Folder changes will not auto-index.',
        nextVal ? 'emerald' : 'slate'
      )
    } catch (err: any) {
      setAppSettings((prev) => ({ ...prev, always_on_scanning: !nextVal }))
      showToast(`Failed to update setting: ${err.message}`, 'red')
    }
  }

  const handleSaveHotkey = (patch: Partial<AppSettings>, toastMsg?: string) =>
    saveHotkeyPatch(patch, setAppSettings, showToast, toastMsg)

  const handleSaveInstructions = async () => {
    setSavingInstructions(true)
    try {
      const updated = await updateAppSettings({ custom_instructions: draftInstructions })
      setAppSettings(updated)
      setDraftInstructions(updated.custom_instructions ?? draftInstructions)
      showToast('Assistant instructions saved. They apply to new chat answers.', 'emerald')
    } catch (err: any) {
      showToast(`Failed to save instructions: ${err.message}`, 'red')
    } finally {
      setSavingInstructions(false)
    }
  }

  const handleToggleSourceWatch = async (s: ConfiguredSource) => {
    const nextVal = s.watch_enabled === false
    showToast(
      nextVal ? `Enabled live sync for ${s.name}` : `Paused live sync for ${s.name}`,
      nextVal ? 'emerald' : 'slate'
    )
    try {
      await toggleSourceWatch(s.path, nextVal)
      onRefreshSources()
      fetchAppSettings().then(setAppSettings).catch(() => {})
    } catch (err: any) {
      showToast(`Error updating source: ${err.message}`, 'red')
    }
  }

  const handleAddManual = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!manualPath.trim()) {
      showToast('Please enter a valid folder path.', 'amber')
      return
    }
    showToast(`Adding '${manualPath.trim()}'...`, 'blue')
    try {
      const res = await startIndex(manualPath.trim(), 'local')
      setManualPath('')
      showToast(res.status === 'queued' ? `Queued '${res.name}'.` : `Indexing started for '${res.name}'!`, 'emerald')
      onStartProgress()
      onRefreshSources()
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'red')
    }
  }

  const handleBrowseFinder = async () => {
    showToast('Opening Finder folder picker...', 'blue')
    try {
      const res = await browseFolder('Select a folder to index in Hyperlight')
      if (res.path && !res.canceled) {
        showToast(`Selected '${res.name}'. Indexing...`, 'emerald')
        await startIndex(res.path, 'local', res.name)
        onStartProgress()
        onRefreshSources()
      } else if (res.canceled) {
        showToast('Folder selection canceled.', 'slate')
      }
    } catch (err: any) {
      showToast(`Finder error: ${err.message}`, 'red')
    }
  }

  const handleConnectVolumes = async () => {
    showToast('Scanning mounted network volumes...', 'blue')
    try {
      const res = await fetchNetworkVolumes()
      if (res.volumes && res.volumes.length > 0) {
        const v = res.volumes[0]
        showToast(`Connecting network volume '${v.name}'...`, 'emerald')
        await startIndex(v.path, 'network_volume', v.name)
        onStartProgress()
        onRefreshSources()
      } else {
        showToast('No mounted volumes in /Volumes. Select your share in Finder...', 'blue')
        await handleBrowseFinder()
      }
    } catch (err: any) {
      showToast(`Volume scan error: ${err.message}`, 'red')
    }
  }

  const handleRemoveSource = async (path: string) => {
    showToast('Removing source...', 'blue')
    try {
      await removeSource(path)
      showToast('Source removed.', 'emerald')
      onRefreshSources()
    } catch (err: any) {
      showToast(`Error removing source: ${err.message}`, 'red')
    }
  }

  const handleClearDb = async () => {
    if (!confirm('Are you sure you want to clear all indexed items? This will reset your database.')) return
    showToast('Clearing vector database...', 'blue')
    try {
      await clearDatabase()
      showToast('Database reset.', 'slate')
      onRefreshSources()
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'red')
    }
  }

  const handleIndexApps = async () => {
    showToast('Indexing macOS applications...', 'blue')
    try {
      const data = await indexApps()
      showToast(data.status === 'queued' ? 'macOS applications queued for indexing.' : 'Indexing macOS applications…', 'emerald')
      onStartProgress()
    } catch (err: any) {
      showToast(`Error indexing apps: ${err.message}`, 'red')
    }
  }

  const handleIndexPreset = (p: string) => {
    showToast(`Indexing ${p}...`, 'blue')
    startIndex(p, 'local')
      .then(() => {
        showToast(`Started index for ${p}`, 'emerald')
        onStartProgress()
        onRefreshSources()
      })
      .catch((err) => showToast(err.message, 'red'))
  }

  const handleRescan = (s: ConfiguredSource) => {
    showToast(`Rescanning ${s.name}...`, 'blue')
    startIndex(s.path, s.source_type, s.name)
      .then(() => onStartProgress())
      .catch((err) => showToast(err.message, 'red'))
  }

  const localSources = sources.filter((s) => s.source_type !== 'macos_system')
  const isGlobalAlwaysOn = appSettings.always_on_scanning
  const presets = availablePresets(sources)
  const hasAppsSource = sources.some((s) => s.source_type === 'macos_system')
  const jobs = activeJobs(indexStatus)
  const queuedJobs = jobs.filter((j) => j.state === 'queued')
  const jobForSource = (s: ConfiguredSource) =>
    jobs.find((j) => (j.path ? j.path === s.path : j.name === s.name))

  const activeLabel = TABS.find((t) => t.id === activeTab)?.label ?? 'Settings'

  return (
    <main className={styles.page}>
      <nav className={styles.sideNav} aria-label="Settings categories">
        {TABS.map((t) => {
          const Icon = t.icon
          const isActive = t.id === activeTab
          return (
            <button
              key={t.id}
              className={`${styles.navButton} ${isActive ? styles.navButtonActive : ''}`}
              onClick={() => setActiveTab(t.id)}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className={`${styles.navIconTile} ${t.tint}`}>
                <Icon className="w-3.5 h-3.5" />
              </span>
              <span>{t.label}</span>
              {t.id === 'scanning' && indexStatus?.is_running && <span className={`${styles.tabDot} ${styles.navDot}`} />}
            </button>
          )
        })}
      </nav>

      <div className={`${styles.detail} custom-scroll`}>
        <div className={styles.content}>
          <header className={styles.pageHeader}>
            <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
              {activeLabel}
            </h1>
            <div className={styles.headerMeta}>
              <span>{totalItems.toLocaleString()} items</span>
              {isGlobalAlwaysOn && <span className={styles.tabDot} title="Live Real-Time Watching Active" />}
            </div>
          </header>

          {toast && (
          <div role="status" className={`${styles.status} ${STATUS_CLASS[toast.color] ?? styles.statusInfo}`}>
            {toast.msg}
          </div>
        )}

        {/* TAB 1: SOURCES & FOLDERS */}
        {activeTab === 'sources' && (
          <SourcesTab
            sources={sources}
            availablePresets={presets}
            hasAppsSource={hasAppsSource}
            isGlobalAlwaysOn={isGlobalAlwaysOn}
            watchedCount={appSettings.watched_paths_count ?? localSources.length}
            totalItems={totalItems}
            indexStatus={indexStatus}
            jobs={jobs}
            googleConnected={googleStatus.connected}
            manualPath={manualPath}
            onManualPathChange={setManualPath}
            jobForSource={jobForSource}
            onBrowseFinder={handleBrowseFinder}
            onConnectVolumes={handleConnectVolumes}
            onAddManual={handleAddManual}
            onIndexPreset={handleIndexPreset}
            onIndexApps={handleIndexApps}
            onToggleAlwaysOn={handleToggleAlwaysOn}
            onToggleSourceWatch={handleToggleSourceWatch}
            onReveal={handleReveal}
            onRescan={handleRescan}
            onRemoveSource={handleRemoveSource}
            onOpenCloudTab={() => setActiveTab('cloud')}
          />
        )}

        {/* TAB 2: REAL-TIME SCANNING */}
        {activeTab === 'scanning' && (
          <ScanningTab
            isGlobalAlwaysOn={isGlobalAlwaysOn}
            watchedCount={appSettings.watched_paths_count ?? localSources.length}
            localSources={localSources}
            indexStatus={indexStatus}
            queuedJobs={queuedJobs}
            onToggleAlwaysOn={handleToggleAlwaysOn}
            onToggleSourceWatch={handleToggleSourceWatch}
          />
        )}

        {/* TAB 3: CLOUD & ACCOUNTS */}
        {activeTab === 'cloud' && (
          <div className={styles.panel}>
            <GoogleAccountCard
              status={googleStatus}
              indexStatus={indexStatus}
              onRefreshStatus={onRefreshGoogleStatus}
              onShowToast={showToast}
              onStartProgress={onStartProgress}
            />
          </div>
        )}

        {activeTab === 'assistant' && (
          <AssistantTab
            draftInstructions={draftInstructions}
            savedInstructions={appSettings.custom_instructions ?? ''}
            saving={savingInstructions}
            onDraftChange={setDraftInstructions}
            onSave={handleSaveInstructions}
          />
        )}

        {activeTab === 'shortcuts' && (
          <ShortcutsTab
            settings={appSettings}
            onSaveHotkey={handleSaveHotkey}
            onShowToast={showToast}
          />
        )}

        {activeTab === 'maintenance' && (
          <MaintenanceTab
            totalItems={totalItems}
            sources={sources}
            localSources={localSources}
            onClearDb={handleClearDb}
          />
        )}
        </div>
      </div>
    </main>
  )
}
