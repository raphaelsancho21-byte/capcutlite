const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const fmt = t => { t = Math.max(0, Math.floor(t || 0)); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const initialTracks = [
  {id:'video2', name:'Vídeo 2', kind:'video'},
  {id:'video1', name:'Vídeo 1', kind:'video'},
  {id:'text1', name:'Texto', kind:'text'},
  {id:'audio1', name:'Áudio', kind:'audio'},
  {id:'audio2', name:'Áudio 2', kind:'audio'}
];
const state = {
  name:'Meu projeto', aspect:'16:9', quality:720, fps:30, background:'#09090c',
  tracks:initialTracks, assets:[], clips:[], selected:null,
  time:0, playing:false, zoom:80, previewMuted:false,
  exporting:false, history:[], future:[], transient:false, magnetic:true, beatSnap:true, ripple:false
};
let audioContext=null, audioDestination=null;
let missingAssetNames=new Map();
let lastFrame=0, toastTimer=null, dragState=null, seekRequested=true, exportSession=null;
let transformDrag=null, overlayBounds=null, lastPreviewFrame=0,lastExportFrame=0;
const EPS=1e-5;
const frameStep=()=>1/(Number(state.fps)||30);
const frameTime=t=>Math.max(0,Math.round(t/frameStep())*frameStep());
const sameLane=(c,track)=>state.clips.filter(x=>x.track===track && x.id!==c.id).sort((a,b)=>a.start-b.start);
const freePosition=(start,len,peers)=>{ // Earliest gap at or after desired start, never overlay peers.
  let t=Math.max(0,start);
  for(const p of peers){if(t+len<=p.start+EPS)break;if(t<p.start+p.duration-EPS)t=p.start+p.duration;}
  return frameTime(t);
};
const overlaps=(start,len,peers)=>peers.some(p=>start<p.start+p.duration-EPS && start+len>p.start+EPS);
function nearestSnap(raw,edge,clip,peers){
 const tol=10/state.zoom,candidates=[];
 if(state.magnetic){candidates.push({t:0,type:'clip'});for(const p of peers){candidates.push({t:p.start,type:'clip'},{t:p.start+p.duration,type:'clip'});}}
 if(state.beatSnap){for(const c of state.clips){if(c.kind!=='audio')continue;for(const m of [...(c.markers||[]),...(c.autoMarkers||[])]){
  const t=c.start+m;if(t>=0)candidates.push({t,type:'beat'});
 }}}
 let best=null;for(const p of candidates){const dif=Math.abs(p.t-(raw+edge));if(dif<=tol && (!best||dif<best.dif))best={...p,dif};}
 return best?{value:frameTime(best.t-edge),target:best.t,type:best.type}:{value:frameTime(raw),target:null};
}
let guideTime=null,dragFramePending=false;
let paintTrack=null;
function paintDrag(){dragFramePending=false;
 const d=dragState,c=d&&clipById(d.id);
 if(!c){renderTimeline();drawFrame();return;}
 if(paintTrack!==c.track){paintTrack=c.track;renderTimeline();}
 else{for(const cl of state.clips){const el=document.querySelector(`.clip[data-clip="${cl.id}"]`);if(el){el.style.left=`${cl.start*state.zoom}px`;el.style.width=`${Math.max(10,cl.duration*state.zoom)}px`;}}
  const guide=$('#timelineInner .snap-guide');if(guideTime!==null){if(guide){guide.style.left=`${timelineLabelWidth()+guideTime*state.zoom}px`;}else{const line=document.createElement('div');line.className='snap-guide';line.style.left=`${timelineLabelWidth()+guideTime*state.zoom}px`;$('#timelineInner').append(line);}}else guide?.remove();
  updateTimeUI();
 }
 drawFrame();}
function scheduleDragPaint(){if(!dragFramePending){dragFramePending=true;requestAnimationFrame(paintDrag);}}
function shiftFollowing(track,from,newEnd,ignore){
 const next=state.clips.filter(x=>x.track===track&&x.id!==ignore&&x.start>=from-EPS).sort((a,b)=>a.start-b.start);
 let cursor=frameTime(newEnd);for(const p of next){if(p.start<cursor-EPS)p.start=cursor;cursor=p.start+p.duration;}
}
const beatCache=new Map();let beatWorker=null, beatJob=0;
function getBeatWorker(){if(beatWorker)return beatWorker;try{beatWorker=new Worker('./beat-worker.js');return beatWorker;}catch{return null;}}

const exportCanvas=document.createElement('canvas');
const exportCtx=exportCanvas.getContext('2d',{alpha:false});
const canvas=$('#previewCanvas'), ctx=canvas.getContext('2d',{alpha:false});
const defaultText = () => ({text:'Seu texto aqui', x:.5, y:.5, size:58, color:'#ffffff', font:'Arial', weight:'bold', outline:2, shadow:8});
const clone = obj => JSON.parse(JSON.stringify(obj));
const clipById = id => state.clips.find(c=>c.id===id);
const assetById = id => state.assets.find(a=>a.id===id);
const duration = () => Math.max(0,...state.clips.map(c=>c.start+c.duration));
const selectedClip = () => clipById(state.selected);
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3000);}
function snapshot(){return clone({clips:state.clips,tracks:state.tracks,selected:state.selected,aspect:state.aspect,background:state.background,magnetic:state.magnetic,beatSnap:state.beatSnap,ripple:state.ripple});}
function pushHistory(){if(state.exporting)return;state.history.push(snapshot());if(state.history.length>60)state.history.shift();state.future=[];}
function restore(s){state.clips=s.clips;state.tracks=s.tracks;state.selected=s.selected;state.aspect=s.aspect;state.background=s.background||'#09090c';state.magnetic=s.magnetic??true;state.beatSnap=s.beatSnap??true;state.ripple=s.ripple??false;syncToggleButtons();$('#backgroundSelect').value=state.background;$('#aspectSelect').value=state.aspect;resizePreview();renderAll();seekRequested=true;}
function undo(){if(!state.history.length)return;state.future.push(snapshot());restore(state.history.pop());}
function redo(){if(!state.future.length)return;state.history.push(snapshot());restore(state.future.pop());}
function stopPlayback(){state.playing=false;$('#playBtn').textContent='▶';for(const a of state.assets){if(a.element && typeof a.element.pause==='function')a.element.pause();}}
function createAsset(file){return new Promise(resolve=>{
  const kind=file.type.startsWith('video/')?'video':file.type.startsWith('audio/')?'audio':file.type.startsWith('image/')?'image':null;
  if(!kind){toast(`Formato não reconhecido: ${file.name}`);resolve(null);return;}
  const url=URL.createObjectURL(file), asset={id:uid(),name:file.name,kind,url,duration:kind==='image'?5:0,element:null,file};
  if(kind==='image'){
    const image=new Image();image.onload=()=>{asset.element=image;resolve(asset);};image.onerror=()=>{URL.revokeObjectURL(url);toast(`Erro ao ler ${file.name}`);resolve(null);};image.src=url;
  }else{
    const media=document.createElement(kind);media.preload='auto';media.src=url;media.playsInline=true;media.crossOrigin='anonymous';
    media.addEventListener('loadeddata',()=>drawFrame());media.addEventListener('seeked',()=>{if(!state.playing)drawFrame();});
    media.addEventListener('loadedmetadata',()=>{asset.duration=Number.isFinite(media.duration)?media.duration:0;asset.element=media;resolve(asset);},{once:true});
    media.addEventListener('error',()=>{URL.revokeObjectURL(url);toast(`Não foi possível abrir ${file.name}`);resolve(null);},{once:true});
    // Prevent forever-pending promises on malformed files.
    setTimeout(()=>{if(!asset.element){toast(`Tempo esgotado ao ler ${file.name}`);resolve(null);}},15000);
  }
});}
async function addFiles(files){const list=[...files];if(!list.length)return;for(const file of list){const a=await createAsset(file);if(a){state.assets.push(a);connectAssetAudio(a);for(const [oldId,old] of missingAssetNames){if(old.name===a.name&&old.kind===a.kind){for(const c of state.clips)if(c.source===oldId)c.source=a.id;missingAssetNames.delete(oldId);}}for(const [oldId,old] of [...missingAssetNames]){if(old.originName===a.name&&a.kind==='video'){const derived=createDerivedAudioAsset(a,oldId);state.assets.push(derived);missingAssetNames.delete(oldId);}}}}renderMediaList();toast(`${list.length} arquivo(s) processado(s)`);}
function trackFor(kind){return kind==='audio'?'audio1':kind==='text'?'text1':'video1';}
function defaultEffects(){return {brightness:100,contrast:100,saturate:100,blur:0,opacity:100};}
function createClip(kind,source=null,at=state.time){const track=trackFor(kind);const asset=source?assetById(source):null;
  let mediaDur=asset?.duration||5;
  if(!Number.isFinite(mediaDur)||mediaDur<=0)mediaDur=5;
  const c={id:uid(),kind,source,track,start:Math.max(0,at),inPoint:0,duration:kind==='text'?5:mediaDur,speed:1,volume:100,muted:false,markers:[],autoMarkers:[],fit:'contain',scaleX:100,scaleY:100,offsetX:0,offsetY:0,lockAspect:true,rotation:0,effects:defaultEffects(),...kind==='text'?defaultText():{}};
  return c;
}
function addAssetToTimeline(id){const asset=assetById(id);if(!asset)return;pushHistory();const c=createClip(asset.kind,id);if(c.kind==='video'||c.kind==='audio'){
  const peers=state.clips.filter(x=>x.track===c.track).sort((a,b)=>a.start-b.start);
  c.start=frameTime(state.time);if(state.ripple){const active=peers.find(p=>p.start<c.start-EPS && p.start+p.duration>c.start+EPS);if(active)c.start=frameTime(active.start+active.duration);shiftFollowing(c.track,c.start,c.start+c.duration,c.id);}else c.start=freePosition(c.start,c.duration,peers);
}state.clips.push(c);state.selected=c.id;renderAll();toast('Adicionado à timeline');}
function addText(){pushHistory();const c=createClip('text');c.start=freePosition(c.start,c.duration,sameLane(c,c.track));state.clips.push(c);state.selected=c.id;renderAll();}
function renderMediaList(){const container=$('#mediaList');container.replaceChildren();for(const a of state.assets){const row=document.createElement('div');row.className='media-item';
 const symbol=a.kind==='video'?'▶':a.kind==='audio'?'♫':'▧';row.innerHTML=`<div class="media-icon">${symbol}</div><div class="media-info"><b></b><small>${a.kind.toUpperCase()} · ${fmt(a.duration)}</small></div>`;
 row.querySelector('b').textContent=a.name;const b=document.createElement('button');b.title='Adicionar à timeline';b.textContent='+';b.onclick=()=>addAssetToTimeline(a.id);row.append(b);container.append(row);}}
function resizePreview(){const ratios={'16:9':[16,9],'9:16':[9,16],'1:1':[1,1],'4:3':[4,3],'21:9':[21,9],'4:5':[4,5]};const [w,h]=ratios[state.aspect];const q=Number(state.quality);
  const cw=w>=h?Math.round(q*w/h):q;const ch=w>=h?q:Math.round(q*h/w);
  canvas.width=cw;canvas.height=ch;$('#previewResolution').textContent=`${cw} × ${ch}`;resizeCanvasDisplay();drawFrame();}
function activeClips(at,kind){return state.clips.filter(c=>c.kind===kind&&at>=c.start&&at<c.start+c.duration);}
function assetTime(c,at){return c.inPoint+(at-c.start)*c.speed;}
function ensureAudio(){if(audioContext)return;audioContext=new (window.AudioContext||window.webkitAudioContext)();audioDestination=audioContext.createMediaStreamDestination();
 for(const asset of state.assets)connectAssetAudio(asset);
}
function connectAssetAudio(asset){if(!audioContext||!asset||!['video','audio'].includes(asset.kind)||!asset.element||asset.audioNode)return;
 const node=audioContext.createMediaElementSource(asset.element),gain=audioContext.createGain();node.connect(gain);gain.connect(audioContext.destination);gain.connect(audioDestination);asset.audioNode=node;asset.gainNode=gain;
}
function syncMedia(at,force=false){const selectedBySource=new Map();for(const c of state.clips){if(!['video','audio'].includes(c.kind))continue;if(at>=c.start&&at<c.start+c.duration&&!selectedBySource.has(c.source))selectedBySource.set(c.source,c);}
 for(const asset of state.assets){if(!['video','audio'].includes(asset.kind)||!asset.element)continue;const el=asset.element,c=selectedBySource.get(asset.id);
 if(!c){if(!el.paused)el.pause();if(asset.gainNode)asset.gainNode.gain.value=0;continue;}
 const desired=clamp(assetTime(c,at),0,Math.max(0,asset.duration-.015));
 const drift=Math.abs(el.currentTime-desired);
 if(force||drift>(state.playing?.28:.06)){try{el.currentTime=desired;}catch{}}
 el.playbackRate=clamp(c.speed,.25,4);
 const vol=state.previewMuted||c.muted?0:clamp(c.volume/100,0,2);
 if(asset.gainNode){asset.gainNode.gain.value=vol;el.muted=false;}else el.volume=clamp(vol,0,1);
 if(state.playing && el.paused){el.play().catch(()=>{});}else if(!state.playing&&!el.paused)el.pause();
 }
}
function renderComposition(canvas,ctx,at=state.time){if(!ctx)return;const w=canvas.width,h=canvas.height;ctx.fillStyle=state.background||'#09090c';ctx.fillRect(0,0,w,h);
 const visuals=activeClips(at,'video').concat(activeClips(at,'image'));
 visuals.sort((a,b)=>state.tracks.findIndex(t=>t.id===b.track)-state.tracks.findIndex(t=>t.id===a.track));
 for(const c of visuals){const asset=assetById(c.source),media=asset?.element;if(!media)continue;
  if(c.kind==='video'&&(media.readyState<2||media.videoWidth===0))continue;
  const mw=c.kind==='image'?media.naturalWidth:media.videoWidth, mh=c.kind==='image'?media.naturalHeight:media.videoHeight;
  if(!mw||!mh)continue;
  ctx.save();const fx=c.effects||defaultEffects();ctx.globalAlpha=clamp(fx.opacity/100,0,1);
  ctx.filter=`brightness(${fx.brightness}%) contrast(${fx.contrast}%) saturate(${fx.saturate}%) blur(${fx.blur}px)`;
  const g=getVisualGeometry(c,canvas);if(!g){ctx.restore();continue;}
  ctx.beginPath();ctx.rect(0,0,w,h);ctx.clip();
  ctx.translate(g.cx,g.cy);ctx.rotate((Number(c.rotation)||0)*Math.PI/180);
  ctx.drawImage(media,-g.w/2,-g.h/2,g.w,g.h);ctx.restore();
 }
 const texts=activeClips(at,'text');for(const c of texts){ctx.save();const fontsize=Number(c.size||58)*h/720;ctx.font=`${c.weight||'bold'} ${fontsize}px ${c.font||'Arial'}`;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.shadowColor='#000a';ctx.shadowBlur=Number(c.shadow||0)*h/720;ctx.lineWidth=Number(c.outline||0)*h/360;ctx.strokeStyle='#000';ctx.fillStyle=c.color||'#fff';
  const lines=String(c.text||'').split('\n');lines.forEach((line,i)=>{const y=c.y*h+(i-(lines.length-1)/2)*fontsize*1.2;
   if(c.outline>0)ctx.strokeText(line,c.x*w,y,w*.95);ctx.fillText(line,c.x*w,y,w*.95);});ctx.restore();}
}
function drawFrame(){renderComposition(canvas,ctx);$('#stageTextHint').hidden=state.clips.length>0;updateStageOverlay();}

function play(){if(state.exporting)return;if(state.playing){stopPlayback();return;}if(duration()<=0){toast('Adicione um clipe primeiro');return;}if(state.time>=duration())state.time=0;
 try{ensureAudio();audioContext.resume().catch(()=>{});}catch(e){console.warn('Audio API',e);}
 state.playing=true;$('#playBtn').textContent='❚❚';lastFrame=performance.now();syncMedia(state.time,true);}
function seek(t){state.time=clamp(t,0,duration());syncMedia(state.time,true);updateTimeUI();drawFrame();}
function timelineLabelWidth(){return window.matchMedia('(max-width:700px)').matches?68:115;}
function updateTimeUI(){const t=state.time,px=timelineLabelWidth()+t*state.zoom;$('#currentTime').textContent=fmt(t);$('#totalTime').textContent=fmt(duration());$('#playhead').style.left=`${px}px`;
 $('#clipCount').textContent=`${state.clips.length} clipes`;
 $('#timelineStatus').textContent=`${t.toFixed(2)}s / ${duration().toFixed(2)}s`;
}
function tick(timestamp){if(state.playing){let delta=Math.min((timestamp-lastFrame)/1000,.15);if(!Number.isFinite(delta)||delta<0)delta=0;state.time+=delta;if(state.time>=duration()){state.time=duration();stopPlayback();}
 syncMedia(state.time,seekRequested);seekRequested=false;updateTimeUI();}lastFrame=timestamp;if(state.playing&&timestamp-lastPreviewFrame>=1000/Math.min(30,Number(state.fps)||30)){drawFrame();lastPreviewFrame=timestamp;}if(state.exporting&&exportSession?.recorder?.state==='recording'&&timestamp-lastExportFrame>=1000/Math.min(60,Number(state.fps)||30)){renderComposition(exportCanvas,exportCtx,state.time);lastExportFrame=timestamp;}requestAnimationFrame(tick);}
function renderRuler(){const ruler=$('#ruler');ruler.replaceChildren();const total=Math.max(duration()+12,30),step=state.zoom>120?1:state.zoom>55?2:5;
 for(let t=0;t<=total;t+=step){const tick=document.createElement('span');tick.className='ruler-tick';tick.style.left=`${t*state.zoom}px`;const label=document.createElement('span');label.className='ruler-label';label.style.left=`${t*state.zoom}px`;label.textContent=fmt(t).slice(3);ruler.append(tick,label);}}
function renderTimeline(){const total=Math.max(duration()+12,30),pixelWidth=Math.ceil(total*state.zoom);$('#timelineInner').style.width=`${timelineLabelWidth()+pixelWidth}px`;renderRuler();const area=$('#trackArea');area.replaceChildren();
 for(const track of state.tracks){const row=document.createElement('div');row.className='track';const label=document.createElement('div');label.className='track-label';label.innerHTML=`<b>${track.kind==='audio'?'♫':track.kind==='text'?'T':'▣'} ${track.name}</b><small>${track.kind==='audio'?'Trilha sonora':track.kind==='text'?'Sobreposição':'Camada visual'}</small>`;
 const lane=document.createElement('div');lane.className='track-content';lane.style.minWidth=`${pixelWidth}px`;lane.dataset.track=track.id;
 lane.addEventListener('pointerdown',ev=>{if(ev.target!==lane)return;const rect=lane.getBoundingClientRect();seek((ev.clientX-rect.left)/state.zoom);state.selected=null;renderInspector();updateClipSelection();});
 for(const c of state.clips.filter(x=>x.track===track.id)){const el=document.createElement('div');el.className=`clip ${c.kind}${c.id===state.selected?' selected':''}`;el.dataset.clip=c.id;el.style.left=`${c.start*state.zoom}px`;el.style.width=`${Math.max(10,c.duration*state.zoom)}px`;
  const name=document.createElement('span');name.className='clip-name';name.textContent=c.kind==='text'?c.text:(assetById(c.source)?.name||'Mídia ausente');el.append(name);
  if(c.kind==='audio'){
   const wave=assetById(c.source)?.waveform;if(wave){const img=document.createElement('canvas');img.className='clip-wave';img.width=200;img.height=38;const wctx=img.getContext('2d');wctx.fillStyle='#d1ffde88';for(let i=0;i<wave.length;i++){const x=Math.floor(i/wave.length*200),h=wave[i]*18;wctx.fillRect(x,19-h,1,2*h);}el.append(img);}
   const marks=[...(c.autoMarkers||[]).map(v=>({v,auto:true})),...(c.markers||[]).map(v=>({v,auto:false}))];
   for(const {v:m,auto} of marks){if(m<0||m>c.duration)continue;const marker=document.createElement('span');marker.className=`beat-marker ${auto?'detected':'manual'}`;marker.title=`${auto?'Detectada':'Manual'}: ${(c.start+m).toFixed(2)}s • clique duplo remove manual`;marker.style.left=`${m/c.duration*100}%`;marker.dataset.beat=String(m);
    if(!auto){marker.addEventListener('pointerdown',ev=>beginBeatDrag(ev,c,m));marker.addEventListener('dblclick',ev=>{ev.stopPropagation();pushHistory();c.markers=c.markers.filter(x=>Math.abs(x-m)>EPS);renderTimeline();renderInspector();});}el.append(marker);
   }
  }
  for(const side of ['left','right']){const handle=document.createElement('span');handle.className=`clip-handle ${side}`;handle.dataset.edge=side;el.append(handle);}
  el.addEventListener('pointerdown',ev=>startDrag(ev,c));lane.append(el);}
 row.append(label,lane);area.append(row);}
 if(guideTime!==null){const guide=document.createElement('div');guide.className='snap-guide';guide.style.left=`${timelineLabelWidth()+guideTime*state.zoom}px`;$('#timelineInner').append(guide);}else $('#timelineInner .snap-guide')?.remove();updateTimeUI();}
function updateClipSelection(){for(const el of $$('.clip'))el.classList.toggle('selected',el.dataset.clip===state.selected);}
function startDrag(ev,clip){if(ev.button!==0 && ev.pointerType==='mouse')return;ev.preventDefault();ev.stopPropagation();stopPlayback();const edge=ev.target.dataset.edge||'move';state.selected=clip.id;updateClipSelection();renderInspector();drawFrame();
 paintTrack=null;dragState={id:clip.id,edge,x:ev.clientX,start:clip.start,duration:clip.duration,inPoint:clip.inPoint,track:clip.track,snapshot:snapshot(),changed:false};
 document.addEventListener('pointermove',onDragMove,{passive:false});document.addEventListener('pointerup',endDrag,{once:true});document.addEventListener('pointercancel',endDrag,{once:true});}
function onDragMove(ev){if(!dragState)return;ev.preventDefault();const c=clipById(dragState.id);if(!c)return;const d=dragState,dt=(ev.clientX-d.x)/state.zoom;
 const lane=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.track-content');let target=d.track;
 if(d.edge==='move'&&lane){const tr=state.tracks.find(t=>t.id===lane.dataset.track);if(tr&&(tr.kind===c.kind||(c.kind==='image'&&tr.kind==='video')))target=tr.id;}
 // Recompute every frame from the drag-start snapshot; ripple cannot accumulate shifts.
 for(const original of d.snapshot.clips){if(original.id===d.id)continue;const live=clipById(original.id);if(live){live.start=original.start;live.duration=original.duration;}}
 const peers=sameLane(c,target);guideTime=null;
 if(d.edge==='move'){
  const intended=Math.max(0,d.start+dt),snap=nearestSnap(intended,0,c,peers);let pos=snap.value;
  // Collision clamps at the boundary, not jump over the blocker.
  if(!state.ripple){const direction=Math.sign(dt);if(direction>0){for(const p of peers){if(p.start>=d.start+d.duration-EPS && pos+d.duration>p.start && d.start+d.duration<=p.start+EPS){pos=p.start-d.duration;break;}}}
   else if(direction<0){for(const p of [...peers].reverse()){if(p.start+p.duration<=d.start+EPS && pos<p.start+p.duration){pos=p.start+p.duration;break;}}}
   if(overlaps(pos,d.duration,peers))pos=d.start===c.start?c.start:freePosition(pos,d.duration,peers);
  }else{const active=peers.find(p=>p.start<pos-EPS&&p.start+p.duration>pos+EPS);if(active)pos=active.start+active.duration;shiftFollowing(target,pos,pos+d.duration,c.id);}
  c.start=frameTime(Math.max(0,pos));c.track=target;
  if(snap.target!==null&&Math.abs(c.start-(snap.target))<frameStep())guideTime=snap.target;
 }else if(d.edge==='left'){
  const maxChange=d.duration-frameStep(),minChange=Math.max(-d.start,-d.inPoint/(c.speed||1));let change=clamp(dt,minChange,maxChange), snap=nearestSnap(d.start+change,0,c,peers);change=clamp(snap.value-d.start,minChange,maxChange);
  let newStart=frameTime(d.start+change),fixedEnd=d.start+d.duration;
  if(!state.ripple){for(const p of peers){const end=p.start+p.duration;if(end<=d.start+EPS&&newStart<end)newStart=end;} }
  const diff=newStart-d.start;c.start=newStart;c.duration=frameTime(fixedEnd-newStart);c.inPoint=d.inPoint+diff*c.speed;
  if(snap.target!==null&&Math.abs(newStart-snap.target)<frameStep())guideTime=snap.target;
 }else if(d.edge==='right'){
  const a=assetById(c.source), maxDur=a&&c.kind!=='image'?(a.duration-d.inPoint)/c.speed:3600;
  let end=frameTime(d.start+clamp(d.duration+dt,frameStep(),Math.max(frameStep(),maxDur)));
  const snap=nearestSnap(end,0,c,peers);end=clamp(snap.value,d.start+frameStep(),d.start+Math.max(frameStep(),maxDur));
  if(!state.ripple){for(const p of peers){if(p.start>=d.start+d.duration-EPS && end>p.start){end=p.start;break;}}}
  c.duration=frameTime(end-d.start);if(state.ripple)shiftFollowing(c.track,d.start+d.duration,end,c.id);
  if(snap.target!==null&&Math.abs(end-snap.target)<frameStep())guideTime=snap.target;
 }
 d.changed=true;scheduleDragPaint();
}
function endDrag(){document.removeEventListener('pointermove',onDragMove);document.removeEventListener('pointercancel',endDrag);guideTime=null;paintTrack=null;if(dragState?.changed){state.history.push(dragState.snapshot);state.future=[];renderInspector();syncMedia(state.time,true);renderTimeline();drawFrame();}dragState=null;}
function beginBeatDrag(ev,c,m){ev.stopPropagation();ev.preventDefault();if(ev.button!==0&&ev.pointerType==='mouse')return;const initial=snapshot(),x=ev.clientX;let moved=false,current=m;
 const move=e=>{e.preventDefault();const newM=clamp(frameTime(m+(e.clientX-x)/state.zoom),0,c.duration);if(Math.abs(newM-m)>=frameStep())moved=true;const idx=c.markers.findIndex(v=>Math.abs(v-current)<EPS);if(idx>=0)c.markers[idx]=newM;current=newM;c.markers=[...new Set(c.markers)].sort((a,b)=>a-b);scheduleDragPaint();};
 const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);if(moved){state.history.push(initial);state.future=[];renderTimeline();}};
 document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',up,{once:true});
}
function syncToggleButtons(){for(const [id,key] of [['magneticBtn','magnetic'],['beatSnapBtn','beatSnap'],['rippleBtn','ripple']]){const el=$('#'+id);if(el){el.classList.toggle('is-on',!!state[key]);el.setAttribute('aria-pressed',String(!!state[key]));}}}
async function detectBeats(){const c=selectedClip();if(!c||c.kind!=='audio')return toast('Selecione uma faixa de áudio');const a=assetById(c.source);if(!a?.file)return toast('Reimporte o arquivo de áudio');
 const key=`${a.file.name}:${a.file.size}:${a.file.lastModified}`;let result=beatCache.get(key);
 const btn=$('#detectBeatBtn');btn.disabled=true;btn.textContent='Analisando…';
 try{
  if(!result){if(a.file.size>40*1024*1024 || a.duration>900)throw Error('Para proteger a RAM, analise arquivos de até 40 MB e 15 minutos.');
   const bytes=await a.file.arrayBuffer();const ac=new (window.AudioContext||window.webkitAudioContext)();let audio;
   try{audio=await ac.decodeAudioData(bytes);}catch{throw Error('O navegador não decodificou o áudio deste arquivo. Use MP3, WAV ou M4A de áudio; alguns MP4 com vídeo não são suportados.');}finally{ac.close();}
   const rate=80,step=Math.max(1,Math.floor(audio.sampleRate/rate)),channel=audio.getChannelData(0);
   const n=Math.ceil(channel.length/step),env=new Float32Array(n),wave=new Float32Array(200);
   for(let i=0;i<n;i++){let sum=0;const first=i*step,last=Math.min(channel.length,first+step);for(let j=first;j<last;j+=2){const v=channel[j];sum+=v*v;}env[i]=Math.sqrt(sum/Math.max(1,Math.ceil((last-first)/2)));const wi=Math.min(199,Math.floor(i/n*200));wave[wi]=Math.max(wave[wi],env[i]);}
   a.waveform=wave;const max=Math.max(...wave,.0001);for(let i=0;i<200;i++)wave[i]=wave[i]/max;
   const worker=location.protocol==='file:'?null:getBeatWorker();if(worker){result=await new Promise((resolve,reject)=>{const id=++beatJob;const timeout=setTimeout(()=>{worker.removeEventListener('message',answer);reject(Error('Análise excedeu o limite de tempo'));},25000);function answer(e){if(e.data.id!==id)return;clearTimeout(timeout);worker.removeEventListener('message',answer);resolve(e.data.beats);}worker.addEventListener('message',answer);worker.postMessage({id,rate,envelope:env.buffer},[env.buffer]);});}
   else{ // Worker unavailable (e.g. file://): small yielding fallback.
    result=[];let last=-100;for(let i=2;i<env.length-2;i++){if(env[i]>env[i-1]*1.45&&env[i]>env[i+1]&&i-last>rate*.23){result.push(i/rate);last=i;}if(i%150000===0)await new Promise(r=>setTimeout(r,0));}
   }
   beatCache.set(key,result);
  }
  pushHistory();c.autoMarkers=result.filter(t=>t>=c.inPoint&&t<=c.inPoint+c.duration*c.speed).map(t=>frameTime(c.start+(t-c.inPoint)/c.speed)-c.start).filter(t=>t>=0&&t<=c.duration);
  renderTimeline();renderInspector();toast(`${c.autoMarkers.length} batidas detectadas (estimativa)`);
 }catch(e){toast(`Não foi possível analisar: ${e.message}`);}finally{btn.disabled=false;btn.textContent='◈ Detectar batidas';}
}
function split(){const c=selectedClip();if(!c)return toast('Selecione um clipe');const at=frameTime(state.time);if(at<=c.start+.08||at>=c.start+c.duration-.08)return toast('Posicione o cursor dentro do clipe');
 pushHistory();const leftDur=at-c.start;const right=clone(c);right.id=uid();right.start=at;right.inPoint=c.inPoint+leftDur*c.speed;right.duration=c.duration-leftDur;c.duration=leftDur;if(c.kind==='audio'){for(const key of ['markers','autoMarkers']){right[key]=(c[key]||[]).filter(m=>m>=leftDur).map(m=>m-leftDur);c[key]=(c[key]||[]).filter(m=>m<leftDur);}}state.clips.push(right);state.selected=right.id;renderAll();toast('Clipe dividido');}
function deleteSelected(){if(!state.selected)return;pushHistory();state.clips=state.clips.filter(c=>c.id!==state.selected);state.selected=null;renderAll();}
function duplicateSelected(){const c=selectedClip();if(!c)return toast('Selecione um clipe');pushHistory();const other=clone(c);other.id=uid();other.start=freePosition(c.start+c.duration,other.duration,sameLane(other,other.track));if(state.ripple)shiftFollowing(other.track,other.start,other.start+other.duration,other.id);state.clips.push(other);state.selected=other.id;renderAll();}
function updateSelected(field,value){const c=selectedClip();if(!c)return;pushHistory();if(field.startsWith('effects.'))c.effects[field.slice(8)]=Number(value);else if(['text','color','font','weight','fit'].includes(field))c[field]=value;else c[field]=Number(value);
 if(field==='start')c.start=Math.max(0,frameTime(c.start));
 if(field==='duration')c.duration=Math.max(frameStep(),frameTime(c.duration));
 if(field==='speed')c.speed=clamp(c.speed,.25,4);
 if(field==='x'||field==='y')c[field]=clamp(c[field],0,1);
 if(field==='inPoint')c.inPoint=Math.max(0,c.inPoint);
 const asset=assetById(c.source);if(asset&&['audio','video'].includes(c.kind)){const maxDur=Math.max(.1,(asset.duration-c.inPoint)/c.speed);c.duration=Math.min(c.duration,maxDur);}
 if(['start','duration'].includes(field)){const peers=sameLane(c,c.track);if(state.ripple)shiftFollowing(c.track,c.start,c.start+c.duration,c.id);else if(overlaps(c.start,c.duration,peers))c.start=freePosition(c.start,c.duration,peers);}
 renderTimeline();syncMedia(state.time,true);drawFrame();}
function property(label,field,value,type='number',opts={}){const wrap=document.createElement('label');wrap.className='form-field';wrap.textContent=label;const el=document.createElement(type==='textarea'?'textarea':'input');
 if(type!=='textarea')el.type=type;el.value=value;if(opts.min!=null)el.min=opts.min;if(opts.max!=null)el.max=opts.max;if(opts.step!=null)el.step=opts.step;
 if(type==='textarea')el.rows=3;
 el.addEventListener(type==='range'?'change':'change',()=>updateSelected(field,el.value));wrap.append(el);return wrap;}
function selectProperty(label,field,value,options){const wrap=document.createElement('label');wrap.className='form-field';wrap.textContent=label;const sel=document.createElement('select');for(const [v,t] of options){const o=document.createElement('option');o.value=v;o.textContent=t;sel.append(o);}sel.value=value;sel.onchange=()=>updateSelected(field,sel.value);wrap.append(sel);return wrap;}
function group(title){const g=document.createElement('div');g.className='inspector-group';const h=document.createElement('h3');h.textContent=title;g.append(h);return g;}
// Transform coordinates always use a 1080p composition space, regardless of preview quality.
// Changing 360p/720p/1080p preview must not change the numbers or the exported geometry.
function transformProperty(label,key,value,opts={}){
 const wrap=document.createElement('label');wrap.className='form-field';wrap.textContent=label;
 const el=document.createElement('input');el.type='number';el.value=String(Number(value.toFixed(2)));
 if(opts.step!=null)el.step=opts.step;if(opts.min!=null)el.min=opts.min;if(opts.max!=null)el.max=opts.max;
 let before=null,dirty=false;
 el.addEventListener('focus',()=>{before=snapshot();dirty=false;});
 el.addEventListener('input',()=>{
  const n=Number(el.value);if(el.value.trim()===''||!Number.isFinite(n))return;
  const c=selectedClip();if(!c)return;
  const basis={width:compositionSize(1080)[0],height:compositionSize(1080)[1]};
  const g=getVisualGeometry(c,basis);if(!g)return;
  if(key==='x')c.offsetX=clamp((n-basis.width/2)/basis.width*100,-300,300);
  else if(key==='y')c.offsetY=clamp((n-basis.height/2)/basis.height*100,-300,300);
  else if(key==='width')c.scaleX=clamp((Number(c.scaleX)||100)*Math.max(8,n)/g.w,2,1200);
  else if(key==='height')c.scaleY=clamp((Number(c.scaleY)||100)*Math.max(8,n)/g.h,2,1200);
  else if(key==='scaleX'||key==='scaleY')c[key]=clamp(n,2,1200);
  else if(key==='rotation')c.rotation=((n%360)+360)%360;
  dirty=true;drawFrame();
 });
 el.addEventListener('blur',()=>{
  if(dirty&&before){state.history.push(before);if(state.history.length>60)state.history.shift();state.future=[];}
  if(dirty)renderInspector();
 });
 wrap.append(el);return wrap;
}
function renderInspector(){const c=selectedClip(),content=$('#inspectorContent');content.replaceChildren();$('#clipType').textContent=c?c.kind.toUpperCase():'Nenhum clipe';if(!c){content.innerHTML='<div class="empty-properties"><span>◫</span><p>Selecione um clipe na timeline para editar suas propriedades.</p></div>';return;}
 let g=group('Posição e duração');g.append(property('Início (segundos)','start',c.start,'number',{min:0,step:.1}),property('Duração (segundos)','duration',c.duration,'number',{min:.1,step:.1}));
 if(c.kind==='video'||c.kind==='audio')g.append(property('Entrada da mídia (segundos)','inPoint',c.inPoint,'number',{min:0,step:.1}),property('Velocidade (0.25–4x)','speed',c.speed,'number',{min:.25,max:4,step:.25}));content.append(g);
 if(c.kind==='text'){g=group('Estilo do texto');g.append(property('Conteúdo','text',c.text,'textarea'),property('Tamanho','size',c.size,'number',{min:8,max:300}),property('Cor','color',c.color,'color'),property('Posição X (0–1)','x',c.x,'number',{min:0,max:1,step:.01}),property('Posição Y (0–1)','y',c.y,'number',{min:0,max:1,step:.01}),property('Borda','outline',c.outline,'number',{min:0,max:12}),property('Sombra','shadow',c.shadow,'number',{min:0,max:50}));content.append(g);}
 if(c.kind==='video'||c.kind==='audio'){g=group('Áudio');g.append(property('Volume (%)','volume',c.volume,'number',{min:0,max:200,step:5}));if(c.kind==='video'){const b=document.createElement('button');b.className='wide-option';b.textContent='♫ Extrair áudio para uma faixa';b.onclick=extractAudio;g.append(b);}else{const b=document.createElement('button');b.className='wide-option';b.textContent='◆ Marcar batida na posição atual (M)';b.onclick=markBeat;g.append(b);const info=document.createElement('p');info.className='tip';info.textContent=`${(c.markers||[]).length} batidas marcadas. Clique duas vezes no losango da timeline para remover.`;g.append(info);}content.append(g);}
 if(c.kind==='video'||c.kind==='image'){
  g=group('Free Transform · Transformar');g.classList.add('transform-properties');
  const help=document.createElement('p');help.className='transform-help';help.textContent='Arraste o centro para mover. Cantos preservam a proporção; alças laterais esticam. Use a alça circular superior para girar. Shift inverte temporariamente a proporção.';g.append(help);
  const dim=getVisualGeometry(c,{width:compositionSize(1080)[0],height:compositionSize(1080)[1]});
  if(dim){
   const sizes=document.createElement('div');sizes.className='transform-property-grid';
   for(const [label,key,value,options] of [
    ['Posição X','x',dim.cx,{step:1}],['Posição Y','y',dim.cy,{step:1}],
    ['Largura (px)','width',dim.w,{min:8,step:1}],['Altura (px)','height',dim.h,{min:8,step:1}],
    ['Escala X (%)','scaleX',c.scaleX??100,{min:2,max:1200,step:1}],
    ['Escala Y (%)','scaleY',c.scaleY??100,{min:2,max:1200,step:1}],
    ['Rotação (°)','rotation',c.rotation??0,{step:1}]
   ])sizes.append(transformProperty(label,key,value,options));
   g.append(sizes);
  }
  const aspect=document.createElement('label');aspect.className='aspect-checkbox';const lock=document.createElement('input');lock.type='checkbox';lock.checked=c.lockAspect!==false;lock.onchange=()=>{pushHistory();c.lockAspect=lock.checked;};aspect.append(lock,document.createTextNode('Manter proporção pelos cantos (padrão)'));g.append(aspect);
  const controls=document.createElement('div');controls.className='preset-row';
  const reset=document.createElement('button');reset.textContent='↺ Restaurar';reset.onclick=resetSelectedTransform;
  const center=document.createElement('button');center.textContent='⊞ Centralizar';center.onclick=()=>{pushHistory();c.offsetX=0;c.offsetY=0;renderInspector();drawFrame();};
  controls.append(reset,center);g.append(controls);
  g.append(selectProperty('Como encaixar o vídeo','fit',c.fit||'contain',[['contain','Ajustar (com bordas)'],['cover','Preencher / cortar bordas'],['stretch','Esticar mídia para preencher']]));
  content.append(g);g=group('Ajustes e filtros');for(const [label,key,min,max] of [['Brilho','brightness',0,250],['Contraste','contrast',0,250],['Saturação','saturate',0,250],['Desfoque','blur',0,20],['Opacidade','opacity',0,100]])g.append(property(`${label} (${c.effects[key]})`,`effects.${key}`,c.effects[key],'range',{min,max,step:1}));content.append(g);
 }
 // Make Free Transform the FIRST panel for visual clips, including in the mobile drawer.
 if(c.kind==='video'||c.kind==='image'){
  const transformGroup=content.querySelector('.transform-properties');if(transformGroup)content.prepend(transformGroup);
 }
 const deleteBtn=document.createElement('button');deleteBtn.className='ghost danger';deleteBtn.textContent='Excluir clipe';deleteBtn.onclick=deleteSelected;content.append(deleteBtn);
}
// The detached audio uses a SEPARATE media element but shares the original local Blob URL.
// No file is written, converted, uploaded, or downloaded.
function createDerivedAudioAsset(video,id=uid()){
 const el=document.createElement('audio');el.preload='auto';el.src=video.url;el.playsInline=true;
 const a={id,name:`${video.name} (áudio extraído)`,kind:'audio',url:video.url,duration:video.duration,element:el,file:video.file,originName:video.name,derived:true};
 connectAssetAudio(a);return a;
}
function extractAudio(){
 const c=selectedClip();if(!c||c.kind!=='video')return toast('Selecione um clipe de vídeo primeiro');
 const video=assetById(c.source);if(!video)return toast('Reimporte o vídeo original');
 if(!state.tracks.some(t=>t.id==='audio1'))return toast('Faixa de áudio indisponível');
 stopPlayback();pushHistory();const extracted=createDerivedAudioAsset(video);state.assets.push(extracted);
 const audio=createClip('audio',extracted.id,c.start);audio.track='audio1';audio.start=c.start;audio.inPoint=c.inPoint;audio.duration=c.duration;audio.speed=c.speed;audio.volume=c.volume;audio.markers=[];audio.autoMarkers=[];
 // Independent audio clip: the video is muted, but its image stays on the timeline.
 audio.start=freePosition(audio.start,audio.duration,sameLane(audio,audio.track));c.muted=true;state.clips.push(audio);state.selected=audio.id;
 renderMediaList();renderAll();toast('Áudio separado na timeline — sem baixar arquivo');
}
function markBeat(){
 const c=selectedClip();if(!c||c.kind!=='audio')return toast('Selecione um clipe de áudio para marcar batidas');
 const m=frameTime(state.time)-c.start;if(m<0||m>c.duration)return toast('Posicione o cursor dentro do áudio');
 c.markers ||= [];if(c.markers.some(x=>Math.abs(x-m)<.07))return toast('Já existe uma batida nessa posição');
 pushHistory();c.markers.push(Number(m.toFixed(3)));c.markers.sort((a,b)=>a-b);renderTimeline();renderInspector();toast(`Batida marcada em ${fmt(state.time)} (${state.time.toFixed(2)}s)`);
}
function renderAll(){renderTimeline();renderInspector();drawFrame();}
function saveProject(){const data={version:1,app:'CapCut 2',name:$('#projectName').value,aspect:state.aspect,quality:state.quality,fps:state.fps,background:state.background,tracks:state.tracks,clips:state.clips,magnetic:state.magnetic,beatSnap:state.beatSnap,ripple:state.ripple,assets:state.assets.map(a=>({id:a.id,name:a.name,kind:a.kind,duration:a.duration,originName:a.originName||null}))};
 downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`${data.name.replace(/[^\wÀ-ÿ-]+/g,'_')||'projeto'}.capcut2.json`);toast('Projeto JSON salvo');}
async function loadProject(file){try{const data=JSON.parse(await file.text());if(data.app!=='CapCut 2'||!Array.isArray(data.clips))throw Error('Projeto incompatível');stopPlayback();pushHistory();
 state.name=data.name||'Meu projeto';state.aspect=data.aspect||'16:9';state.quality=data.quality||720;state.fps=data.fps||30;state.background=data.background||'#09090c';state.tracks=data.tracks||clone(initialTracks);state.magnetic=data.magnetic??true;state.beatSnap=data.beatSnap??true;state.ripple=data.ripple??false;syncToggleButtons();
 // Relink files by name if they were previously imported in this session.
 const newAssets=data.assets||[];missingAssetNames=new Map();const matches=new Map();for(const a of newAssets){const old=state.assets.find(x=>x.name===a.name&&x.kind===a.kind);if(old)matches.set(a.id,old.id);else missingAssetNames.set(a.id,a);}
 state.clips=data.clips.map(c=>({...c,source:c.source?(matches.get(c.source)||c.source):null}));for(const a of newAssets.filter(a=>a.originName&&!matches.has(a.id))){const original=state.assets.find(x=>x.name===a.originName&&x.kind==='video');if(original){const derived=createDerivedAudioAsset(original,a.id);state.assets.push(derived);matches.set(a.id,derived.id);missingAssetNames.delete(a.id);for(const c of state.clips)if(c.source===a.id)c.source=derived.id;}}state.selected=null;state.time=0;
 $('#projectName').value=state.name;$('#aspectSelect').value=state.aspect;$('#qualitySelect').value=state.quality;$('#liveQualitySelect').value=state.quality;$('#fpsSelect').value=state.fps;$('#backgroundSelect').value=state.background;renderMediaList();resizePreview();renderAll();toast('Projeto aberto. Reimporte as mídias ausentes.');
 }catch(e){toast(`Erro ao abrir projeto: ${e.message}`);}}
function downloadBlob(blob,name){const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),60000);}
function resetProject(){if(!confirm('Criar um novo projeto? A edição atual não salva será perdida.'))return;stopPlayback();pushHistory();state.clips=[];state.selected=null;state.time=0;state.name='Meu projeto';$('#projectName').value=state.name;renderAll();}
const mp4MimeTypes=[
 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
 'video/mp4;codecs="avc1.42E01E,opus"',
 'video/mp4;codecs=avc1.42E01E',
 'video/mp4'
];
const webmMimeTypes=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
function chooseExportMime(format){
 const types=format==='mp4'?mp4MimeTypes:webmMimeTypes;
 if(typeof MediaRecorder==='undefined')return '';
 return types.find(t=>MediaRecorder.isTypeSupported(t))||'';
}
function setExportAvailability(){
 const nativeMP4=!!chooseExportMime('mp4');
 const mp4Option=$('#exportFormat option[value="mp4"]');mp4Option.disabled=!nativeMP4;
 if(!nativeMP4&&$('#exportFormat').value==='mp4')$('#exportFormat').value='webm';
 const format=$('#exportFormat').value;
 $('#exportNote').textContent=format==='mp4'
  ? 'MP4 real, gravado nativamente no navegador (geralmente H.264). Alguns navegadores usam áudio Opus no MP4, que pode não abrir em todos os apps. A resolução final é fixada ao iniciar; durante a renderização você pode reduzir a prévia.'
  : nativeMP4?'WebM é uma alternativa. Você também pode escolher MP4 acima.':'Este navegador não oferece gravação MP4 nativa. WebM continua disponível. Abra no Chrome ou Edge atualizados para tentar MP4 sem instalar codificadores pesados.';
}
function setExportBusy(busy){
 for(const selector of ['#startExport','#exportResolution','#exportBitrate','#exportFormat','#fpsSelect','#aspectSelect'])$(selector).disabled=busy;
 $('#cancelExport').disabled=false;
}
async function startExport(){
 if(state.exporting)return;
 const len=duration();if(len<=0)return toast('A timeline está vazia');
 if(!exportCanvas.captureStream||typeof MediaRecorder==='undefined')return toast('Exportação indisponível no navegador');
 const format=$('#exportFormat').value,mime=chooseExportMime(format);
 if(!mime)return toast(format==='mp4'?'MP4 nativo indisponível; selecione WebM.':'Este navegador não suporta a exportação selecionada.');
 stopPlayback();const rememberedTime=state.time;
 try{ensureAudio();await audioContext.resume();}catch(err){return toast('O navegador bloqueou o áudio. Tente novamente.');}
 let session=null;
 try{
  state.exporting=true;setExportBusy(true);$('#exportProgressText').textContent='Preparando renderização…';
  const fps=clamp(Number(state.fps),1,60);setExportResolution(Number($('#exportResolution').value));renderComposition(exportCanvas,exportCtx,0);
  const stream=exportCanvas.captureStream(fps);
  for(const track of audioDestination.stream.getAudioTracks())stream.addTrack(track);
  const chunks=[];
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:Number($('#exportBitrate').value)||3_000_000});
  session={cancelled:false,recorder,stream,rememberedTime,error:false};exportSession=session;
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onstop=()=>{
   for(const t of stream.getTracks())t.stop();
   const good=!session.cancelled&&!session.error&&chunks.length>0;
   if(good){
    const recordedMime=recorder.mimeType||mime;
    const container=recordedMime.startsWith('video/mp4')?'mp4':'webm';
    downloadBlob(new Blob(chunks,{type:recordedMime}),`${($('#exportName').value||'CapCut2-video').replace(/[\\/:*?"<>|]/g,'_')}.${container}`);
    toast(`Vídeo ${container.toUpperCase()} exportado!`);
   }else if(session.error){toast('Falha na exportação. Tente WebM ou resolução mais baixa.');}
   state.exporting=false;exportSession=null;setExportBusy(false);
   $('#exportProgressBar').style.width=good?'100%':'0%';
   $('#exportProgressText').textContent=good?'Exportação concluída':session.error?'Erro na exportação':'Exportação cancelada';
   stopPlayback();seek(rememberedTime);
  };
  recorder.onerror=err=>{console.error('Erro ao exportar',err);session.error=true;};
  state.time=0;seekRequested=true;syncMedia(0,true);drawFrame();renderComposition(exportCanvas,exportCtx,0);
  lastExportFrame=performance.now();recorder.start(250);state.playing=true;$('#playBtn').textContent='❚❚';lastFrame=performance.now();
  const progress=setInterval(()=>{
   if(!state.exporting||exportSession!==session||recorder.state==='inactive'){clearInterval(progress);return;}
   const pct=Math.min(100,Math.round(100*state.time/len));$('#exportProgressBar').style.width=`${pct}%`;
   $('#exportProgressText').textContent=`Exportando ${format.toUpperCase()}… ${pct}%`;
   if(state.time>=len){clearInterval(progress);stopPlayback();if(recorder.state==='recording')recorder.stop();}
  },100);
 }catch(err){
  console.error('Não foi possível exportar',err);
  if(session?.stream){for(const t of session.stream.getTracks())t.stop();}
  state.exporting=false;exportSession=null;setExportBusy(false);seek(rememberedTime);
  toast('Falha ao iniciar gravação. Tente WebM ou qualidade menor.');
 }
}
function cancelExport(){
 if(!state.exporting){$('#exportDialog').close();return;}
 if(exportSession){exportSession.cancelled=true;stopPlayback();if(exportSession.recorder.state!=='inactive')exportSession.recorder.stop();}
 $('#exportDialog').close();
}
// Preview quality does not alter export resolution once an export starts.
function setPreviewQuality(q){
 state.quality=clamp(Number(q)||720,360,1080);
 $('#qualitySelect').value=String(state.quality);
 $('#liveQualitySelect').value=String(state.quality);
 $('#exportPreviewQuality').value=String(state.quality);
 resizePreview();
 toast(`Prévia em ${state.quality}p${state.exporting?' (exportação não muda)':''}`);
}
function compositionSize(height){
 const ratios={'16:9':[16,9],'9:16':[9,16],'1:1':[1,1],'4:3':[4,3],'21:9':[21,9],'4:5':[4,5]};
 const [w,h]=ratios[state.aspect]||[16,9];
 return w>=h?[Math.round(height*w/h),height]:[height,Math.round(height*h/w)];
}
function setExportResolution(height){const [w,h]=compositionSize(height);exportCanvas.width=w;exportCanvas.height=h;}
function resizeCanvasDisplay(){
 const stage=$('#previewStage');if(!stage||!canvas.width)return;
 const aw=Math.max(20,stage.clientWidth-16),ah=Math.max(20,stage.clientHeight-16);
 const scale=Math.min(aw/canvas.width,ah/canvas.height);
 canvas.style.width=`${Math.round(canvas.width*scale)}px`;
 canvas.style.height=`${Math.round(canvas.height*scale)}px`;
}
function getVisualGeometry(c,output=canvas){
 if(!c||!['video','image'].includes(c.kind))return null;
 const asset=assetById(c.source),media=asset?.element;if(!media)return null;
 const mw=c.kind==='video'?media.videoWidth:media.naturalWidth;
 const mh=c.kind==='video'?media.videoHeight:media.naturalHeight;
 if(!(mw>0&&mh>0))return null;
 const w=output.width,h=output.height,fit=c.fit||'contain';
 const factor=fit==='cover'?Math.max(w/mw,h/mh):fit==='stretch'?1:Math.min(w/mw,h/mh);
 const width=(fit==='stretch'?w:mw*factor)*clamp(Number(c.scaleX??100),2,1200)/100;
 const height=(fit==='stretch'?h:mh*factor)*clamp(Number(c.scaleY??100),2,1200)/100;
 const cx=w/2+w*(Number(c.offsetX)||0)/100,cy=h/2+h*(Number(c.offsetY)||0)/100;
 return {x:cx-width/2,y:cy-height/2,w:width,h:height,cx,cy,rotation:Number(c.rotation)||0};
}
function previewCoords(e){const rect=canvas.getBoundingClientRect();return {x:(e.clientX-rect.left)*canvas.width/rect.width,y:(e.clientY-rect.top)*canvas.height/rect.height};}
function activeVisualsAt(at){
 return activeClips(at,'video').concat(activeClips(at,'image')).sort((a,b)=>
 state.tracks.findIndex(t=>t.id===b.track)-state.tracks.findIndex(t=>t.id===a.track));
}
function pickCanvasVisual(e){
 if(state.exporting)return;
 if(selectedClip()?.kind==='text'&&activeClips(state.time,'text').some(x=>x.id===state.selected))return;
 const p=previewCoords(e);
 const picked=activeVisualsAt(state.time).reverse().find(c=>{
  const g=getVisualGeometry(c);if(!g)return false;
  const angle=-g.rotation*Math.PI/180,co=Math.cos(angle),si=Math.sin(angle),dx=p.x-g.cx,dy=p.y-g.cy;
  const lx=dx*co-dy*si,ly=dx*si+dy*co;
  return Math.abs(lx)<=g.w/2&&Math.abs(ly)<=g.h/2;
 });
 if(!picked)return;
 e.preventDefault();e.stopImmediatePropagation();
 state.selected=picked.id;updateClipSelection();renderInspector();drawFrame();beginTransform(e,'move');
}
function updateStageOverlay(){
 const overlay=$('#transformOverlay'),toolbar=$('#canvasQuicktools'),c=selectedClip();
 if(!c||!['video','image'].includes(c.kind)||state.time<c.start||state.time>=c.start+c.duration){
  overlay.hidden=true;toolbar.hidden=true;overlayBounds=null;return;
 }
 const g=getVisualGeometry(c);
 if(!g){overlay.hidden=true;toolbar.hidden=true;overlayBounds=null;return;}
 const cv=canvas.getBoundingClientRect(),stage=$('#previewStage').getBoundingClientRect();
 const ratioX=cv.width/canvas.width,ratioY=cv.height/canvas.height;
 overlay.hidden=false;toolbar.hidden=false;overlayBounds=g;
 overlay.classList.toggle('inside-rotate',cv.top-stage.top+(g.y*ratioY)<50);
 overlay.style.left=`${cv.left-stage.left+g.x*ratioX}px`;
 overlay.style.top=`${cv.top-stage.top+g.y*ratioY}px`;
 overlay.style.width=`${g.w*ratioX}px`;
 overlay.style.height=`${g.h*ratioY}px`;
 overlay.style.transform=`rotate(${g.rotation}deg)`;
 for(const b of $$('#canvasQuicktools [data-fit]'))b.classList.toggle('active',b.dataset.fit===(c.fit||'contain'));
}
function beginTransform(e,handle){
 const c=selectedClip();if(!c||!['video','image'].includes(c.kind)||state.exporting)return;
 const g=getVisualGeometry(c),cv=canvas.getBoundingClientRect();if(!g)return;
 stopPlayback();
 const p=previewCoords(e);
 transformDrag={id:c.id,handle,pointerId:e.pointerId,
  start:p,base:g,was:snapshot(),changed:false,
  original:{scaleX:Number(c.scaleX??100),scaleY:Number(c.scaleY??100),rotation:Number(c.rotation)||0},
  basis:{width:canvas.width,height:canvas.height},
  angleStart:Math.atan2(p.y-g.cy,p.x-g.cx)};
 document.addEventListener('pointermove',onTransformMove,{passive:false});
 document.addEventListener('pointerup',endTransform);document.addEventListener('pointercancel',endTransform);
}
function onTransformMove(e){
 const d=transformDrag;if(!d||d.pointerId!==e.pointerId)return;
 e.preventDefault();const c=clipById(d.id);if(!c)return;
 const p=previewCoords(e),dx=p.x-d.start.x,dy=p.y-d.start.y,g=d.base;
 if(d.handle==='rotate'){
  const theta=Math.atan2(p.y-g.cy,p.x-g.cx);
  const delta=Math.atan2(Math.sin(theta-d.angleStart),Math.cos(theta-d.angleStart))*180/Math.PI;
  let angle=d.original.rotation+delta;
  if(e.shiftKey)angle=Math.round(angle/15)*15;
  c.rotation=Number(angle.toFixed(2));
 }else if(d.handle==='move'){
  c.offsetX=clamp((g.cx+dx-canvas.width/2)/canvas.width*100,-300,300);
  c.offsetY=clamp((g.cy+dy-canvas.height/2)/canvas.height*100,-300,300);
 }else{
  // Move the pointer in the local (unrotated) axes, then keep the opposite handle fixed in world space.
  const rad=g.rotation*Math.PI/180,co=Math.cos(rad),si=Math.sin(rad);
  const localDX=co*dx+si*dy,localDY=-si*dx+co*dy;
  const signX=d.handle.includes('w')?-1:d.handle.includes('e')?1:0;
  const signY=d.handle.includes('n')?-1:d.handle.includes('s')?1:0;
  const minW=canvas.width*.008,minH=canvas.height*.008;
  let nextW=g.w,nextH=g.h;
  const isCorner=signX!==0&&signY!==0;
  const keepAspect=(c.lockAspect!==false)!==e.shiftKey;
  if(isCorner&&keepAspect){
   const factor=clamp(1+(signX*localDX*g.w+signY*localDY*g.h)/(g.w*g.w+g.h*g.h),
    Math.max(minW/g.w,minH/g.h),Math.min(12,1200/d.original.scaleX,1200/d.original.scaleY));
   nextW=g.w*factor;nextH=g.h*factor;
  }else{
   if(signX)nextW=Math.max(minW,g.w+signX*localDX);
   if(signY)nextH=Math.max(minH,g.h+signY*localDY);
  }
  nextW=g.w*clamp(d.original.scaleX*nextW/g.w,2,1200)/d.original.scaleX;
  nextH=g.h*clamp(d.original.scaleY*nextH/g.h,2,1200)/d.original.scaleY;
  c.scaleX=clamp(d.original.scaleX*nextW/g.w,2,1200);
  c.scaleY=clamp(d.original.scaleY*nextH/g.h,2,1200);
  const moveLocalX=signX*(nextW-g.w)/2,moveLocalY=signY*(nextH-g.h)/2;
  const newCX=g.cx+co*moveLocalX-si*moveLocalY;
  const newCY=g.cy+si*moveLocalX+co*moveLocalY;
  c.offsetX=clamp((newCX-canvas.width/2)/canvas.width*100,-300,300);
  c.offsetY=clamp((newCY-canvas.height/2)/canvas.height*100,-300,300);
 }
 d.changed=true;drawFrame();
}
function endTransform(e){
 if(!transformDrag||transformDrag.pointerId!==e.pointerId)return;
 if(transformDrag.changed){state.history.push(transformDrag.was);if(state.history.length>60)state.history.shift();state.future=[];renderInspector();}
 transformDrag=null;
 document.removeEventListener('pointermove',onTransformMove);document.removeEventListener('pointerup',endTransform);document.removeEventListener('pointercancel',endTransform);
}
function resetSelectedTransform(){
 const c=selectedClip();if(!c)return;
 pushHistory();Object.assign(c,{fit:'contain',scaleX:100,scaleY:100,offsetX:0,offsetY:0,rotation:0,lockAspect:true});renderInspector();drawFrame();toast('Enquadramento restaurado');
}
function openMobilePanel(panel){
 const library=$('.library'),inspector=$('.inspector');
 const showLibrary=panel==='library'||panel==='project',showInspector=panel==='inspector';
 library.classList.toggle('is-open',showLibrary);inspector.classList.toggle('is-open',showInspector);
 $('#mobileScrim').hidden=!(showLibrary||showInspector);
 $$('#mobileDock button').forEach(b=>b.classList.toggle('active',b.dataset.mobile===panel));
 if(panel==='project'){
  $$('.main-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.panel==='settings'));
  $$('.sidebar-panel').forEach(p=>p.classList.toggle('active',p.id==='panel-settings'));
 }else if(panel==='library'){
  $$('.main-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.panel==='media'));
  $$('.sidebar-panel').forEach(p=>p.classList.toggle('active',p.id==='panel-media'));
 }
}
function wireUI(){
 $('#mediaInput').addEventListener('change',async e=>{await addFiles(e.target.files);e.target.value='';});
 const drop=$('#dropZone');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');addFiles(e.dataTransfer.files);});
 document.addEventListener('dragover',e=>e.preventDefault());document.addEventListener('drop',e=>{e.preventDefault();if(!drop.contains(e.target))addFiles(e.dataTransfer.files);});
 $$('.main-tabs button').forEach(button=>button.addEventListener('click',()=>{$$('.main-tabs button').forEach(b=>b.classList.toggle('active',b===button));$$('.sidebar-panel').forEach(p=>p.classList.toggle('active',p.id===`panel-${button.dataset.panel}`));}));
 $('#addText').onclick=addText;$('#playBtn').onclick=play;$('#backBtn').onclick=()=>seek(state.time-1);$('#forwardBtn').onclick=()=>seek(state.time+1);
 $('#extractAudioBtn').onclick=extractAudio;$('#beatBtn').onclick=markBeat;$('#splitBtn').onclick=split;$('#deleteBtn').onclick=deleteSelected;$('#duplicateBtn').onclick=duplicateSelected;$('#undoBtn').onclick=undo;$('#redoBtn').onclick=redo;
 $('#detectBeatBtn').onclick=detectBeats;for(const [id,key] of [['magneticBtn','magnetic'],['beatSnapBtn','beatSnap'],['rippleBtn','ripple']])$('#'+id).onclick=()=>{state[key]=!state[key];syncToggleButtons();};syncToggleButtons();
 $('#timelineZoom').oninput=e=>{state.zoom=Number(e.target.value);renderTimeline();};
 const ruler=$('#ruler');let rulerSeek=null;const onRulerMove=e=>{if(rulerSeek!==e.pointerId)return;const r=ruler.getBoundingClientRect();seek((e.clientX-r.left)/state.zoom);};const endRuler=e=>{if(rulerSeek!==e.pointerId)return;rulerSeek=null;document.removeEventListener('pointermove',onRulerMove);document.removeEventListener('pointerup',endRuler);document.removeEventListener('pointercancel',endRuler);};ruler.addEventListener('pointerdown',e=>{e.preventDefault();rulerSeek=e.pointerId;onRulerMove(e);document.addEventListener('pointermove',onRulerMove);document.addEventListener('pointerup',endRuler);document.addEventListener('pointercancel',endRuler);});$('#fitTimeline').onclick=()=>{const available=$('#timelineScroll').clientWidth-125;state.zoom=clamp(Math.floor(available/Math.max(duration(),5)),25,220);$('#timelineZoom').value=state.zoom;renderTimeline();};
 $('#aspectSelect').onchange=e=>{pushHistory();state.aspect=e.target.value;resizePreview();};$('#backgroundSelect').onchange=e=>{pushHistory();state.background=e.target.value;drawFrame();};$('#qualitySelect').onchange=e=>setPreviewQuality(e.target.value);$('#liveQualitySelect').onchange=e=>setPreviewQuality(e.target.value);$('#fpsSelect').onchange=e=>state.fps=Number(e.target.value);
 $('#mutePreview').onclick=()=>{state.previewMuted=!state.previewMuted;$('#mutePreview').textContent=state.previewMuted?'♪̸':'♪';syncMedia(state.time,true);};
 $('#fullscreenBtn').onclick=()=>$('#previewStage').requestFullscreen?.();
 $('#newProject').onclick=resetProject;$('#saveProject').onclick=saveProject;$('#inlineSaveProject').onclick=saveProject;$('#inlineOpenProject').onclick=()=>$('#projectInput').click();$('#projectInput').onchange=e=>{if(e.target.files[0])loadProject(e.target.files[0]);e.target.value='';};
 $('#projectName').onchange=e=>{state.name=e.target.value;};
 $('#exportPreviewQuality').onchange=e=>setPreviewQuality(e.target.value);$('#exportFormat').onchange=setExportAvailability;
 $('#exportBtn').onclick=()=>{setExportAvailability();$('#exportPreviewQuality').value=String(state.quality);$('#exportName').value=$('#projectName').value.replace(/\s+/g,'-')||'CapCut2-video';$('#exportDialog').showModal();};
 $('#closeExport').onclick=()=>{if(!state.exporting)$('#exportDialog').close();};$('#cancelExport').onclick=cancelExport;$('#startExport').onclick=startExport;
 $('#exportDialog').addEventListener('cancel',e=>{if(state.exporting)e.preventDefault();});
 document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='b'&&!e.altKey){e.preventDefault();split();return;}const focused=e.target.closest('input,textarea,select,[contenteditable="true"]');if(focused)return;
  if(e.code==='Space'){e.preventDefault();play();}else if(e.key.toLowerCase()==='s'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();split();}
  else if(e.key.toLowerCase()==='m'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();markBeat();}else if(e.key==='Delete'||e.key==='Backspace'){deleteSelected();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}
  else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();}
  else if(e.key==='ArrowLeft'){seek(state.time-.1);}else if(e.key==='ArrowRight'){seek(state.time+.1);}
 });
 let textDrag=null;canvas.addEventListener('pointerdown',e=>{const c=selectedClip();if(!c||c.kind!=='text')return;const r=canvas.getBoundingClientRect();textDrag={id:c.id,start:snapshot()};canvas.setPointerCapture(e.pointerId);const point=ev=>{c.x=clamp((ev.clientX-r.left)/r.width,0,1);c.y=clamp((ev.clientY-r.top)/r.height,0,1);drawFrame();};point(e);});
 canvas.addEventListener('pointermove',e=>{if(!textDrag)return;const c=clipById(textDrag.id);const r=canvas.getBoundingClientRect();if(c){c.x=clamp((e.clientX-r.left)/r.width,0,1);c.y=clamp((e.clientY-r.top)/r.height,0,1);drawFrame();}});
 canvas.addEventListener('pointerup',()=>{if(textDrag){state.history.push(textDrag.start);state.future=[];textDrag=null;renderInspector();}});
 canvas.addEventListener('pointerdown',pickCanvasVisual,true);
 $('#transformOverlay').addEventListener('pointerdown',e=>{const handle=e.target.closest('[data-handle]');if(!handle)return;e.preventDefault();e.stopPropagation();beginTransform(e,handle.dataset.handle);});
 $$('#canvasQuicktools [data-fit]').forEach(b=>b.addEventListener('click',()=>{const c=selectedClip();if(!c)return;updateSelected('fit',b.dataset.fit);renderInspector();drawFrame();}));
 $('#resetTransform').onclick=resetSelectedTransform;
 $('#mobileDock').addEventListener('click',e=>{const button=e.target.closest('[data-mobile]');if(button)openMobilePanel(button.dataset.mobile);});
 $('#mobileScrim').addEventListener('click',()=>openMobilePanel('timeline'));
 $('#inspectorToggle').onclick=()=>$('.inspector').classList.toggle('is-open');
 window.addEventListener('resize',()=>{resizeCanvasDisplay();renderTimeline();drawFrame();});
 if('ResizeObserver' in window)new ResizeObserver(()=>{resizeCanvasDisplay();drawFrame();}).observe($('#previewStage'));
}
if(window.matchMedia('(max-width:700px)').matches){state.quality=480;$('#qualitySelect').value='480';$('#liveQualitySelect').value='480';$('#exportPreviewQuality').value='480';}
wireUI();setExportAvailability();resizePreview();renderAll();requestAnimationFrame(tick);
