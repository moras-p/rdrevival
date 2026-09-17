import { CommandHistory } from '../domain/command-history.js';
import { SelectionModel } from '../domain/selection-model.js';
import { ViewportModel } from '../domain/viewport-model.js';

const PRESENTATIONS = new Set(['rdx', 'classic', 'compare']);
const SOURCE_VIEWS = new Set(['effective', 'raw-rdx']);

export class EditorSession {
  constructor({ repository, runtime = null, history = null, selection = null, viewport = null } = {}) {
    if (!repository) throw new TypeError('EditorSession requires a level-data repository');
    this.repository = repository;
    this.runtime = runtime;
    this.history = history || new CommandHistory();
    this.selection = selection || new SelectionModel();
    this.viewport = viewport || new ViewportModel();
    this.listeners = new Set();
    this.openGeneration = 0;
    this.state = {
      room: null,
      roomList: [],
      presentation: 'rdx',
      sourceView: 'effective',
      loading: false,
      error: null
    };
    this.history.subscribe(() => this.emit('history'));
    this.selection.subscribe(() => this.emit('selection'));
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(reason) { const snapshot = this.snapshot(); for (const listener of this.listeners) listener(snapshot, reason); }
  snapshot() { return Object.freeze({ ...this.state, roomList: Object.freeze([...this.state.roomList]), selection: this.selection.snapshot(), history: this.history.state(), viewport: this.viewport.snapshot() }); }

  async initialize() {
    this.state.loading = true;
    this.emit('loading');
    try {
      this.state.roomList = await this.repository.listRooms();
      this.state.error = null;
      this.emit('room-list');
      return this.snapshot();
    } catch (error) {
      this.state.error = error;
      this.emit('error');
      throw error;
    } finally {
      this.state.loading = false;
      this.emit('loaded');
    }
  }

  async openRoom(submap) {
    const generation = ++this.openGeneration;
    this.state.loading = true;
    this.emit('loading-room');
    try {
      const room = await this.repository.roomStaticModel(submap);
      if (generation !== this.openGeneration) return null;
      this.state.room = room;
      this.state.error = null;
      this.selection.clear('room-change');
      this.history.clear('room-change');
      this.emit('room-opened');
      return room;
    } catch (error) {
      if (generation !== this.openGeneration) return null;
      this.state.error = error;
      this.emit('error');
      throw error;
    } finally {
      if (generation === this.openGeneration) {
        this.state.loading = false;
        this.emit('loaded-room');
      }
    }
  }

  setPresentation(mode) {
    const next = String(mode);
    if (!PRESENTATIONS.has(next)) throw new Error(`Unknown presentation '${mode}'`);
    if (this.state.presentation === next) return;
    this.state.presentation = next;
    this.emit('presentation');
  }

  setSourceView(mode) {
    const next = String(mode);
    if (!SOURCE_VIEWS.has(next)) throw new Error(`Unknown source view '${mode}'`);
    if (this.state.sourceView === next) return;
    this.state.sourceView = next;
    this.emit('source-view');
  }

  execute(command) { const result = this.history.execute(command, this); this.emit('command'); return result; }
  undo() { const changed = this.history.undo(this); if (changed) this.emit('undo'); return changed; }
  redo() { const changed = this.history.redo(this); if (changed) this.emit('redo'); return changed; }
}
