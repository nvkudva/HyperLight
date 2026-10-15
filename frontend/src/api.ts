import type { AppSettings, ConfiguredSource, DriveLocation, GoogleStatus, IndexJobStatus, JobStart, SearchBucket, SearchResult } from './types'

export interface SpotlightResponse {
  query: string
  total_matches: number
  buckets: SearchBucket[]
}

/** A failed backend call. `code` is the backend's `error` field (e.g. 'full_disk_access'). */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('Hyperlight’s local service is not reachable.', 0)
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : undefined
    throw new ApiError(body.message || code || `Request failed (${res.status}).`, res.status, code)
  }
  return body as T
}

const get = <T>(url: string, signal?: AbortSignal) => request<T>(url, { signal })

const post = <T>(url: string, body?: unknown, signal?: AbortSignal) =>
  request<T>(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })

const postForm = <T>(url: string, form: FormData) => request<T>(url, { method: 'POST', body: form })

export async function fetchStatus(): Promise<{ total: number; photos: number; documents: number; sources: Record<string, number> }> {
  return get('/api/status')
}

export async function warmup(): Promise<{ status: string }> {
  return post('/api/warmup')
}

export async function fetchSources(): Promise<{ sources: ConfiguredSource[] }> {
  return get('/api/sources')
}

export async function fetchAppSettings(): Promise<AppSettings> {
  return get('/api/settings')
}

export async function updateAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return post('/api/settings', settings)
}

export async function toggleSourceWatch(path: string, enabled: boolean): Promise<{ success: boolean; sources: ConfiguredSource[] }> {
  return post('/api/sources/watch', { path, enabled })
}

export async function fetchDriveLocations(): Promise<{ locations: DriveLocation[] }> {
  return get('/api/drive-locations')
}

export async function fetchNetworkVolumes(): Promise<{ volumes: Array<{ name: string; path: string; type: string }> }> {
  return get('/api/network-volumes')
}

export async function browseFolder(prompt?: string): Promise<{ path: string; name: string; canceled: boolean; error?: string }> {
  return post('/api/browse-folder', { prompt })
}

export async function startIndex(path: string, source = 'local', name?: string): Promise<{ status?: JobStart; path?: string; name?: string; error?: string }> {
  return post('/api/index', { path, source, name })
}

export async function fetchIndexStatus(): Promise<IndexJobStatus> {
  return get('/api/indexing-status')
}

export async function stopIndex(): Promise<{ status: string }> {
  return post('/api/stop-index')
}

export async function rescanSource(path: string): Promise<{ status?: JobStart; path?: string; name?: string }> {
  return post('/api/sources/rescan', { path })
}

export async function removeSource(path: string): Promise<{ status: string }> {
  return post('/api/remove-source', { path })
}

export async function clearDatabase(): Promise<{ status: string }> {
  return post('/api/clear', { force: true })
}

export async function searchSpotlight(query: string, signal?: AbortSignal): Promise<SpotlightResponse> {
  return post('/api/spotlight', { query }, signal)
}

export async function sendChat(message: string): Promise<{ answer: string; photos: SearchResult[]; sources: SearchResult[] }> {
  return post('/api/chat', { message })
}

export async function launchTarget(path: string): Promise<{ success: boolean; path: string }> {
  return post('/api/launch', { path })
}

export async function revealTarget(path: string): Promise<{ success: boolean; path: string }> {
  return post('/api/reveal', { path })
}

export async function fetchGoogleStatus(): Promise<GoogleStatus> {
  return get('/api/auth/google/status')
}

export async function fetchGoogleAuthUrl(): Promise<{ url?: string; error?: string }> {
  return get('/api/auth/google/auth-url')
}

export async function disconnectGoogle(): Promise<{ status: string }> {
  return post('/api/auth/google/disconnect')
}

export async function syncCloudDrive(): Promise<{ status: JobStart; name: string }> {
  return post('/api/auth/google/sync-drive')
}

export async function syncCloudPhotos(): Promise<{ status?: string; picker_uri?: string; error?: string }> {
  return post('/api/auth/google/sync-photos')
}

export async function syncGmail(): Promise<{ status: JobStart; name: string }> {
  return post('/api/auth/google/sync-gmail')
}

export async function indexAppleMail(): Promise<{ status?: string; error?: string; message?: string }> {
  return post('/api/sources/apple-mail')
}

export function indexDriveLocations(locations: DriveLocation[]) {
  return Promise.all(locations.map((loc) => startIndex(loc.path, 'google_drive', loc.name)))
}

export async function indexApps(): Promise<{ status: JobStart }> {
  return post('/api/index-apps')
}

export async function indexSettings(): Promise<{ status: JobStart }> {
  return post('/api/index-settings')
}

export async function fetchPermissions(): Promise<{ full_disk_access: boolean }> {
  return get('/api/permissions')
}

export async function resetApp(): Promise<{ status: string }> {
  return post('/api/reset-all')
}

export async function fetchICloudLocations(): Promise<{ locations: DriveLocation[] }> {
  return get('/api/icloud-locations')
}

export function indexICloudLocations(locations: DriveLocation[]) {
  return Promise.all(locations.map((loc) => startIndex(loc.path, 'icloud_drive', loc.name)))
}

export async function openSettingsPane(pane: 'full-disk-access' | 'internet-accounts'): Promise<{ success: boolean }> {
  return post(`/api/open-settings/${pane}`)
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const type = (blob.type || 'audio/webm').split(';')[0]
  const ext = type.includes('mp4') ? 'clip.mp4' : type.includes('ogg') ? 'clip.ogg' : 'clip.webm'
  const form = new FormData()
  form.append('file', blob, ext)
  const data = await postForm<{ text?: string }>('/api/transcribe', form)
  return data.text ?? ''
}

export async function searchByAudio(wav: Blob): Promise<SpotlightResponse> {
  const form = new FormData()
  form.append('file', wav, 'clip.wav')
  return postForm<SpotlightResponse>('/api/audio-search', form)
}
