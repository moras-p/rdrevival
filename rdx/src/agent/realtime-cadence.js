export function createRealtimeCadencePolicy({configuredCadenceFrames=4,maxCadenceFrames=24,headroomFrames=1}={}) {
  const floor=Math.max(1,Number(configuredCadenceFrames)|0);
  const cap=Math.max(floor,Number(maxCadenceFrames)|0);
  const headroom=Math.max(0,Number(headroomFrames)|0);
  let latencyMs=0, latencyFrames=0, effectiveCadenceFrames=floor;
  return Object.freeze({
    observe({latencyMs:nextLatencyMs,tickRate=25}={}) {
      const ms=Math.max(0,Number(nextLatencyMs)||0);
      const hz=Math.max(1,Number(tickRate)||25);
      latencyMs=ms;
      latencyFrames=Math.ceil(ms*hz/1000);
      effectiveCadenceFrames=Math.max(floor,Math.min(cap,latencyFrames+headroom));
      return this.snapshot();
    },
    reset(){latencyMs=0;latencyFrames=0;effectiveCadenceFrames=floor;return this.snapshot();},
    snapshot(){return Object.freeze({configuredCadenceFrames:floor,effectiveCadenceFrames,priorLatencyMs:latencyMs,priorLatencyFrames:latencyFrames,maxCadenceFrames:cap});}
  });
}
