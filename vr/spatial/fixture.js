/** Recorded SM00 native evidence, for optional desktop audition only.
 * Not injected into the C event ring or the live game input timeline.
 * RDX coords: Revival room0, MD0003; supported foot x192..247/y223,
 * boulder mark1 x236/y223, enemy mark2 x52/y373.
 * The boulder was activated with the headless scenario trigger override;
 * enemy death was invoked through the native zombie transition after actor
 * mark2 was activated by the native camera. Neither is a player playthrough. */
export const SM00_SPATIAL_REPLAY = Object.freeze([
  {atMs:0,kind:'player.footstep',x:192,y:223,actor:0,mark:null},
  {atMs:210,kind:'player.footstep',x:208,y:223,actor:0,mark:null},
  {atMs:420,kind:'player.footstep',x:222,y:223,actor:0,mark:null},
  {atMs:630,kind:'player.footstep',x:238,y:223,actor:0,mark:null},
  {atMs:840,kind:'player.footstep',x:247,y:223,actor:0,mark:null},
  {atMs:1150,kind:'world.boulder.impact',x:236,y:223,actor:4,mark:1},
  {atMs:1650,kind:'enemy.died',x:52,y:373,actor:9,mark:2}
]);

export function replaySpatialMessage(item, serial) {
  return {type:'event',event:{version:2,generation:-1,serial,tick:serial,
    submap:0,experience:'revival',kind:item.kind,
    coordinateSpace:'rdx-world',supportedContact:item.kind!=='enemy.died',
    world:{x:item.x,y:item.y},source:{actorSlot:item.actor,mark:item.mark}}};
}
