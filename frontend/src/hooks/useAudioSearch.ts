import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { micErrorMessage } from './useSegmentedRecorder'
import workletUrl from './pcmWorklet.js?url&no-inline'
import type { SearchBucket } from '../types'

const SAMPLE_RATE = 16000
const MAX_RECORD_MS = 90000
const WAVE_BARS = 24
const WAVE_FLOOR = 0.08
const WAVE_SMOOTH = 0.35

const MIN_SPEECH_RMS = 0.01
const NOISE_FLOOR_MULTIPLIER = 3
const INITIAL_NOISE_FLOOR = 0.003
const MIN_UTTERANCE_SEC = 0.25
const PAUSE_SEC = 0.6
const SEARCH_INTERVAL_SEC = 2.5
const SEARCH_PAD_SEC = 0.2
const MAX_SEARCH_SEC = 30
const AUTO_STOP_SEC = 1.2
const NO_SPEECH_STOP_SEC = 6

interface AudioSearch {
  supported: boolean
  listening: boolean
  searching: boolean
  error: string | null
  waveCanvas: (el: HTMLCanvasElement | null) => void
  toggle: () => void
  stop: () => void
  reset: () => void
  cancel: () => void
}

interface AudioSearchCallbacks {
  onResults: (buckets: SearchBucket[], transcript: string) => void
  onSearching: () => void
  onStart?: () => void
}

// All times below are positions on the 16kHz sample clock, so VAD decisions
// don't depend on how late the main thread happens to run.
interface CaptureState {
  chunks: { start: number; samples: Float32Array }[]
  base: number
  total: number
  noiseFloor: number
  inSpeech: boolean
  utteranceStart: number
  utteranceVoiced: number
  lastVoicedEnd: number
  lastSpeechEnd: number
  firstSpeechStart: number | null
  unsentSpeech: boolean
  lastSendAt: number
}

interface CaptureResources {
  stream: MediaStream
  context: AudioContext
  node: AudioWorkletNode
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


function createCaptureState(base: number, noiseFloor: number): CaptureState {
  return {
    chunks: [],
    base,
    total: base,
    noiseFloor,
    inSpeech: false,
    utteranceStart: base,
    utteranceVoiced: 0,
    lastVoicedEnd: base,
    lastSpeechEnd: base,
    firstSpeechStart: null,
    unsentSpeech: false,
    lastSendAt: base,
  }
}

function rmsOf(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / Math.max(1, samples.length))
}

function ingestChunk(state: CaptureState, samples: Float32Array) {
  const start = state.total
  const end = start + samples.length
  state.chunks.push({ start, samples })
  state.total = end

  const rms = rmsOf(samples)
  const voiced = rms > Math.max(state.noiseFloor * NOISE_FLOOR_MULTIPLIER, MIN_SPEECH_RMS)
  // The floor falls fast but rises slowly, and barely moves during speech, so
  // talking never raises the bar for itself.
  const adaptRate = voiced ? 0.002 : rms < state.noiseFloor ? 0.2 : 0.05
  state.noiseFloor += (rms - state.noiseFloor) * adaptRate

  if (!voiced) {
    if (state.inSpeech && end - state.lastVoicedEnd >= PAUSE_SEC * SAMPLE_RATE) state.inSpeech = false
    return
  }
  if (!state.inSpeech) {
    state.inSpeech = true
    state.utteranceStart = start
    state.utteranceVoiced = 0
  }
  state.utteranceVoiced += samples.length
  state.lastVoicedEnd = end
  if (state.utteranceVoiced < MIN_UTTERANCE_SEC * SAMPLE_RATE) return
  if (state.firstSpeechStart === null) {
    state.firstSpeechStart = state.utteranceStart
    state.lastSendAt = state.utteranceStart
  }
  state.lastSpeechEnd = end
  state.unsentSpeech = true
}

function shouldSearch(state: CaptureState): boolean {
  if (!state.unsentSpeech) return false
  const sincePause = state.total - state.lastSpeechEnd
  const sinceSend = state.total - state.lastSendAt
  return sincePause >= PAUSE_SEC * SAMPLE_RATE || sinceSend >= SEARCH_INTERVAL_SEC * SAMPLE_RATE
}

function shouldAutoStop(state: CaptureState): boolean {
  if (state.firstSpeechStart === null) return state.total - state.base >= NO_SPEECH_STOP_SEC * SAMPLE_RATE
  return state.total - state.lastSpeechEnd >= AUTO_STOP_SEC * SAMPLE_RATE
}

function collectSpeechSamples(state: CaptureState): Float32Array {
  const pad = SEARCH_PAD_SEC * SAMPLE_RATE
  const end = Math.min(state.total, state.lastSpeechEnd + pad)
  const start = Math.max(state.base, (state.firstSpeechStart ?? state.base) - pad, end - MAX_SEARCH_SEC * SAMPLE_RATE)
  const out = new Float32Array(Math.max(0, end - start))
  for (const chunk of state.chunks) {
    const chunkEnd = chunk.start + chunk.samples.length
    if (chunkEnd <= start || chunk.start >= end) continue
    const from = Math.max(start, chunk.start)
    const to = Math.min(end, chunkEnd)
    out.set(chunk.samples.subarray(from - chunk.start, to - chunk.start), from - start)
  }
  return out
}

// Captures the mic continuously (AudioWorklet, 16kHz mono) and searches by
// what was said so far: after a ~600ms pause following new speech, and every
// ~2.5s during long speech. One request at a time; speech that arrives
// meanwhile is sent once the request returns. The mic stops itself shortly
// after the user finishes talking, or silently if nobody speaks.
export function useAudioSearch({ onResults, onSearching, onStart }: AudioSearchCallbacks): AudioSearch {
  const [listening, setListening] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasElRef = useRef<HTMLCanvasElement | null>(null)
  const setWaveCanvas = useCallback((el: HTMLCanvasElement | null) => {
    canvasElRef.current = el
  }, [])
  const cbRef = useRef({ onResults, onSearching, onStart })
  const resourcesRef = useRef<CaptureResources | null>(null)
  const rafRef = useRef<number | null>(null)
  const levelsRef = useRef<number[]>([])
  const maxTimerRef = useRef<number | null>(null)
  const stateRef = useRef(createCaptureState(0, INITIAL_NOISE_FLOOR))
  const inFlightRef = useRef<Promise<void> | null>(null)
  const lastTranscriptRef = useRef('')
  const generationRef = useRef(0)
  const listeningRef = useRef(false)
  const startingRef = useRef(false)
  const disposedRef = useRef(false)

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

  useEffect(() => {
    cbRef.current = { onResults, onSearching, onStart }
  })

  const teardownCapture = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }
    const resources = resourcesRef.current
    resourcesRef.current = null
    if (!resources) return
    resources.node.port.onmessage = null
    resources.stream.getTracks().forEach((track) => track.stop())
    try {
      resources.node.disconnect()
      void resources.context.close()
    } catch {
      // Ignore teardown errors
    }
  }

  const handleResponse = (response: api.SpotlightResponse) => {
    const transcript = (response.query ?? '').trim()
    if (!transcript || transcript === lastTranscriptRef.current) return
    lastTranscriptRef.current = transcript
    cbRef.current.onResults(response.buckets || [], transcript)
  }

  const sendSearch = (): Promise<void> => {
    const state = stateRef.current
    const generation = generationRef.current
    const wav = encodeWav(collectSpeechSamples(state), SAMPLE_RATE)
    state.unsentSpeech = false
    state.lastSendAt = state.total
    setSearching(true)
    cbRef.current.onSearching()
    const request: Promise<void> = api
      .searchByAudio(wav)
      .then((response) => {
        if (generation === generationRef.current) handleResponse(response)
      })
      .catch((err) => {
        if (generation === generationRef.current) setError((err as Error)?.message ?? 'Audio search failed.')
      })
      .finally(() => {
        // A reset or newer request may already own these; only clean up our own.
        if (inFlightRef.current !== request) return
        inFlightRef.current = null
        setSearching(false)
      })
    inFlightRef.current = request
    return request
  }

  // Ends capture, then runs one last search for speech not yet sent, after
  // any request already in flight.
  const stop = () => {
    if (!listeningRef.current) return
    listeningRef.current = false
    setListening(false)
    teardownCapture()
    const generation = generationRef.current
    void (async () => {
      await inFlightRef.current
      if (generation !== generationRef.current || !stateRef.current.unsentSpeech) return
      await sendSearch()
    })()
  }

  const handleChunk = (samples: Float32Array) => {
    const state = stateRef.current
    ingestChunk(state, samples)
    if (shouldAutoStop(state)) {
      stop()
      return
    }
    if (!inFlightRef.current && shouldSearch(state)) void sendSearch()
  }

  // Drops the audio heard so far and any search in flight. The mic keeps
  // recording, so later speech starts a fresh search.
  const reset = () => {
    generationRef.current += 1
    inFlightRef.current = null
    lastTranscriptRef.current = ''
    stateRef.current = createCaptureState(stateRef.current.total, stateRef.current.noiseFloor)
    setSearching(false)
  }

  // Stops the mic and discards everything: no search runs for the audio so far.
  const cancel = () => {
    reset()
    listeningRef.current = false
    setListening(false)
    teardownCapture()
  }

  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  })

  const startWaveform = (analyser: AnalyserNode) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      levelsRef.current = new Array(WAVE_BARS).fill(0.4)
      drawWave()
      return
    }
    const data = new Uint8Array(analyser.fftSize)
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      const slice = Math.max(1, Math.floor(data.length / WAVE_BARS))
      for (let i = 0; i < WAVE_BARS; i++) {
        let peak = 0
        const from = i * slice
        const to = Math.min(data.length, from + slice)
        for (let j = from; j < to; j++) {
          const level = Math.abs(data[j] - 128) / 128
          if (level > peak) peak = level
        }
        const target = Math.max(WAVE_FLOOR, Math.min(1, peak * 1.8))
        const prev = levelsRef.current[i] ?? WAVE_FLOOR
        levelsRef.current[i] = prev + (target - prev) * (target > prev ? 0.6 : WAVE_SMOOTH)
      }
      drawWave()
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const openCapture = async (stream: MediaStream): Promise<CaptureResources> => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE })
    await context.audioWorklet.addModule(workletUrl)
    if (context.state === 'suspended') await context.resume()
    const node = new AudioWorkletNode(context, 'pcm-capture')
    const nativeRate = context.sampleRate
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const samples = nativeRate === SAMPLE_RATE ? event.data : resampleMono(event.data, nativeRate, SAMPLE_RATE)
      handleChunk(samples)
    }
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)
    source.connect(node)
    // Some engines only pull audio through nodes that reach the destination;
    // the processor writes no output, so this stays silent.
    node.connect(context.destination)
    startWaveform(analyser)
    return { stream, context, node }
  }

  const start = async () => {
    if (startingRef.current || listeningRef.current) return
    startingRef.current = true
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      startingRef.current = false
      setError(micErrorMessage((err as DOMException)?.name))
      return
    }
    startingRef.current = false
    if (disposedRef.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    generationRef.current += 1
    inFlightRef.current = null
    lastTranscriptRef.current = ''
    stateRef.current = createCaptureState(0, INITIAL_NOISE_FLOOR)
    levelsRef.current = []
    setSearching(false)
    try {
      resourcesRef.current = await openCapture(stream)
    } catch {
      stream.getTracks().forEach((track) => track.stop())
      setError('Could not start audio recording on this device.')
      return
    }
    listeningRef.current = true
    setListening(true)
    api.warmupAudio().catch(() => {})
    cbRef.current.onStart?.()
    maxTimerRef.current = window.setTimeout(() => stopRef.current(), MAX_RECORD_MS)
  }

  const toggle = () => {
    if (listeningRef.current) stop()
    else void start()
  }

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      generationRef.current += 1
      teardownCapture()
    }
  }, [])

  return {
    supported:
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof AudioContext !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined',
    listening,
    searching,
    error,
    waveCanvas: setWaveCanvas,
    toggle,
    stop,
    reset,
    cancel,
  }
}
