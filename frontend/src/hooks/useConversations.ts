import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, Conversation } from '../types'

const STORAGE_KEY = 'conversations'
const MAX_CONVERSATIONS = 100
const PERSIST_DEBOUNCE_MS = 500
// A search that extends the previous one within this window is the same search, typed further.
const SAME_SEARCH_WINDOW_MS = 8000

function load(): Conversation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (c): c is Conversation =>
          !!c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages)
      )
      .map((c) => ({ ...c, updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0 }))
      .slice(0, MAX_CONVERSATIONS)
  } catch {
    return []
  }
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(load)
  const [activeId, setActiveId] = useState<string | null>(null)

  const persist = useCallback((items: Conversation[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      // Quota exceeded or unavailable: keep the session in memory.
    }
  }, [])

  const latestRef = useRef(conversations)
  useEffect(() => {
    latestRef.current = conversations
    const timer = window.setTimeout(() => persist(conversations), PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [conversations, persist])

  useEffect(() => {
    const flush = () => persist(latestRef.current)
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [persist])

  const create = useCallback((title: string, kind: 'search' | 'chat' = 'chat') => {
    const conv: Conversation = { id: `c_${Date.now()}`, title: title.slice(0, 60), kind, messages: [], updatedAt: Date.now() }
    setConversations((prev) => [conv, ...prev].slice(0, MAX_CONVERSATIONS))
    setActiveId(conv.id)
    return conv.id
  }, [])

  const recordSearch = useCallback((query: string) => {
    const title = query.trim().slice(0, 60)
    if (!title) return
    const key = title.toLowerCase()
    setConversations((prev) => {
      const latest = prev[0]
      const continuesLatest =
        latest &&
        (latest.kind ?? 'chat') === 'search' &&
        Date.now() - latest.updatedAt < SAME_SEARCH_WINDOW_MS &&
        key.startsWith(latest.title.toLowerCase())
      if (continuesLatest) {
        const message = { id: latest.messages[0]?.id ?? `user_${Date.now()}`, sender: 'user' as const, text: title, timestamp: Date.now() }
        return [{ ...latest, title, messages: [message], updatedAt: Date.now() }, ...prev.slice(1)]
      }
      const existing = prev.find((c) => (c.kind ?? 'chat') === 'search' && c.title.toLowerCase() === key)
      if (existing) {
        const updated = { ...existing, updatedAt: Date.now() }
        return [updated, ...prev.filter((c) => c.id !== existing.id)]
      }
      const conv: Conversation = {
        id: `c_${Date.now()}`,
        title,
        kind: 'search',
        messages: [{ id: `user_${Date.now()}`, sender: 'user', text: title, timestamp: Date.now() }],
        updatedAt: Date.now(),
      }
      return [conv, ...prev].slice(0, MAX_CONVERSATIONS)
    })
  }, [])

  const append = useCallback((id: string, message: ChatMessage) => {
    setConversations((prev) => {
      const conv = prev.find((c) => c.id === id)
      if (!conv) return prev
      const updated = { ...conv, messages: [...conv.messages, message], updatedAt: Date.now() }
      return [updated, ...prev.filter((c) => c.id !== id)]
    })
  }, [])

  const remove = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id))
    setActiveId((cur) => (cur === id ? null : cur))
  }, [])

  const active = conversations.find((c) => c.id === activeId) ?? null

  return { conversations, active, activeId, select: setActiveId, create, append, remove, recordSearch }
}
