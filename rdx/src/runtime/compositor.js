import { PixelBuffer } from '../render/pixel-buffer.js';
import { effectiveMapDimensions, topologyTargetYs } from '../core/map-topology.js';

export class RdxCompositor {
  constructor({ mapDecoder, spriteDecoder }) {
    this.mapDecoder = mapDecoder;
    this.spriteDecoder = spriteDecoder;
  }

  renderMap(mapId, palette, options = {}) {
    const topology = options.topology || options.viewport?.mapping?.rdxTopology || null;
    const dimensions = effectiveMapDimensions(this.mapDecoder.dimensions(mapId), topology);
    const viewport = options.viewport || { x: 0, y: 0, width: dimensions.width, height: dimensions.height };
    const phase = options.phase ?? 0;
    const background = this.mapDecoder.renderPlane(mapId, palette, { plane: 'B', phase, viewport, topology });
    const output = background.pixels;
    const actorMetrics = { mode: options.actorMode || 'none', spawned: 0, drawn: 0, unresolved: 0, placementModes: {} };

    if ((options.actorMode || 'none') !== 'none') {
      const spawns = this.spriteDecoder.parseMaSpawns(mapId);
      const allowlist = options.actorAllowlist ? new Set(options.actorAllowlist) : null;
      for (const spawn of spawns) {
        actorMetrics.spawned += 1;
        if (actorMetrics.mode === 'allowlist' && (!allowlist || !allowlist.has(spawn.actorId))) continue;
        const frame = this.spriteDecoder.actorFrame(spawn.actorId, phase, palette, { mirrorX: false });
        if (!frame) {
          actorMetrics.unresolved += 1;
          continue;
        }
        const anchor = this.spriteDecoder.placementAnchor(frame, spawn.actorId);
        const targetYs = topologyTargetYs(topology, Number(spawn.y));
        const effectiveY = targetYs.length ? Number(targetYs[0]) : Number(spawn.y);
        const x = Math.round(spawn.x - anchor.x - viewport.x);
        const y = Math.round(effectiveY - anchor.y - viewport.y);
        output.blit(frame.pixels, x, y);
        actorMetrics.drawn += 1;
        actorMetrics.placementModes[anchor.mode] = (actorMetrics.placementModes[anchor.mode] || 0) + 1;
      }
    }

    const foreground = this.mapDecoder.renderPlane(mapId, palette, { plane: 'A', phase, viewport, topology });
    output.blit(foreground.pixels, 0, 0);
    return {
      pixels: output,
      metrics: {
        drawOrder: ['plane-b', 'actors', 'plane-a'],
        background: background.metrics,
        actors: actorMetrics,
        foreground: foreground.metrics
      }
    };
  }

  renderMappedSubmap(mapping, submap, palette, options = {}) {
    const viewport = mapping.viewportForSubmap(submap, options);
    if (!viewport) return null;
    return {
      viewport,
      ...this.renderMap(viewport.mapId, palette, { ...options, viewport })
    };
  }
}
