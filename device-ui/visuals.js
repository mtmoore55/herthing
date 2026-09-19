(function () {
  'use strict'

  var canvas=document.getElementById('visual-field'),ctx=canvas.getContext('2d'),width=canvas.width,height=canvas.height
  var current=[[19,18,16],[51,39,30],[20,27,27],[103,58,39]],target=current.map(function(color){return color.slice()}),music=false
  var userEnergy=0,assistantEnergy=0,targetUser=0,targetAssistant=0,urgency=0,targetUrgency=0,lastFrame=0
  var paused=false,speed=1,intensity=1,sceneTime=0,frameCount=0,fps=0,fpsStarted=0,artwork=new Image();artwork.crossOrigin='anonymous'
  function clamp(value,min,max){return Math.max(min,Math.min(max,value))}function mix(a,b,amount){return a+(b-a)*amount}
  function mixColor(a,b,amount){return[mix(a[0],b[0],amount),mix(a[1],b[1],amount),mix(a[2],b[2],amount)]}
  function rgb(color){return'rgb('+color.map(Math.round).join(',')+')'}
  function fallback(seed){var base=seed%180;return[[40+base%35,24,20],[120,55+base%70,42],[18,52+base%45,64],[105+base%65,78,118]]}
  function sample(image){var sampleCanvas=document.createElement('canvas');sampleCanvas.width=sampleCanvas.height=24;var sampleContext=sampleCanvas.getContext('2d'),buckets={};try{sampleContext.drawImage(image,0,0,24,24);var pixels=sampleContext.getImageData(0,0,24,24).data;for(var index=0;index<pixels.length;index+=16){var red=pixels[index],green=pixels[index+1],blue=pixels[index+2],high=Math.max(red,green,blue),low=Math.min(red,green,blue);if(high<28||high-low<12)continue;var key=(red>>5)+'-'+(green>>5)+'-'+(blue>>5);if(!buckets[key])buckets[key]={count:0,color:[0,0,0],saturation:0};var bucket=buckets[key];bucket.count++;bucket.color[0]+=red;bucket.color[1]+=green;bucket.color[2]+=blue;bucket.saturation+=high-low}var colors=Object.keys(buckets).map(function(key){var bucket=buckets[key];return{color:bucket.color.map(function(value){return value/bucket.count}),weight:bucket.count*2+bucket.saturation/bucket.count}}).sort(function(a,b){return b.weight-a.weight}).slice(0,8).map(function(value){return value.color});if(colors.length>=4)return[colors[0],colors[2],colors[1],colors[3]]}catch(_){}return fallback(image.src.length)}
  artwork.onload=function(){target=sample(artwork)};artwork.onerror=function(){target=fallback(artwork.src.length)}
  function setArtwork(url){music=!!url;if(url&&!/^(https?:|data:)/.test(url)){target=fallback(url.length);return}if(url&&artwork.src!==url)artwork.src=url;if(!url)target=[[17,16,14],[44,34,27],[17,25,24],[83,47,35]]}
  function setVoice(activity,user,assistant){targetUser=clamp(Number(user)||(activity==='listening'?.34:0),0,1);targetAssistant=clamp(Number(assistant)||(activity==='speaking'?.34:0),0,1)}
  function setUrgency(value){targetUrgency=clamp(Number(value)||0,0,1)}
  function setPalette(colors){if(colors&&colors.length>=4){target=colors;music=true}}
  function setTuning(options){options=options||{};if(typeof options.paused==='boolean')paused=options.paused;if(options.speed!=null)speed=clamp(Number(options.speed)||0,.05,3);if(options.intensity!=null)intensity=clamp(Number(options.intensity)||0,0,2)}
  function getDebugState(){return{fps:fps,paused:paused,speed:speed,intensity:intensity,palette:target.map(function(color){return color.map(Math.round)})}}
  function field(x,y,originX,originY,reach){var dx=(x-originX)/reach,dy=(y-originY)/reach;return clamp(1-Math.sqrt(dx*dx+dy*dy),0,1)}
  function renderGrid(time){var columns=20,rows=12,cellWidth=width/columns,cellHeight=height/rows,motion=(1-urgency*.62)*intensity,presence=(music?1.18:.3)*(1-urgency*.22),pulse=(Math.sin(time*.91)+Math.sin(time*.37+1.4))*.5
    var originA={x:.28+Math.sin(time*.43)*.13*motion,y:.34+Math.cos(time*.31)*.11*motion},originB={x:.74+Math.cos(time*.29+1.2)*.16*motion,y:.7+Math.sin(time*.47)*.13*motion},originC={x:.52+Math.sin(time*.19+2.1)*.18*motion,y:.48+Math.cos(time*.23)*.15*motion}
    for(var row=0;row<rows;row++)for(var column=0;column<columns;column++){var x=(column+.5)/columns,y=(row+.5)/rows,a=field(x,y,originA.x,originA.y,.72),b=field(x,y,originB.x,originB.y,.68),c=field(x,y,originC.x,originC.y,.56),diamond=clamp(1-(Math.abs(x-.5)+Math.abs(y-.5))*1.12,0,1),facet=((column*7+row*11)%9-4)/150
      var color=mixColor(current[0],current[1],clamp(a*.78+c*.18+facet,0,1));color=mixColor(color,current[2],clamp(b*.67,0,1));color=mixColor(color,current[3],clamp(c*.48+diamond*.13,0,1))
      var user=field(x,y,.08,.67,.5)*userEnergy,assistant=field(x,y,.92,.35,.52)*assistantEnergy;color=mixColor(color,[248,151,82],user*.72);color=mixColor(color,[157,136,255],assistant*.7)
      var edge=clamp(1-Math.sqrt(Math.pow((x-.5)*1.1,2)+Math.pow((y-.5)*.86,2))*.77,.28,1),level=(.2+presence*.76)*(edge+.06)+pulse*.026*motion+user*.15+assistant*.13;color=color.map(function(channel){return clamp(channel*level,4,255)})
      ctx.fillStyle=rgb(color);ctx.fillRect(Math.floor(column*cellWidth),Math.floor(row*cellHeight),Math.ceil(cellWidth)+1,Math.ceil(cellHeight)+1)}}
  function frame(timestamp){var delta=Math.min(100,timestamp-lastFrame||80);lastFrame=timestamp;if(!paused)sceneTime+=delta*speed;var easing=paused?0:1-Math.pow(.985,delta);for(var paletteIndex=0;paletteIndex<4;paletteIndex++)for(var channel=0;channel<3;channel++)current[paletteIndex][channel]=mix(current[paletteIndex][channel],target[paletteIndex][channel],easing);userEnergy=mix(userEnergy,targetUser,paused?0:.26);assistantEnergy=mix(assistantEnergy,targetAssistant,paused?0:.21);urgency=mix(urgency,targetUrgency,paused?0:.08);frameCount++;if(!fpsStarted)fpsStarted=timestamp;if(timestamp-fpsStarted>=1000){fps=Math.round(frameCount*1000/(timestamp-fpsStarted));frameCount=0;fpsStarted=timestamp}renderGrid(sceneTime*.00012);setTimeout(function(){requestAnimationFrame(frame)},80)}
  window.HerThingVisuals={setArtwork:setArtwork,setVoice:setVoice,setUrgency:setUrgency,setPalette:setPalette,setTuning:setTuning,getDebugState:getDebugState};requestAnimationFrame(frame)
})()
