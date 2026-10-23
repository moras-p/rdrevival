import { SpatialProjector, selectSpatialProfile } from './profile.js';

const DEFAULT_TICK_SECONDS = 1 / 25; // the 1x gameplay rate; measured from the boulder's own events
const MAX_EXTRAPOLATION_S = 1.2;      // a lost update never carries a sound off across the map
const LOST_ROLL_S = 4;

/** Read-only companion to the native event dispatcher; never touches input,
 * native game state, presentation canvas or the game scheduler. */
export class RoomSpatialController {
  constructor({audio, lampBridge, onEvent=()=>{}, now=()=>globalThis.performance?.now?.() ?? 0} = {}) {
    this.audio=audio;this.lampBridge=lampBridge;this.onEvent=onEvent;this.now=now;
    this.mode='inside';this.submap=-1;this.selection=null;this.projector=null;
    this.rolls=new Map();this.tickSeconds=DEFAULT_TICK_SECONDS;
    this.setLocation(0,'inside');
  }
  setLocation(submap,mode=this.mode) {
    if (submap===this.submap && mode===this.mode) return false;
    this.submap=submap;this.mode=mode;
    this.selection=selectSpatialProfile(submap,mode);
    this.projector=new SpatialProjector(this.selection);
    this.lampBridge?.setProjector(this.projector);
    this.#stopRolls();
    this.audio?.clear();
    return true;
  }
  receive(message) {
    this.lampBridge?.receive(message);
    if (message?.type === 'reset' || message?.type === 'gap') {
      this.#stopRolls();this.audio?.clear();return null;
    }
    const event=message?.event;
    if (!event) return null;
    // Never let a stale event from an earlier map re-select its room profile.
    if (event.submap !== this.submap) return null;
    const kind=this.projector.classify(event);
    if (!kind) return null;
    const point=this.projector.project(event.world);
    if (!point) return null;
    if (kind==='roll') this.#roll(event,point,message.observedAt ?? this.now());
    else this.audio?.play(kind,point,this.selection.calibration);
    const observation={kind,source:event.source,rdx:event.world,room:point,
      generation:event.generation,serial:event.serial};
    this.onEvent(observation);
    return observation;
  }
  /** The boulder reports only changes of direction or speed; between them it
   * moves on in a straight line at the last reported velocity. */
  #roll(event,point,at) {
    const id=event.source?.actorSlot ?? 0, previous=this.rolls.get(id);
    if (previous && event.generation===previous.generation && event.tick>previous.tick) {
      const measured=(at-previous.at)/1000/(event.tick-previous.tick);
      if (measured>1/120 && measured<1/10) this.tickSeconds+=0.5*(measured-this.tickSeconds);
    }
    const {dx,dy}=event.velocity;
    if (!dx && !dy) {
      this.rolls.delete(id);this.audio?.stopLoop?.(id);return;
    }
    this.rolls.set(id,{generation:event.generation,tick:event.tick,at,world:{...event.world},dx,dy,point});
    if (!previous) this.audio?.startLoop?.(id,'roll',point,this.selection.calibration);
  }
  /** Per frame: where each rolling boulder is now, in room metres, with its speed (0..1). */
  update(now=this.now()) {
    const active=[];
    for (const [id,roll] of this.rolls) {
      const elapsed=(now-roll.at)/1000;
      if (elapsed>LOST_ROLL_S) {this.rolls.delete(id);this.audio?.stopLoop?.(id);continue;}
      const ticks=Math.min(elapsed,MAX_EXTRAPOLATION_S)/this.tickSeconds;
      const point=this.projector.project({x:roll.world.x+roll.dx*ticks,y:roll.world.y+roll.dy*ticks});
      if (!point) continue;
      const intensity=Math.min(1,Math.hypot(roll.dx,roll.dy)/8);
      this.audio?.updateLoop?.(id,point,intensity);
      active.push({id,point,intensity,falling:roll.dy>0});
    }
    return active;
  }
  #stopRolls() {
    for (const id of this.rolls.keys()) this.audio?.stopLoop?.(id);
    this.rolls.clear();
  }
  diagnostics() {return {id:this.selection.id,submap:this.submap,
    mapId:this.selection.data?.mapId ?? null,coordinateSpace:this.selection.coordinateSpace,
    calibration:this.selection.calibration};}
}
