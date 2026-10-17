import { useEffect } from 'react'

const RECORD_DELAY_MS = 1000

// Records a search once it has settled: the text stopped changing and its results loaded.
export function useRecordSearch(query: string, isSettled: boolean, record?: (query: string) => void) {
  useEffect(() => {
    const text = query.trim()
    if (!record || !isSettled || !text) return
    const timer = window.setTimeout(() => record(text), RECORD_DELAY_MS)
    return () => clearTimeout(timer)
  }, [query, isSettled, record])
}
