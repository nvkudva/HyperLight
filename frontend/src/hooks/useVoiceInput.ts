import { useRef, useState } from 'react'
import { transcribeAudio } from '../api'
import { useSegmentedRecorder } from './useSegmentedRecorder'

const SEGMENT_MS = 2500

interface VoiceInput {
  supported: boolean
  listening: boolean
  error: string | null
  toggle: () => void
  stop: () => void
  cancel: () => void
}

// Dictation: each recorded segment is transcribed on the backend with whisper
// (EmbeddingGemma embeds audio; it cannot transcribe), so text streams in
// while the user is still speaking.
export function useVoiceInput(onTranscript: (text: string, isFinal: boolean) => void): VoiceInput {
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef('')

  const transcribeSegment = async (blob: Blob, session: number, final: boolean) => {
    if (!recorder.isCurrent(session)) return
    if (blob.size === 0) {
      if (final) onTranscript(textRef.current, true)
      return
    }
    try {
      const text = await transcribeAudio(blob)
      if (!recorder.isCurrent(session)) return
      if (text) textRef.current = textRef.current ? `${textRef.current} ${text}` : text
      onTranscript(textRef.current, final)
    } catch (err) {
      if (!recorder.isCurrent(session)) return
      setError((err as Error)?.message ?? 'Transcription failed.')
      recorder.cancel()
      onTranscript(textRef.current, true)
    }
  }

  const recorder = useSegmentedRecorder({
    segmentMs: SEGMENT_MS,
    onSegment: transcribeSegment,
    onError: setError,
  })

  const start = () => {
    setError(null)
    textRef.current = ''
    void recorder.start()
  }

  const toggle = () => {
    if (recorder.listening) recorder.stop()
    else start()
  }

  // Stops recording and drops any transcript still in flight (e.g. after sending).
  const cancel = () => {
    recorder.cancel()
    textRef.current = ''
  }

  return { supported: recorder.supported, listening: recorder.listening, error, toggle, stop: recorder.stop, cancel }
}
