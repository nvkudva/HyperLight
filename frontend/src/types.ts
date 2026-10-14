export interface SearchResult {
  id: string
  path: string
  filename: string
  type?: string
  file_type?: string
  source?: string
  content?: string
  excerpt?: string
  score?: number
  matched_terms?: string[]
  metadata?: Record<string, any>
}

export interface SearchBucket {
  kind: string
  label: string
  items: SearchResult[]
}

export interface ConfiguredSource {
  name: string
  path: string
  source_type: string
  items_count: number
  last_scanned?: number
  watch_enabled?: boolean
  watchable: boolean
}

export type HotkeyConfig =
  | 'double_ctrl'
  | 'double_option'
  | { key_code: number; modifiers: string[]; label: string }

export interface AppSettings {
  always_on_scanning: boolean
  custom_instructions: string
  hotkey_enabled: boolean
  hotkey: HotkeyConfig
  hotkey_voice: boolean
  watched_paths_count?: number
}

export interface GoogleUser {
  id?: string
  email?: string
  name?: string
  picture?: string
  verified_email?: boolean
}

export interface GoogleStatus {
  connected: boolean
  has_client_config: boolean
  full_access?: boolean
  client_id?: string
  user?: GoogleUser
}

export interface IndexJobInfo {
  name: string
  path: string
  state: 'running' | 'queued'
  percent: number
  current_index: number
  total_files: number
}

export interface IndexJobStatus {
  is_running: boolean
  cancel_requested: boolean
  current_folder: string
  current_path: string
  current_source: string
  current_file: string
  current_index: number
  total_files: number
  percent: number
  indexed_items: number
  status: string
  state: 'idle' | 'running' | 'finished' | 'cancelled' | 'error'
  error_code: string
  is_cloud: boolean
  queued: string[]
  jobs?: IndexJobInfo[]
}

export type JobStart = 'started' | 'queued'

export interface DriveLocation {
  name: string
  path: string
  account: string
}

export interface ChatMessage {
  id: string
  sender: 'user' | 'assistant'
  text?: string
  photos?: SearchResult[]
  sources?: SearchResult[]
  timestamp: number
}

export interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  path: string
  filename: string
}

export interface Conversation {
  id: string
  title: string
  kind?: 'search' | 'chat'
  messages: ChatMessage[]
  updatedAt: number
}
