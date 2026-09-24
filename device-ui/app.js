(function () {
  'use strict'

  var protocol = 'herthing/1'
  var revision = -1
  var socket = null
  var retryTimer = null
  var toastTimer = null
  var volumeTimer = null
  var responseTimer = null
  var responseAdvanceTimer = null
  var lastResponse = null
  var responseLines = []
  var responseLine = 0
  var responseManual = false
  var volume = 50
  var hostClockSkewMs = 0
  var eventUrgency = 0
  var visualHourOverride = null
  var visualClockOverride = null
  var activeTheme = 'signal'
  var knobHoldTimer = null
  var knobHeld = false
  var state = {
    clock: { utc_offset_minutes: 0 },
    weather: null,
    next_event: null,
    today_events: [],
    now_playing: null,
    spotify_devices: [],
    microphone: { mode: 'off', activity: 'idle' }
  }

  var $ = function (id) { return document.getElementById(id) }
  var dashboard = document.querySelector('.world')
  var connection = $('connection')

  function applyTheme(name, announce) {
    if (['signal', 'terminal', 'orbit', 'aurora'].indexOf(name) < 0) name = 'signal'
    activeTheme = name
    dashboard.dataset.theme = name
    try { localStorage.setItem('herthing-theme', name) } catch (_) {}
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-choice]'), function (button) {
      button.classList.toggle('selected', button.dataset.themeChoice === name)
    })
    if (window.HerThingVisuals && window.HerThingVisuals.setTheme) window.HerThingVisuals.setTheme(name)
    if (announce) showToast(name.toUpperCase())
  }

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
      // Host revisions are process-local and restart at one. A reconnected
      // device must accept the new host's first snapshot even when the prior
      // process had already published a larger revision.
      revision = -1
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
    var weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    $('date').textContent = weekdays[wallClock.getUTCDay()] + ' ' + months[wallClock.getUTCMonth()] + ' ' + wallClock.getUTCDate()
    var clockHours = wallClock.getUTCHours() % 12 || 12
    var gridClock = visualClockOverride || clockHours + ':' + String(wallClock.getUTCMinutes()).padStart(2, '0')
    if (window.HerThingVisuals) window.HerThingVisuals.setClock(gridClock)
    if (window.HerThingVisuals) window.HerThingVisuals.setTimeOfDay(visualHourOverride == null ? wallClock.getUTCHours() + wallClock.getUTCMinutes() / 60 : visualHourOverride)
    renderEventRelative(now)
    renderAttention(now)
  }

  function smoothstep(value) { return value * value * (3 - 2 * value) }

  function renderAttention(now) {
    var minutes = state.next_event ? (new Date(state.next_event.starts_at).getTime() - now.getTime()) / 60000 : 999
    var proximity = Math.max(0, Math.min(1, 1 - minutes / 120))
    eventUrgency = minutes < -60 ? 0 : smoothstep(proximity)
    var activity = (state.microphone && state.microphone.activity) || 'idle'
    var conversation = activity !== 'idle'
    dashboard.style.setProperty('--conditions-opacity', conversation ? .23 : Math.max(.42, 1 - eventUrgency * .48))
    dashboard.style.setProperty('--event-opacity', conversation ? .2 : (.34 + eventUrgency * .66))
    dashboard.style.setProperty('--event-size', (22 + eventUrgency * 27).toFixed(1) + 'px')
    dashboard.style.setProperty('--event-shift', (eventUrgency * 18).toFixed(1) + 'px')
    dashboard.style.setProperty('--event-detail-opacity', (conversation ? .62 : Math.max(.88, 1 - eventUrgency * .12)).toFixed(2))
    dashboard.style.setProperty('--event-kicker-size', (10 + eventUrgency * 5).toFixed(1) + 'px')
    dashboard.style.setProperty('--music-opacity', conversation ? .2 : Math.max(.3, 1 - eventUrgency * .68))
    if (window.HerThingVisuals) window.HerThingVisuals.setUrgency(eventUrgency)
  }

  function renderEventRelative(now) {
    if (!state.next_event) return
    var start = new Date(state.next_event.starts_at)
    var minutes = Math.round((start.getTime() - now.getTime()) / 60000)
    $('event-kicker').textContent = minutes > 0 && minutes <= 60
      ? 'IN ' + minutes + ' MIN'
      : minutes <= 0 && minutes > -60 ? 'HAPPENING NOW' : 'NEXT'
    var relative = $('event-relative')
    relative.classList.toggle('hidden', minutes <= 60)
    relative.textContent = minutes > 60
      ? 'in ' + Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
      : ''
  }

  function weatherIcon(value) {
    var text = String(value || '').toLowerCase()
    var common = 'viewBox="0 0 32 32" role="img" aria-hidden="true"'
    if (text.indexOf('thunder') >= 0 || text.indexOf('storm') >= 0) return '<svg ' + common + '><path d="M8 21a6 6 0 0 1 1-11.9A8 8 0 0 1 24.6 12 4.7 4.7 0 0 1 24 21H8Z"/><path class="weather-accent" d="m17 19-4 7h4l-2 5 7-9h-4l2-3Z"/></svg>'
    if (text.indexOf('rain') >= 0 || text.indexOf('shower') >= 0 || text.indexOf('drizzle') >= 0) return '<svg ' + common + '><path d="M8 19a6 6 0 0 1 1-11.9A8 8 0 0 1 24.6 10 4.7 4.7 0 0 1 24 19H8Z"/><path class="weather-accent" d="m10 23-2 5m8-5-2 5m8-5-2 5"/></svg>'
    if (text.indexOf('snow') >= 0 || text.indexOf('flurr') >= 0) return '<svg ' + common + '><path d="M8 18a6 6 0 0 1 1-11.9A8 8 0 0 1 24.6 9 4.7 4.7 0 0 1 24 18H8Z"/><path class="weather-accent" d="M10 23h4m-2-2v4m6-2h4m-2-2v4m-7 4h4m-2-2v4"/></svg>'
    if (text.indexOf('fog') >= 0 || text.indexOf('mist') >= 0 || text.indexOf('haze') >= 0) return '<svg ' + common + '><path d="M8 17a6 6 0 0 1 1-11.9A8 8 0 0 1 24.6 8 4.7 4.7 0 0 1 24 17H8Z"/><path class="weather-accent" d="M5 22h22M8 27h16"/></svg>'
    if (text.indexOf('partly') >= 0) return '<svg ' + common + '><circle class="weather-accent" cx="11" cy="10" r="5"/><path class="weather-accent" d="M11 2V0m0 20v-2M3 10H1m20 0h-2M5.3 4.3 3.9 2.9m14.2 14.2-1.4-1.4m0-11.4 1.4-1.4M3.9 17.1l1.4-1.4"/><path d="M8 25a6 6 0 0 1 1-11.9A8 8 0 0 1 24.6 16 4.7 4.7 0 0 1 24 25H8Z"/></svg>'
    if (text.indexOf('cloud') >= 0 || text.indexOf('overcast') >= 0) return '<svg ' + common + '><path d="M7 23a7 7 0 0 1 1.2-13.9A9 9 0 0 1 25.7 12 5.5 5.5 0 0 1 25 23H7Z"/></svg>'
    if (text.indexOf('clear') >= 0 || text.indexOf('sun') >= 0) return '<svg ' + common + '><circle cx="16" cy="16" r="6"/><path d="M16 4V1m0 30v-3M4 16H1m30 0h-3M7.5 7.5 5.4 5.4m21.2 21.2-2.1-2.1m0-17 2.1-2.1M5.4 26.6l2.1-2.1"/></svg>'
    return '<svg ' + common + '><circle cx="16" cy="16" r="10"/><path d="M16 10v7m0 5v1"/></svg>'
  }

  function renderWeather() {
    var weather = state.weather
    $('weather-symbol').innerHTML = weather ? weatherIcon(weather.symbol || weather.condition) : ''
    $('temperature').textContent = weather ? Math.round(weather.temperature) + '°' : '--°'
  }

  function renderEvent() {
    var event = state.next_event
    dashboard.dataset.event = String(!!event)
    $('event-empty').classList.toggle('hidden', !!event)
    $('event-state').classList.toggle('hidden', !event)
    if (!event) return
    setMarqueeText('event-title', event.title)
    $('event-time').textContent = formatTime(new Date(event.starts_at))
    $('event-location').textContent = event.location || ''
    renderEventRelative(new Date(Date.now() + hostClockSkewMs))
  }

  function renderAgenda() {
    var events = state.today_events || []
    var list = $('agenda-list')
    if (!events.length) { list.innerHTML = '<div class="agenda-empty">Nothing else on your calendar today.</div>'; return }
    list.innerHTML = events.map(function (event, index) {
      var time = event.all_day ? 'ALL DAY' : formatTime(new Date(event.starts_at))
      var location = event.location ? '<span>' + escapeHtml(event.location) + '</span>' : ''
      return '<article class="agenda-item" tabindex="-1"><time class="agenda-time">' + time + '</time><i aria-hidden="true"></i><div class="agenda-copy"><strong class="marquee-window"><span id="agenda-event-title-' + index + '">' + escapeHtml(event.title) + '</span></strong>' + location + '</div></article>'
    }).join('')
    events.forEach(function (event, index) { setMarqueeText('agenda-event-title-' + index, event.title) })
  }

  function escapeHtml(value) {
    var element = document.createElement('span')
    element.textContent = String(value || '')
    return element.innerHTML
  }

  function formatDuration(milliseconds) {
    var seconds = Math.max(0, Math.floor(milliseconds / 1000))
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
  }

  function playbackIcon(playing) {
    return playing
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7Zm6 0h4v14h-4Z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>'
  }

  function setMarqueeText(id, value) {
    var element = $(id)
    var text = String(value || '')
    if (element.textContent === text && element.dataset.marqueeReady === 'true') return
    element.textContent = text
    element.dataset.marqueeReady = 'false'
    element.classList.remove('marquee-active')
    element.parentElement.classList.remove('is-marquee')
    function measure() {
      if (!element.parentElement) return
      var windowWidth = element.parentElement.clientWidth
      var overflow = element.scrollWidth - windowWidth
      element.parentElement.classList.remove('is-marquee')
      element.classList.remove('marquee-active')
      if (overflow > 2) {
        var shift = overflow + 24
        element.style.setProperty('--marquee-shift', '-' + shift + 'px')
        element.style.setProperty('--marquee-duration', Math.max(10, Math.min(19, 9 + shift / 24)).toFixed(1) + 's')
        element.parentElement.classList.add('is-marquee')
        element.classList.add('marquee-active')
      }
      element.dataset.marqueeReady = 'true'
    }
    setTimeout(measure, 80)
    // Event prominence animates its font size. Measure again after that
    // transition so the final marquee distance matches the rendered title.
    if (id === 'event-title') setTimeout(measure, 2000)
  }

  function renderTrack() {
    var track = state.now_playing
    dashboard.dataset.track = String(!!track)
    dashboard.dataset.music = String(!!(track && track.playing))
    $('track-empty').classList.toggle('hidden', !!track)
    $('track-state').classList.toggle('hidden', !track)
    if (!track) {
      $('album-art').removeAttribute('src')
      $('spotify-panel-art').removeAttribute('src')
      $('spotify-panel-title').textContent = 'Nothing playing'
      $('spotify-panel-artist').textContent = 'Start something in Spotify first'
      Array.prototype.forEach.call(document.querySelectorAll('[data-command="spotify.previous"],[data-command="spotify.toggle"],[data-command="spotify.next"]'), function (button) { button.disabled = true })
      if (window.HerThingVisuals) window.HerThingVisuals.setArtwork(null)
      return
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-command="spotify.previous"],[data-command="spotify.toggle"],[data-command="spotify.next"]'), function (button) { button.disabled = false })
    setMarqueeText('track-title', track.track)
    setMarqueeText('track-artist', track.artist)
    $('track-time').textContent = formatDuration(track.position_ms)
    $('play-button').innerHTML = playbackIcon(track.playing)
    $('track-progress').style.width = (track.duration_ms ? Math.min(100, track.position_ms / track.duration_ms * 100) : 0) + '%'
    if (track.art_url && $('album-art').getAttribute('src') !== track.art_url) $('album-art').setAttribute('src', track.art_url)
    renderSpotifyPanel(track)
    if (window.HerThingVisuals) window.HerThingVisuals.setArtwork(track.art_url || track.track, track.playing)
  }

  function renderSpotifyPanel(track) {
    setMarqueeText('spotify-panel-title', track.track)
    setMarqueeText('spotify-panel-artist', track.artist)
    $('spotify-panel-album').textContent = track.album || ''
    $('spotify-panel-position').textContent = formatDuration(track.position_ms)
    $('spotify-panel-duration').textContent = formatDuration(track.duration_ms)
    $('spotify-panel-progress').style.width = (track.duration_ms ? Math.min(100, track.position_ms / track.duration_ms * 100) : 0) + '%'
    $('spotify-panel-play').innerHTML = playbackIcon(track.playing)
    if (track.art_url && $('spotify-panel-art').getAttribute('src') !== track.art_url) $('spotify-panel-art').setAttribute('src', track.art_url)

    var devices = state.spotify_devices || []
    var herthing = devices.find(function (device) { return /herthing|shed/i.test(device.name) })
    var transfer = $('spotify-transfer')
    transfer.dataset.deviceId = herthing ? herthing.id : ''
    transfer.disabled = !herthing || herthing.restricted
    transfer.classList.toggle('active', Boolean(herthing && herthing.active))
    transfer.querySelector('span').textContent = herthing && herthing.active ? 'PLAYING ON HERTHING' : herthing ? 'PLAY ON HERTHING' : 'HERTHING OFFLINE'
    var activeDevice = devices.find(function (device) { return device.active })
    $('spotify-active-device').textContent = activeDevice ? activeDevice.name : 'NO ACTIVE DEVICE'

    $('spotify-shuffle').classList.toggle('active', Boolean(track.shuffle))
    $('spotify-shuffle').dataset.enabled = String(!track.shuffle)
    var nextRepeat = track.repeat === 'off' ? 'context' : track.repeat === 'context' ? 'track' : 'off'
    $('spotify-repeat').classList.toggle('active', track.repeat !== 'off')
    $('spotify-repeat').dataset.mode = nextRepeat
    $('spotify-repeat').textContent = track.repeat === 'track' ? 'REPEAT ONE' : track.repeat === 'context' ? 'REPEAT ALL' : 'REPEAT'
    $('spotify-devices').innerHTML = devices.map(function (device) {
      return '<button class="' + (device.active ? 'active' : '') + '" data-command="spotify.transfer" data-device-id="' + escapeHtml(device.id) + '" data-feedback="PLAYING ON ' + escapeHtml(device.name) + '"' + (device.restricted ? ' disabled' : '') + '>' + escapeHtml(device.name) + '<small>' + escapeHtml(device.type) + (device.volume == null ? '' : ' · ' + device.volume + '%') + '</small></button>'
    }).join('')
  }

  function renderMicrophone() {
    var microphone = state.microphone || { mode: 'off', activity: 'idle' }
    var mode = microphone.mode || 'off'
    dashboard.dataset.activity = microphone.activity || 'idle'
    $('mic-status').className = 'mic ' + mode + (microphone.activity === 'listening' ? ' listening' : '')
    $('mic-label').textContent = mode === 'off'
      ? 'MIC OFF'
      : microphone.activity === 'listening'
        ? 'YOU · LISTENING'
        : microphone.activity === 'speaking'
          ? 'HERTHING · SPEAKING'
          : microphone.activity === 'thinking' ? 'HERTHING · THINKING' : mode.toUpperCase()
    var toggle = $('microphone-toggle')
    if (toggle) {
      toggle.classList.toggle('off', mode === 'off')
      $('microphone-toggle-state').textContent = mode === 'off' ? 'OFF' : 'ON'
      $('microphone-toggle-detail').textContent = mode === 'off' ? 'Wake listening is disabled · hold knob to restore' : 'Listening for “Ziggy” · hold knob to mute'
      toggle.dataset.feedback = mode === 'off' ? 'MICROPHONE ON' : 'MICROPHONE MUTED'
    }
    $('turn-label').textContent = microphone.activity === 'thinking' ? 'Thinking' : 'Listening'
    $('turn-hint').textContent = microphone.activity === 'thinking'
      ? 'ONE MOMENT · PRESS TO END CONVERSATION'
      : 'SPEAK NATURALLY · PRESS TO END CONVERSATION'
    if (window.HerThingVisuals) {
      window.HerThingVisuals.setVoice(microphone.activity, microphone.user_energy, microphone.assistant_energy)
    }
  }

  function renderResponse() {
    var response = state.assistant_response
    var transcript = state.transcript
    var element = $('assistant-response')
    var value = response || transcript
    var key = response ? 'assistant:' + response : transcript ? 'user:' + transcript : ''
    if (!value || key === lastResponse) return
    lastResponse = key
    clearTimeout(responseAdvanceTimer)
    responseManual = false
    responseLine = 0
    responseLines = response ? wrapResponseLines(value) : ['“' + value + '”']
    element.innerHTML = '<div class="response-track">' + responseLines.map(function (line, index) {
      return '<div class="response-line" data-line="' + index + '">' + escapeHtml(line) + '</div>'
    }).join('') + '</div><div class="response-position" aria-hidden="true"></div>'
    element.classList.add('visible')
    positionResponseLine(0)
    if (response && responseLines.length > 1) scheduleResponseLine()
    clearTimeout(responseTimer)
    // Assistant language should remain long enough to read comfortably, even
    // after a short spoken response finishes. User transcripts are briefer.
    var words = String(value).trim().split(/\s+/).filter(Boolean).length
    var visibleMs = response
      ? Math.max(15000, Math.min(45000, 5500 + words * 430))
      : Math.max(5500, Math.min(12000, 2500 + words * 300))
    responseTimer = setTimeout(function () {
      element.classList.remove('visible')
      clearTimeout(responseAdvanceTimer)
    }, visibleMs)
  }

  function wrapResponseLines(text) {
    var words = String(text).trim().split(/\s+/).filter(Boolean)
    var lines = []
    var line = ''
    words.forEach(function (word) {
      var candidate = line ? line + ' ' + word : word
      if (candidate.length > 31 && line) { lines.push(line); line = word } else line = candidate
    })
    if (line) lines.push(line)
    return lines.length ? lines : ['']
  }

  function positionResponseLine(index) {
    var element = $('assistant-response')
    responseLine = Math.max(0, Math.min(responseLines.length - 1, index))
    element.style.setProperty('--response-line', String(responseLine))
    Array.prototype.forEach.call(element.querySelectorAll('.response-line'), function (line, lineIndex) {
      line.classList.toggle('current', lineIndex === responseLine)
      line.classList.toggle('past', lineIndex < responseLine)
    })
    var position = element.querySelector('.response-position')
    if (position) position.textContent = responseLines.length > 1 ? (responseLine + 1) + ' / ' + responseLines.length : ''
  }

  function scheduleResponseLine() {
    clearTimeout(responseAdvanceTimer)
    if (responseManual || responseLine >= responseLines.length - 1) return
    var words = responseLines[responseLine].split(/\s+/).filter(Boolean).length
    responseAdvanceTimer = setTimeout(function () {
      positionResponseLine(responseLine + 1)
      scheduleResponseLine()
    }, Math.max(1500, 420 + words * 315))
  }

  function scrollResponse(direction) {
    if (!$('assistant-response').classList.contains('visible') || responseLines.length < 2) return false
    responseManual = true
    clearTimeout(responseAdvanceTimer)
    positionResponseLine(responseLine + direction)
    return true
  }

  function render() { renderWeather(); renderEvent(); renderAgenda(); renderTrack(); renderMicrophone(); renderResponse(); renderAttention(new Date(Date.now() + hostClockSkewMs)) }

  function showToast(text) {
    $('volume').classList.remove('visible')
    clearTimeout(volumeTimer)
    $('toast').textContent = text
    $('toast').classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { $('toast').classList.remove('visible') }, 1450)
  }

  function showVolume(delta) {
    $('toast').classList.remove('visible')
    clearTimeout(toastTimer)
    volume = Math.max(0, Math.min(100, volume + delta))
    $('volume-value').textContent = String(volume)
    $('volume-level').style.width = volume + '%'
    $('volume').classList.add('visible')
    clearTimeout(volumeTimer)
    volumeTimer = setTimeout(function () { $('volume').classList.remove('visible') }, 1350)
  }

  function setView(view) {
    clearKnobFocus()
    dashboard.dataset.view = view
    var panel = view === 'spotify' ? $('spotify-panel') : view === 'calendar' ? $('agenda') : view === 'settings' ? $('settings-panel') : null
    if (panel) { panel.scrollTop = 0; panel.scrollLeft = 0 }
  }

  function clearKnobFocus() {
    var selected = document.querySelector('.knob-focus')
    if (selected) selected.classList.remove('knob-focus')
  }

  function focusableItems() {
    var view = dashboard.dataset.view
    var panel = view === 'spotify' ? $('spotify-panel') : view === 'calendar' ? $('agenda') : view === 'settings' ? $('settings-panel') : null
    if (!panel) return []
    return Array.prototype.slice.call(panel.querySelectorAll('button:not(:disabled),.agenda-item'))
  }

  function moveKnobFocus(direction) {
    var items = focusableItems()
    if (!items.length) return false
    var current = document.querySelector('.knob-focus')
    var index = items.indexOf(current)
    if (index < 0) index = direction > 0 ? -1 : 0
    index = (index + direction + items.length) % items.length
    clearKnobFocus()
    items[index].classList.add('knob-focus')
    var view = dashboard.dataset.view
    var panel = view === 'spotify' ? $('spotify-panel') : view === 'calendar' ? $('agenda') : $('settings-panel')
    var panelRect = panel.getBoundingClientRect()
    var itemRect = items[index].getBoundingClientRect()
    panel.scrollLeft = 0
    panel.scrollTop = Math.max(0, panel.scrollTop + itemRect.top - panelRect.top - (panel.clientHeight - itemRect.height) / 2)
    return true
  }

  function activateKnobFocus() {
    var selected = document.querySelector('.knob-focus')
    if (!selected) {
      moveKnobFocus(1)
      return
    }
    if (selected.tagName === 'BUTTON') selected.dispatchEvent(new Event('pointerdown', { bubbles:true, cancelable:true }))
  }

  function toggleMicrophone() {
    var muted = state.microphone && state.microphone.mode === 'off'
    sendCommand('microphone.toggle')
    showToast(muted ? 'MICROPHONE ON' : 'MICROPHONE MUTED')
  }

  window.addEventListener('wheel', function (event) {
    event.preventDefault()
    var delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
    // Car Thing reports the physical rotary direction opposite to desktop
    // wheel convention.
    var direction = delta > 0 ? -1 : 1
    if (dashboard.dataset.view !== 'home') { moveKnobFocus(direction); return }
    if (scrollResponse(direction)) return
    showVolume(direction * 4)
    sendInput(direction > 0 ? 'knob_right' : 'knob_left', { volume: volume })
  }, { passive: false, capture: true })

  window.addEventListener('keydown', function (event) {
    var code = event.code || event.key
    var inputMap = { Escape: 'back', Digit1: 'preset_1', Digit2: 'preset_2', Digit3: 'preset_3', Digit4: 'preset_4' }
    if (code === 'Enter') {
      event.preventDefault()
      if (event.repeat || knobHoldTimer) return
      knobHeld = false
      knobHoldTimer = setTimeout(function () { knobHeld = true; knobHoldTimer = null; toggleMicrophone() }, 700)
      return
    }
    if (!inputMap[code] || event.repeat) return
    event.preventDefault()
    sendInput(inputMap[code])
    if (code === 'Digit1') setView('home')
    if (code === 'Digit2') setView('spotify')
    if (code === 'Digit3') setView('calendar')
    if (code === 'Digit4') setView('settings')
    if (code === 'Escape' && dashboard.dataset.view !== 'home') setView('home')
  }, true)

  window.addEventListener('keyup', function (event) {
    var code = event.code || event.key
    if (code !== 'Enter') return
    event.preventDefault()
    if (knobHoldTimer) { clearTimeout(knobHoldTimer); knobHoldTimer = null }
    if (knobHeld) { knobHeld = false; return }
    if (dashboard.dataset.view !== 'home') activateKnobFocus()
    else {
      sendInput('knob_press')
      showToast(state.conversation && state.conversation.active ? 'VOICE CLOSED' : 'LISTENING')
    }
  }, true)

  window.addEventListener('pointerdown', function (event) {
    var themeChoice = event.target.closest('[data-theme-choice]')
    if (themeChoice) { event.preventDefault(); applyTheme(themeChoice.dataset.themeChoice, true); return }
    var command = event.target.closest('[data-command]')
    if (command) {
      event.preventDefault()
      if (command.dataset.command === 'microphone.toggle') { toggleMicrophone(); return }
      var args = {}
      if (command.dataset.deviceId) args.device_id = command.dataset.deviceId
      if (command.dataset.enabled) args.enabled = command.dataset.enabled === 'true'
      if (command.dataset.mode) args.mode = command.dataset.mode
      sendCommand(command.dataset.command, args)
      var feedback = command.dataset.feedback || (command.dataset.command === 'spotify.previous'
        ? 'PREVIOUS TRACK'
        : command.dataset.command === 'spotify.next'
          ? 'NEXT TRACK'
          : command.dataset.command === 'spotify.shuffle'
            ? args.enabled ? 'SHUFFLE ON' : 'SHUFFLE OFF'
            : command.dataset.command === 'spotify.repeat'
              ? args.mode === 'off' ? 'REPEAT OFF' : args.mode === 'track' ? 'REPEAT ONE' : 'REPEAT ALL'
              : command.dataset.command === 'spotify.transfer'
                ? 'SWITCHING OUTPUT'
                : state.now_playing && state.now_playing.playing ? 'PAUSED' : 'PLAYING')
      showToast(feedback)
      return
    }
    var viewCommand = event.target.closest('[data-view-command]')
    if (viewCommand) { event.preventDefault(); setView(viewCommand.dataset.viewCommand); return }
    var panel = event.target.closest('[data-panel]')
    if (panel) { event.preventDefault(); setView(panel.dataset.panel === 'spotify' ? 'spotify' : 'calendar'); return }
    sendInput('touch', { x: Math.round(event.clientX), y: Math.round(event.clientY) })
  })

  function enableDemo(mode, minutes) {
    minutes = Number(minutes == null ? 180 : minutes)
    state.assistant_response = null
    lastResponse = null
    $('assistant-response').classList.remove('visible')
    state.weather = { temperature: 71, condition: 'Clear', symbol: 'sun' }
    state.next_event = { title: 'Design Review', starts_at: new Date(Date.now() + minutes * 60000).toISOString(), location: 'Studio' }
    state.today_events = [state.next_event, { title: 'Dinner with Andy', starts_at: new Date(Date.now() + (minutes + 120) * 60000).toISOString(), location: 'Downtown' }]
    state.microphone = { mode: mode === 'off' ? 'off' : 'ambient', activity: 'idle' }
    if (mode.indexOf('music') >= 0 || mode === 'track') {
      state.now_playing = { track: 'Everything in Its Right Place', artist: 'Radiohead', album: 'Kid A', art_url: null, duration_ms: 251000, position_ms: 137000, playing: true, device:'iPhone', shuffle:false, repeat:'off' }
      state.spotify_devices = [{ id:'shed', name:'HerThing Shed', type:'Computer', active:false, restricted:false }, { id:'phone', name:'iPhone', type:'Smartphone', active:true, restricted:false }]
    }
    if (mode.indexOf('user') >= 0) state.microphone = { mode: 'conversation', activity: 'listening', user_energy: .72 }
    if (mode.indexOf('transcription') >= 0) { state.microphone = { mode: 'conversation', activity: 'thinking' }; state.transcript = 'what does tomorrow morning look like' }
    if (mode.indexOf('thinking') >= 0) { state.microphone = { mode: 'conversation', activity: 'thinking' }; state.transcript = 'what does tomorrow morning look like' }
    if (mode.indexOf('assistant') >= 0) state.microphone = { mode: 'conversation', activity: 'speaking', assistant_energy: .72 }
    if (mode.indexOf('assistant') >= 0) state.assistant_response = 'You have twenty quiet minutes before your next meeting.'
    setConnection(true)
  }

  function buildDebugLab() {
    var userOverride = null
    var assistantOverride = null
    var paused = false
    var lab = document.createElement('div')
    lab.className = 'debug-lab'
    lab.innerHTML = '<header><strong>HERTHING VISUAL WORKBENCH</strong><span id="debug-fps">-- FPS</span></header><label>Scenario</label><select id="debug-scenario"><option>dormant</option><option>event-180</option><option>event-60</option><option>event-30</option><option>event-10</option><option>event-now</option><option>music</option><option>track-transition</option><option>user</option><option>assistant</option><option>music-user</option><option>music-assistant</option><option>imminent-music</option><option>imminent-conversation</option><option>off</option></select><div class="debug-gallery"><button data-scene="dormant">REST</button><button data-scene="music">MUSIC</button><button data-scene="music-user">YOU</button><button data-scene="music-assistant">HERTHING</button><button data-scene="event-10">10 MIN</button><button data-scene="off">MIC OFF</button></div><label>Minutes until event <b id="debug-minutes-value">180</b></label><input id="debug-minutes" type="range" min="-10" max="180" value="180"><label>User energy <b id="debug-user-value">0</b></label><input id="debug-user" type="range" min="0" max="100" value="0"><label>Assistant energy <b id="debug-assistant-value">0</b></label><input id="debug-assistant" type="range" min="0" max="100" value="0"><label>Motion intensity <b id="debug-intensity-value">100%</b></label><input id="debug-intensity" type="range" min="0" max="200" value="100"><label>Cell softness <b id="debug-softness-value">58%</b></label><input id="debug-softness" type="range" min="0" max="100" value="58"><label>Glow <b id="debug-glow-value">42%</b></label><input id="debug-glow" type="range" min="0" max="100" value="42"><label>Wave speed <b id="debug-wave-speed-value">100%</b></label><input id="debug-wave-speed" type="range" min="40" max="180" value="100"><label>Wave decay <b id="debug-wave-decay-value">90%</b></label><input id="debug-wave-decay" type="range" min="40" max="97" value="90"><label>Brightness <b id="debug-brightness-value">118%</b></label><input id="debug-brightness" type="range" min="35" max="160" value="118"><label>Motion speed</label><select id="debug-speed"><option value=".1">0.1× study</option><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><div class="debug-actions"><button id="debug-pause">PAUSE</button><button id="debug-clean">CLEAN VIEW</button></div><label>Test palette / transition</label><div class="debug-actions"><button data-palette="ember">EMBER</button><button data-palette="marine">MARINE</button><button data-palette="acid">ACID</button></div><label>Compare / share</label><div class="debug-actions"><button data-save="a">SAVE A</button><button data-load="a">LOAD A</button><button data-save="b">SAVE B</button><button data-load="b">LOAD B</button><button id="debug-export">EXPORT JSON</button></div><small>Press D to show/hide this panel.</small>'
    lab.querySelector('header').insertAdjacentHTML('afterend','<label>Grid clock</label><div class="debug-actions"><input id="debug-clock" type="time" value="10:42"><button id="debug-minute">+1 MIN</button></div><label>Clock treatment</label><select id="debug-clock-style"><option>hybrid</option><option>void</option><option>force</option><option>calm</option></select><label>Grid density <b id="debug-density-value">40</b></label><input id="debug-density" type="range" min="28" max="52" value="40"><label>Grid energy <b id="debug-grid-energy-value">88%</b></label><input id="debug-grid-energy" type="range" min="30" max="140" value="88"><label>Clock void <b id="debug-clock-void-value">72%</b></label><input id="debug-clock-void" type="range" min="20" max="100" value="72"><label>Edge influence <b id="debug-edge-value">2%</b></label><input id="debug-edge" type="range" min="0" max="150" value="2"><label>Clock scale <b id="debug-clock-scale-value">82%</b></label><input id="debug-clock-scale" type="range" min="68" max="100" value="82">')
    document.body.appendChild(lab)
    ;['no-calendar','transcription','thinking'].forEach(function (name) {
      var option = document.createElement('option')
      option.value = name
      option.textContent = name
      $('debug-scenario').appendChild(option)
    })
    var palettes = { ember: [[68,23,16],[190,72,34],[91,28,55],[220,145,70]], marine: [[8,37,48],[23,105,117],[30,53,91],[111,166,153]], acid: [[27,34,18],[145,183,38],[184,73,28],[66,36,94]] }
    function settings() { return { scenario:$('debug-scenario').value, minutes:Number($('debug-minutes').value), userEnergy:Number($('debug-user').value), assistantEnergy:Number($('debug-assistant').value), intensity:Number($('debug-intensity').value), softness:Number($('debug-softness').value), glow:Number($('debug-glow').value), waveSpeed:Number($('debug-wave-speed').value), waveDecay:Number($('debug-wave-decay').value), brightness:Number($('debug-brightness').value), speed:Number($('debug-speed').value), paused:paused } }
    function applySettings(value) {
      if (!value) return
      $('debug-scenario').value = value.scenario || 'dormant'; $('debug-minutes').value = value.minutes == null ? 180 : value.minutes
      $('debug-user').value = value.userEnergy || 0; $('debug-assistant').value = value.assistantEnergy || 0
      $('debug-intensity').value = value.intensity == null ? 100 : value.intensity; $('debug-speed').value = String(value.speed || 1)
      $('debug-softness').value = value.softness == null ? 58 : value.softness; $('debug-glow').value = value.glow == null ? 42 : value.glow
      $('debug-wave-speed').value = value.waveSpeed == null ? 100 : value.waveSpeed; $('debug-wave-decay').value = value.waveDecay == null ? 90 : value.waveDecay; $('debug-brightness').value = value.brightness == null ? 118 : value.brightness
      paused = !!value.paused; userOverride = Number($('debug-user').value) / 100; assistantOverride = Number($('debug-assistant').value) / 100
      update()
    }
    function update(event) {
      if (event && event.target.id === 'debug-scenario') { userOverride = null; assistantOverride = null; $('debug-user').value = 0; $('debug-assistant').value = 0 }
      if (event && event.target.id === 'debug-user') userOverride = Number(event.target.value) / 100
      if (event && event.target.id === 'debug-assistant') assistantOverride = Number(event.target.value) / 100
      var scenario = $('debug-scenario').value
      var minutes = Number($('debug-minutes').value)
      var eventPreset = scenario.match(/^event-(180|60|30|10)$/)
      if (eventPreset) { minutes = Number(eventPreset[1]); $('debug-minutes').value = minutes }
      if (scenario === 'event-now') { minutes = 0; $('debug-minutes').value = 0 }
      $('debug-minutes-value').textContent = String(minutes)
      $('debug-user-value').textContent = $('debug-user').value
      $('debug-assistant-value').textContent = $('debug-assistant').value
      $('debug-intensity-value').textContent = $('debug-intensity').value + '%'
      $('debug-density-value').textContent = $('debug-density').value; $('debug-grid-energy-value').textContent = $('debug-grid-energy').value + '%'; $('debug-clock-void-value').textContent = $('debug-clock-void').value + '%'; $('debug-edge-value').textContent = $('debug-edge').value + '%'; $('debug-clock-scale-value').textContent = $('debug-clock-scale').value + '%'
      $('debug-softness-value').textContent = $('debug-softness').value + '%'; $('debug-glow-value').textContent = $('debug-glow').value + '%'
      $('debug-wave-speed-value').textContent = $('debug-wave-speed').value + '%'; $('debug-wave-decay-value').textContent = $('debug-wave-decay').value + '%'; $('debug-brightness-value').textContent = $('debug-brightness').value + '%'
      enableDemo(scenario === 'dormant' ? 'ambient' : scenario, minutes)
      if (scenario === 'no-calendar') { state.next_event = null; state.today_events = [] }
      if (scenario.indexOf('imminent') === 0) state.next_event.starts_at = new Date(Date.now() + 10 * 60000).toISOString()
      if (scenario === 'imminent-music') state.now_playing = { track:'Antidote', artist:'Travis Scott', duration_ms:252000, position_ms:91000, playing:true }
      if (scenario === 'imminent-conversation') state.microphone = { mode:'conversation', activity:'listening', user_energy:.6 }
      if (scenario === 'track-transition') {
        state.now_playing = { track:'A New World', artist:'HerThing', duration_ms:240000, position_ms:32000, playing:true }
        if (window.HerThingVisuals) window.HerThingVisuals.setPalette(palettes.marine)
      }
      if (userOverride !== null) state.microphone.user_energy = userOverride
      if (assistantOverride !== null) state.microphone.assistant_energy = assistantOverride
      visualClockOverride = $('debug-clock').value
      if (window.HerThingVisuals) { window.HerThingVisuals.setClock(visualClockOverride); window.HerThingVisuals.setTuning({ paused:paused, speed:Number($('debug-speed').value), intensity:Number($('debug-intensity').value)/100, cellSoftness:Number($('debug-softness').value)/100, glow:Number($('debug-glow').value)/100, userWavePropagationSpeed:5.2*Number($('debug-wave-speed').value)/100, assistantWavePropagationSpeed:4.7*Number($('debug-wave-speed').value)/100, userWaveDecay:Number($('debug-wave-decay').value)/100, assistantWaveDecay:Number($('debug-wave-decay').value)/100, overallBrightness:Number($('debug-brightness').value)/100, clockStyle:$('debug-clock-style').value, columns:Number($('debug-density').value), rows:Math.round(Number($('debug-density').value)*.6), gridEnergy:Number($('debug-grid-energy').value)/100, clockVoidStrength:Number($('debug-clock-void').value)/100, clockBoundaryDisplacement:Number($('debug-edge').value)/100, clockScale:Number($('debug-clock-scale').value)/100 }) }
      $('debug-pause').textContent = paused ? 'PLAY' : 'PAUSE'
      render()
    }
    lab.addEventListener('input', update)
    lab.addEventListener('click', function (event) {
      var name=event.target.dataset.palette
      if(name&&window.HerThingVisuals)window.HerThingVisuals.setPalette(palettes[name])
      if(event.target.dataset.scene){$('debug-scenario').value=event.target.dataset.scene;update({target:$('debug-scenario')})}
      if(event.target.id==='debug-pause'){paused=!paused;update()}
      if(event.target.id==='debug-minute'){var parts=$('debug-clock').value.split(':').map(Number),total=(parts[0]*60+parts[1]+1)%1440;$('debug-clock').value=String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');update()}
      if(event.target.id==='debug-clean')lab.classList.add('hidden-lab')
      if(event.target.dataset.save)localStorage.setItem('herthing-workbench-'+event.target.dataset.save,JSON.stringify(settings()))
      if(event.target.dataset.load)applySettings(JSON.parse(localStorage.getItem('herthing-workbench-'+event.target.dataset.load)||'null'))
      if(event.target.id==='debug-export'){
        var blob=new Blob([JSON.stringify({herthingVisualPreset:1,settings:settings(),visuals:window.HerThingVisuals&&window.HerThingVisuals.getDebugState()},null,2)],{type:'application/json'})
        var link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='herthing-visual-preset.json';link.click();setTimeout(function(){URL.revokeObjectURL(link.href)},1000)
      }
    })
    window.addEventListener('keydown',function(event){if((event.key||'').toLowerCase()==='d')lab.classList.toggle('hidden-lab')})
    setInterval(function(){var metrics=window.HerThingVisuals&&window.HerThingVisuals.getDebugState();$('debug-fps').textContent=metrics?metrics.fps+' FPS':'-- FPS'},1000)
    update()
  }

  var parameters = new URLSearchParams(window.location.search)
  var demoMode = parameters.get('demo')
  var debugMode = parameters.get('debug') === '1'
  if (parameters.has('hour')) visualHourOverride = Math.max(0, Math.min(23.99, Number(parameters.get('hour')) || 0))
  if (parameters.has('time')) visualClockOverride = parameters.get('time')
  if (parameters.has('clockStyle') && window.HerThingVisuals) window.HerThingVisuals.setClockStyle(parameters.get('clockStyle'))
  if (demoMode) enableDemo(demoMode, parameters.get('minutes'))
  if (debugMode) enableDemo('ambient', 180)
  if (parameters.get('view')) dashboard.dataset.view = parameters.get('view')
  var storedTheme = 'signal'
  try { storedTheme = localStorage.getItem('herthing-theme') || 'signal' } catch (_) {}
  applyTheme(parameters.get('theme') || storedTheme, false)
  tick(); render(); setInterval(tick, 1000)
  if (parameters.get('feedback') === 'volume') setTimeout(function () { showVolume(0) }, 100)
  if (parameters.get('feedback') === 'media') setTimeout(function () { showToast('NEXT TRACK') }, 100)
  if (debugMode) buildDebugLab()
  if (!demoMode && !debugMode) connect()
})()
