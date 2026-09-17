export function updateDraftToolbar(ui,snapshot,changeCount=0){
  if(!snapshot)return;
  ui.undo.disabled=!snapshot.history?.canUndo;ui.redo.disabled=!snapshot.history?.canRedo;
  ui.undo.title=snapshot.history?.undoLabel?`Undo ${snapshot.history.undoLabel}`:'Undo';ui.redo.title=snapshot.history?.redoLabel?`Redo ${snapshot.history.redoLabel}`:'Redo';
  ui.discardDraft.disabled=!snapshot.dirty;ui.draftState.textContent=snapshot.dirty?`Working draft · ${changeCount} change${changeCount===1?'':'s'}`:'Canonical';
  ui.draftState.classList.toggle('dirty',!!snapshot.dirty);
}
