function normalizeLayer(layer) {
  if (!layer || typeof layer !== 'object') throw new TypeError('Render layer must be an object');
  if (!String(layer.id || '').trim()) throw new TypeError('Render layer requires an id');
  if (typeof layer.render !== 'function') throw new TypeError(`Render layer '${layer.id}' requires render(context, frame)`);
  return {
    ...layer,
    id: String(layer.id),
    order: Number.isFinite(Number(layer.order)) ? Number(layer.order) : 0,
    visible: typeof layer.visible === 'function' ? layer.visible : layer.visible !== false
  };
}

export class RenderLayerStack {
  constructor() { this.layers = new Map(); }

  register(layer) {
    const normalized = normalizeLayer(layer);
    if (this.layers.has(normalized.id)) throw new Error(`Render layer '${normalized.id}' is already registered`);
    this.layers.set(normalized.id, normalized);
    return () => this.layers.delete(normalized.id);
  }

  setVisible(id, visible) {
    const layer = this.layers.get(String(id));
    if (!layer) throw new Error(`Unknown render layer '${id}'`);
    layer.visible = !!visible;
  }

  ordered() {
    return [...this.layers.values()].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  }

  render(context, frame = {}) {
    const results = [];
    for (const layer of this.ordered()) {
      const visible = typeof layer.visible === 'function' ? !!layer.visible(frame) : layer.visible !== false;
      if (!visible) continue;
      results.push({ id: layer.id, result: layer.render(context, frame) });
    }
    return results;
  }
}
