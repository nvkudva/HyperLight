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
  metadata?: Record<string, any>
}

export interface ConfiguredSource {
  name: string
  path: string
  source_type: string
  items_count: number
  last_scanned?: number
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
