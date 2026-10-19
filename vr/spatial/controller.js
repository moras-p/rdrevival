import { SpatialProjector, selectSpatialProfile } from './profile.js';

/** Read-only companion to the native event dispatcher; never touches input,
 * native game state, presentation canvas or the game scheduler. */
export class RoomSpatialController {
  constructor({audio, lampBridge, onEvent=()=>{}} = {}) {
    this.audio=audio;this.lampBridge=lampBridge;this.onEvent=onEvent;
    this.mode='inside';this.submap=-1;this.selection=null;this.projector=null;
    this.setLocation(0,'inside');
  }
  setLocation(submap,mode=this.mode) {
    if (submap===this.submap && mode===this.mode) return false;
    this.submap=submap;this.mode=mode;
    this.selection=selectSpatialProfile(submap,mode);
    this.projector=new SpatialProjector(this.selection);
    this.lampBridge?.setProjector(this.projector);
    this.audio?.clear();
    return true;
  }
  receive(message) {
    this.lampBridge?.receive(message);
    if (message?.type === 'reset' || message?.type === 'gap') {
      this.audio?.clear();return null;
    }
    const event=message?.event;
    if (!event) return null;
    // Never let a stale event from an earlier map re-select its room profile.
    if (event.submap !== this.submap) return null;
    const kind=this.projector.classify(event);
    if (!kind) return null;
    const point=this.projector.project(event.world);
    if (!point) return null;
    this.audio?.play(kind,point,this.selection.calibration);
    const observation={kind,source:event.source,rdx:event.world,room:point,
      generation:event.generation,serial:event.serial};
    this.onEvent(observation);
    return observation;
  }
  diagnostics() {return {id:this.selection.id,submap:this.submap,
    mapId:this.selection.data?.mapId ?? null,coordinateSpace:this.selection.coordinateSpace,
    calibration:this.selection.calibration};}
}
