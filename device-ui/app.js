(function () {
  'use strict'

  var protocol = 'herthing/1'
  var revision = -1
  var socket = null
  var retryTimer = null
  var toastTimer = null
  var volumeTimer = null
  var volume = 50
  var hostClockSkewMs = 0
  var state = {
    clock: { utc_offset_minutes: 0 },
    weather: null,
    next_event: null,
    now_playing: null,
    microphone: { mode: 'off', activity: 'idle' }
  }

  var $ = function (id) { return document.getElementById(id) }
  var dashboard = document.querySelector('.dashboard')
  var connection = $('connection')

  function messageId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
  }

  function envelope(type, fields) {
    var message = { protocol: protocol, type: type, id: messageId(), sent_at: new Date().toISOString() }
    Object.keys(fields || {}).forEach(function (key) { message[key] = fields[key] })
    return message
  }

  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify(message))
    return true
  }

  function sendInput(input, value) { send(envelope('input_event', { input: input, value: value })) }

  function sendCommand(command, args) {
    var key = messageId()
    if (!send(envelope('command', { command: command, arguments: args || {}, idempotency_key: key }))) showToast('HOST OFFLINE')
  }

  function setConnection(online) {
    connection.className = 'connection ' + (online ? 'online' : 'offline')
    connection.querySelector('span').textContent = online ? 'HOST ONLINE' : 'HOST OFFLINE'
  }

  function connect() {
    clearTimeout(retryTimer)
    var query = new URLSearchParams(window.location.search)
    var endpoint = query.get('ws') || 'ws://172.16.42.1:8787/ws'
    try { socket = new WebSocket(endpoint) } catch (_) { scheduleReconnect(); return }
    socket.addEventListener('open', function () {
      setConnection(true)
      send(envelope('hello', { role: 'device', capabilities: ['display.800x480', 'touch', 'knob', 'presets', 'back'] }))
    })
    socket.addEventListener('message', function (event) {
      var message
      try { message = JSON.parse(event.data) } catch (_) { return }
      if (message.protocol !== protocol) return
      if (message.type === 'dashboard_state' && message.revision >= revision) {
        revision = message.revision
        state = message
        if (message.clock && Number(message.clock.epoch_ms)) {
          hostClockSkewMs = Number(message.clock.epoch_ms) - Date.now()
        }
        render()
      }
      if (message.type === 'error' && message.message) showToast(message.message.toUpperCase())
    })
    socket.addEventListener('close', function () { setConnection(false); scheduleReconnect() })
    socket.addEventListener('error', function () { setConnection(false) })
  }

  function scheduleReconnect() { clearTimeout(retryTimer); retryTimer = setTimeout(connect, 2000) }
  function wallClockDate(date) {
    var offset = state.clock && Number(state.clock.utc_offset_minutes)
    return new Date(date.getTime() + (isNaN(offset) ? 0 : offset) * 60000)
  }

  function formatTime(date) {
    var wallClock = wallClockDate(date)
    var hours = wallClock.getUTCHours()
    var suffix = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12 || 12
    return hours + ':' + String(wallClock.getUTCMinutes()).padStart(2, '0') + ' ' + suffix
  }

  function tick() {
    var now = new Date(Date.now() + hostClockSkewMs)
    $('clock').textContent = formatTime(now)
    var wallClock = wallClockDate(now)
    var weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
    var months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
    $('date').textContent = weekdays[wallClock.getUTCDay()] + ' · ' + months[wallClock.getUTCMonth()] + ' ' + wallClock.getUTCDate()
    renderEventRelative(now)
  }

  function renderEventRelative(now) {
    if (!state.next_event) return
    var start = new Date(state.next_event.starts_at)
    var minutes = Math.round((start.getTime() - now.getTime()) / 60000)
    $('event-relative').textContent = minutes > 0
      ? 'in ' + (minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm')
      : minutes > -60 ? 'started ' + Math.abs(minutes) + ' min ago' : ''
  }

  function symbolFor(value) {
    var text = String(value || '').toLowerCase()
    if (text.indexOf('rain') >= 0) return '☂'
    if (text.indexOf('cloud') >= 0) return '☁'
    if (text.indexOf('snow') >= 0) return '✣'
    if (text.indexOf('clear') >= 0 || text.indexOf('sun') >= 0) return '☀'
    return '◌'
  }

  function renderWeather() {
    var weather = state.weather
    $('weather-symbol').textContent = weather ? symbolFor(weather.symbol || weather.condition) : '—'
    $('temperature').textContent = weather ? Math.round(weather.temperature) + '°' : '--°'
    $('condition').textContent = weather ? weather.condition : 'Weather unavailable'
  }

  function renderEvent() {
    var event = state.next_event
    $('event-empty').classList.toggle('hidden', !!event)
    $('event-state').classList.toggle('hidden', !event)
    if (!event) return
    $('event-title').textContent = event.title
    $('event-time').textContent = formatTime(new Date(event.starts_at))
    $('event-location').textContent = event.location || ''
    renderEventRelative(new Date(Date.now() + hostClockSkewMs))
  }

  function formatDuration(milliseconds) {
    var seconds = Math.max(0, Math.floor(milliseconds / 1000))
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
  }

  function renderTrack() {
    var track = state.now_playing
    $('track-empty').classList.toggle('hidden', !!track)
    $('track-state').classList.toggle('hidden', !track)
    if (!track) { $('album-art').style.backgroundImage = ''; return }
    $('track-title').textContent = track.track
    $('track-artist').textContent = track.artist
    $('track-time').textContent = formatDuration(track.position_ms)
    $('play-button').textContent = track.playing ? 'Ⅱ' : '▶'
    $('track-progress').style.width = (track.duration_ms ? Math.min(100, track.position_ms / track.duration_ms * 100) : 0) + '%'
    $('album-art').style.backgroundImage = track.art_url ? 'url("' + track.art_url.replace(/"/g, '') + '")' : ''
  }

  function renderMicrophone() {
    var microphone = state.microphone || { mode: 'off', activity: 'idle' }
    var mode = microphone.mode || 'off'
    $('mic-status').className = 'mic ' + mode + (microphone.activity === 'listening' ? ' listening' : '')
    $('mic-label').textContent = mode === 'off' ? 'MIC OFF' : microphone.activity === 'listening' ? 'LISTENING' : mode.toUpperCase()
  }

  function render() { renderWeather(); renderEvent(); renderTrack(); renderMicrophone() }

  function showToast(text) {
    $('toast').textContent = text
    $('toast').classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { $('toast').classList.remove('visible') }, 1800)
  }

  function showVolume(delta) {
    volume = Math.max(0, Math.min(100, volume + delta))
    $('volume-value').textContent = String(volume)
    $('volume-level').style.width = volume + '%'
    $('volume').classList.add('visible')
    clearTimeout(volumeTimer)
    volumeTimer = setTimeout(function () { $('volume').classList.remove('visible') }, 1200)
  }

  function setView(view) { dashboard.dataset.view = view; showToast(view === 'home' ? 'HOME' : view.toUpperCase()) }

  window.addEventListener('wheel', function (event) {
    event.preventDefault()
    var delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
    // Car Thing reports the physical rotary direction opposite to desktop
    // wheel convention.
    var direction = delta > 0 ? -1 : 1
    showVolume(direction * 4)
    sendInput(direction > 0 ? 'knob_right' : 'knob_left', { volume: volume })
  }, { passive: false, capture: true })

  window.addEventListener('keydown', function (event) {
    var code = event.code || event.key
    var inputMap = { Enter: 'knob_press', Escape: 'back', Digit1: 'preset_1', Digit2: 'preset_2', Digit3: 'preset_3', Digit4: 'preset_4' }
    if (!inputMap[code]) return
    event.preventDefault()
    sendInput(inputMap[code])
    if (code === 'Digit1' || code === 'Escape') setView('home')
    if (code === 'Digit2') setView('spotify')
    if (code === 'Digit3') setView('calendar')
    if (code === 'Digit4') showToast('MIC CONTROL · PHASE 4')
    if (code === 'Enter') showToast('VOICE · PHASE 4')
  }, true)

  window.addEventListener('pointerdown', function (event) {
    var command = event.target.closest('[data-command]')
    if (command) { event.preventDefault(); sendCommand(command.dataset.command); return }
    sendInput('touch', { x: Math.round(event.clientX), y: Math.round(event.clientY) })
  })

  tick(); render(); setInterval(tick, 1000); connect()
})()
