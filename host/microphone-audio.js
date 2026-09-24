export function createPcmEnergyAnalyzer({ sampleBytes = 4, reference = 2147483648, sampleRate = 16000, highpassHz = 80 } = {}) {
  let remainder = new Uint8Array(0)
  const alpha = highpassHz > 0 ? 1 / (1 + 2 * Math.PI * highpassHz / sampleRate) : 1
  let previousInput = 0
  let previousOutput = 0

  return {
    analyze(input) {
      const chunk = input instanceof Uint8Array ? input : new Uint8Array(input)
      const joined = new Uint8Array(remainder.length + chunk.length)
      joined.set(remainder)
      joined.set(chunk, remainder.length)
      const complete = joined.length - (joined.length % sampleBytes)
      const view = new DataView(joined.buffer, joined.byteOffset, complete)
      let squares = 0
      let rawSquares = 0
      let peak = 0
      let samples = 0
      for (let offset = 0; offset < complete; offset += sampleBytes) {
        const value = sampleBytes === 4 ? view.getInt32(offset, true) : view.getInt16(offset, true)
        const raw = value / reference
        const normalized = highpassHz > 0 ? alpha * (previousOutput + raw - previousInput) : raw
        previousInput = raw
        previousOutput = normalized
        rawSquares += raw * raw
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
      return { samples, rms, peak, db, energy, raw_db: rawSquares > 0 ? 10 * Math.log10(rawSquares / samples) : -120 }
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
  initialSpeechMs = 0,
  adaptiveNoiseMarginDb = 0,
  adaptiveSilenceMarginDb = 0
} = {}) {
  let voicedMs = initialSpeechMs
  let quietMs = 0
  let armed = voicedMs >= minimumSpeechMs
  let elapsedMs = 0
  let noiseFloorDb = Infinity
  const calibration = []

  return {
    update(measurement) {
      const durationMs = measurement.samples / sampleRate * 1000
      elapsedMs += durationMs
      if (elapsedMs <= startupDelayMs) {
        // Ignore the capture startup edge and digital silence. A minimum over
        // startup samples can pin calibration to a single quiet glitch, making
        // steady fan noise look like speech for the rest of the capture.
        if (elapsedMs > startupDelayMs / 2 && measurement.db > -100) {
          calibration.push({ db: measurement.db, durationMs })
        }
        return { speech_detected: false, trailing_silence_ms: 0, endpoint: false }
      }
      if (calibration.length) {
        const sorted = calibration.sort((a, b) => a.db - b.db)
        const halfDuration = sorted.reduce((sum, frame) => sum + frame.durationMs, 0) / 2
        let duration = 0
        for (const frame of sorted) {
          duration += frame.durationMs
          if (duration >= halfDuration) { noiseFloorDb = frame.db; break }
        }
        calibration.length = 0
      }
      const effectiveSpeechDb = Number.isFinite(noiseFloorDb) && adaptiveNoiseMarginDb
        ? Math.max(speechDb, noiseFloorDb + adaptiveNoiseMarginDb)
        : speechDb
      const effectiveSilenceDb = Number.isFinite(noiseFloorDb) && adaptiveSilenceMarginDb
        ? Math.max(silenceDb, noiseFloorDb + adaptiveSilenceMarginDb)
        : silenceDb
      if (!armed) {
        voicedMs = measurement.db >= effectiveSpeechDb
          ? voicedMs + durationMs
          : Math.max(0, voicedMs - durationMs * 0.5)
        armed = voicedMs >= minimumSpeechMs
      } else {
        quietMs = measurement.db < effectiveSilenceDb ? quietMs + durationMs : 0
      }
      return {
        speech_detected: armed,
        trailing_silence_ms: Math.round(quietMs),
        endpoint: armed && quietMs >= trailingSilenceMs,
        noise_floor_db: Number.isFinite(noiseFloorDb) ? noiseFloorDb : null,
        speech_threshold_db: effectiveSpeechDb,
        silence_threshold_db: effectiveSilenceDb
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
