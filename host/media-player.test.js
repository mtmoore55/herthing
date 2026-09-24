import { describe, expect, test } from 'bun:test'
import { executeMediaCommand, normalizePlayback, readLocalSpotifyReceiver, readSpotifyDevices, setSpotifyTokenForTest } from './media-player.js'

describe('media player adapter', () => {
  test('normalizes Spotify playback', () => {
    expect(normalizePlayback({ is_playing: true, progress_ms: 137250, device: { name: 'iPhone' }, item: {
      name: 'Everything in Its Right Place', duration_ms: 250000, artists: [{ name: 'Radiohead' }],
      album: { name: 'Kid A', images: [{ url: 'https://example.test/art.jpg' }] }
    }})).toEqual({
      track: 'Everything in Its Right Place',
      artist: 'Radiohead',
      album: 'Kid A',
      artwork_source_url: 'https://example.test/art.jpg',
      duration_ms: 250000,
      position_ms: 137250,
      playing: true,
      device: 'iPhone',
      device_id: null,
      shuffle: false,
      repeat: 'off'
    })
  })

  test('returns null without a track', () => {
    expect(normalizePlayback({})).toBeNull()
  })

  test('routes transport controls to account-wide Spotify playback', async () => {
    setSpotifyTokenForTest({ access_token: 'test', expires_at: '2099-01-01T00:00:00.000Z' })
    const calls = []
    const fakeFetch = async (url, options) => { calls.push([url, options.method]); return new Response(null, { status: 204 }) }
    expect(await executeMediaCommand('spotify.toggle', { playing: true }, fakeFetch)).toBe(true)
    expect(await executeMediaCommand('spotify.play', {}, fakeFetch)).toBe(true)
    expect(await executeMediaCommand('spotify.next', false, fakeFetch)).toBe(true)
    expect(calls).toEqual([
      ['https://api.spotify.com/v1/me/player/pause', 'PUT'],
      ['https://api.spotify.com/v1/me/player/play', 'PUT'],
      ['https://api.spotify.com/v1/me/player/next', 'POST']
    ])
  })

  test('targets the known playback device when resuming', async () => {
    setSpotifyTokenForTest({ access_token: 'test', expires_at: '2099-01-01T00:00:00.000Z' })
    const calls = []
    const fakeFetch = async (url, options) => { calls.push([url, options.method]); return new Response(null, { status: 204 }) }
    expect(await executeMediaCommand('spotify.toggle', { playing: false, device_id: 'phone id' }, fakeFetch)).toBe(true)
    expect(calls).toEqual([['https://api.spotify.com/v1/me/player/play?device_id=phone%20id', 'PUT']])
  })

  test('transfers playback and controls shuffle and repeat', async () => {
    setSpotifyTokenForTest({ access_token: 'test', expires_at: '2099-01-01T00:00:00.000Z' })
    const calls = []
    const fakeFetch = async (url, options) => { calls.push([url, options.method, options.body]); return new Response(null, { status: 204 }) }
    await executeMediaCommand('spotify.transfer', { device_id: 'shed' }, fakeFetch)
    await executeMediaCommand('spotify.shuffle', { enabled: true }, fakeFetch)
    await executeMediaCommand('spotify.repeat', { mode: 'context' }, fakeFetch)
    expect(calls).toEqual([
      ['https://api.spotify.com/v1/me/player', 'PUT', JSON.stringify({ device_ids: ['shed'], play: true })],
      ['https://api.spotify.com/v1/me/player/shuffle?state=true', 'PUT', undefined],
      ['https://api.spotify.com/v1/me/player/repeat?state=context', 'PUT', undefined]
    ])
  })

  test('normalizes available devices', async () => {
    setSpotifyTokenForTest({ access_token: 'test', expires_at: '2099-01-01T00:00:00.000Z' })
    const fakeFetch = async () => Response.json({ devices: [{ id: 'shed', name: 'HerThing Shed', type: 'Computer', is_active: false, is_restricted: false, volume_percent: 72 }] })
    expect(await readSpotifyDevices(fakeFetch)).toEqual([{ id: 'shed', name: 'HerThing Shed', type: 'Computer', active: false, restricted: false, volume: 72 }])
  })

  test('discovers the local HerThing receiver without the Spotify device API', async () => {
    const fakeFetch = async () => Response.json({
      deviceID: 'shed', remoteName: 'HerThing Shed', deviceType: 'Speaker', statusString: 'OK'
    })
    expect(await readLocalSpotifyReceiver(fakeFetch)).toEqual({
      id: 'shed', name: 'HerThing Shed', type: 'Speaker', active: false, restricted: false, volume: null
    })
  })
})
