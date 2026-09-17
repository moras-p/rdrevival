import { RdxVisualState } from './state.js';

/**
 * Deterministic visual adapter boundary intended to mirror the later C API.
 * xrick supplies submap, canonical reachable-layout camera position, and semantic entity actions.
 */
export class RdxRuntimeAdapter {
  constructor({ mapping, compositor, palettes, mapDecoder, state = new RdxVisualState() }) {
    this.mapping = mapping;
    this.compositor = compositor;
    this.palettes = palettes;
    this.mapDecoder = mapDecoder;
    this.state = state;
  }

  setCamera({ submap, canonicalX = 0, canonicalY = 0, width = 256, height = 192 }) {
    this.state.submap = submap;
    this.state.canonicalX = canonicalX;
    this.state.canonicalY = canonicalY;
    this.state.viewportWidth = width;
    this.state.viewportHeight = height;
  }

  step() {
    const level = this.mapping.levelForSubmap(this.state.submap);
    const phases = level ? this.mapDecoder.phaseCount(level.rdxMd) : 1;
    this.state.step({ miPhaseCount: phases || 1 });
  }

  render() {
    const level = this.mapping.levelForSubmap(this.state.submap);
    if (!level) return null;
    return this.compositor.renderMappedSubmap(this.mapping, this.state.submap, this.palettes.forMap(level.rdxMd).rgba, {
      canonicalX: this.state.canonicalX,
      canonicalY: this.state.canonicalY,
      width: this.state.viewportWidth,
      height: this.state.viewportHeight,
      phase: this.state.miPhase,
      actorMode: this.state.decorativeActors ? 'all' : 'none'
    });
  }

  resolveEntityAction(assetKey, role) {
    return this.mapping.resolveAction(assetKey, role);
  }

  saveState() {
    return this.state.serialize();
  }

  loadState(bytes) {
    this.state = RdxVisualState.deserialize(bytes);
  }
}
