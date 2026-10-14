import React, { useEffect, useRef, useState } from 'react'
import {
  ApiError,
  browseFolder,
  clearDatabase,
  fetchAppSettings,
  indexAppleMail,
  indexApps,
  indexDriveLocations,
  indexICloudLocations,
  indexSettings,
  openSettingsPane,
  removeSource,
  rescanSource,
  startIndex,
  toggleSourceWatch,
  updateAppSettings,
} from '../../api'
import type { AppSettings, ConfiguredSource, DriveLocation, GoogleStatus, IndexJobStatus } from '../../types'
import {
  ChatIcon,
  CloudIcon,
  DatabaseIcon,
  FolderIcon,
  KeyboardIcon,
} from '../common/Icons'
import { GoogleAccountCard } from '../Google/GoogleAccountCard'
import { AssistantTab } from './AssistantTab'
import { MaintenanceTab } from './MaintenanceTab'
import { ShortcutsTab, saveHotkeyPatch } from './ShortcutsTab'
import { SourcesTab } from './SourcesTab'
import { activeJobs, availablePresets } from './settingsUtils'
import styles from './SettingsPage.module.css'
import shared from './SettingsShared.module.css'

const STATUS_CLASS: Record<string, string> = {
  blue: styles.statusInfo,
  emerald: styles.statusSuccess,
  red: styles.statusError,
  amber: styles.statusWarning,
  slate: styles.statusNeutral,
}

type SettingsTab = 'sources' | 'cloud' | 'assistant' | 'shortcuts' | 'maintenance'

const TABS: Array<{ id: SettingsTab; label: string; icon: React.FC<{ className?: string }>; tint: string }> = [
  { id: 'sources', label: 'Sources', icon: FolderIcon, tint: shared.iconAccent },
  { id: 'cloud', label: 'Cloud & Accounts', icon: CloudIcon, tint: shared.iconGreen },
  { id: 'assistant', label: 'Assistant', icon: ChatIcon, tint: shared.iconAccent },
  { id: 'shortcuts', label: 'Shortcuts', icon: KeyboardIcon, tint: shared.iconIndigo },
  { id: 'maintenance', label: 'Maintenance', icon: DatabaseIcon, tint: shared.iconIndigo },
]

interface SettingsPageProps {
  totalItems: number
  sources: ConfiguredSource[]
  googleStatus: GoogleStatus
  indexStatus?: IndexJobStatus | null
  onRefreshSources: () => void
  onStartProgress: () => void
  onRevealTarget: (path: string) => Promise<{ success: boolean; path: string }>
  focusIndexing?: boolean
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  totalItems,
  sources,
  indexStatus,
  onRefreshSources,
  onStartProgress,
  onRevealTarget,
  focusIndexing,
}) => {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('sources')
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
    if (focusIndexing) setActiveTab('sources')
    else titleRef.current?.focus()
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

  const normPath = (p: string) => p.replace(/\/$/, '')
  const isDuplicate = (p: string) => {
    const t = normPath(p)
    return sources.some((s) => {
      const e = normPath(s.path)
      return e === t || t.startsWith(e + '/') || e.startsWith(t + '/')
    })
  }

  const handleAddManual = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!manualPath.trim()) {
      showToast('Please enter a valid folder path.', 'amber')
      return
    }
    if (isDuplicate(manualPath.trim())) {
      showToast(`'${manualPath.trim()}' is already indexed (or overlaps an added source).`, 'amber')
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
        if (isDuplicate(res.path)) {
          showToast(`'${res.name}' is already indexed.`, 'amber')
          return
        }
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

  const handleIndexSettings = async () => {
    showToast('Indexing macOS settings...', 'blue')
    try {
      const data = await indexSettings()
      showToast(data.status === 'queued' ? 'macOS settings queued for indexing.' : 'Indexing macOS settings…', 'emerald')
      onStartProgress()
    } catch (err: any) {
      showToast(`Error indexing settings: ${err.message}`, 'red')
    }
  }

  const handleIndexICloud = async (locations: DriveLocation[]) => {    showToast('Indexing iCloud Drive...', 'blue')
    try {
      await indexICloudLocations(locations)
      showToast('Indexing iCloud Drive…', 'emerald')
      onStartProgress()
      onRefreshSources()
    } catch (err: any) {
      showToast(`Error indexing iCloud Drive: ${err.message}`, 'red')
    }
  }

  const handleIndexDrive = async (locations: DriveLocation[]) => {
    showToast('Indexing Google Drive...', 'blue')
    try {
      await indexDriveLocations(locations)
      showToast('Indexing Google Drive…', 'emerald')
      onStartProgress()
      onRefreshSources()
    } catch (err: any) {
      showToast(`Error indexing Drive: ${err.message}`, 'red')
    }
  }

  const handleIndexAppleMail = async () => {
    showToast('Indexing Apple Mail...', 'blue')
    try {
      await indexAppleMail()
      showToast('Indexing Apple Mail…', 'emerald')
      onStartProgress()
      onRefreshSources()
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'full_disk_access') {
        showToast(err.message, 'amber')
        openSettingsPane('full-disk-access')
      } else {
        showToast(`Error indexing Apple Mail: ${err.message}`, 'red')
      }
    }
  }

  const handleIndexPreset = (p: string) => {
    if (isDuplicate(p)) {
      showToast(`'${p}' is already indexed.`, 'amber')
      return
    }
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
    rescanSource(s.path)
      .then((res) => {
        showToast(res.status === 'queued' ? `Queued rescan for '${s.name}'.` : `Rescanning '${s.name}'...`, 'emerald')
        onStartProgress()
        onRefreshSources()
      })
      .catch((err) => showToast(err.message, 'red'))
  }

  const localSources = sources.filter((s) => s.source_type !== 'macos_system')
  const isGlobalAlwaysOn = appSettings.always_on_scanning
  const presets = availablePresets(sources)
  const hasAppsSource = sources.some((s) => s.source_type === 'macos_system' && !s.path.startsWith('x-apple.systempreferences:'))
  const hasSettingsSource = sources.some((s) => s.path.startsWith('x-apple.systempreferences:'))
  const jobs = activeJobs(indexStatus)
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
            hasSettingsSource={hasSettingsSource}
            isGlobalAlwaysOn={isGlobalAlwaysOn}
            watchedCount={appSettings.watched_paths_count ?? localSources.length}
            totalItems={totalItems}
            indexStatus={indexStatus}
            jobs={jobs}
            manualPath={manualPath}
            onManualPathChange={setManualPath}
            jobForSource={jobForSource}
            onBrowseFinder={handleBrowseFinder}
            onAddManual={handleAddManual}
            onIndexPreset={handleIndexPreset}
            onIndexApps={handleIndexApps}
            onIndexSettings={handleIndexSettings}
            onIndexICloud={handleIndexICloud}
            onIndexDrive={handleIndexDrive}
            onIndexAppleMail={handleIndexAppleMail}
            onToggleAlwaysOn={handleToggleAlwaysOn}
            onToggleSourceWatch={handleToggleSourceWatch}
            onReveal={handleReveal}
            onRescan={handleRescan}
            onRemoveSource={handleRemoveSource}
          />
        )}

        {/* TAB 3: CLOUD & ACCOUNTS */}
        {activeTab === 'cloud' && (
          <div className={shared.panel}>
            <GoogleAccountCard
              sources={sources}
              onRefreshSources={onRefreshSources}
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
