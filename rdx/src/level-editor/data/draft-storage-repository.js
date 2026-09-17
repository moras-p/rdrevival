export const WORKSPACE_DRAFT_SCHEMA = 'rdr.level_editor.workspace_draft.v1';
const DEFAULT_PREFIX = 'rdr.level-editor.workspace-draft.';

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export class DraftStorageRepository {
  constructor({ storage = defaultStorage(), keyPrefix = DEFAULT_PREFIX } = {}) {
    this.storage = storage || null;
    this.keyPrefix = String(keyPrefix || DEFAULT_PREFIX);
  }
  key(roomId) { return `${this.keyPrefix}${String(roomId)}`; }
  async get(roomId) {
    if (!this.storage) return null;
    const key = this.key(roomId), text = this.storage.getItem(key);
    if (!text) return null;
    try {
      const value = JSON.parse(text);
      return value?.schema === WORKSPACE_DRAFT_SCHEMA ? value : null;
    } catch {
      try { this.storage.removeItem(key); } catch {}
      return null;
    }
  }
  async put(roomId, draft) {
    if (draft?.schema !== WORKSPACE_DRAFT_SCHEMA) throw new Error(`Expected ${WORKSPACE_DRAFT_SCHEMA}`);
    if (String(draft?.room?.id || '') !== String(roomId)) throw new Error(`Draft room ${draft?.room?.id || 'missing'} does not match ${roomId}`);
    if (this.storage) this.storage.setItem(this.key(roomId), JSON.stringify(draft));
    return draft;
  }
  async remove(roomId) { if (this.storage) this.storage.removeItem(this.key(roomId)); }
}
