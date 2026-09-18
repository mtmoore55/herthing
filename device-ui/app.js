(function () {
  'use strict'

  var count = 0
  var history = []
  var lastInput = document.getElementById('last-input')
  var eventCount = document.getElementById('event-count')
  var strip = document.getElementById('event-strip')
  var shell = document.querySelector('.shell')

  function record(label) {
    count += 1
    history.unshift(label)
    history = history.slice(0, 5)
    lastInput.textContent = label
    eventCount.textContent = String(count)
    strip.innerHTML = ''
    history.forEach(function (item, index) {
      var chip = document.createElement('span')
      chip.textContent = item
      if (index === 0) chip.className = 'latest'
      strip.appendChild(chip)
    })
    shell.classList.remove('flash')
    void shell.offsetWidth
    shell.classList.add('flash')
  }

  window.addEventListener('wheel', function (event) {
    event.preventDefault()
    var delta = event.deltaX !== 0 ? event.deltaX : event.deltaY
    record(delta > 0 ? 'KNOB CLOCKWISE' : 'KNOB COUNTERCLOCKWISE')
  }, { passive: false, capture: true })

  window.addEventListener('keydown', function (event) {
    var labels = {
      Enter: 'KNOB PRESS',
      Escape: 'BACK',
      Digit1: 'PRESET 1',
      Digit2: 'PRESET 2',
      Digit3: 'PRESET 3',
      Digit4: 'PRESET 4',
      KeyM: 'POWER'
    }
    if (labels[event.code] || labels[event.key]) {
      event.preventDefault()
      record(labels[event.code] || labels[event.key])
    }
  }, true)

  window.addEventListener('pointerdown', function (event) {
    record('TOUCH ' + Math.round(event.clientX) + ',' + Math.round(event.clientY))
  })
})()
