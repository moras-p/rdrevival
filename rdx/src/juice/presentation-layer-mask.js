export const PRESENTATION_LAYERS = Object.freeze(['backdrop','midground','actors','foreground','frontActors','hud']);
export const PRESENTATION_LAYER_BITS = Object.freeze(Object.fromEntries(PRESENTATION_LAYERS.map((name,index)=>[name,1<<index])));
export const PRESENTATION_LAYER_MASK_ALL_GAMEPLAY = PRESENTATION_LAYER_BITS.backdrop|PRESENTATION_LAYER_BITS.midground|PRESENTATION_LAYER_BITS.actors|PRESENTATION_LAYER_BITS.foreground|PRESENTATION_LAYER_BITS.frontActors;
export const PRESENTATION_LAYER_MASK_ALL = PRESENTATION_LAYER_MASK_ALL_GAMEPLAY|PRESENTATION_LAYER_BITS.hud;
export const PRESENTATION_LAYER_MASK_PRESETS = Object.freeze({
  worldOnly:Object.freeze(['backdrop','midground','foreground']),
  behindActors:Object.freeze(['backdrop','midground']),
  inFrontOfActors:Object.freeze(['foreground','frontActors']),
  allGameplay:Object.freeze(['backdrop','midground','actors','foreground','frontActors']),
  everythingButMidground:Object.freeze(['backdrop','actors','foreground','frontActors']),
  sceneryWithoutMidground:Object.freeze(['backdrop','foreground'])
});

export function normalizePresentationLayerSelection(value, fallback=PRESENTATION_LAYER_MASK_PRESETS.allGameplay){
  const input=Array.isArray(value)?value:Array.isArray(fallback)?fallback:PRESENTATION_LAYER_MASK_PRESETS.allGameplay;
  const set=new Set(input.map(String));
  return Object.freeze(PRESENTATION_LAYERS.filter(layer=>set.has(layer)));
}
export function presentationLayerMaskBits(value, fallback=PRESENTATION_LAYER_MASK_PRESETS.allGameplay){
  if(Number.isInteger(Number(value))&&!Array.isArray(value))return Number(value)&PRESENTATION_LAYER_MASK_ALL;
  return normalizePresentationLayerSelection(value,fallback).reduce((mask,layer)=>mask|PRESENTATION_LAYER_BITS[layer],0);
}
export function presentationLayerMaskHas(mask,layer){return !!(presentationLayerMaskBits(mask,[]) & (PRESENTATION_LAYER_BITS[layer]||0));}
export function presentationLayerSelectionFromBits(mask){const bits=Number(mask)||0;return Object.freeze(PRESENTATION_LAYERS.filter(layer=>bits&PRESENTATION_LAYER_BITS[layer]));}
