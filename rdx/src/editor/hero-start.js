import { resolvedPlayerEntryContact } from '../levels/player-entry-authority.js';

function finitePoint(value) {
  return Array.isArray(value) && value.length >= 2 &&
    Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

export function resolvedClassicHeroStart(resolvedRoom) {
  const player = resolvedRoom?.layers?.semanticCorpus?.objects?.find(object =>
    String(object?.presentation?.runtimeRole || object?.class || '') === 'player' ||
    String(object?.sources?.rdx?.sourceKey || '') === 'player');
  const contact = resolvedPlayerEntryContact(player?.playerEntry);
  if (!finitePoint(contact)) return null;
  return { x:Number(contact[0]), y:Number(contact[1]) };
}

/* Native restart anchors and resolved editor checkpoints share one phase-zero
 * contract. Castle/Missile rows are generated from reviewed xrick direct-entry
 * evidence; older Jungle/Egypt rows retain their ROM initializer authority. */
export function productionHeroStart({ room, bridge = null, resolvedRoom = null } = {}) {
  const anchor = bridge?.scorpionEntryAnchor?.(room?.mapId, room?.submap);
  if (anchor && Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y))) {
    return { x:Number(anchor.x), y:Number(anchor.y) };
  }
  return resolvedClassicHeroStart(resolvedRoom) || { x:40, y:80 };
}
