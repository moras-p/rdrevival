import { projectRealtimeObservation } from './realtime-observation-projector.js';

export const REALTIME_FRAME_WIDTH=320;
export const REALTIME_FRAME_HEIGHT=200;
export const REALTIME_FRAME_SCHEMA='rdr.realtime-ai.frame.rgb8.v1';
const INPUT_MODES=new Set(['structured','pixels','hybrid']);

function providerCapabilities(provider) {
  const raw=typeof provider?.getCapabilities==='function' ? provider.getCapabilities() : {structured:true,pixels:false,hybrid:false};
  const capabilities={structured:!!raw?.structured,pixels:!!raw?.pixels,hybrid:!!raw?.hybrid};
  if(!capabilities.structured && !capabilities.pixels && !capabilities.hybrid)
    throw new Error('DecisionProvider must support structured, pixels and/or hybrid input');
  return Object.freeze(capabilities);
}

export function resolveRealtimeProviderInput(provider,{inputMode='auto'}={}) {
  const capabilities=providerCapabilities(provider);
  let mode=String(inputMode||'auto');
  if(mode==='auto') mode=capabilities.hybrid?'hybrid':capabilities.structured?'structured':'pixels';
  if(!INPUT_MODES.has(mode)) throw new Error(`Unknown realtime provider input mode '${mode}'`);
  if(mode==='structured'&&!capabilities.structured) throw new Error('DecisionProvider does not support structured input');
  if(mode==='pixels'&&!capabilities.pixels) throw new Error('DecisionProvider does not support pixel input');
  if(mode==='hybrid'&&!capabilities.hybrid) throw new Error('DecisionProvider does not support hybrid input');
  return Object.freeze({mode,capabilities});
}

export function makeRealtimeRgbFrame({frameSerial,pixels,width=REALTIME_FRAME_WIDTH,height=REALTIME_FRAME_HEIGHT}={}) {
  const expected=width*height*3;
  if(!(pixels instanceof Uint8Array) || pixels.byteLength!==expected)
    throw new Error(`Realtime RGB frame must contain ${expected} bytes`);
  return Object.freeze({schema:REALTIME_FRAME_SCHEMA,frameSerial:Number(frameSerial)>>>0,width,height,format:'rgb8',pixels});
}

export function captureBrowserRealtimeFrame(bridge,observation) {
  if(!bridge || typeof bridge.presentationFramebufferForFrame!=='function')
    throw new Error('Browser realtime pixel input requires presentationFramebufferForFrame');
  const frameSerial=Number(observation?.episode?.frameSerial)>>>0;
  const rgba=bridge.presentationFramebufferForFrame(frameSerial);
  const expected=REALTIME_FRAME_WIDTH*REALTIME_FRAME_HEIGHT*4;
  if(!(rgba instanceof Uint8Array) && !(rgba instanceof Uint8ClampedArray) || rgba.byteLength!==expected)
    throw new Error(`Browser production framebuffer must contain ${expected} RGBA bytes`);
  const rgb=new Uint8Array(REALTIME_FRAME_WIDTH*REALTIME_FRAME_HEIGHT*3);
  for(let src=0,dst=0;src<rgba.length;src+=4){rgb[dst++]=rgba[src];rgb[dst++]=rgba[src+1];rgb[dst++]=rgba[src+2];}
  return makeRealtimeRgbFrame({frameSerial,pixels:rgb});
}

export function realtimeInputCalibrationKey({mode,projection}={}) {
  if(mode==='structured') return projection;
  if(mode==='pixels') return 'pixels:rgb8-v1';
  return `hybrid:${projection}+rgb8-v1`;
}

export function prepareRealtimeDecisionInput({provider,inputMode='auto',observation,choices,projection='compact-v1',maxStateBytes=8192,history=null,timingContext=null,frame=null,previousFrame=null,signal=null}={}) {
  const resolved=resolveRealtimeProviderInput(provider,{inputMode});
  const structured=resolved.mode==='structured'||resolved.mode==='hybrid';
  const pixels=resolved.mode==='pixels'||resolved.mode==='hybrid';
  let projected=null;
  if(structured) projected=projectRealtimeObservation(observation,{projection,maxBytes:maxStateBytes,history,timingContext});
  if(pixels && !frame) throw new Error(`Realtime ${resolved.mode} input requires a production frame`);
  const request={choices,signal,inputMode:resolved.mode,timing:observation?.timing||null};
  if(structured){request.observation=observation;request.projectedState=projected.projectedState;}
  if(pixels){request.frame=frame;request.previousFrame=previousFrame||null;}
  const input={mode:resolved.mode,frameSchema:pixels?frame.schema:null,frameSerial:pixels?frame.frameSerial:null,
    previousFrameSerial:pixels&&previousFrame?previousFrame.frameSerial:null,pixelBytes:pixels?(frame.pixels.byteLength+(previousFrame?.pixels?.byteLength||0)):0};
  return {resolved,projected,request,input,calibrationKey:realtimeInputCalibrationKey({mode:resolved.mode,projection})};
}
