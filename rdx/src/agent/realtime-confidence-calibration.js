const clean=value=>value==null?'':String(value);
export function realtimeCalibrationKey({providerFamily,providerProfile,model,modelVersion,projection}={}) {
  return [providerFamily,providerProfile,model,modelVersion,projection].map(clean).join('\u001f');
}
function normalizeEntry(entry) {
  const threshold=Number(entry?.threshold);
  if(!Number.isFinite(threshold)||threshold<0||threshold>1) throw new Error('Realtime confidence calibration threshold must be within [0,1]');
  const identity={providerFamily:clean(entry.providerFamily),providerProfile:clean(entry.providerProfile),model:clean(entry.model),modelVersion:clean(entry.modelVersion),projection:clean(entry.projection)};
  if(Object.values(identity).some(value=>!value)) throw new Error('Realtime confidence calibration entries require provider family/profile, model/version and projection');
  return Object.freeze({...identity,threshold});
}
export function createRealtimeConfidenceCalibration({profile='uncalibrated',version='1',entries=[]}={}) {
  const normalized=(entries||[]).map(normalizeEntry); const byKey=new Map(normalized.map(entry=>[realtimeCalibrationKey(entry),entry]));
  return Object.freeze({
    metadata(){return Object.freeze({profile:String(profile),version:String(version)});},
    evaluate(decision,identity={}) {
      const confidence=decision?.confidence;
      if(confidence==null) return Object.freeze({calibrated:false,apply:true,reason:'confidence-absent',threshold:null,confidence:null});
      const numeric=Number(confidence); if(!Number.isFinite(numeric)) throw new Error('Realtime decision confidence must be finite');
      const entry=byKey.get(realtimeCalibrationKey(identity));
      if(!entry) return Object.freeze({calibrated:false,apply:true,reason:'uncalibrated',threshold:null,confidence:numeric});
      return Object.freeze({calibrated:true,apply:numeric>=entry.threshold,reason:numeric>=entry.threshold?'calibrated-accepted':'low-confidence',threshold:entry.threshold,confidence:numeric});
    },
    entries(){return [...normalized];}
  });
}
