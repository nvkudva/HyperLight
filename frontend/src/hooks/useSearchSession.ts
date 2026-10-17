import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchBucket } from '../types'
import { useAudioSearch } from './useAudioSearch'

export interface VoiceResult {
  transcript: string
  buckets: SearchBucket[]
}

const RECORD_DEBOUNCE_MS = 1000
const VOICE_HISTORY_TITLE = 'Voice Search'

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
    onStart: () => {
      onActivityRef.current()
      setQueryState('')
      setVoiceResult(null)
    },
    // Previous results stay on screen (dimmed) while the next request runs.
    onSearching: () => onActivityRef.current(),
    onResults: (buckets, transcript) => {
      onActivityRef.current()
      setQueryState('')
      setVoiceResult({ transcript, buckets })
      recordSearch(VOICE_HISTORY_TITLE)
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

  // The search box shows the spoken transcript while a voice result is live.
  return { query: voiceResult?.transcript ?? query, setQuery, voice, voiceResult, clearVoice, cancelSearch, cancelVoice }
}

export type SearchSession = ReturnType<typeof useSearchSession>
