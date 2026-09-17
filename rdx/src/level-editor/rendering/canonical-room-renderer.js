import { PreviewRenderer } from '../../preview/preview-renderer.js';
import { EDITOR_PROJECTION_SCHEMA } from '../../levels/resolved-level.js';

/**
 * Canonical Level Editor effective-room rendering seam.
 *
 * Any browser surface that claims to show the maintained Level Editor's
 * effective RDX room must enter through this module.  Structural inspection
 * projectors deliberately have a different contract and are not a substitute
 * for production-pixel reconstruction.
 */
function requireEffectiveResources(resources) {
  if (!resources || typeof resources !== 'object')
    throw new Error('Canonical Level Editor rendering requires loaded preview resources');
  if (resources.productionScene?.schema !== EDITOR_PROJECTION_SCHEMA)
    throw new Error(`Canonical Level Editor rendering requires ${EDITOR_PROJECTION_SCHEMA} productionScene`);
  if (!resources.mapDecoder || !resources.spriteDecoder || !resources.paletteRegistry || !resources.mapping)
    throw new Error('Canonical Level Editor rendering requires the shared map/sprite/palette/mapping resources');
  return resources;
}

export function createCanonicalLevelEditorPreviewRenderer(resources) {
  return new PreviewRenderer(requireEffectiveResources(resources));
}

export function createDecodedRdxPreviewRenderer(resources) {
  if (!resources?.mapDecoder || !resources?.spriteDecoder || !resources?.paletteRegistry || !resources?.mapping)
    throw new Error('Decoded RDX rendering requires map/sprite/palette/mapping resources');
  const renderer = new PreviewRenderer(resources);
  renderer.setSystemModificationsEnabled(false);
  return renderer;
}

export class CanonicalLevelEditorRoomRenderer {
  constructor({ resourcesProvider } = {}) {
    if (typeof resourcesProvider !== 'function')
      throw new TypeError('CanonicalLevelEditorRoomRenderer requires resourcesProvider()');
    this.resourcesProvider = resourcesProvider;
    this.resources = null;
    this.renderer = null;
  }

  #currentRenderer() {
    const resources = requireEffectiveResources(this.resourcesProvider());
    if (resources !== this.resources) {
      this.resources = resources;
      this.renderer = createCanonicalLevelEditorPreviewRenderer(resources);
    }
    return { resources, renderer:this.renderer };
  }

  frameForSubmap(submap, { tick = 0, mapId = null, activateAllTraps = false } = {}) {
    const { resources, renderer } = this.#currentRenderer();
    const room = (resources.productionScene.rooms || []).find(row => Number(row.submap) === Number(submap));
    if (!room) throw new Error(`No canonical Level Editor production room for submap ${submap}`);
    const effectiveMapId = Number(mapId ?? room.mapId);
    renderer.select({ submap:Number(submap), mapId:effectiveMapId, visualSource:'rdx', spriteSource:'rdx', missingPolicy:'red' });
    renderer.setActivateAllTraps(activateAllTraps === true);
    const phase = Math.max(0, Number(tick) || 0);
    const staticLayers = renderer.staticLayers(renderer.staticPhaseAtTick(phase));
    const dynamic = renderer.dynamicFrame(phase);
    return Object.freeze({
      submap:Number(submap),
      mapId:effectiveMapId,
      tick:phase,
      dimensions:Object.freeze({ ...renderer.selection.dimensions }),
      backdrop:staticLayers.backdrop || staticLayers.background,
      midground:staticLayers.midground || staticLayers.foregroundBehindActors,
      background:staticLayers.backdrop || staticLayers.background,
      foregroundBehindActors:staticLayers.midground || staticLayers.foregroundBehindActors,
      embeddedActors:dynamic.behindMidgroundPixels,
      actors:dynamic.pixels,
      foreground:staticLayers.foreground,
      frontActors:dynamic.frontPixels,
      selectables:dynamic.selectables,
      productionRoom:room,
      authority:'ResolvedLevel + PreviewRenderer canonical Level Editor presentation'
    });
  }
}
