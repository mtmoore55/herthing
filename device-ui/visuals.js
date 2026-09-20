(function () {
  'use strict'

  var canvas = document.getElementById('visual-field')
  var ctx = canvas.getContext('2d', { alpha: false })
  var width = canvas.width
  var height = canvas.height

  var parameters = {
    columns: 20, rows: 12, cellSoftness: .58, glow: .42,
    idleMovementSpeed: .72, idleIntensity: .68,
    userWavePropagationSpeed: 3.3, userWaveDecay: .9, userAmplitudeSensitivity: 1.22,
    assistantWavePropagationSpeed: 2.75, assistantWaveDecay: .91, assistantAmplitudeSensitivity: 1.16,
    musicResponsiveness: .2, albumColorInfluence: .38,
    dayNightPaletteInterpolation: 1, overallBrightness: 1.18
  }
  var dayPalette = [[24,15,17],[72,32,40],[145,61,62],[210,118,69]]
  var nightPalette = [[5,17,27],[11,44,72],[39,45,111],[69,37,124]]
  var userPalette = [[255,91,133],[242,74,119],[255,157,118]]
  var assistantPalette = [[24,170,231],[53,119,255],[107,85,224]]
  var albumCurrent = [[38,27,30],[82,42,51],[36,46,63],[128,75,70]]
  var albumTarget = albumCurrent.map(copyColor)
  var music = false, dayAmount = .5, targetDayAmount = .5
  var targetUser = 0, targetAssistant = 0, userEnergy = 0, assistantEnergy = 0
  var urgency = 0, targetUrgency = 0, userWaves = [], assistantWaves = []
  var lastUserEmission = 0, lastAssistantEmission = 0
  var paused = false, speed = 1, intensity = 1, sceneTime = 0, lastFrame = 0
  var frameCount = 0, fps = 0, fpsStarted = 0
  var artwork = new Image(); artwork.crossOrigin = 'anonymous'

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
  function mix(a, b, amount) { return a + (b - a) * amount }
  function smoothstep(value) { value = clamp(value, 0, 1); return value * value * (3 - 2 * value) }
  function copyColor(color) { return color.slice() }
  function mixColor(a, b, amount) { return [mix(a[0],b[0],amount),mix(a[1],b[1],amount),mix(a[2],b[2],amount)] }
  function addColor(base, color, amount) { return mixColor(base, color, amount) }
  function rgb(color) { return 'rgb(' + color.map(Math.round).join(',') + ')' }
  function gaussian(distance, spread) { return Math.exp(-(distance * distance) / Math.max(.001, 2 * spread * spread)) }
  function hash(column, row) { var value = Math.sin(column * 127.1 + row * 311.7) * 43758.5453; return value - Math.floor(value) }
  function fallback(seed) { var base=seed%180; return [[40+base%35,24,20],[120,55+base%70,42],[18,52+base%45,64],[105+base%65,78,118]] }

  function sample(image) {
    var sampleCanvas=document.createElement('canvas'); sampleCanvas.width=sampleCanvas.height=24
    var sampleContext=sampleCanvas.getContext('2d'),buckets={}
    try {
      sampleContext.drawImage(image,0,0,24,24)
      var pixels=sampleContext.getImageData(0,0,24,24).data
      for(var index=0;index<pixels.length;index+=16){
        var red=pixels[index],green=pixels[index+1],blue=pixels[index+2],high=Math.max(red,green,blue),low=Math.min(red,green,blue)
        if(high<28||high-low<12)continue
        var key=(red>>5)+'-'+(green>>5)+'-'+(blue>>5)
        if(!buckets[key])buckets[key]={count:0,color:[0,0,0],saturation:0}
        var bucket=buckets[key];bucket.count++;bucket.color[0]+=red;bucket.color[1]+=green;bucket.color[2]+=blue;bucket.saturation+=high-low
      }
      var colors=Object.keys(buckets).map(function(key){var bucket=buckets[key];return{color:bucket.color.map(function(value){return value/bucket.count}),weight:bucket.count*2+bucket.saturation/bucket.count}}).sort(function(a,b){return b.weight-a.weight}).slice(0,8).map(function(value){return value.color})
      if(colors.length>=4)return[colors[0],colors[2],colors[1],colors[3]]
    } catch(_) {}
    return fallback(image.src.length)
  }
  artwork.onload=function(){albumTarget=sample(artwork)}
  artwork.onerror=function(){albumTarget=fallback(artwork.src.length)}

  function setArtwork(url,isPlaying){
    music=Boolean(isPlaying)
    if(url&&!/^(https?:|data:)/.test(url))albumTarget=fallback(url.length)
    else if(url&&artwork.src!==url)artwork.src=url
  }
  function setVoice(activity,user,assistant){
    targetUser=clamp(Number(user)||(activity==='listening'?.28:0),0,1)
    targetAssistant=clamp(Number(assistant)||(activity==='speaking'?.32:0),0,1)
  }
  function setTimeOfDay(hours){
    var hour=((Number(hours)%24)+24)%24
    var dawn=smoothstep((hour-5.5)/2.5),dusk=1-smoothstep((hour-17.5)/3)
    targetDayAmount=clamp(dawn*dusk,0,1)
  }
  function setUrgency(value){targetUrgency=clamp(Number(value)||0,0,1)}
  function setPalette(colors){if(colors&&colors.length>=4)albumTarget=colors.map(copyColor)}
  function setTuning(options){
    options=options||{}
    if(typeof options.paused==='boolean')paused=options.paused
    if(options.speed!=null)speed=clamp(Number(options.speed)||0,.05,3)
    if(options.intensity!=null)intensity=clamp(Number(options.intensity)||0,0,2)
    Object.keys(parameters).forEach(function(key){if(options[key]!=null&&!isNaN(Number(options[key])))parameters[key]=Number(options[key])})
    parameters.columns=Math.round(clamp(parameters.columns,8,32));parameters.rows=Math.round(clamp(parameters.rows,6,20))
  }
  function getDebugState(){return{fps:fps,paused:paused,speed:speed,intensity:intensity,dayAmount:Number(dayAmount.toFixed(3)),waves:{user:userWaves.length,assistant:assistantWaves.length},parameters:Object.assign({},parameters),albumPalette:albumTarget.map(function(color){return color.map(Math.round)})}}

  function emitWave(kind,energy,now){
    var waves=kind==='user'?userWaves:assistantWaves
    var sensitivity=kind==='user'?parameters.userAmplitudeSensitivity:parameters.assistantAmplitudeSensitivity
    waves.push({position:kind==='user'?-.7:parameters.rows-.3,amplitude:clamp(energy*sensitivity,.08,1.35),width:1.05+energy*1.65,phase:now*.0017+waves.length*1.37})
    if(waves.length>5)waves.shift()
  }
  function advanceWaves(waves,direction,propagation,decay,deltaSeconds){
    for(var index=waves.length-1;index>=0;index--){var wave=waves[index];wave.position+=direction*propagation*deltaSeconds*speed;wave.amplitude*=Math.pow(decay,deltaSeconds*1.5);if(wave.amplitude<.025||wave.position<-4||wave.position>parameters.rows+4)waves.splice(index,1)}
  }
  function simulate(delta,timestamp){
    var deltaSeconds=Math.min(.12,delta/1000),voiceEase=1-Math.pow(.013,deltaSeconds)
    userEnergy=mix(userEnergy,targetUser,voiceEase);assistantEnergy=mix(assistantEnergy,targetAssistant,voiceEase*.84)
    urgency=mix(urgency,targetUrgency,1-Math.pow(.22,deltaSeconds));dayAmount=mix(dayAmount,targetDayAmount,1-Math.pow(.82,deltaSeconds))
    for(var paletteIndex=0;paletteIndex<4;paletteIndex++)for(var channel=0;channel<3;channel++)albumCurrent[paletteIndex][channel]=mix(albumCurrent[paletteIndex][channel],albumTarget[paletteIndex][channel],1-Math.pow(.72,deltaSeconds))
    if(userEnergy>.035&&timestamp-lastUserEmission>mix(820,330,userEnergy)){emitWave('user',userEnergy,timestamp);lastUserEmission=timestamp}
    if(assistantEnergy>.035&&timestamp-lastAssistantEmission>mix(900,380,assistantEnergy)){emitWave('assistant',assistantEnergy,timestamp);lastAssistantEmission=timestamp}
    advanceWaves(userWaves,1,parameters.userWavePropagationSpeed,parameters.userWaveDecay,deltaSeconds)
    advanceWaves(assistantWaves,-1,parameters.assistantWavePropagationSpeed,parameters.assistantWaveDecay,deltaSeconds)
  }
  function waveAt(waves,row,column,columns){
    var total=0,x=(column+.5)/columns
    for(var index=0;index<waves.length;index++){
      var wave=waves[index]
      // Each wave crosses most of the display, but its front bends through
      // the columns. This keeps the direction legible without drawing a
      // literal horizontal waveform or a sequence of equalizer bars.
      var bend=Math.sin(x*Math.PI*2.15+wave.phase)*.82+Math.sin(x*Math.PI*4.7-wave.phase*.53)*.34
      var localPosition=wave.position+bend*(.5+wave.amplitude*.42)
      var localWidth=wave.width*(.8+.23*Math.sin(x*Math.PI*3.2+wave.phase*.71))
      var broadField=.7+.3*Math.sin(x*Math.PI*1.55+wave.phase*.37)
      var facets=.88+.12*(hash(column,index+Math.floor(wave.phase*3))-.5)*2
      total+=gaussian(row-localPosition,localWidth)*wave.amplitude*broadField*facets
    }
    return clamp(total,0,1.5)
  }
  function ambientAt(x,y,time){var slow=time*parameters.idleMovementSpeed,broad=Math.sin(x*5.2+slow*.37)+Math.cos(y*4.1-slow*.29),cross=Math.sin((x+y)*3.4+slow*.17)+Math.cos((x-y)*4.7-slow*.13);return clamp(.5+broad*.105+cross*.065,0,1)}
  function paletteColor(level,x,y){
    var night=mixColor(nightPalette[0],nightPalette[1],clamp(level*1.25,0,1));night=mixColor(night,nightPalette[2],clamp((x+level-.65)*.75,0,1));night=mixColor(night,nightPalette[3],clamp((y+level-.95)*.55,0,1))
    var day=mixColor(dayPalette[0],dayPalette[1],clamp(level*1.28,0,1));day=mixColor(day,dayPalette[2],clamp((level+x-.7)*.72,0,1));day=mixColor(day,dayPalette[3],clamp((level+y-1.02)*.56,0,1))
    return mixColor(night,day,dayAmount*parameters.dayNightPaletteInterpolation)
  }

  function renderGrid(time){
    var columns=parameters.columns,rows=parameters.rows,cellWidth=width/columns,cellHeight=height/rows
    var idleScale=parameters.idleIntensity*intensity*(1-urgency*.48),albumInfluence=music?parameters.albumColorInfluence:0,brightness=parameters.overallBrightness*mix(.74,1,dayAmount)
    ctx.fillStyle='#05080b';ctx.fillRect(0,0,width,height)
    for(var row=0;row<rows;row++)for(var column=0;column<columns;column++){
      var x=(column+.5)/columns,y=(row+.5)/rows,ambient=ambientAt(x,y,time)
      var neighbor=(ambientAt(x+1/columns,y,time)+ambientAt(x-1/columns,y,time)+ambientAt(x,y+1/rows,time)+ambientAt(x,y-1/rows,time))*.25
      var level=mix(ambient,neighbor,parameters.cellSoftness)*idleScale,color=paletteColor(level,x,y)
      if(albumInfluence){var albumA=mixColor(albumCurrent[0],albumCurrent[1],clamp(x*.85+level*.3,0,1)),albumB=mixColor(albumCurrent[2],albumCurrent[3],clamp(y*.72+level*.4,0,1));color=mixColor(color,mixColor(albumA,albumB,.5+Math.sin(time*.19+x*3)*.12),albumInfluence)}
      var user=waveAt(userWaves,row,column,columns),assistant=waveAt(assistantWaves,row,column,columns)
      color=addColor(color,mixColor(userPalette[0],userPalette[2],clamp(x*.55+user*.18,0,1)),clamp(user*.76,0,.88))
      color=addColor(color,mixColor(assistantPalette[0],assistantPalette[2],clamp((1-x)*.48+assistant*.2,0,1)),clamp(assistant*.78,0,.9))
      var edge=clamp(1-Math.pow(Math.abs(x-.5)*1.55,2)-Math.pow(Math.abs(y-.52)*1.18,2),.3,1),shimmer=(hash(column,row)-.5)*.045
      var luminous=(.46+level*1.08+user*.55+assistant*.55+parameters.glow*(user+assistant)*.24+shimmer)*edge*brightness
      color=color.map(function(channel){return clamp(channel*luminous,3,255)})
      ctx.fillStyle=rgb(color);ctx.fillRect(Math.floor(column*cellWidth),Math.floor(row*cellHeight),Math.ceil(cellWidth)+1,Math.ceil(cellHeight)+1)
    }
  }
  function frame(timestamp){
    var delta=Math.min(100,timestamp-lastFrame||80);lastFrame=timestamp
    if(!paused){sceneTime+=delta*speed;simulate(delta,timestamp)}
    frameCount++;if(!fpsStarted)fpsStarted=timestamp;if(timestamp-fpsStarted>=1000){fps=Math.round(frameCount*1000/(timestamp-fpsStarted));frameCount=0;fpsStarted=timestamp}
    renderGrid(sceneTime*.00013);setTimeout(function(){requestAnimationFrame(frame)},80)
  }
  window.HerThingVisuals={setArtwork:setArtwork,setVoice:setVoice,setTimeOfDay:setTimeOfDay,setUrgency:setUrgency,setPalette:setPalette,setTuning:setTuning,getDebugState:getDebugState}
  requestAnimationFrame(frame)
})()
