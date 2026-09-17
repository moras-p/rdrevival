import { createEditorCommand } from '../domain/command-history.js';
import {
  REVIEWED_CORRECTIONS_SCHEMA,
  applyReviewedCorrections,
  correctionImpact,
  inspectReviewedCorrectionState,
  validateReviewedCorrection,
  validateReviewedCorrectionLedger
} from '../domain/reviewed-corrections.js';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function ledgerFor(room, corrections = []) {
  return { schema: REVIEWED_CORRECTIONS_SCHEMA, room:{ submap:Number(room.submap), mapId:Number(room.mapId) }, corrections:clone(corrections) };
}

export class CorrectionAuthoringService {
  constructor({ correctionRepository = null, history = null, resolveRoom = null } = {}) {
    this.correctionRepository = correctionRepository;
    this.history = history;
    this.resolveRoom = resolveRoom;
    this.room = null;
    this.persisted = null;
    this.working = null;
    this.proposals = new Map();
  }

  async openRoom(room) {
    this.room = room;
    this.persisted = this.correctionRepository ? await this.correctionRepository.getRoomCorrections(room) : ledgerFor(room);
    this.working = clone(this.persisted);
    this.proposals.clear();
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      roomId:this.room?.id || null,
      persisted:clone(this.persisted),
      working:clone(this.working),
      proposals:Object.freeze([...this.proposals.values()].map(clone))
    });
  }

  getRoomCorrections() { return clone(this.working || ledgerFor(this.room || { submap:0, mapId:0 })); }
  loadWorkingCorrections(ledger) {
    validateReviewedCorrectionLedger(ledger, { room:this.room, roomId:this.room?.id });
    this.working = clone(ledger);
    this.proposals.clear();
    return this.snapshot();
  }
  validateCorrection(correction) { return validateReviewedCorrection(correction, { room:this.room, roomId:this.room?.id }); }
  previewCorrection(correction) { return inspectReviewedCorrectionState(this.resolveReviewedRoom(), correction); }
  describeCorrectionImpact(correction) { return correctionImpact(correction); }
  resolveReviewedRoom() {
    const working = this.working || ledgerFor(this.room);
    if (JSON.stringify(working) === JSON.stringify(this.persisted)) return this.room;
    if ((this.persisted?.corrections || []).length === 0) return applyReviewedCorrections(this.room, working);
    if (this.resolveRoom) return this.resolveRoom(this.room, working);

    /* ResolvedLevel already contains the persisted reviewed ledger. For an
     * unsaved editor draft, project only added/replaced rows on top of that
     * effective room so the browser never double-applies canonical rows. A
     * persisted-row removal still needs the canonical room resolver because
     * it must reconstruct the pre-reviewed value. */
    const persistedById = new Map((this.persisted?.corrections || []).map(row => [String(row.id), row]));
    const workingById = new Map((working?.corrections || []).map(row => [String(row.id), row]));
    const removed = [...persistedById.keys()].filter(id => !workingById.has(id));
    if (removed.length) throw new Error(`Removing persisted reviewed corrections requires canonical promotion/reload (${removed.join(', ')})`);
    const delta = (working?.corrections || []).filter(row => JSON.stringify(row) !== JSON.stringify(persistedById.get(String(row.id)) || null))
      .map(row => { const next=clone(row); delete next.expected; return next; });
    if (!delta.length) return this.room;
    const resolved = applyReviewedCorrections(this.room, ledgerFor(this.room, delta));
    resolved.layers.reviewedCorrections = clone(working);
    resolved.provenance.reviewedCorrections = [
      ...(this.room?.provenance?.reviewedCorrections || []).map(clone),
      ...(resolved.provenance.reviewedCorrections || []).map(clone)
    ];
    return resolved;
  }

  _setProposal(id, correction) {
    if (correction == null) this.proposals.delete(id);
    else this.proposals.set(id, clone(correction));
  }

  _replaceWorking(corrections) {
    const next = ledgerFor(this.room, corrections);
    validateReviewedCorrectionLedger(next, { room:this.room, roomId:this.room.id });
    this.working = next;
  }

  _command(id, label, execute, undo) {
    return createEditorCommand({ id, label, execute:() => execute(), undo:() => undo() });
  }

  proposeCorrection(correction) {
    this.validateCorrection(correction);
    const previous = clone(this.proposals.get(correction.id) || null);
    const command = this._command(`correction.propose.${correction.id}`, `Propose ${correction.id}`,
      () => this._setProposal(correction.id, correction), () => this._setProposal(correction.id, previous));
    return this.history ? this.history.execute(command, this) : (command.execute(this), command);
  }

  modifyProposedCorrection(id, replacement) {
    if (!this.proposals.has(id)) throw new Error(`No proposed correction '${id}'`);
    this.validateCorrection(replacement);
    const previous = clone(this.proposals.get(id));
    const command = this._command(`correction.modify.${id}`, `Modify ${id}`,
      () => { this.proposals.delete(id); this._setProposal(replacement.id, replacement); },
      () => { this.proposals.delete(replacement.id); this._setProposal(id, previous); });
    return this.history ? this.history.execute(command, this) : (command.execute(this), command);
  }

  acceptCorrection(id) {
    const proposed = this.proposals.get(id);
    if (!proposed) throw new Error(`No proposed correction '${id}'`);
    const previousCorrections = clone(this.working.corrections);
    const previousProposal = clone(proposed);
    const command = this._command(`correction.accept.${id}`, `Accept ${id}`, () => {
      const next = this.working.corrections.filter(row => row.id !== id);
      next.push(clone(proposed));
      this._replaceWorking(next);
      this.proposals.delete(id);
    }, () => {
      this._replaceWorking(previousCorrections);
      this._setProposal(id, previousProposal);
    });
    return this.history ? this.history.execute(command, this) : (command.execute(this), command);
  }

  removeCorrection(id) {
    const previousCorrections = clone(this.working.corrections);
    if (!previousCorrections.some(row => row.id === id)) throw new Error(`No accepted correction '${id}'`);
    const command = this._command(`correction.remove.${id}`, `Remove ${id}`,
      () => this._replaceWorking(this.working.corrections.filter(row => row.id !== id)),
      () => this._replaceWorking(previousCorrections));
    return this.history ? this.history.execute(command, this) : (command.execute(this), command);
  }

  replaceCorrection(id, replacement) {
    this.validateCorrection(replacement);
    const previousCorrections = clone(this.working.corrections);
    if (!previousCorrections.some(row => row.id === id)) throw new Error(`No accepted correction '${id}'`);
    const command = this._command(`correction.replace.${id}`, `Replace ${id}`,
      () => this._replaceWorking(this.working.corrections.map(row => row.id === id ? clone(replacement) : row)),
      () => this._replaceWorking(previousCorrections));
    return this.history ? this.history.execute(command, this) : (command.execute(this), command);
  }

  async saveRoomCorrections() {
    if (!this.correctionRepository) throw new Error('No correction repository configured');
    await this.correctionRepository.saveRoomCorrections(this.room, this.working);
    this.persisted = clone(this.working);
    return clone(this.persisted);
  }
}
