import React from 'react'
import type { SearchResult } from '../../types'
import {
  AppIcon,
  AudioIcon,
  BookmarkIcon,
  CalendarIcon,
  ContactIcon,
  DocumentIcon,
  MailIcon,
  PhotoIcon,
  VideoIcon,
} from '../common/Icons'
import styles from './ChatWorkspace.module.css'

export type ResultKind = 'photo' | 'video' | 'audio' | 'app' | 'contact' | 'calendar' | 'bookmark' | 'email' | 'document'

export const KIND_ORDER: ResultKind[] = ['photo', 'video', 'audio', 'app', 'contact', 'calendar', 'bookmark', 'email', 'document']

export const KIND_LABELS: Record<ResultKind, string> = {
  photo: 'Photos',
  video: 'Videos',
  audio: 'Audio',
  app: 'Apps',
  contact: 'Contacts',
  calendar: 'Calendar',
  bookmark: 'Bookmarks',
  email: 'Mail',
  document: 'Documents',
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.heic', '.gif'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'])
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.flac', '.aiff', '.ogg'])

export function kindOf(item: SearchResult): ResultKind {
  const t = (item.type ?? item.file_type ?? '').toLowerCase()
  if (t === 'photo' || t === 'video' || t === 'audio' || t === 'app' || t === 'contact' || t === 'calendar' || t === 'bookmark' || t === 'email') {
    return t
  }
  const name = `${item.filename ?? ''} ${item.path ?? ''}`.toLowerCase()
  const dot = name.lastIndexOf('.')
  const ext = dot === -1 ? '' : name.slice(dot).split(/[\s?#]/)[0]
  if (IMAGE_EXTS.has(ext)) return 'photo'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (ext === '.app' || t === 'app') return 'app'
  if (ext === '.vcf') return 'contact'
  if (ext === '.ics') return 'calendar'
  if (ext === '.webloc' || ext === '.url') return 'bookmark'
  return 'document'
}

const KIND_ICON: Record<ResultKind, React.FC<{ className?: string }>> = {
  photo: PhotoIcon,
  video: VideoIcon,
  audio: AudioIcon,
  app: AppIcon,
  contact: ContactIcon,
  calendar: CalendarIcon,
  bookmark: BookmarkIcon,
  email: MailIcon,
  document: DocumentIcon,
}

export const KIND_TINT: Record<ResultKind, string> = {
  photo: 'tOrange',
  video: 'tRed',
  audio: 'tIndigo',
  app: 'tIndigo',
  contact: 'tGreen',
  calendar: 'tRed',
  bookmark: 'tAccent',
  email: 'tAccent',
  document: 'tAccent',
}

export function renderTile(kind: ResultKind) {
  const Icon = KIND_ICON[kind]
  return (
    <span className={`${styles.tile} ${styles[KIND_TINT[kind]]}`}>
      <Icon className={styles.tileIcon} />
    </span>
  )
}

export function initials(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').trim()
  const parts = base.split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

export function groupResults(photos: SearchResult[], sources: SearchResult[]): Array<[ResultKind, SearchResult[]]> {
  const groups = new Map<ResultKind, SearchResult[]>()
  const push = (item: SearchResult) => {
    const kind = kindOf(item)
    const list = groups.get(kind)
    if (list) list.push(item)
    else groups.set(kind, [item])
  }
  photos.forEach(push)
  sources.forEach(push)
  return [...groups.entries()].sort(([a], [b]) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b))
}
