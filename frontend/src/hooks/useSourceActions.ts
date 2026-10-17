import * as api from '../api'
import type { ConfiguredSource, DriveLocation } from '../types'

type ShowToast = (msg: string, color?: string) => void
type JobResponse = { status?: string; name?: string }

interface SourceActionsOptions {
  sources: ConfiguredSource[]
  showToast: ShowToast
  onStartProgress: () => void
  onRefreshSources: () => void
  onRevealTarget: (path: string) => Promise<{ success: boolean; path: string }>
}

const trimSlash = (path: string) => path.replace(/\/$/, '')

/** Add, index, rescan, reveal and remove sources, reporting each outcome as a toast. */
export function useSourceActions({ sources, showToast, onStartProgress, onRefreshSources, onRevealTarget }: SourceActionsOptions) {
  const overlapsExisting = (path: string) => {
    const target = trimSlash(path)
    return sources.some((s) => {
      const existing = trimSlash(s.path)
      return existing === target || target.startsWith(existing + '/') || existing.startsWith(target + '/')
    })
  }

  const reportError = (err: any, prefix: string) => {
    if (err instanceof api.ApiError && err.code === 'full_disk_access') {
      showToast(err.message, 'amber')
      api.openSettingsPane('full-disk-access')
      return
    }
    showToast(`${prefix}${err.message}`, 'red')
  }

  /** Runs one indexing request; true when the job was accepted. */
  const startJob = async (
    pendingMsg: string,
    request: () => Promise<unknown>,
    doneMsg: (res: JobResponse) => string,
    errorPrefix: string,
  ) => {
    showToast(pendingMsg, 'blue')
    try {
      const res = ((await request()) ?? {}) as JobResponse
      showToast(doneMsg(res), 'emerald')
      onStartProgress()
      onRefreshSources()
      return true
    } catch (err: any) {
      reportError(err, errorPrefix)
      return false
    }
  }

  const addFolder = async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) {
      showToast('Please enter a valid folder path.', 'amber')
      return false
    }
    if (overlapsExisting(trimmed)) {
      showToast(`'${trimmed}' is already indexed (or overlaps an added source).`, 'amber')
      return false
    }
    return startJob(
      `Adding '${trimmed}'...`,
      () => api.startIndex(trimmed, 'local'),
      (res) => (res.status === 'queued' ? `Queued '${res.name}'.` : `Indexing started for '${res.name}'!`),
      'Error: ',
    )
  }

  const browseFinder = async () => {
    showToast('Opening Finder folder picker...', 'blue')
    try {
      const res = await api.browseFolder('Select a folder to index in Hyperlight')
      if (res.canceled) {
        showToast('Folder selection canceled.', 'slate')
        return
      }
      if (!res.path) return
      if (overlapsExisting(res.path)) {
        showToast(`'${res.name}' is already indexed.`, 'amber')
        return
      }
      await startJob(`Selected '${res.name}'. Indexing...`, () => api.startIndex(res.path, 'local', res.name), () => `Indexing '${res.name}'…`, 'Finder error: ')
    } catch (err: any) {
      reportError(err, 'Finder error: ')
    }
  }

  const indexPreset = (path: string) => {
    if (overlapsExisting(path)) {
      showToast(`'${path}' is already indexed.`, 'amber')
      return
    }
    startJob(`Indexing ${path}...`, () => api.startIndex(path, 'local'), () => `Started index for ${path}`, '')
  }

  const queuedOr = (queuedMsg: string, startedMsg: string) => (res: JobResponse) =>
    res.status === 'queued' ? queuedMsg : startedMsg

  return {
    addFolder,
    browseFinder,
    indexPreset,
    indexApps: () =>
      startJob('Indexing macOS applications...', api.indexApps, queuedOr('macOS applications queued for indexing.', 'Indexing macOS applications…'), 'Error indexing apps: '),
    indexSettings: () =>
      startJob('Indexing macOS settings...', api.indexSettings, queuedOr('macOS settings queued for indexing.', 'Indexing macOS settings…'), 'Error indexing settings: '),
    indexICloud: (locations: DriveLocation[]) =>
      startJob('Indexing iCloud Drive...', () => api.indexICloudLocations(locations), () => 'Indexing iCloud Drive…', 'Error indexing iCloud Drive: '),
    indexDrive: (locations: DriveLocation[]) =>
      startJob('Indexing Google Drive...', () => api.indexDriveLocations(locations), () => 'Indexing Google Drive…', 'Error indexing Drive: '),
    indexAppleMail: () =>
      startJob('Indexing Apple Mail...', api.indexAppleMail, () => 'Indexing Apple Mail…', 'Error indexing Apple Mail: '),
    rescan: (s: ConfiguredSource) =>
      startJob(`Rescanning ${s.name}...`, () => api.rescanSource(s.path), queuedOr(`Queued rescan for '${s.name}'.`, `Rescanning '${s.name}'...`), ''),
    remove: async (path: string) => {
      showToast('Removing source...', 'blue')
      try {
        await api.removeSource(path)
        showToast('Source removed.', 'emerald')
        onRefreshSources()
      } catch (err: any) {
        reportError(err, 'Error removing source: ')
      }
    },
    reveal: async (path: string) => {
      try {
        const res = await onRevealTarget(path)
        if (!res.success) showToast(`Could not reveal '${path}' in Finder.`, 'red')
      } catch (err: any) {
        showToast(`Reveal failed: ${err.message}`, 'red')
      }
    },
  }
}

export type SourceActions = ReturnType<typeof useSourceActions>
