import { useCallback, useEffect, useState } from 'react'
import type { ChatMessage, Conversation } from '../types'

const STORAGE_KEY = 'conversations'

function load(): Conversation[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>(load)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
  }, [conversations])

  const create = useCallback((title: string) => {
    const conv: Conversation = { id: `c_${Date.now()}`, title: title.slice(0, 60), messages: [], updatedAt: Date.now() }
    setConversations((prev) => [conv, ...prev])
    setActiveId(conv.id)
    return conv.id
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

  return { conversations, active, activeId, select: setActiveId, create, append, remove }
}
