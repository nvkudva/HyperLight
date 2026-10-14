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
      // No transcription: Gemma returns matches, not words. Label the result
      // by the top match it identified; fall back to any transcript text.
      const topItem = buckets[0]?.items[0]
      const label = transcript.trim() || topItem?.filename || 'Voice search'
      setQueryState('')
      setVoiceResult({ transcript: label, buckets })
      recordSearch(label)
    },
  })

  const setQuery = useCallback((q: string) => {
    setVoiceResult(null)
    setQueryState(q)
  }, [])

  const clearVoice = useCallback(() => setVoiceResult(null), [])

  const voiceReset = voice.reset
  const voiceCancel = voice.cancel
  const cancelSearch = useCallback(() => {
    voiceReset()
    setQueryState('')
    setVoiceResult(null)
  }, [voiceReset])

  const cancelVoice = useCallback(() => {
    voiceCancel()
    setVoiceResult(null)
  }, [voiceCancel])

  useEffect(() => {
    const q = query.trim()
    if (!q) return
    const timer = window.setTimeout(() => recordSearch(q), RECORD_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, recordSearch])

  return { query, setQuery, voice, voiceResult, clearVoice, cancelSearch, cancelVoice }
}

export type SearchSession = ReturnType<typeof useSearchSession>
