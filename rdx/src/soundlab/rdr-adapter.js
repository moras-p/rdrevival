import { XrickLivePreview, LIVE_WIDTH, LIVE_HEIGHT } from '../juice/xrick-live-preview.js';
import { NativeSceneRunner, NATIVE_SCENE_FRAME_MS } from '../runtime/native-scene-runner.js';

const ROLLING_SLOT=0, EVENT_SLOTS=[1,2,3,4,5], TEMP_SLOT=6;
const SOUNDLAB_EVENT_IDS=Object.freeze({'boulder.impact':1});
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

const humanize=value=>String(value||'').replace(/^sm\d+-/i,'').replace(/[-_.]+/g,' ').replace(/\b\w/g,ch=>ch.toUpperCase());

export function summarizeSceneMotion(points,eventFrame,binding={}){
  const rows=(points||[]).filter(row=>Number.isFinite(row?.x)&&Number.isFinite(row?.y));
  const proof=Number.isFinite(Number(eventFrame))?Number(eventFrame):null;
  const before=proof==null?rows:rows.filter(row=>Number(row.frame)<=proof);
  const after=proof==null?[]:rows.filter(row=>Number(row.frame)>=proof);
  const first=rows[0],last=rows.at(-1),impact=(proof==null?last:[...rows].reverse().find(row=>Number(row.frame)<=proof))||last;
  const minBeforeY=before.length?Math.min(...before.map(row=>Number(row.y))):Number(first?.y||0);
  const fallPx=impact?Math.max(0,Math.round(Number(impact.y)-minBeforeY)):0;
  const minAfterY=after.length?Math.min(...after.map(row=>Number(row.y))):Number(impact?.y||0);
  const bouncePx=impact?Math.max(0,Math.round(Number(impact.y)-minAfterY)):0;
  const horizontalPx=first&&last?Math.round(Number(last.x)-Number(first.x)):0;
  return {
    object:humanize(binding?.match?.actorFamily||binding?.object||'sound object'),
    surface:humanize(binding?.surface||'surface'),
    event:humanize(binding?.event||'contact'),
    pointCount:rows.length,fallPx,bouncePx,horizontalPx,proofFrame:proof,
    summary:rows.length<2?'Waiting for motion trace':`${humanize(binding?.match?.actorFamily||binding?.object||'object')} ${fallPx?`falls ${fallPx}px`:horizontalPx?`moves ${Math.abs(horizontalPx)}px ${horizontalPx<0?'left':'right'}`:'moves'}${proof!=null?` → ${humanize(binding?.event||'contact')} on ${humanize(binding?.surface||'surface')} at frame ${proof}`:''}${bouncePx?` → bounces ${bouncePx}px`:''}`
  };
}

export function eventMatchesBinding(event,binding){
  if(!event||!binding)return false;
  if(binding.event&&String(event.event)!==String(binding.event))return false;
  const match=binding.match||{};
  if(match.submap!=null&&Number(event.submap)!==Number(match.submap))return false;
  if(match.mark!=null&&Number(event.actor?.mark)!==Number(match.mark))return false;
  if(match.actorFamily&&String(event.actor?.family||'')!==String(match.actorFamily))return false;
  return true;
}

export class SoundLabLiveAudioRoute {
  constructor({bridge,binding,audioContext,onState=null}={}){
    this.bridge=bridge;this.binding=binding;this.audioContext=audioContext;this.onState=onState;
    this.mode='native';this.buffer=null;this.bufferRevision=0;this.pendingRevision=0;this.lastEventSerial=null;this.lastStart=null;this.error=null;
  }
  eventId(){return SOUNDLAB_EVENT_IDS[this.binding?.event]||0;}
  state(){return{mode:this.mode,armed:this.armed(),revision:this.bufferRevision,pendingRevision:this.pendingRevision,lastEventSerial:this.lastEventSerial,lastStart:this.lastStart,error:this.error};}
  #publish(){const value=this.state();this.onState?.(value);return value;}
  #syncSuppression(){const id=this.eventId();if(!id)return false;return !!this.bridge?.setSoundLabEventSuppressed?.(id,this.armed());}
  armed(){return this.mode==='current-draft'&&!!this.buffer&&this.audioContext?.state==='running';}
  setMode(mode){this.mode=mode==='current-draft'?'current-draft':'native';if(this.mode==='native')this.bridge?.setSoundLabEventSuppressed?.(this.eventId(),false);else this.#syncSuppression();return this.#publish();}
  beginRevision(revision){this.pendingRevision=Math.max(this.pendingRevision,Number(revision)||0);this.error=null;return this.#publish();}
  prepareBuffer(buffer,revision){
    revision=Number(revision)||0;
    if(revision<this.pendingRevision||revision<this.bufferRevision)return false;
    if(!buffer) return this.failRevision(revision,new Error('Draft render did not produce audio'));
    this.buffer=buffer;this.bufferRevision=revision;this.pendingRevision=Math.max(this.pendingRevision,revision);this.error=null;this.#syncSuppression();this.#publish();return true;
  }
  failRevision(revision,error){
    revision=Number(revision)||0;if(revision<this.pendingRevision)return false;
    this.error=String(error?.message||error||'Draft preparation failed');this.buffer=null;this.bufferRevision=0;this.bridge?.setSoundLabEventSuppressed?.(this.eventId(),false);this.#publish();return false;
  }
  audioStateChanged(){this.#syncSuppression();return this.#publish();}
  resetReplayGuard(){this.lastEventSerial=null;return this.#publish();}
  clear(){this.bridge?.setSoundLabEventSuppressed?.(this.eventId(),false);this.buffer=null;this.bufferRevision=0;this.pendingRevision=0;this.lastEventSerial=null;this.error=null;return this.#publish();}
  handleEvent(event){
    if(!eventMatchesBinding(event,this.binding)||!this.armed())return false;
    const serial=Number(event.serial)>>>0;if(this.lastEventSerial===serial)return false;
    const context=this.audioContext,source=context.createBufferSource();source.buffer=this.buffer;
    let output=source;const screenX=Number(event.screenX);
    if(typeof context.createStereoPanner==='function'&&Number.isFinite(screenX)){
      const panner=context.createStereoPanner();panner.pan.value=clamp((screenX-(LIVE_WIDTH/2))/(LIVE_WIDTH/2),-1,1);source.connect(panner);output=panner;
    }
    output.connect(context.destination);const startedAt=Number(context.currentTime||0);source.start(startedAt);
    this.lastEventSerial=serial;this.lastStart={serial,revision:this.bufferRevision,screenX:Number.isFinite(screenX)?screenX:null,audioTime:startedAt,wallTime:globalThis.performance?.now?.()??Date.now()};this.#publish();return true;
  }
}

export class RdrSoundLabRuntime {
  constructor({canvas,onEvent,onStatus,onSceneState,onLiveState,onSceneAnalysis,previewFactory=XrickLivePreview,requestFrame=globalThis.requestAnimationFrame?.bind(globalThis),cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis)}={}){
    this.canvas=canvas;this.ctx=canvas?.getContext('2d');this.onEvent=onEvent;this.onStatus=onStatus;this.onSceneState=onSceneState;this.onLiveState=onLiveState;this.onSceneAnalysis=onSceneAnalysis;this.previewFactory=previewFactory;this.requestFrame=requestFrame||(()=>0);this.cancelFrame=cancelFrame||(()=>{});this.preview=null;this.binding=null;this.scene=null;this.sceneRunner=null;this.liveRoute=null;this.lastSerial=0;this.running=false;this.raf=0;this.lastSceneTick=0;
    this.rolling=null;this.replays=new Map();this.replayCursor=0;this.lastRollingFrame=-1;this.motionTrace=[];this.motionEventFrame=null;this.lastMotionAnalysis=null;
  }
  async start({binding,scene=binding?.scene,romBytes,audioContext=null}={}){
    if(!(romBytes instanceof Uint8Array)||romBytes.length===0)throw new Error('Native SoundLab requires validated RDX ROM bytes');
    if(!binding)throw new Error('Native SoundLab requires a binding');if(!scene)throw new Error(`Binding ${binding.id||binding.event} does not define a native scene`);
    if(this.preview)this.stop();
    this.onStatus?.('Starting native runtime…');this.binding=binding;this.scene=scene;
    this.preview=await this.previewFactory.create(()=>{},()=>{});await this.preview.loadRdxRom(romBytes);this.preview.setPresentation(scene.presentation||'rdx');
    this.preview.setHighQualityAmigaAudio?.();this.preview.bridge.clearSoundLabEventSuppressions?.();this.#clearCheckpoints();this.motionTrace=[];this.motionEventFrame=null;this.lastMotionAnalysis=null;
    this.sceneRunner=new NativeSceneRunner(this.preview,{checkpointSlot:7,onState:value=>this.onSceneState?.(value)});this.sceneRunner.start(scene);
    this.lastSerial=this.preview.bridge.soundLabEventSerial?.()||0;
    this.liveRoute=new SoundLabLiveAudioRoute({bridge:this.preview.bridge,binding,audioContext,onState:value=>this.onLiveState?.(value)});
    this.running=true;this.lastSceneTick=0;this.#loop();this.onStatus?.(`Scene ${scene.id} · authoritative native timing`);return this;
  }
  setDraftBuffer(buffer,revision){return this.liveRoute?.prepareBuffer(buffer,revision)??false;}
  beginDraftRevision(revision){return this.liveRoute?.beginRevision(revision);}
  failDraftRevision(revision,error){return this.liveRoute?.failRevision(revision,error);}
  setAuditionMode(mode){return this.liveRoute?.setMode(mode);}
  audioStateChanged(){return this.liveRoute?.audioStateChanged();}
  setPaused(paused){return this.sceneRunner?.setPaused(paused);}
  setLoop(loop){return this.sceneRunner?.setLoop(loop);}
  setPreviewWindow(start,end){this.liveRoute?.resetReplayGuard();return this.sceneRunner?.setWindow(start,end);}
  restartScene(){this.liveRoute?.resetReplayGuard();return this.sceneRunner?.restart();}
  reset(){return this.restartScene();}
  stop(){
    this.running=false;if(this.raf)this.cancelFrame(this.raf);this.raf=0;this.liveRoute?.clear();this.preview?.bridge?.clearSoundLabEventSuppressions?.();this.sceneRunner?.stop({discard:true});this.preview?.clearKeys?.();this.#clearCheckpoints();this.preview=null;this.sceneRunner=null;this.liveRoute=null;
  }
  canReplayEvent(serial){return this.replays.has(Number(serial)>>>0);}
  replayEvent(serial){
    const checkpoint=this.replays.get(Number(serial)>>>0);if(!checkpoint||!this.preview)return false;
    if(!this.preview.bridge.debugCheckpointLoad?.(checkpoint.slot))return false;if(checkpoint.tracking)this.preview.restoreTrackingState?.(checkpoint.tracking);
    this.lastSerial=checkpoint.lastSerial;this.liveRoute?.resetReplayGuard();this.onStatus?.(`Replaying event context · ${checkpoint.framesBefore}f pre-roll`);return true;
  }
  #clearCheckpoints(){if(this.preview?.bridge?.debugCheckpointDiscard)for(let slot=0;slot<=TEMP_SLOT;slot+=1)this.preview.bridge.debugCheckpointDiscard(slot);this.rolling=null;this.replays.clear();this.replayCursor=0;this.lastRollingFrame=-1;}
  #saveRolling(frameSerial){if(!this.preview?.bridge?.debugCheckpointSave?.(ROLLING_SLOT))return;this.rolling={slot:ROLLING_SLOT,tracking:this.preview.captureTrackingState?.()||null,lastSerial:this.lastSerial,frameSerial:Number(frameSerial)};this.lastRollingFrame=Number(frameSerial);}
  #freezeReplay(event,frameSerial){
    if(!this.rolling||!this.preview?.bridge?.debugCheckpointSave||!this.preview.bridge.debugCheckpointLoad)return null;const slot=EVENT_SLOTS[this.replayCursor++%EVENT_SLOTS.length];for(const [serial,row] of this.replays)if(row.slot===slot)this.replays.delete(serial);
    const currentTracking=this.preview.captureTrackingState?.()||null,currentLast=this.lastSerial;if(!this.preview.bridge.debugCheckpointSave(TEMP_SLOT))return null;if(!this.preview.bridge.debugCheckpointLoad(ROLLING_SLOT))return null;if(!this.preview.bridge.debugCheckpointSave(slot)){this.preview.bridge.debugCheckpointLoad(TEMP_SLOT);return null;}
    this.preview.bridge.debugCheckpointLoad(TEMP_SLOT);if(currentTracking)this.preview.restoreTrackingState?.(currentTracking);this.lastSerial=currentLast;const checkpoint={slot,tracking:this.rolling.tracking,lastSerial:this.rolling.lastSerial,framesBefore:Math.max(0,Number(frameSerial)-Number(this.rolling.frameSerial))};this.replays.set(Number(event.serial)>>>0,checkpoint);return checkpoint;
  }
  #trackSceneMotion(snapshot){
    const mark=Number(this.binding?.match?.mark);if(!Number.isFinite(mark))return;
    const entity=(snapshot?.entities||[]).find(row=>Number(row.mark)===mark&&Number(row.n)>0&&Number(row.n)<=0x7f);
    if(!entity)return;const frame=Number(this.sceneRunner?.frame??0);const previous=this.motionTrace.at(-1);
    if(previous&&Number(previous.frame)===frame){previous.x=Number(entity.x);previous.y=Number(entity.y);return;}
    this.motionTrace.push({frame,x:Number(entity.x),y:Number(entity.y),slot:Number(entity.slot)});
    if(this.motionTrace.length>512)this.motionTrace.shift();
    this.lastMotionAnalysis=summarizeSceneMotion(this.motionTrace,this.motionEventFrame,this.binding);this.onSceneAnalysis?.(this.lastMotionAnalysis);
  }
  #completeMotionLoop(){
    if(this.motionTrace.length){this.lastMotionAnalysis=summarizeSceneMotion(this.motionTrace,this.motionEventFrame,this.binding);this.onSceneAnalysis?.(this.lastMotionAnalysis);}
    this.motionTrace=[];this.motionEventFrame=null;
  }
  #captureAndEvents(){
    const frame=this.preview.capture();if(this.ctx&&frame?.canvas){this.ctx.imageSmoothingEnabled=false;this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);this.ctx.drawImage(frame.canvas,0,0,LIVE_WIDTH,LIVE_HEIGHT,0,0,this.canvas.width,this.canvas.height);}
    this.#trackSceneMotion(frame?.snapshot);
    const frameSerial=Number(frame?.snapshot?.frameSerial??-1),events=this.preview.bridge.soundLabEventsSince?.(this.lastSerial,64)||[];
    for(const event of events){const family=event.event==='boulder.impact'?'sm00-boulder':undefined,enriched={...event,actor:{...event.actor,...(family?{family}:{})}};const checkpoint=this.#freezeReplay(enriched,frameSerial);this.lastSerial=event.serial;const out={...enriched,sceneFrame:Number(this.sceneRunner?.frame??0),replayable:!!checkpoint,preRollFrames:checkpoint?.framesBefore??0};this.sceneRunner?.noteEvent(out);if(eventMatchesBinding(out,this.binding)){this.motionEventFrame=out.sceneFrame;this.lastMotionAnalysis=summarizeSceneMotion(this.motionTrace,this.motionEventFrame,this.binding);this.onSceneAnalysis?.(this.lastMotionAnalysis);}this.liveRoute?.handleEvent(out);this.onEvent?.(out,frame.snapshot);}
    if(frameSerial>=0&&(this.lastRollingFrame<0||frameSerial-this.lastRollingFrame>=6))this.#saveRolling(frameSerial);
  }
  #loop(timestamp=0){
    if(!this.running||!this.preview)return;const now=Number(timestamp||globalThis.performance?.now?.()||0);if(!this.lastSceneTick)this.lastSceneTick=now;
    if(now-this.lastSceneTick>=NATIVE_SCENE_FRAME_MS){const steps=Math.min(3,Math.max(1,Math.floor((now-this.lastSceneTick)/NATIVE_SCENE_FRAME_MS)));for(let i=0;i<steps;i+=1){const result=this.sceneRunner?.step();if(result?.wrapped){this.#completeMotionLoop();this.liveRoute?.resetReplayGuard();}this.lastSceneTick+=NATIVE_SCENE_FRAME_MS;}}
    this.#captureAndEvents();this.raf=this.requestFrame(next=>this.#loop(next));
  }
}

export { RdrSoundLabRuntime as SoundLabRuntime };
