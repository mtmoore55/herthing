(function () {
  'use strict'

  var protocol = 'herthing/1'
  var revision = -1
  var socket = null
  var retryTimer = null
  var toastTimer = null
  var volumeTimer = null
  var responseTimer = null
  var lastResponse = null
  var volume = 50
  var hostClockSkewMs = 0
  var eventUrgency = 0
  var state = {
    clock: { utc_offset_minutes: 0 },
    weather: null,
    next_event: null,
    now_playing: null,
    microphone: { mode: 'off', activity: 'idle' }
  }

  var $ = function (id) { return document.getElementById(id) }
  var dashboard = document.querySelector('.world')
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
    dashboard.style.setProperty('--event-detail-opacity', Math.max(.08, 1 - eventUrgency * 1.16).toFixed(2))
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
    dashboard.dataset.track = String(!!track)
    dashboard.dataset.music = String(!!(track && track.playing))
    $('track-empty').classList.toggle('hidden', !!track)
    $('track-state').classList.toggle('hidden', !track)
    if (!track) {
      $('album-art').removeAttribute('src')
      if (window.HerThingVisuals) window.HerThingVisuals.setArtwork(null)
      return
    }
    $('track-title').textContent = track.track
    $('track-artist').textContent = track.artist
    $('track-time').textContent = formatDuration(track.position_ms)
    $('play-button').textContent = track.playing ? 'Ⅱ' : '▶'
    $('track-progress').style.width = (track.duration_ms ? Math.min(100, track.position_ms / track.duration_ms * 100) : 0) + '%'
    if (track.art_url && $('album-art').src !== track.art_url) $('album-art').src = track.art_url
    if (window.HerThingVisuals) window.HerThingVisuals.setArtwork(track.art_url || track.track)
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
          : mode.toUpperCase()
    if (window.HerThingVisuals) {
      window.HerThingVisuals.setVoice(microphone.activity, microphone.user_energy, microphone.assistant_energy)
    }
  }

  function renderResponse() {
    var response = state.assistant_response
    var element = $('assistant-response')
    if (!response || response === lastResponse) return
    lastResponse = response
    element.textContent = typeof response === 'string' ? response : ''
    element.classList.add('visible')
    clearTimeout(responseTimer)
    responseTimer = setTimeout(function () { element.classList.remove('visible') }, 6500)
  }

  function render() { renderWeather(); renderEvent(); renderTrack(); renderMicrophone(); renderResponse(); renderAttention(new Date(Date.now() + hostClockSkewMs)) }

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
    if (code === 'Digit4') showToast('MIC OFF')
  }, true)

  window.addEventListener('pointerdown', function (event) {
    var command = event.target.closest('[data-command]')
    if (command) { event.preventDefault(); sendCommand(command.dataset.command); return }
    sendInput('touch', { x: Math.round(event.clientX), y: Math.round(event.clientY) })
  })

  function enableDemo(mode, minutes) {
    minutes = Number(minutes == null ? 180 : minutes)
    state.assistant_response = null
    lastResponse = null
    $('assistant-response').classList.remove('visible')
    state.weather = { temperature: 71, condition: 'Clear', symbol: 'sun' }
    state.next_event = { title: 'Design Review', starts_at: new Date(Date.now() + minutes * 60000).toISOString(), location: 'Studio' }
    state.microphone = { mode: mode === 'off' ? 'off' : 'ambient', activity: 'idle' }
    if (mode.indexOf('music') >= 0 || mode === 'track') {
      state.now_playing = { track: 'Everything in Its Right Place', artist: 'Radiohead', album: 'Kid A', art_url: null, duration_ms: 251000, position_ms: 137000, playing: true }
    }
    if (mode.indexOf('user') >= 0) state.microphone = { mode: 'conversation', activity: 'listening', user_energy: .72 }
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
    lab.innerHTML = '<header><strong>HERTHING VISUAL WORKBENCH</strong><span id="debug-fps">-- FPS</span></header><label>Scenario</label><select id="debug-scenario"><option>dormant</option><option>event-180</option><option>event-60</option><option>event-30</option><option>event-10</option><option>event-now</option><option>music</option><option>track-transition</option><option>user</option><option>assistant</option><option>music-user</option><option>music-assistant</option><option>imminent-music</option><option>imminent-conversation</option><option>off</option></select><div class="debug-gallery"><button data-scene="dormant">REST</button><button data-scene="music">MUSIC</button><button data-scene="music-user">YOU</button><button data-scene="music-assistant">HERTHING</button><button data-scene="event-10">10 MIN</button><button data-scene="off">MIC OFF</button></div><label>Minutes until event <b id="debug-minutes-value">180</b></label><input id="debug-minutes" type="range" min="-10" max="180" value="180"><label>User energy <b id="debug-user-value">0</b></label><input id="debug-user" type="range" min="0" max="100" value="0"><label>Assistant energy <b id="debug-assistant-value">0</b></label><input id="debug-assistant" type="range" min="0" max="100" value="0"><label>Motion intensity <b id="debug-intensity-value">100%</b></label><input id="debug-intensity" type="range" min="0" max="200" value="100"><label>Motion speed</label><select id="debug-speed"><option value=".1">0.1× study</option><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><div class="debug-actions"><button id="debug-pause">PAUSE</button><button id="debug-clean">CLEAN VIEW</button></div><label>Test palette / transition</label><div class="debug-actions"><button data-palette="ember">EMBER</button><button data-palette="marine">MARINE</button><button data-palette="acid">ACID</button></div><label>Compare / share</label><div class="debug-actions"><button data-save="a">SAVE A</button><button data-load="a">LOAD A</button><button data-save="b">SAVE B</button><button data-load="b">LOAD B</button><button id="debug-export">EXPORT JSON</button></div><small>Press D to show/hide this panel.</small>'
    document.body.appendChild(lab)
    var palettes = { ember: [[68,23,16],[190,72,34],[91,28,55],[220,145,70]], marine: [[8,37,48],[23,105,117],[30,53,91],[111,166,153]], acid: [[27,34,18],[145,183,38],[184,73,28],[66,36,94]] }
    function settings() { return { scenario:$('debug-scenario').value, minutes:Number($('debug-minutes').value), userEnergy:Number($('debug-user').value), assistantEnergy:Number($('debug-assistant').value), intensity:Number($('debug-intensity').value), speed:Number($('debug-speed').value), paused:paused } }
    function applySettings(value) {
      if (!value) return
      $('debug-scenario').value = value.scenario || 'dormant'; $('debug-minutes').value = value.minutes == null ? 180 : value.minutes
      $('debug-user').value = value.userEnergy || 0; $('debug-assistant').value = value.assistantEnergy || 0
      $('debug-intensity').value = value.intensity == null ? 100 : value.intensity; $('debug-speed').value = String(value.speed || 1)
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
      enableDemo(scenario === 'dormant' ? 'ambient' : scenario, minutes)
      if (scenario.indexOf('imminent') === 0) state.next_event.starts_at = new Date(Date.now() + 10 * 60000).toISOString()
      if (scenario === 'imminent-music') state.now_playing = { track:'Antidote', artist:'Travis Scott', duration_ms:252000, position_ms:91000, playing:true }
      if (scenario === 'imminent-conversation') state.microphone = { mode:'conversation', activity:'listening', user_energy:.6 }
      if (scenario === 'track-transition') {
        state.now_playing = { track:'A New World', artist:'HerThing', duration_ms:240000, position_ms:32000, playing:true }
        if (window.HerThingVisuals) window.HerThingVisuals.setPalette(palettes.marine)
      }
      if (userOverride !== null) state.microphone.user_energy = userOverride
      if (assistantOverride !== null) state.microphone.assistant_energy = assistantOverride
      if (window.HerThingVisuals) window.HerThingVisuals.setTuning({ paused:paused, speed:Number($('debug-speed').value), intensity:Number($('debug-intensity').value)/100 })
      $('debug-pause').textContent = paused ? 'PLAY' : 'PAUSE'
      render()
    }
    lab.addEventListener('input', update)
    lab.addEventListener('click', function (event) {
      var name=event.target.dataset.palette
      if(name&&window.HerThingVisuals)window.HerThingVisuals.setPalette(palettes[name])
      if(event.target.dataset.scene){$('debug-scenario').value=event.target.dataset.scene;update({target:$('debug-scenario')})}
      if(event.target.id==='debug-pause'){paused=!paused;update()}
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
  if (demoMode) enableDemo(demoMode, parameters.get('minutes'))
  if (debugMode) enableDemo('ambient', 180)
  tick(); render(); setInterval(tick, 1000)
  if (debugMode) buildDebugLab()
  if (!demoMode && !debugMode) connect()
})()
