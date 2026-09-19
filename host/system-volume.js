export function normalizeVolume(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(0, Math.min(100, Math.round(number)))
}

export function setSystemVolume(value) {
  const volume = normalizeVolume(value)
  if (volume === null) return false
  const result = Bun.spawnSync(['wpctl', 'set-volume', '@DEFAULT_AUDIO_SINK@', `${volume / 100}`], {
    stdout: 'ignore',
    stderr: 'pipe'
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || 'volume command failed')
  return true
}
