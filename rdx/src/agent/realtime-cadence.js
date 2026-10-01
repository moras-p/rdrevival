export function createRealtimeCadencePolicy({configuredCadenceFrames=4,maxCadenceFrames=24,headroomFrames=1,minimumInterRequestFrames=1,emaWeight=0.5}={}) {
  const refresh=Math.max(1,Number(configuredCadenceFrames)|0);
  const latencyCap=Math.max(1,Number(maxCadenceFrames)|0);
  const headroom=Math.max(0,Number(headroomFrames)|0);
  const minimumSpacing=Math.max(1,Number(minimumInterRequestFrames)|0);
  const alpha=Math.max(0,Math.min(1,Number(emaWeight)||0.5));
  let latencyMs=0,latencyFrames=0,emaLatencyFrames=0,estimatedLatencyFrames=0,prefetchLeadFrames=headroom;
  return Object.freeze({
    observe({latencyMs:nextLatencyMs,tickRate=25}={}){
      const ms=Math.max(0,Number(nextLatencyMs)||0),hz=Math.max(1,Number(tickRate)||25);
      latencyMs=ms;latencyFrames=Math.ceil(ms*hz/1000);
      emaLatencyFrames=emaLatencyFrames===0?latencyFrames:(alpha*latencyFrames+(1-alpha)*emaLatencyFrames);
      estimatedLatencyFrames=Math.min(latencyCap,Math.max(latencyFrames,Math.ceil(emaLatencyFrames)));
      prefetchLeadFrames=Math.min(latencyCap,estimatedLatencyFrames+headroom);
      return this.snapshot();
    },
    reset(){latencyMs=0;latencyFrames=0;emaLatencyFrames=0;estimatedLatencyFrames=0;prefetchLeadFrames=headroom;return this.snapshot();},
    snapshot(){return Object.freeze({configuredCadenceFrames:refresh,refreshCadenceFrames:refresh,effectiveCadenceFrames:refresh,priorLatencyMs:latencyMs,priorLatencyFrames:latencyFrames,estimatedLatencyFrames,prefetchLeadFrames,minimumInterRequestFrames:minimumSpacing,maxCadenceFrames:latencyCap});}
  });
}
