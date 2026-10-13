import { useCallback, useEffect, useRef, useState } from 'react'

interface SegmentedRecorderOptions {
  segmentMs: number
  /** `final` is true for the last segment of a session (after stop). */
  onSegment: (blob: Blob, session: number, final: boolean) => void
  onError: (message: string) => void
}

interface SegmentedRecorder {
  supported: boolean
  listening: boolean
  /** Opens the microphone and starts recording; null if it could not start. */
  start: () => Promise<MediaStream | null>
  /** Ends the session; the last segment arrives as `final`. */
  stop: () => void
  /** Ends the session and drops any segment still in flight. */
  cancel: () => void
  isCurrent: (session: number) => boolean
  isRecording: () => boolean
}

export function micErrorMessage(name?: string): string {
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone blocked. Enable it in System Settings → Privacy & Security → Microphone, then try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found on this Mac.'
  if (name === 'NotReadableError') return 'Microphone is busy in another app. Close it, then try again.'
  return 'Could not access the microphone on this device.'
}

function pickMimeType(): string {
  for (const mime of ['audio/mp4', 'audio/webm']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ''
}

const START_FAILED = 'Could not start audio recording on this device.'

// Microphone capture shared by voice dictation and audio search. Records in
// back-to-back segments so callers can stream partial results while the user
// is still speaking. Owns the stream, the recorder and their cleanup.
export function useSegmentedRecorder(options: SegmentedRecorderOptions): SegmentedRecorder {
  const [supported] = useState(
    () =>
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
  )
  const [listening, setListening] = useState(false)
  const optionsRef = useRef(options)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const sessionRef = useRef(0)
  const recordingRef = useRef(false)
  const startingRef = useRef(false)
  const disposedRef = useRef(false)

  useEffect(() => {
    optionsRef.current = options
  })

  const clearTimer = () => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const abortWithError = (message: string) => {
    recordingRef.current = false
    setListening(false)
    optionsRef.current.onError(message)
  }

  const recordSegment = useCallback(function recordSegment(session: number) {
    const stream = streamRef.current
    if (!stream || session !== sessionRef.current || !recordingRef.current) return
    const chunks: Blob[] = []
    let recorder: MediaRecorder
    try {
      const mimeType = pickMimeType()
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch {
      abortWithError(START_FAILED)
      return
    }
    recorderRef.current = recorder
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data)
    }
    recorder.onstop = () => {
      recorderRef.current = null
      const stillRecording = recordingRef.current && session === sessionRef.current
      const type = (chunks[0]?.type || recorder.mimeType || 'audio/webm').split(';')[0]
      if (stillRecording) recordSegment(session)
      else releaseStream()
      optionsRef.current.onSegment(new Blob(chunks, { type }), session, !stillRecording)
    }
    try {
      recorder.start()
    } catch {
      abortWithError(START_FAILED)
      return
    }
    timerRef.current = window.setTimeout(() => {
      try {
        recorder.stop()
      } catch {
        // Already stopped
      }
    }, optionsRef.current.segmentMs)
  }, [])

  const start = useCallback(async (): Promise<MediaStream | null> => {
    if (!supported || startingRef.current || recordingRef.current) return null
    startingRef.current = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (disposedRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return null
      }
      streamRef.current = stream
      recordingRef.current = true
      sessionRef.current += 1
      setListening(true)
      recordSegment(sessionRef.current)
      return stream
    } catch (err) {
      optionsRef.current.onError(micErrorMessage((err as DOMException)?.name))
      return null
    } finally {
      startingRef.current = false
    }
  }, [supported, recordSegment])

  const stop = useCallback(() => {
    if (!recordingRef.current) return
    clearTimer()
    recordingRef.current = false
    setListening(false)
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
        return
      } catch {
        // Fall through to the empty final segment.
      }
    }
    releaseStream()
    optionsRef.current.onSegment(new Blob([]), sessionRef.current, true)
  }, [])

  const cancel = useCallback(() => {
    sessionRef.current += 1
    clearTimer()
    recordingRef.current = false
    try {
      recorderRef.current?.stop()
    } catch {
      // Already stopped
    }
    recorderRef.current = null
    releaseStream()
    setListening(false)
  }, [])

  const isCurrent = useCallback((session: number) => session === sessionRef.current, [])
  const isRecording = useCallback(() => recordingRef.current, [])

  useEffect(
    () => () => {
      disposedRef.current = true
      clearTimer()
      recordingRef.current = false
      sessionRef.current += 1
      try {
        recorderRef.current?.stop()
      } catch {
        // Ignore teardown errors
      }
      recorderRef.current = null
      releaseStream()
    },
    []
  )

  return { supported, listening, start, stop, cancel, isCurrent, isRecording }
}
