export const PLATFORM_CURVE_MODES = Object.freeze([
  Object.freeze({ id:'linear', value:0, label:'Linear / Classic', controls:[0,0,1,1] }),
  Object.freeze({ id:'ease-in', value:1, label:'Ease in', controls:[0.42,0,1,1] }),
  Object.freeze({ id:'ease-out', value:2, label:'Ease out', controls:[0,0,0.58,1] }),
  Object.freeze({ id:'ease-in-out', value:3, label:'Ease in / out', controls:[0.42,0,0.58,1] }),
  Object.freeze({ id:'overshoot', value:4, label:'Dynamic · overshoot', controls:[0.175,0.885,0.32,1.275] }),
  Object.freeze({ id:'anticipate', value:5, label:'Dynamic · anticipate', controls:[0.6,-0.28,0.735,0.045] }),
  Object.freeze({ id:'custom', value:6, label:'Custom cubic', controls:null })
]);

export const DEFAULT_PLATFORM_CURVE = Object.freeze({
  platformCurveMode:'linear', platformCurveX1:.25, platformCurveY1:.1,
  platformCurveX2:.25, platformCurveY2:1
});

const clamp=(value,min,max,fallback)=>{const n=Number(value);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;};
export function normalizePlatformCurveTuning(input={}){
  const mode=PLATFORM_CURVE_MODES.some(row=>row.id===input.platformCurveMode)?input.platformCurveMode:DEFAULT_PLATFORM_CURVE.platformCurveMode;
  return {
    platformCurveMode:mode,
    platformCurveX1:clamp(input.platformCurveX1,0,1,DEFAULT_PLATFORM_CURVE.platformCurveX1),
    platformCurveY1:clamp(input.platformCurveY1,-1,2,DEFAULT_PLATFORM_CURVE.platformCurveY1),
    platformCurveX2:clamp(input.platformCurveX2,0,1,DEFAULT_PLATFORM_CURVE.platformCurveX2),
    platformCurveY2:clamp(input.platformCurveY2,-1,2,DEFAULT_PLATFORM_CURVE.platformCurveY2)
  };
}
export function platformCurveModeValue(mode){return PLATFORM_CURVE_MODES.find(row=>row.id===mode)?.value??0;}
export function platformCurveControls(tuning={}){
  const normalized=normalizePlatformCurveTuning(tuning),preset=PLATFORM_CURVE_MODES.find(row=>row.id===normalized.platformCurveMode);
  return preset?.controls ? [...preset.controls] : [normalized.platformCurveX1,normalized.platformCurveY1,normalized.platformCurveX2,normalized.platformCurveY2];
}
const cubic=(p1,p2,t)=>{const q=1-t;return 3*q*q*t*p1+3*q*t*t*p2+t*t*t;};
export function platformCurveProgress(progress,tuning={}){
  const target=Math.min(1,Math.max(0,Number(progress)||0));
  if(target<=0||target>=1)return target;
  const normalized=normalizePlatformCurveTuning(tuning);
  if(normalized.platformCurveMode==='linear')return target;
  const [x1,y1,x2,y2]=platformCurveControls(normalized);
  let lo=0,hi=1;
  for(let i=0;i<18;i++){const t=(lo+hi)/2;if(cubic(x1,x2,t)<target)lo=t;else hi=t;}
  return cubic(y1,y2,(lo+hi)/2);
}
