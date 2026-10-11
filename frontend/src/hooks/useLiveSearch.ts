import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import type { SearchResult } from '../types'

export function useLiveSearch(query: string, limit = 30, delayMs = 150) {
  const [categories, setCategories] = useState<Record<string, SearchResult[]>>({})
  const [isSearching, setIsSearching] = useState(false)
  const requestSeq = useRef(0)

  useEffect(() => {
    const seq = ++requestSeq.current
    const q = query.trim()
    if (!q) {
      setCategories({})
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.searchSpotlight(q, limit)
        if (seq === requestSeq.current) setCategories(res.categories || {})
      } catch (err) {
        console.error('Search error:', err)
      } finally {
        if (seq === requestSeq.current) setIsSearching(false)
      }
    }, delayMs)
    return () => clearTimeout(timer)
  }, [query, limit, delayMs])

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
