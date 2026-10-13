import { useCallback, useEffect, useRef, useState } from 'react'
import { transcribeAudio } from '../api'

const SEGMENT_MS = 2500

interface VoiceInput {
  supported: boolean
  listening: boolean
  error: string | null
  toggle: () => void
  stop: () => void
  cancel: () => void
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const mime of ['audio/mp4', 'audio/webm', '']) {
    if (!mime || MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ''
}

function extForMime(mime: string): string {
  if (mime.includes('mp4')) return '.mp4'
  if (mime.includes('webm')) return '.webm'
  if (mime.includes('ogg')) return '.ogg'
  return '.bin'
}

export function micErrorMessage(name?: string): string {
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone blocked. Enable it in System Settings → Privacy & Security → Microphone, then try again.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found on this Mac.'
  if (name === 'NotReadableError') return 'Microphone is busy in another app. Close it, then try again.'
  return 'Could not access the microphone on this device.'
}

// Microphone capture via getUserMedia + MediaRecorder, transcribed on the
// backend with whisper (EmbeddingGemma embeds audio; it cannot transcribe).
// Audio is segmented every SEGMENT_MS so transcripts stream in while speaking.
export function useVoiceInput(onTranscript: (text: string, isFinal: boolean) => void): VoiceInput {
  const [supported] = useState(
    () =>
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
  )
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cbRef = useRef(onTranscript)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const sessionRef = useRef(0)
  const modeRef = useRef<'cycling' | 'stopped'>('stopped')
  const textRef = useRef('')
  const disposedRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  const transcribeChunk = useCallback(async (blob: Blob, session: number, final: boolean) => {
    if (blob.size === 0) {
      if (final) cbRef.current(textRef.current, true)
      return
    }
    try {
      const text = await transcribeAudio(blob)
      if (session !== sessionRef.current) return
      if (text) textRef.current = textRef.current ? `${textRef.current} ${text}` : text
      cbRef.current(textRef.current, final)
    } catch (err: any) {
      if (session !== sessionRef.current) return
      setError(err?.message ?? 'Transcription failed.')
      modeRef.current = 'stopped'
      setListening(false)
      cbRef.current(textRef.current, true)
    }
  }, [])

  const cycleRef = useRef<(session: number) => void>(() => {})
  const cycle = useCallback(
    (session: number) => {
      const stream = streamRef.current
      if (!stream || session !== sessionRef.current || modeRef.current !== 'cycling') return
      const chunks: Blob[] = []
      let rec: MediaRecorder
      try {
        const mime = pickMimeType()
        rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      } catch {
        setError('Could not start audio recording on this device.')
        modeRef.current = 'stopped'
        setListening(false)
        return
      }
      recRef.current = rec
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data)
      }
      rec.onstop = () => {
        recRef.current = null
        const type = chunks[0]?.type || rec.mimeType || 'audio/webm'
        const blob = new Blob(chunks, { type: type.split(';')[0] })
        const wasCycling = modeRef.current === 'cycling' && session === sessionRef.current
        void transcribeChunk(blob, session, !wasCycling)
        if (wasCycling) cycleRef.current(session)
        else releaseStream()
      }
      try {
        rec.start()
      } catch {
        setError('Could not start audio recording on this device.')
        modeRef.current = 'stopped'
        setListening(false)
        return
      }
      timerRef.current = window.setTimeout(() => {
        try {
          rec.stop()
        } catch {
          // Already stopped
        }
      }, SEGMENT_MS)
    },
    [transcribeChunk]
  )

  useEffect(() => {
    cbRef.current = onTranscript
    cycleRef.current = cycle
  })

  const stop = useCallback(() => {
    clearTimer()
    modeRef.current = 'stopped'
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') {
      // The cycle-attached onstop transcribes the tail as final.
      try {
        rec.stop()
      } catch {
        releaseStream()
      }
    } else {
      releaseStream()
      cbRef.current(textRef.current, true)
    }
    setListening(false)
  }, [])

  // Stops recording and drops any transcript still in flight (e.g. after sending).
  const cancel = useCallback(() => {
    sessionRef.current += 1
    clearTimer()
    modeRef.current = 'stopped'
    try {
      recRef.current?.stop()
    } catch {
      // Already stopped
    }
    recRef.current = null
    releaseStream()
    textRef.current = ''
    setListening(false)
  }, [])

  const start = useCallback(async () => {
    if (!supported || recRef.current) return
    setError(null)
    textRef.current = ''
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: any) {
      setError(micErrorMessage(err?.name))
      return
    }
    if (disposedRef.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    streamRef.current = stream
    modeRef.current = 'cycling'
    sessionRef.current += 1
    setListening(true)
    cycle(sessionRef.current)
  }, [supported, cycle])

  const toggle = useCallback(() => {
    if (listening) stop()
    else void start()
  }, [listening, start, stop])

  useEffect(
    () => () => {
      disposedRef.current = true
      clearTimer()
      modeRef.current = 'stopped'
      sessionRef.current += 1
      try {
        recRef.current?.stop()
      } catch {
        // Ignore teardown errors
      }
      recRef.current = null
      releaseStream()
    },
    []
  )

  return { supported, listening, error, toggle, stop, cancel }
}

export { extForMime }
