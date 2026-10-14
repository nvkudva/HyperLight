import { useCallback, useEffect, useRef, useState } from 'react'
import { searchByAudio } from '../api'
import { useSegmentedRecorder } from './useSegmentedRecorder'
import type { SearchBucket } from '../types'

const MAX_RECORD_MS = 90000
const LIVE_SEGMENT_MS = 2000
const SILENCE_MS = 3000
const VOICE_RMS = 0.02
const MIN_LIVE_SEC = 0.4
const SEARCH_WINDOW_SEC = 30
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
  reset: () => void
}

interface AudioSearchCallbacks {
  onResults: (buckets: SearchBucket[], transcript: string) => void
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
// appended to a cumulative PCM buffer, then only the most recent
// SEARCH_WINDOW_SEC seconds are resampled to 16kHz mono WAV and sent to audio
// search, so results update as speech comes in without re-uploading minutes
// of audio every segment. A 3s silence (or the 90s cap) stops the mic.
export function useAudioSearch({ onResults, onSearching }: AudioSearchCallbacks): AudioSearch {
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasElRef = useRef<HTMLCanvasElement | null>(null)
  const setWaveCanvas = useCallback((el: HTMLCanvasElement | null) => {
    canvasElRef.current = el
  }, [])
  const cbRef = useRef({ onResults, onSearching })
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const levelsRef = useRef<number[]>([])
  const maxTimerRef = useRef<number | null>(null)
  const pcmRef = useRef<Float32Array[]>([])
  const pcmLenRef = useRef(0)
  const nativeRateRef = useRef(TARGET_RATE)
  const liveBusyRef = useRef(false)
  const lastVoiceRef = useRef(0)
  const generationRef = useRef(0)

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

  const clearMaxTimer = () => {
    if (maxTimerRef.current === null) return
    window.clearTimeout(maxTimerRef.current)
    maxTimerRef.current = null
  }

  const teardownAudio = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    clearMaxTimer()
    try {
      void ctxRef.current?.close()
    } catch {
      // Ignore teardown errors
    }
    ctxRef.current = null
    analyserRef.current = null
  }

  useEffect(() => {
    cbRef.current = { onResults, onSearching }
  })

  const searchCumulative = async (session: number, final: boolean) => {
    if (!recorder.isCurrent(session)) return
    const generation = generationRef.current
    const total = pcmLenRef.current
    const rate = nativeRateRef.current
    if (total < rate * MIN_LIVE_SEC) {
      if (final) setSearching(false)
      return
    }
    if (!final && liveBusyRef.current) return
    liveBusyRef.current = true
    if (final) setSearching(true)
    try {
      const takeTotal = Math.min(total, rate * SEARCH_WINDOW_SEC)
      const tail: Float32Array[] = []
      let need = takeTotal
      for (let i = pcmRef.current.length - 1; i >= 0 && need > 0; i--) {
        const part = pcmRef.current[i]
        if (part.length <= need) {
          tail.unshift(part)
          need -= part.length
        } else {
          tail.unshift(part.subarray(part.length - need))
          need = 0
        }
      }
      const combined = new Float32Array(takeTotal)
      let off = 0
      for (const part of tail) {
        combined.set(part, off)
        off += part.length
      }
      const wav = encodeWav(resampleMono(combined, rate, TARGET_RATE), TARGET_RATE)
      const res = await searchByAudio(wav)
      if (!recorder.isCurrent(session) || generation !== generationRef.current) return
      cbRef.current.onResults(res.buckets || [], res.query || '')
    } catch (err) {
      if (final && recorder.isCurrent(session)) setError((err as Error)?.message ?? 'Audio search failed.')
    } finally {
      liveBusyRef.current = false
      if (final) setSearching(false)
    }
  }

  const finishSegment = (session: number, final: boolean) => {
    if (final) teardownAudio()
    void searchCumulative(session, final)
  }

  const handleSegment = (blob: Blob, session: number, final: boolean) => {
    const decodeCtx = ctxRef.current
    const generation = generationRef.current
    if (blob.size === 0 || !decodeCtx) {
      finishSegment(session, final)
      return
    }
    void blob
      .arrayBuffer()
      .then((buf) => decodeCtx.decodeAudioData(buf))
      .then((decoded) => {
        if (!recorder.isCurrent(session) || generation !== generationRef.current) return
        const mono = decoded.getChannelData(0)
        pcmRef.current.push(new Float32Array(mono))
        pcmLenRef.current += mono.length
        nativeRateRef.current = decoded.sampleRate
      })
      .catch(() => {
        // Undecodable segment: keep listening, next cycle carries on.
      })
      .finally(() => finishSegment(session, final))
  }

  const recorder = useSegmentedRecorder({
    segmentMs: LIVE_SEGMENT_MS,
    onSegment: handleSegment,
    onError: setError,
  })

  const stop = () => {
    clearMaxTimer()
    recorder.stop()
  }

  // Drops the audio heard so far and any search in flight. The mic keeps
  // recording, so later speech starts a fresh search.
  const reset = () => {
    generationRef.current += 1
    pcmRef.current = []
    pcmLenRef.current = 0
    liveBusyRef.current = false
    lastVoiceRef.current = performance.now()
    setSearching(false)
  }

  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  })

  const loopRef = useRef(() => {})
  useEffect(() => {
    loopRef.current = () => {
      const analyser = analyserRef.current
      if (!analyser) return
      const data = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(data)
      if (rmsOfTimeDomain(data) > VOICE_RMS) lastVoiceRef.current = performance.now()
      else if (recorder.isRecording() && performance.now() - lastVoiceRef.current > SILENCE_MS) {
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
  })

  const attachWaveform = (stream: MediaStream) => {
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
  }

  const start = async () => {
    setError(null)
    levelsRef.current = []
    pcmRef.current = []
    pcmLenRef.current = 0
    liveBusyRef.current = false
    setSearching(false)
    const stream = await recorder.start()
    if (!stream) return
    lastVoiceRef.current = performance.now()
    attachWaveform(stream)
    cbRef.current.onSearching()
    maxTimerRef.current = window.setTimeout(() => stopRef.current(), MAX_RECORD_MS)
  }

  const toggle = () => {
    if (recorder.listening) stop()
    else void start()
  }

  useEffect(() => teardownAudio, [])

  return {
    supported: recorder.supported && (typeof AudioContext !== 'undefined' || typeof (window as any).webkitAudioContext !== 'undefined'),
    listening: recorder.listening,
    searching,
    error,
    waveCanvas: setWaveCanvas,
    toggle,
    stop,
    reset,
  }
}
