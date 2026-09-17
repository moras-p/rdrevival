function assertCommand(command) {
  if (!command || typeof command !== 'object') throw new TypeError('Editor command must be an object');
  if (!String(command.id || '').trim()) throw new TypeError('Editor command requires a stable id');
  if (typeof command.execute !== 'function') throw new TypeError(`Editor command '${command.id}' requires execute(context)`);
  if (typeof command.undo !== 'function') throw new TypeError(`Editor command '${command.id}' requires undo(context)`);
  return command;
}

export function createEditorCommand({ id, label = id, execute, undo }) {
  return Object.freeze({ id: String(id), label: String(label || id), execute, undo });
}

export function createCompositeCommand({ id, label = id, commands = [] }) {
  const parts = commands.map(assertCommand);
  return createEditorCommand({
    id,
    label,
    execute(context) {
      const completed = [];
      try {
        for (const command of parts) {
          command.execute(context);
          completed.push(command);
        }
      } catch (error) {
        for (let index = completed.length - 1; index >= 0; index -= 1) completed[index].undo(context);
        throw error;
      }
    },
    undo(context) {
      for (let index = parts.length - 1; index >= 0; index -= 1) parts[index].undo(context);
    }
  });
}

export class CommandHistory {
  constructor({ limit = 100 } = {}) {
    this.limit = Math.max(1, Number(limit) || 100);
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(reason, command = null) {
    const state = this.state();
    for (const listener of this.listeners) listener(state, reason, command);
  }

  state() {
    return Object.freeze({
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      undoLabel: this.undoStack.at(-1)?.label || null,
      redoLabel: this.redoStack.at(-1)?.label || null
    });
  }

  execute(command, context) {
    const next = assertCommand(command);
    next.execute(context);
    this.undoStack.push(next);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit('execute', next);
    return next;
  }

  undo(context) {
    const command = this.undoStack.at(-1);
    if (!command) return false;
    command.undo(context);
    this.undoStack.pop();
    this.redoStack.push(command);
    this.emit('undo', command);
    return true;
  }

  redo(context) {
    const command = this.redoStack.at(-1);
    if (!command) return false;
    command.execute(context);
    this.redoStack.pop();
    this.undoStack.push(command);
    this.emit('redo', command);
    return true;
  }

  clear(reason = 'clear') {
    if (!this.undoStack.length && !this.redoStack.length) return;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit(reason, null);
  }
}
