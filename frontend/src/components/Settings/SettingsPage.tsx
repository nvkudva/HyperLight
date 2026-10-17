import React, { useEffect, useRef, useState } from 'react'
import {
  clearDatabase,
  fetchAppSettings,
  resetApp,
  toggleSourceWatch,
  updateAppSettings,
} from '../../api'
import { useSourceActions } from '../../hooks/useSourceActions'
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
import { PermissionList } from '../Permission/PermissionList'
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

type SettingsTab = 'sources' | 'cloud' | 'assistant' | 'shortcuts' | 'permissions' | 'maintenance'

const TABS: Array<{ id: SettingsTab; label: string; icon: React.FC<{ className?: string }>; tint: string }> = [
  { id: 'sources', label: 'Sources', icon: FolderIcon, tint: shared.iconAccent },
  { id: 'cloud', label: 'Cloud & Accounts', icon: CloudIcon, tint: shared.iconGreen },
  { id: 'assistant', label: 'Assistant', icon: ChatIcon, tint: shared.iconAccent },
  { id: 'shortcuts', label: 'Shortcuts', icon: KeyboardIcon, tint: shared.iconIndigo },
  { id: 'permissions', label: 'Permissions', icon: ZapIcon, tint: shared.iconGreen },
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

  const sourceActions = useSourceActions({ sources, showToast, onStartProgress, onRefreshSources, onRevealTarget })

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

  const handleResetApp = async () => {
    showToast('Resetting Hyperlight...', 'blue')
    try {
      await resetApp()
      localStorage.clear()
      window.location.reload()
    } catch (err: any) {
      showToast(`Error: ${err.message}`, 'red')
    }
  }

  const localSources = sources.filter((s) => s.source_type !== 'macos_system')
  const isGlobalAlwaysOn = appSettings.always_on_scanning
  const presets = availablePresets(sources)
  const hasAppsSource = sources.some((s) => s.runner === 'macos_apps')
  const hasSettingsSource = sources.some((s) => s.runner === 'macos_settings')
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
          {activeTab !== 'sources' && (
            <header className={styles.pageHeader}>
              <h1 ref={titleRef} tabIndex={-1} className={styles.title}>
                {activeLabel}
              </h1>
            </header>
          )}

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
            jobForSource={jobForSource}
            actions={sourceActions}
            onToggleAlwaysOn={handleToggleAlwaysOn}
            onToggleSourceWatch={handleToggleSourceWatch}
            titleRef={titleRef}
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

        {activeTab === 'permissions' && (
          <div className={shared.panel}>
            <div className={shared.card}>
              <div className={shared.cardHeader}>
                <div className={shared.cardHeaderCol}>
                  <h2 className={shared.cardTitle}>App Permissions</h2>
                  <p className={shared.cardSubtitle}>
                    macOS controls these. Allow each in System Settings, then come back — status updates automatically.
                  </p>
                </div>
              </div>
              <PermissionList />
            </div>
          </div>
        )}

        {activeTab === 'maintenance' && (
          <MaintenanceTab
            totalItems={totalItems}
            sources={sources}
            localSources={localSources}
            onClearDb={handleClearDb}
            onResetApp={handleResetApp}
          />
        )}
        </div>
      </div>
    </main>
  )
}
