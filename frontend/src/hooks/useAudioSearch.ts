import { useCallback, useEffect, useRef, useState } from 'react'
import { searchByAudio } from '../api'
import { micErrorMessage } from './useVoiceInput'
import type { SearchResult } from '../types'

const MAX_RECORD_MS = 90000
const LIVE_SEGMENT_MS = 2000
const SILENCE_MS = 3000
const VOICE_RMS = 0.02
const MIN_LIVE_SEC = 0.4
const WAVE_BARS = 24
const TARGET_RATE = 16000
const WAVE_FLOOR = 0.08
const WAVE_SMOOTH = 0.35

interface AudioSearch {
  supported: boolean
  listening: boolean
  searching: boolean
  error: string | null
  waveCanvas: (el: HTMLCanvasElement | null) => void
  toggle: () => void
  stop: () => void
}

interface AudioSearchCallbacks {
  onResults: (categories: Record<string, SearchResult[]>, query?: string) => void
  onSearching: () => void
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export function rmsOfTimeDomain(data: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128
    sum += v * v
  }
  return Math.sqrt(sum / Math.max(1, data.length))
}

export function resampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input
  const len = Math.max(1, Math.floor((input.length / fromRate) * toRate))
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const pos = (i * fromRate) / toRate
    const i0 = Math.min(input.length - 1, Math.floor(pos))
    const i1 = Math.min(input.length - 1, i0 + 1)
    const frac = pos - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

// Records the mic stream, draws a live waveform into waveRef, and searches
// while the user is still speaking: each recorded segment is decoded,
// appended to a cumulative PCM buffer, resampled to 16kHz mono WAV and sent
// to audio search, so results update as speech comes in. A 3s silence
// (or the 90s cap) stops the mic automatically.
export function useAudioSearch({ onResults, onSearching }: AudioSearchCallbacks): AudioSearch {
  const [supported] = useState(
    () =>
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined' &&
      (typeof AudioContext !== 'undefined' ||
        typeof (window as any).webkitAudioContext !== 'undefined')
  )
  const [listening, setListening] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasElRef = useRef<HTMLCanvasElement | null>(null)
  const setWaveCanvas = useCallback((el: HTMLCanvasElement | null) => {
    canvasElRef.current = el
  }, [])
  const cbRef = useRef({ onResults, onSearching })
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const levelsRef = useRef<number[]>([])
  const timerRef = useRef<number | null>(null)
  const cycleTimerRef = useRef<number | null>(null)
  const busyRef = useRef(false)
  const sessionRef = useRef(0)
  const modeRef = useRef<'live' | 'stopped'>('stopped')
  const pcmRef = useRef<Float32Array[]>([])
  const pcmLenRef = useRef(0)
  const nativeRateRef = useRef(TARGET_RATE)
  const liveBusyRef = useRef(false)
  const lastVoiceRef = useRef(0)

  const accentRef = useRef('')
  const drawWave = useCallback(() => {
    const canvas = canvasElRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (!accentRef.current) {
      accentRef.current =
        getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a84ff'
    }
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)
    const n = WAVE_BARS
    const gap = Math.max(2, Math.round(W / 72))
    const bw = (W - gap * (n - 1)) / n
    const radius = Math.min(bw / 2, 3)
    for (let i = 0; i < n; i++) {
      const v = levelsRef.current[i] ?? WAVE_FLOOR
      const h = Math.max(3, v * (H - 4))
      ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, v)
      ctx.fillStyle = accentRef.current
      ctx.beginPath()
      ctx.roundRect(i * (bw + gap), (H - h) / 2, bw, h, radius)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }, [])

  const teardownAudio = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (cycleTimerRef.current !== null) {
      window.clearTimeout(cycleTimerRef.current)
      cycleTimerRef.current = null
    }
    try {
      void ctxRef.current?.close()
    } catch {
      // Ignore teardown errors
    }
    ctxRef.current = null
    analyserRef.current = null
  }

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    cbRef.current = { onResults, onSearching }
  })

  const searchCumulative = useCallback(async (session: number, final: boolean) => {
    if (session !== sessionRef.current) return
    const total = pcmLenRef.current
    const rate = nativeRateRef.current
    if (total < rate * MIN_LIVE_SEC) {
      if (final) {
        setSearching(false)
        releaseStream()
      }
      return
    }
    if (!final && liveBusyRef.current) return
    liveBusyRef.current = true
    if (final) setSearching(true)
    try {
      const combined = new Float32Array(total)
      let off = 0
      for (const part of pcmRef.current) {
        combined.set(part, off)
        off += part.length
      }
      const wav = encodeWav(resampleMono(combined, rate, TARGET_RATE), TARGET_RATE)
      const res = await searchByAudio(wav)
      if (session !== sessionRef.current) return
      cbRef.current.onResults(res.categories || {}, res.query)
    } catch (err: any) {
      if (final) setError(err?.message ?? 'Audio search failed.')
    } finally {
      liveBusyRef.current = false
      if (final) {
        setSearching(false)
        releaseStream()
      }
    }
  }, [])

  const stopRef = useRef(() => {})
  const cycleRef = useRef((_session: number) => {})

  const loopRef = useRef(() => {})
  useEffect(() => {
    loopRef.current = () => {
      const analyser = analyserRef.current
      if (!analyser) return
      const data = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(data)
      if (rmsOfTimeDomain(data) > VOICE_RMS) lastVoiceRef.current = performance.now()
      else if (
        modeRef.current === 'live' &&
        performance.now() - lastVoiceRef.current > SILENCE_MS
      ) {
        stopRef.current()
        return
      }
      const slice = Math.max(1, Math.floor(data.length / WAVE_BARS))
      for (let i = 0; i < WAVE_BARS; i++) {
        let peak = 0
        const start = i * slice
        const end = Math.min(data.length, start + slice)
        for (let j = start; j < end; j++) {
          const v = Math.abs(data[j] - 128) / 128
          if (v > peak) peak = v
        }
        const target = Math.max(WAVE_FLOOR, Math.min(1, peak * 1.8))
        const prev = levelsRef.current[i] ?? WAVE_FLOOR
        levelsRef.current[i] = prev + (target - prev) * (target > prev ? 0.6 : WAVE_SMOOTH)
      }
      drawWave()
      rafRef.current = requestAnimationFrame(() => loopRef.current())
    }
  }, [drawWave])

  useEffect(() => {
    cycleRef.current = (session: number) => {
      const stream = streamRef.current
      if (!stream || session !== sessionRef.current || modeRef.current !== 'live') return
      const chunks: Blob[] = []
      let rec: MediaRecorder
      try {
        rec = new MediaRecorder(stream)
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
        if (cycleTimerRef.current !== null) {
          window.clearTimeout(cycleTimerRef.current)
          cycleTimerRef.current = null
        }
        const stillLive = modeRef.current === 'live' && session === sessionRef.current
        if (stillLive) cycleRef.current(session)
        const type = (chunks[0]?.type || rec.mimeType || 'audio/webm').split(';')[0]
        const blob = new Blob(chunks, { type })
        if (blob.size === 0) {
          void searchCumulative(session, !stillLive)
          if (!stillLive) teardownAudio()
          return
        }
        const decodeCtx = ctxRef.current
        if (!decodeCtx) {
          void searchCumulative(session, !stillLive)
          if (!stillLive) teardownAudio()
          return
        }
        void blob
          .arrayBuffer()
          .then((buf) => decodeCtx.decodeAudioData(buf))
          .then((decoded) => {
            if (session !== sessionRef.current) return
            const mono = decoded.getChannelData(0)
            pcmRef.current.push(new Float32Array(mono))
            pcmLenRef.current += mono.length
            nativeRateRef.current = decoded.sampleRate
          })
          .catch(() => {
            // Undecodable segment: keep listening, next cycle carries on.
          })
          .finally(() => {
            if (!stillLive) teardownAudio()
            void searchCumulative(session, !stillLive)
          })
      }
      try {
        rec.start()
      } catch {
        setError('Could not start audio recording on this device.')
        modeRef.current = 'stopped'
        setListening(false)
        return
      }
      cycleTimerRef.current = window.setTimeout(() => {
        try {
          rec.stop()
        } catch {
          // Already stopped
        }
      }, LIVE_SEGMENT_MS)
    }
  }, [searchCumulative])

  const stop = useCallback(() => {
    if (cycleTimerRef.current !== null) {
      window.clearTimeout(cycleTimerRef.current)
      cycleTimerRef.current = null
    }
    modeRef.current = 'stopped'
    setListening(false)
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') {
      // The cycle-attached onstop appends the tail and runs the final search.
      try {
        rec.stop()
      } catch {
        teardownAudio()
        releaseStream()
      }
    } else {
      teardownAudio()
      void searchCumulative(sessionRef.current, true)
    }
  }, [searchCumulative])

  useEffect(() => {
    stopRef.current = stop
  })

  const start = useCallback(async () => {
    if (!supported || busyRef.current || recRef.current) return
    busyRef.current = true
    setError(null)
    levelsRef.current = []
    pcmRef.current = []
    pcmLenRef.current = 0
    liveBusyRef.current = false
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: any) {
      setError(micErrorMessage(err?.name))
      busyRef.current = false
      return
    }
    streamRef.current = stream
    try {
      const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext ?? AudioContext
      const audioCtx = new AudioCtx()
      ctxRef.current = audioCtx
      nativeRateRef.current = audioCtx.sampleRate || TARGET_RATE
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 2048
      audioCtx.createMediaStreamSource(stream).connect(analyser)
      analyserRef.current = analyser
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        levelsRef.current = new Array(WAVE_BARS).fill(0.4)
        drawWave()
      } else {
        loopRef.current()
      }
    } catch {
      // Waveform is decorative; recording continues without it.
    }
    modeRef.current = 'live'
    sessionRef.current += 1
    lastVoiceRef.current = performance.now()
    setListening(true)
    cbRef.current.onSearching()
    cycleRef.current(sessionRef.current)
    busyRef.current = false
    timerRef.current = window.setTimeout(() => stop(), MAX_RECORD_MS)
  }, [supported, drawWave, stop])

  const toggle = useCallback(() => {
    if (searching) return
    if (listening) stop()
    else void start()
  }, [listening, searching, start, stop])

  useEffect(
    () => () => {
      modeRef.current = 'stopped'
      sessionRef.current += 1
      teardownAudio()
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

  return { supported, listening, searching, error, waveCanvas: setWaveCanvas, toggle, stop }
}
