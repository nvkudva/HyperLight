import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import type { SearchBucket, SearchResult } from '../types'

const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 200
const cache = new Map<string, { at: number; buckets: SearchBucket[] }>()

export function flattenBuckets(buckets: SearchBucket[]): SearchResult[] {
  return buckets.flatMap((b) => b.items)
}

function readCache(key: string): SearchBucket[] | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.buckets
}

function writeCache(key: string, buckets: SearchBucket[]) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, { at: Date.now(), buckets })
}

const NO_BUCKETS: SearchBucket[] = []

export function useLiveSearch(query: string, delayMs = 150, enabled = true) {
  const [buckets, setBuckets] = useState<SearchBucket[]>(NO_BUCKETS)
  const [isSearching, setIsSearching] = useState(false)
  const [hasFailed, setHasFailed] = useState(false)
  const requestSeq = useRef(0)

  useEffect(() => {
    const seq = ++requestSeq.current
    const q = query.trim()
    setHasFailed(false)
    if (!q || !enabled) {
      setBuckets(NO_BUCKETS)
      setIsSearching(false)
      return
    }
    const key = q
    const hit = readCache(key)
    if (hit) {
      setBuckets(hit)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.searchSpotlight(q, controller.signal)
        if (seq === requestSeq.current) {
          const next = res.buckets || NO_BUCKETS
          writeCache(key, next)
          setBuckets(next)
        }
      } catch (err) {
        if (seq !== requestSeq.current || (err as Error)?.name === 'AbortError') return
        console.error('Search error:', err)
        setBuckets(NO_BUCKETS)
        setHasFailed(true)
      } finally {
        if (seq === requestSeq.current) setIsSearching(false)
      }
    }, delayMs)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, delayMs, enabled])

  return { buckets, isSearching, hasFailed }
}
