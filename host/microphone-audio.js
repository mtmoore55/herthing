export function createPcmEnergyAnalyzer({ sampleBytes = 4, reference = 2147483648 } = {}) {
  let remainder = new Uint8Array(0)

  return {
    analyze(input) {
      const chunk = input instanceof Uint8Array ? input : new Uint8Array(input)
      const joined = new Uint8Array(remainder.length + chunk.length)
      joined.set(remainder)
      joined.set(chunk, remainder.length)
      const complete = joined.length - (joined.length % sampleBytes)
      const view = new DataView(joined.buffer, joined.byteOffset, complete)
      let squares = 0
      let peak = 0
      let samples = 0
      for (let offset = 0; offset < complete; offset += sampleBytes) {
        const value = sampleBytes === 4 ? view.getInt32(offset, true) : view.getInt16(offset, true)
        const normalized = value / reference
        squares += normalized * normalized
        peak = Math.max(peak, Math.abs(normalized))
        samples += 1
      }
      remainder = joined.slice(complete)
      const rms = samples ? Math.sqrt(squares / samples) : 0
      const db = rms > 0 ? 20 * Math.log10(rms) : -120
      // The Car Thing's native path sits near -70 dBFS at rest and roughly
      // -55 dBFS for conversational speech. Preserve some quiet motion while
      // mapping speech into the useful middle of the visual range.
      const energy = Math.max(0, Math.min(1, (db + 75) / 30))
      return { samples, rms, peak, db, energy }
    }
  }
}

export function createSpeechEndpointDetector({
  sampleRate = 16000,
  speechDb = -63,
  silenceDb = -65,
  startupDelayMs = 450,
  minimumSpeechMs = 300,
  trailingSilenceMs = 650,
  initialSpeechMs = 0
} = {}) {
  let voicedMs = initialSpeechMs
  let quietMs = 0
  let armed = voicedMs >= minimumSpeechMs
  let elapsedMs = 0

  return {
    update(measurement) {
      const durationMs = measurement.samples / sampleRate * 1000
      elapsedMs += durationMs
      if (elapsedMs < startupDelayMs) {
        return { speech_detected: false, trailing_silence_ms: 0, endpoint: false }
      }
      if (!armed) {
        voicedMs = measurement.db >= speechDb
          ? voicedMs + durationMs
          : Math.max(0, voicedMs - durationMs * 0.5)
        armed = voicedMs >= minimumSpeechMs
      } else {
        quietMs = measurement.db < silenceDb ? quietMs + durationMs : 0
      }
      return {
        speech_detected: armed,
        trailing_silence_ms: Math.round(quietMs),
        endpoint: armed && quietMs >= trailingSilenceMs
      }
    }
  }
}

export function createPcmRingBuffer(maxBytes = 16000 * 4 * 2, sampleBytes = 4) {
  const chunks = []
  let bytes = 0
  return {
    push(value) {
      const chunk = Buffer.from(value)
      chunks.push(chunk)
      bytes += chunk.byteLength
      // Network reads may split a 32-bit PCM sample. Always discard a whole
      // number of samples so the retained buffer still begins on a sample
      // boundary.
      let discard = Math.ceil(Math.max(0, bytes - maxBytes) / sampleBytes) * sampleBytes
      while (discard > 0 && chunks.length) {
        const count = Math.min(discard, chunks[0].byteLength)
        chunks[0] = chunks[0].subarray(count)
        if (!chunks[0].byteLength) chunks.shift()
        bytes -= count
        discard -= count
      }
    },
    snapshot() {
      const completeBytes = bytes - (bytes % sampleBytes)
      return Buffer.concat(chunks, bytes).subarray(0, completeBytes)
    },
    clear() { chunks.length = 0; bytes = 0 },
    get byteLength() { return bytes }
  }
}
