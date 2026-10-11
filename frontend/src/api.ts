import type { ConfiguredSource, DriveLocation, GoogleStatus, IndexJobStatus, JobStart, SearchResult } from './types'

export async function fetchStatus(): Promise<{ total: number; photos: number; documents: number; sources: Record<string, number> }> {
  const res = await fetch('/api/status')
  return res.json()
}

export async function fetchSources(): Promise<{ sources: ConfiguredSource[] }> {
  const res = await fetch('/api/sources')
  return res.json()
}

export async function fetchDriveLocations(): Promise<{ locations: DriveLocation[] }> {
  const res = await fetch('/api/drive-locations')
  return res.json()
}

export async function fetchNetworkVolumes(): Promise<{ volumes: Array<{ name: string; path: string; type: string }> }> {
  const res = await fetch('/api/network-volumes')
  return res.json()
}

export async function browseFolder(prompt?: string): Promise<{ path: string; name: string; canceled: boolean; error?: string }> {
  const res = await fetch('/api/browse-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  return res.json()
}

export async function startIndex(path: string, source = 'local', name?: string): Promise<{ status?: JobStart; path?: string; name?: string; error?: string }> {
  const res = await fetch('/api/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, source, name }),
  })
  return res.json()
}

export async function fetchIndexStatus(): Promise<IndexJobStatus> {
  const res = await fetch('/api/indexing-status')
  return res.json()
}

export async function stopIndex(): Promise<{ status: string }> {
  const res = await fetch('/api/stop-index', { method: 'POST' })
  return res.json()
}

export async function removeSource(path: string): Promise<{ status: string }> {
  const res = await fetch('/api/remove-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return res.json()
}

export async function clearDatabase(): Promise<{ status: string }> {
  const res = await fetch('/api/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true }),
  })
  return res.json()
}

export async function searchSpotlight(query: string, limit = 30): Promise<{ query: string; total_matches: number; categories: Record<string, SearchResult[]> }> {
  const res = await fetch('/api/spotlight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  })
  return res.json()
}

export async function sendChat(message: string): Promise<{ answer: string; photos: SearchResult[]; sources: SearchResult[] }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  return res.json()
}

export async function launchTarget(path: string): Promise<{ success: boolean; path: string }> {
  const res = await fetch('/api/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return res.json()
}

export async function revealTarget(path: string): Promise<{ success: boolean; path: string }> {
  const res = await fetch('/api/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return res.json()
}

export async function fetchGoogleStatus(): Promise<GoogleStatus> {
  const res = await fetch('/api/auth/google/status')
  return res.json()
}

export async function fetchGoogleAuthUrl(): Promise<{ url?: string; error?: string }> {
  const res = await fetch('/api/auth/google/auth-url')
  return res.json()
}

export async function disconnectGoogle(): Promise<{ status: string }> {
  const res = await fetch('/api/auth/google/disconnect', { method: 'POST' })
  return res.json()
}

export async function syncCloudDrive(): Promise<{ status: JobStart; name: string }> {
  const res = await fetch('/api/auth/google/sync-drive', { method: 'POST' })
  return res.json()
}

export async function syncCloudPhotos(): Promise<{ status?: string; picker_uri?: string; error?: string }> {
  const res = await fetch('/api/auth/google/sync-photos', { method: 'POST' })
  return res.json()
}

export async function syncGmail(): Promise<{ status: JobStart; name: string }> {
  const res = await fetch('/api/auth/google/sync-gmail', { method: 'POST' })
  return res.json()
}

export async function indexAppleMail(): Promise<{ status?: string; error?: string; message?: string }> {
  const res = await fetch('/api/sources/apple-mail', { method: 'POST' })
  return res.json()
}

export function indexDriveLocations(locations: DriveLocation[]) {
  return Promise.all(locations.map((loc) => startIndex(loc.path, 'google_drive', loc.name)))
}

export async function indexApps(): Promise<{ status: string; indexed_apps: number }> {
  const res = await fetch('/api/index-apps', { method: 'POST' })
  return res.json()
}

export async function openSettingsPane(pane: 'full-disk-access' | 'internet-accounts'): Promise<{ success: boolean }> {
  const res = await fetch(`/api/open-settings/${pane}`, { method: 'POST' })
  return res.json()
}
