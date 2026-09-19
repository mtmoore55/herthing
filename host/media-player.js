const separator = '\u001f'

function run(args) {
  const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
}

export function parseMetadata(raw, positionSeconds = '0') {
  if (!raw) return null
  const [status, track, artist, album, artUrl, durationMicros] = raw.split(separator)
  if (!track) return null
  return {
    track,
    artist: artist || 'Unknown artist',
    album: album || null,
    art_url: artUrl || null,
    duration_ms: Math.max(0, Math.round(Number(durationMicros || 0) / 1000)),
    position_ms: Math.max(0, Math.round(Number(positionSeconds || 0) * 1000)),
    playing: status === 'Playing'
  }
}

export function readNowPlaying() {
  const format = ['{{status}}', '{{title}}', '{{artist}}', '{{album}}', '{{mpris:artUrl}}', '{{mpris:length}}'].join(separator)
  const metadata = run(['playerctl', '--player=spotifyd', 'metadata', '--format', format])
  const position = run(['playerctl', '--player=spotifyd', 'position'])
  return parseMetadata(metadata, position)
}

const commands = {
  'spotify.previous': 'previous',
  'spotify.toggle': 'play-pause',
  'spotify.next': 'next'
}

export function executeMediaCommand(command) {
  const action = commands[command]
  if (!action) return false
  const result = Bun.spawnSync(['playerctl', '--player=spotifyd', action], { stdout: 'ignore', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `media command failed: ${action}`)
  return true
}
