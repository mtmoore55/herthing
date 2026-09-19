#!/usr/bin/node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

const runtimeDirectory = `${process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`}/herthing`
const statePath = `${runtimeDirectory}/librespot-state.json`
const temporaryPath = `${statePath}.${process.pid}.tmp`

function existingState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return null
  }
}

const event = process.env.PLAYER_EVENT
let state = existingState() || {}
const position = Number(process.env.POSITION_MS)

if (event === 'track_changed') {
  state = {
    track: process.env.NAME || 'Unknown track',
    artist: (process.env.ARTISTS || '').split('\n').filter(Boolean).join(', ') || 'Unknown artist',
    album: process.env.ALBUM || null,
    art_url: (process.env.COVERS || '').split('\n').filter(Boolean)[0] || null,
    duration_ms: Number(process.env.DURATION_MS || 0),
    position_ms: 0,
    playing: false,
    updated_at_ms: Date.now()
  }
} else if (state.track && ['playing', 'paused', 'stopped', 'seeked', 'position_correction', 'end_of_track'].includes(event)) {
  if (Number.isFinite(position)) state.position_ms = position
  state.playing = event === 'playing'
  state.updated_at_ms = Date.now()
}

if (state.track) {
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 })
  writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, statePath)
}
