import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchBucket } from '../types'
import { useAudioSearch } from './useAudioSearch'

export interface VoiceResult {
  transcript: string
  buckets: SearchBucket[]
}

const RECORD_DEBOUNCE_MS = 1000

// The one live search: typed text or a voice result, never both. Typing
// clears the voice result, a voice search clears the text, and both are
// recorded in search history.
export function useSearchSession(recordSearch: (q: string) => void, onActivity: () => void) {
  const [query, setQueryState] = useState('')
  const [voiceResult, setVoiceResult] = useState<VoiceResult | null>(null)
  const onActivityRef = useRef(onActivity)
  useEffect(() => {
    onActivityRef.current = onActivity
  })

  const voice = useAudioSearch({
    onSearching: () => {
      onActivityRef.current()
      setQueryState('')
      setVoiceResult(null)
    },
    onResults: (buckets, transcript) => {
      onActivityRef.current()
      setQueryState('')
      setVoiceResult({ transcript: transcript.trim(), buckets })
      if (transcript.trim()) recordSearch(transcript)
    },
  })

  const setQuery = useCallback((q: string) => {
    setVoiceResult(null)
    setQueryState(q)
  }, [])

  const clearVoice = useCallback(() => setVoiceResult(null), [])

  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const timer = window.setTimeout(() => recordSearch(q), RECORD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, recordSearch])

  return { query, setQuery, voice, voiceResult, clearVoice }
}

export type SearchSession = ReturnType<typeof useSearchSession>
