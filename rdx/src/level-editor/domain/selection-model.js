export function selectionKey(item) {
  if (!item || typeof item !== 'object') throw new TypeError('Selection item must be an object');
  const kind = String(item.kind || '').trim();
  const id = String(item.id || '').trim();
  if (!kind || !id) throw new TypeError('Selection item requires kind and id');
  return `${kind}:${id}`;
}

function freezeItem(item) {
  selectionKey(item);
  return Object.freeze({ ...item, kind: String(item.kind), id: String(item.id) });
}

export class SelectionModel {
  constructor() {
    this.items = [];
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(reason) {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot, reason);
  }

  snapshot() { return Object.freeze([...this.items]); }
  primary() { return this.items[0] || null; }
  has(item) { const key = selectionKey(item); return this.items.some(row => selectionKey(row) === key); }

  set(items, reason = 'set') {
    const seen = new Set();
    this.items = [];
    for (const item of items || []) {
      const key = selectionKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      this.items.push(freezeItem(item));
    }
    this.emit(reason);
    return this.snapshot();
  }

  add(item, reason = 'add') {
    if (this.has(item)) return this.snapshot();
    this.items.push(freezeItem(item));
    this.emit(reason);
    return this.snapshot();
  }

  remove(item, reason = 'remove') {
    const key = selectionKey(item);
    const next = this.items.filter(row => selectionKey(row) !== key);
    if (next.length === this.items.length) return this.snapshot();
    this.items = next;
    this.emit(reason);
    return this.snapshot();
  }

  toggle(item) { return this.has(item) ? this.remove(item, 'toggle-off') : this.add(item, 'toggle-on'); }
  clear(reason = 'clear') { if (this.items.length) this.set([], reason); }
}
