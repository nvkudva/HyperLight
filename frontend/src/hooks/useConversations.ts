import { useCallback, useEffect, useState } from 'react'
import type { ChatMessage, Conversation } from '../types'

const STORAGE_KEY = 'conversations'
const MAX_CONVERSATIONS = 100
const PERSIST_DEBOUNCE_MS = 500

function load(): Conversation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, MAX_CONVERSATIONS) : []
  } catch {
    return []
  }
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(load)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
      } catch {
        // Quota exceeded or unavailable: keep the session in memory.
      }
    }, PERSIST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [conversations])

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
