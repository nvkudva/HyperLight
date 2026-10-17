/* global AudioWorkletProcessor, registerProcessor */
// Runs on the audio thread. Batches the 128-sample render quanta into larger
// mono chunks so the main thread isn't flooded with messages.
const CHUNK_SAMPLES = 1024

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(CHUNK_SAMPLES)
    this.filled = 0
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    let offset = 0
    while (offset < channel.length) {
      const take = Math.min(channel.length - offset, CHUNK_SAMPLES - this.filled)
      this.buffer.set(channel.subarray(offset, offset + take), this.filled)
      this.filled += take
      offset += take
      if (this.filled === CHUNK_SAMPLES) {
        this.port.postMessage(this.buffer, [this.buffer.buffer])
        this.buffer = new Float32Array(CHUNK_SAMPLES)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
