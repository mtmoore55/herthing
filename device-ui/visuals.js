(function () {
  'use strict'
  var canvas=document.getElementById('visual-field'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height
  var current=[[19,18,16],[51,39,30],[20,27,27],[103,58,39]],target=current.map(function(c){return c.slice()}),music=false
  var userEnergy=0,assistantEnergy=0,targetUser=0,targetAssistant=0,urgency=0,targetUrgency=0,lastFrame=0,lastTexture=0,textures=[],artwork=new Image(); artwork.crossOrigin='anonymous'
  var paused=false,speed=1,intensity=1,sceneTime=0,frameCount=0,fps=0,fpsStarted=0
  function clamp(v,a,b){return Math.max(a,Math.min(b,v))} function mix(a,b,n){return a+(b-a)*n} function rgba(c,a){return 'rgba('+c.map(Math.round).join(',')+','+a+')'}
  function fallback(seed){var base=seed%180;return [[40+base%35,24,20],[120,55+base%70,42],[18,52+base%45,64],[105+base%65,78,118]]}
  function sample(image){var c=document.createElement('canvas');c.width=c.height=24;var x=c.getContext('2d'),b={};try{x.drawImage(image,0,0,24,24);var p=x.getImageData(0,0,24,24).data;for(var i=0;i<p.length;i+=16){var r=p[i],g=p[i+1],bl=p[i+2],mx=Math.max(r,g,bl),mn=Math.min(r,g,bl);if(mx<28||mx-mn<12)continue;var k=(r>>5)+'-'+(g>>5)+'-'+(bl>>5);if(!b[k])b[k]={n:0,c:[0,0,0],s:0};b[k].n++;b[k].c[0]+=r;b[k].c[1]+=g;b[k].c[2]+=bl;b[k].s+=mx-mn}var colors=Object.keys(b).map(function(k){var q=b[k];return{c:q.c.map(function(v){return v/q.n}),w:q.n*2+q.s/q.n}}).sort(function(a,z){return z.w-a.w}).slice(0,8).map(function(v){return v.c});if(colors.length>=4)return[colors[0],colors[2],colors[1],colors[3]]}catch(_){}return fallback(image.src.length)}
  artwork.onload=function(){target=sample(artwork)};artwork.onerror=function(){target=fallback(artwork.src.length)}
  function setArtwork(url){music=!!url;if(url&&!/^(https?:|data:)/.test(url)){target=fallback(url.length);return}if(url&&artwork.src!==url)artwork.src=url;if(!url)target=[[17,16,14],[44,34,27],[17,25,24],[83,47,35]]}
  function setVoice(activity,user,assistant){targetUser=clamp(Number(user)||(activity==='listening'?.34:0),0,1);targetAssistant=clamp(Number(assistant)||(activity==='speaking'?.34:0),0,1)}
  function setUrgency(value){targetUrgency=clamp(Number(value)||0,0,1)}
  function setPalette(colors){if(colors&&colors.length>=4){target=colors;music=true}}
  function setTuning(options){options=options||{};if(typeof options.paused==='boolean')paused=options.paused;if(options.speed!=null)speed=clamp(Number(options.speed)||0,.05,3);if(options.intensity!=null)intensity=clamp(Number(options.intensity)||0,0,2)}
  function getDebugState(){return{fps:fps,paused:paused,speed:speed,intensity:intensity,palette:target.map(function(color){return color.map(Math.round)})}}
  function texture(color){var c=document.createElement('canvas');c.width=c.height=72;var x=c.getContext('2d'),g=x.createRadialGradient(36,36,0,36,36,36);g.addColorStop(0,rgba(color,1));g.addColorStop(.54,rgba(color,.72));g.addColorStop(1,rgba(color,0));x.fillStyle=g;x.fillRect(0,0,72,72);return c}
  function refreshTextures(){textures=current.map(texture);textures.push(texture([248,161,91]));textures.push(texture([155,132,255]))}
  function blob(image,x,y,r,stretch,alpha){ctx.save();ctx.globalAlpha=alpha;ctx.translate(x,y);ctx.scale(stretch,1/stretch);ctx.drawImage(image,-r,-r,r*2,r*2);ctx.restore()}
  function frame(ts){var d=Math.min(100,ts-lastFrame||80);lastFrame=ts;if(!paused)sceneTime+=d*speed;var n=paused?0:1-Math.pow(.985,d);for(var p=0;p<4;p++)for(var c=0;c<3;c++)current[p][c]=mix(current[p][c],target[p][c],n);userEnergy=mix(userEnergy,targetUser,paused?0:.26);assistantEnergy=mix(assistantEnergy,targetAssistant,paused?0:.21);urgency=mix(urgency,targetUrgency,paused?0:.08);if(ts-lastTexture>900){refreshTextures();lastTexture=ts}frameCount++;if(!fpsStarted)fpsStarted=ts;if(ts-fpsStarted>=1000){fps=Math.round(frameCount*1000/(ts-fpsStarted));frameCount=0;fpsStarted=ts}
    var t=sceneTime*.00012,motion=(1-urgency*.58)*intensity;ctx.globalCompositeOperation='source-over';ctx.fillStyle='#090a09';ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='screen';var s=(music?1:.47)*(1-urgency*.25)*(.45+intensity*.55)
    blob(textures[0],w*(.19+Math.sin(t*.73)*.09*motion),h*(.36+Math.cos(t*.47)*.08*motion),115,1.48,.55*s);blob(textures[1],w*(.72+Math.cos(t*.59)*.12*motion),h*(.24+Math.sin(t*.81)*.1*motion),105,.72,.58*s);blob(textures[2],w*(.8+Math.sin(t*.41)*.1*motion),h*(.82+Math.cos(t*.67)*.07*motion),125,1.34,.48*s);blob(textures[3],w*(.38+Math.cos(t*.37)*.11*motion),h*(.78+Math.sin(t*.53)*.09*motion),92,.83,.42*s)
    if(userEnergy>.01)blob(textures[4],w*.12,h*.64,66+userEnergy*78*intensity,1.34,userEnergy*.86*intensity);if(assistantEnergy>.01)blob(textures[5],w*.88,h*.38,72+assistantEnergy*82*intensity,.76,assistantEnergy*.82*intensity)
    ctx.globalCompositeOperation='source-over';ctx.fillStyle='rgba(5,5,4,.12)';ctx.fillRect(0,0,w,h);setTimeout(function(){requestAnimationFrame(frame)},80)}
  refreshTextures();window.HerThingVisuals={setArtwork:setArtwork,setVoice:setVoice,setUrgency:setUrgency,setPalette:setPalette,setTuning:setTuning,getDebugState:getDebugState};requestAnimationFrame(frame)
})()
