import { RdxError } from '../core/errors.js';

const STATE_SCHEMA = 'rdx.visual_state.v1';

export class RdxVisualState {
  constructor(values = {}) {
    this.schema = STATE_SCHEMA;
    this.submap = values.submap ?? 0;
    this.canonicalX = values.canonicalX ?? 0;
    this.canonicalY = values.canonicalY ?? 0;
    this.viewportWidth = values.viewportWidth ?? 256;
    this.viewportHeight = values.viewportHeight ?? 192;
    this.frame = values.frame ?? 0;
    this.miPhase = values.miPhase ?? 0;
    this.decorativeActors = values.decorativeActors ?? false;
    this.paletteState = values.paletteState ?? null;
  }

  step({ miPhaseCount = 1 } = {}) {
    this.frame = (this.frame + 1) >>> 0;
    this.miPhase = miPhaseCount > 0 ? this.frame % miPhaseCount : 0;
    return this;
  }

  toJSON() {
    return {
      schema: this.schema,
      submap: this.submap,
      canonicalX: this.canonicalX,
      canonicalY: this.canonicalY,
      viewportWidth: this.viewportWidth,
      viewportHeight: this.viewportHeight,
      frame: this.frame,
      miPhase: this.miPhase,
      decorativeActors: this.decorativeActors,
      paletteState: this.paletteState
    };
  }

  serialize() {
    return new TextEncoder().encode(JSON.stringify(this.toJSON()));
  }

  static deserialize(bytes) {
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      throw new RdxError('STATE_PARSE', 'Invalid serialized RDX visual state', { cause: error.message });
    }
    if (parsed.schema !== STATE_SCHEMA) throw new RdxError('STATE_SCHEMA', `Unsupported state schema ${parsed.schema}`);
    return new RdxVisualState(parsed);
  }
}

export { STATE_SCHEMA };
