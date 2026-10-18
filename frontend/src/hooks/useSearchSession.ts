import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchBucket } from '../types'
import { useAudioSearch } from './useAudioSearch'

export interface VoiceResult {
  transcript: string
  buckets: SearchBucket[]
}

// The one live search: typed text or a voice result, never both. Typing
// clears the voice result and a voice search clears the text. Voice searches
// are recorded in search history here; typed ones once their results load.
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
      // History cards re-run their title as a text query, so a transcript-less voice search has nothing to record.
      if (transcript) recordSearch(transcript)
    },
  })

  const setQuery = useCallback((q: string) => {
    setVoiceResult(null)
    setQueryState(q)
  }, [])

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

  // The search box shows the spoken transcript while a voice result is live.
  return { query: voiceResult?.transcript ?? query, setQuery, voice, voiceResult, cancelSearch, cancelVoice }
}

export type SearchSession = ReturnType<typeof useSearchSession>
