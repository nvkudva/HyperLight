import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import type { SearchResult } from '../types'

const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 200
const cache = new Map<string, { at: number; categories: Record<string, SearchResult[]> }>()

function readCache(key: string): Record<string, SearchResult[]> | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.categories
}

function writeCache(key: string, categories: Record<string, SearchResult[]>) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, { at: Date.now(), categories })
}

export function useLiveSearch(query: string, limit = 30, delayMs = 150, enabled = true) {
  const [categories, setCategories] = useState<Record<string, SearchResult[]>>({})
  const [isSearching, setIsSearching] = useState(false)
  const requestSeq = useRef(0)

  useEffect(() => {
    const seq = ++requestSeq.current
    const q = query.trim()
    if (!q || !enabled) {
      setCategories({})
      setIsSearching(false)
      return
    }
    const key = `${q}|||${limit}`
    const hit = readCache(key)
    if (hit) {
      setCategories(hit)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.searchSpotlight(q, limit, controller.signal)
        if (seq === requestSeq.current) {
          const next = res.categories || {}
          writeCache(key, next)
          setCategories(next)
        }
      } catch (err) {
        if (seq === requestSeq.current && (err as Error)?.name !== 'AbortError') console.error('Search error:', err)
      } finally {
        if (seq === requestSeq.current) setIsSearching(false)
      }
    }, delayMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, limit, delayMs, enabled])

  const { flatItems, offsets } = useMemo(() => {
    const offsets: Record<string, number> = {}
    const flatItems: SearchResult[] = []
    for (const [key, items] of Object.entries(categories)) {
      offsets[key] = flatItems.length
      flatItems.push(...(items || []))
    }
    return { flatItems, offsets }
  }, [categories])

  return { categories, flatItems, offsets, isSearching }
}
