import { isNativeProjectileActive, isNativeProjectileEntity, nativeProjectileInstanceKey } from './runtime-projectiles.js';

/**
 * Session-local Level Editor view of native xrick runtime state.
 *
 * This module deliberately does not synthesize gameplay. It only converts
 * native entity/presentation snapshots into source-keyed samples, records a
 * finite in-memory history, and marks a cycle only when the native motion
 * state itself closes after movement. Nothing produced here is persisted as
 * production level data.
 */

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function sourceKeyForEntity(entity) {
  /* xrick reserves slot 1/entity 1 for Rick. Production RDX presentation uses
   * the semantic `player` identity rather than the Classic source mark 0. */
  if (int(entity?.slot, -1) === 1 && int(entity?.n, -1) === 1) return 'player';
  const mark = int(entity?.mark, -1);
  return mark >= 0 ? `mark:${mark}` : `slot:${int(entity?.slot, -1)}`;
}

/* xrick type-1 enemy families keep horizontal intent in c1, while type-2
 * enemies reserve c1 for climb state and keep horizontal intent in c2.  The
 * Level Editor projects that native semantic direction; it must not infer
 * facing from presentation pixels or displacement. */
const TYPE2_ENEMY_NUMBERS = Object.freeze(new Set([0x06, 0x09, 0x0c, 0x0f]));
/* Mirrors native rdx_present_internal.h MAX_RUNTIME_SLOTS = ENT_ENTSNUM + 1.
 * xrick_rdx_get_entity_count() only reports the currently loaded contiguous
 * entity prefix, so snapshot.entities.length cannot be used as this offset. */
const RDX_PRESENT_RUNTIME_SLOTS = 0x10;

function enemyDirection(entity) {
  const n = int(entity?.n) & 0x7f;
  const intent = int(TYPE2_ENEMY_NUMBERS.has(n) ? entity?.c2 : entity?.c1);
  return intent < 0 ? 'left' : intent > 0 ? 'right' : 'neutral';
}

export function editorRickPhaseZeroPresentation(playerContact, simulation) {
  if (!playerContact || !Array.isArray(simulation?.origin) || !Array.isArray(simulation?.draw)) return null;
  /* The whole-room editor's heroStart is already the authored world contact.
   * A camera/presenter screen-origin residual does not belong in this world
   * coordinate space. Applying the native +8 screen residual here made Rick
   * appear eight pixels inside the floor whenever Simulate was enabled. Keep
   * the resolved PN anchor, but anchor it directly at the authored contact. */
  const contact = Object.freeze([int(playerContact.x), int(playerContact.y)]);
  const origin = contact;
  const anchor = [
    int(simulation.origin[0]) - int(simulation.draw[0]),
    int(simulation.origin[1]) - int(simulation.draw[1])
  ];
  const draw = Object.freeze([origin[0] - anchor[0], origin[1] - anchor[1]]);
  return Object.freeze({ contact, origin, draw, anchor: Object.freeze(anchor),
    authority: 'editor-authored-player-contact+resolved-rick-presentation-anchor' });
}

function presentationBySlot(items) {
  return new Map((items || []).map(item => [int(item?.slot, -1), item]));
}

function motionSignature(sample) {
  const e = sample.nativeEntity || {};
  return [
    int(e.x), int(e.y), int(e.c1), int(e.c2), int(e.sprite), int(e.sprbase), int(e.offsy),
    int(e.flags), int(e.projectileActiveUpdates), int(e.projectileCooldownFrames),
    int(sample.pn), sample.mirrorX ? 1 : 0, sample.mirrorY ? 1 : 0,
    sample.visible === false ? 0 : 1
  ].join(':');
}

function movedBetween(samples, start, end) {
  const first = samples[start];
  if (!first) return false;
  const x = int(first.origin?.[0]), y = int(first.origin?.[1]);
  for (let i = start + 1; i <= end; i += 1) {
    if (int(samples[i]?.origin?.[0]) !== x || int(samples[i]?.origin?.[1]) !== y) return true;
  }
  return false;
}

export function nativeRuntimeStates(snapshot, presentationItems = snapshot?.presentation || []) {
  const audits = presentationBySlot(presentationItems);
  const cameraOffsetY = int(snapshot?.cameraOffsetPx);
  const nativePlayer = snapshot?.collision?.native || {};
  const states = new Map();
  for (const entity of snapshot?.entities || []) {
    const slot = int(entity?.slot, -1);
    if (slot < 0) continue;
    const audit = audits.get(slot) || null;
    const sourceKey = sourceKeyForEntity(entity);
    const origin = audit
      ? [int(audit.originX), int(audit.originY)]
      : [int(entity.x), int(entity.y)];
    const draw = audit
      ? [int(audit.drawX), int(audit.drawY)]
      : origin.slice();
    const sample = Object.freeze({
      sourceKey,
      slot,
      phase: 0,
      duration: 1,
      tick: int(audit?.tick, int(snapshot?.frameSerial)),
      frameSerial: int(snapshot?.frameSerial),
      origin: Object.freeze(origin),
      draw: Object.freeze(draw),
      classicDraw: Object.freeze([int(entity.x), int(entity.y)]),
      cameraNeutralOrigin: Object.freeze([origin[0], origin[1] + cameraOffsetY]),
      cameraNeutralDraw: Object.freeze([draw[0], draw[1] + cameraOffsetY]),
      cameraNeutralClassicDraw: Object.freeze([int(entity.x), int(entity.y) + cameraOffsetY]),
      classicControllerDisplacement: Object.freeze([
        int(entity.x) - int(entity.xsave),
        int(entity.y) - int(entity.ysave)
      ]),
      cameraOffsetY,
      playerWorldContact: sourceKey === 'player' && Number.isFinite(Number(nativePlayer.playerWorldX)) && Number.isFinite(Number(nativePlayer.playerWorldY))
        ? Object.freeze([int(nativePlayer.playerWorldX), int(nativePlayer.playerWorldY)]) : null,
      anchor: Object.freeze([origin[0] - draw[0], origin[1] - draw[1]]),
      size: Object.freeze([int(audit?.width, int(entity.w, 16)), int(audit?.height, int(entity.h, 16))]),
      pn: audit ? int(audit.pn) : null,
      actorId: audit ? int(audit.actorId) : null,
      mirrorX: !!audit?.mirrorX,
      mirrorY: !!audit?.mirrorY,
      front: audit ? !!audit.front : !!entity.front,
      visible: audit ? int(audit.visiblePixels) > 0 : true,
      presentationAudited: !!audit,
      sprite: int(entity.sprite),
      direction: enemyDirection(entity),
      nativeEntity: Object.freeze({
        slot, n: int(entity.n), mark: int(entity.mark), x: int(entity.x), y: int(entity.y),
        xsave: int(entity.xsave), ysave: int(entity.ysave),
        sprite: int(entity.sprite), sprbase: int(entity.sprbase), offsy: int(entity.offsy),
        flags: int(entity.flags), c1: int(entity.c1), c2: int(entity.c2), mapped: int(entity.mapped, 1),
        projectileActive: entity.projectileActive == null ? null : !!entity.projectileActive,
        projectileGeneration: int(entity.projectileGeneration),
        projectileActiveUpdates: int(entity.projectileActiveUpdates),
        projectileCooldownFrames: int(entity.projectileCooldownFrames)
      }),
      authority: 'native-xrick-live-state'
    });
    states.set(sourceKey, sample);
  }
  /* Rolling Revival explosions are presentation-owned instances, not xrick
   * entities. Native rdx_present assigns them a synthetic slot equal to the
   * source entity slot + MAX_RUNTIME_SLOTS. Preserve every audit item instead
   * of collapsing those same-slot instances into the source actor or dropping
   * them entirely; the Level Editor then renders the exact native age/position
   * while gameplay authority remains on the source entity. */
  const runtimeSlots = RDX_PRESENT_RUNTIME_SLOTS;
  if ((snapshot?.entities || []).length > 0) {
    const entitiesBySlot = new Map((snapshot.entities || []).map(entity => [int(entity?.slot, -1), entity]));
    for (let index = 0; index < (presentationItems || []).length; index += 1) {
      const audit = presentationItems[index];
      const slot = int(audit?.slot, -1);
      if (slot < runtimeSlots || slot >= runtimeSlots * 2 || int(audit?.pn, -1) !== 41) continue;
      const sourceSlot = slot - runtimeSlots;
      const sourceEntity = entitiesBySlot.get(sourceSlot) || null;
      const sourceMark = int(sourceEntity?.mark, -1);
      if (sourceMark < 0) continue;
      const parentSourceKey = `mark:${sourceMark}`;
      const sourceKey = `${parentSourceKey}:explosion:${index}`;
      const origin = [int(audit.originX), int(audit.originY)];
      const draw = [int(audit.drawX), int(audit.drawY)];
      states.set(sourceKey, Object.freeze({
        sourceKey, parentSourceKey, slot, sourceSlot,
        phase: 0, duration: 1,
        tick: int(audit.tick), frameSerial: int(snapshot?.frameSerial),
        origin: Object.freeze(origin), draw: Object.freeze(draw),
        classicDraw: Object.freeze([int(sourceEntity?.x), int(sourceEntity?.y)]),
        cameraNeutralOrigin: Object.freeze([origin[0], origin[1] + cameraOffsetY]),
        cameraNeutralDraw: Object.freeze([draw[0], draw[1] + cameraOffsetY]),
        cameraOffsetY,
        anchor: Object.freeze([origin[0] - draw[0], origin[1] - draw[1]]),
        size: Object.freeze([int(audit.width, 32), int(audit.height, 28)]),
        pn: 41, actorId: int(audit.actorId, 0xff),
        mirrorX: !!audit.mirrorX, mirrorY: !!audit.mirrorY, front: !!audit.front,
        visible: int(audit.visiblePixels) > 0,
        presentationAudited: true,
        presentationOnlyExplosion: true,
        presentationInstanceIndex: index,
        sprite: int(sourceEntity?.sprite),
        direction: enemyDirection(sourceEntity),
        nativeEntity: sourceEntity ? Object.freeze({
          slot: sourceSlot, n: int(sourceEntity.n), mark: sourceMark,
          x: int(sourceEntity.x), y: int(sourceEntity.y), sprite: int(sourceEntity.sprite),
          c1: int(sourceEntity.c1), c2: int(sourceEntity.c2), flags: int(sourceEntity.flags)
        }) : null,
        authority: 'native-rdx-presentation-instance'
      }));
    }
  }
  return states;
}

export class NativeRuntimeTimeline {
  constructor({ maxSamples = 300, minLoopPeriod = 4 } = {}) {
    this.maxSamples = Math.max(32, int(maxSamples, 300));
    this.minLoopPeriod = Math.max(2, int(minLoopPeriod, 4));
    this.reset();
  }

  reset() {
    this.frameSerial = -1;
    this.records = new Map();
    this.current = new Map();
    this.phaseZeroAnchors = new Map();
    this.classicPhaseZeroAnchors = new Map();
    this.nativePhaseZeroAudits = new Map();
    this.nativeClassicPhaseZeroDraws = new Map();
    this.runtimeSession = 0;
    this.projectileGenerations = new Map();
    this.projectileActive = new Map();
  }

  beginSession() {
    this.runtimeSession += 1;
    this.frameSerial = -1;
    this.current = new Map();
    this.nativePhaseZeroAudits = new Map();
    this.nativeClassicPhaseZeroDraws = new Map();
    this.projectileGenerations = new Map();
    this.projectileActive = new Map();
    return this.runtimeSession;
  }

  /* The static ResolvedLevel carries Layer E's semantic phase-zero world
   * position. Native compositor audit coordinates are deliberately
   * viewport-relative, so cache each source's first audit and preserve only
   * its live displacement when feeding the whole-room editor. */
  setPhaseZeroAnchors(actors = [], { playerContact = null, classicActors = [] } = {}) {
    this.phaseZeroAnchors = new Map();
    this.classicPhaseZeroAnchors = new Map();
    this.nativePhaseZeroAudits = new Map();
    this.nativeClassicPhaseZeroDraws = new Map();
    for (const actor of actors || []) {
      const sourceKey = String(actor?.sourceKey || '');
      const simulation = actor?.simulation || {};
      if (!sourceKey || !Array.isArray(simulation.origin) || !Array.isArray(simulation.draw)) continue;
      const player = String(actor?.role || '') === 'player'
        ? editorRickPhaseZeroPresentation(playerContact, simulation) : null;
      this.phaseZeroAnchors.set(sourceKey, Object.freeze(player || {
        origin: Object.freeze([int(simulation.origin[0]), int(simulation.origin[1])]),
        draw: Object.freeze([int(simulation.draw[0]), int(simulation.draw[1])]),
        classicControllerDisplacement: String(actor?.role || '') === 'enemy' &&
          String(actor?.controller?.authority || '') === 'classic-xrick' &&
          Array.isArray(actor?.controllerPlacement?.sourceOrigin),
        authority: String(simulation.authority || 'layer-e-semantic-simulated-state')
      }));
    }
    for (const actor of classicActors || []) {
      const sourceKey = String(actor?.sourceKey || '');
      const draw = Array.isArray(actor?.draw) ? actor.draw : null;
      if (!sourceKey || !draw) continue;
      this.classicPhaseZeroAnchors.set(sourceKey, Object.freeze([int(draw[0]), int(draw[1])]));
    }
    return this.phaseZeroAnchors;
  }

  rebasePhaseZeroState(state) {
    const sourceKey = String(state?.sourceKey || '');
    const semantic = this.phaseZeroAnchors.get(sourceKey);
    const classicSemantic = this.classicPhaseZeroAnchors.get(sourceKey);
    if ((!semantic || !state?.presentationAudited) && !classicSemantic) return state;
    /* RDX compositor coordinates and Classic controller coordinates are
     * different spaces. A dormant actor can exist in the entity snapshot
     * before it has any compositor audit, so never let that unaudited Classic
     * position establish the RDX phase-zero baseline. Cache each basis only
     * when that basis is actually observable. */
    let native = null;
    if (semantic && state.presentationAudited) {
      native = this.nativePhaseZeroAudits.get(sourceKey);
      if (!native) {
        native = Object.freeze({
          origin: (state.cameraNeutralOrigin || state.origin || []).slice(),
          draw: (state.cameraNeutralDraw || state.draw || []).slice(),
          playerWorldContact: state.playerWorldContact ? state.playerWorldContact.slice() : null
        });
        this.nativePhaseZeroAudits.set(sourceKey, native);
      }
    }

    let classicDraw = state.classicDraw;
    let classicDisplacement = null;
    if (classicSemantic && semantic?.classicControllerDisplacement && Array.isArray(state.classicControllerDisplacement)) {
      classicDisplacement = Object.freeze([
        int(state.classicControllerDisplacement[0]), int(state.classicControllerDisplacement[1])
      ]);
      classicDraw = Object.freeze([
        classicSemantic[0] + classicDisplacement[0],
        classicSemantic[1] + classicDisplacement[1]
      ]);
    } else if (classicSemantic && state.cameraNeutralClassicDraw) {
      let nativeClassicDraw = this.nativeClassicPhaseZeroDraws.get(sourceKey);
      if (!nativeClassicDraw) {
        nativeClassicDraw = Object.freeze(state.cameraNeutralClassicDraw.slice());
        this.nativeClassicPhaseZeroDraws.set(sourceKey, nativeClassicDraw);
      }
      classicDraw = Object.freeze([
        classicSemantic[0] + int(state.cameraNeutralClassicDraw[0]) - int(nativeClassicDraw[0]),
        classicSemantic[1] + int(state.cameraNeutralClassicDraw[1]) - int(nativeClassicDraw[1])
      ]);
    }

    let origin = state.origin;
    let draw = state.draw;
    let phaseZeroAuthority = state.phaseZeroAuthority;
    if (semantic && state.presentationAudited) {
      if (sourceKey === 'player' && state.playerWorldContact && native.playerWorldContact) {
        const dx = int(state.playerWorldContact[0]) - int(native.playerWorldContact[0]);
        const dy = int(state.playerWorldContact[1]) - int(native.playerWorldContact[1]);
        origin = Object.freeze([semantic.origin[0] + dx, semantic.origin[1] + dy]);
        draw = Object.freeze([semantic.draw[0] + dx, semantic.draw[1] + dy]);
      } else if (classicDisplacement) {
        /* Source-backed enemies are controlled by Classic xrick, while the
         * resolved RDX actor owns their phase-zero presentation registration.
         * Use x-xsave/y-ysave directly as the controller displacement instead
         * of treating the first compositor audit as a motion baseline. Native
         * startup can expose a transient draw anchor for an otherwise stable
         * PN; caching that transient made the first Simulate session sink an
         * enemy into the floor and a stop/start establish a different offset.
         * xsave/ysave are the native patrol/reset origin, so this composition
         * is session-independent and keeps Layer E/F presentation residuals
         * applied exactly once. */
        origin = Object.freeze([
          semantic.origin[0] + classicDisplacement[0],
          semantic.origin[1] + classicDisplacement[1]
        ]);
        draw = Object.freeze([
          semantic.draw[0] + classicDisplacement[0],
          semantic.draw[1] + classicDisplacement[1]
        ]);
      } else {
        const currentOrigin = state.cameraNeutralOrigin || state.origin;
        const currentDraw = state.cameraNeutralDraw || state.draw;
        origin = Object.freeze([
          semantic.origin[0] + int(currentOrigin[0]) - int(native.origin[0]),
          semantic.origin[1] + int(currentOrigin[1]) - int(native.origin[1])
        ]);
        draw = Object.freeze([
          semantic.draw[0] + int(currentDraw[0]) - int(native.draw[0]),
          semantic.draw[1] + int(currentDraw[1]) - int(native.draw[1])
        ]);
      }
      phaseZeroAuthority = classicDisplacement
        ? `${semantic.authority}+native-classic-controller-displacement`
        : semantic.authority;
    }
    return Object.freeze({ ...state, origin, draw, classicDraw,
      anchor: Object.freeze([int(origin?.[0]) - int(draw?.[0]), int(origin?.[1]) - int(draw?.[1])]),
      phaseZeroAuthority });
  }

  withRuntimeIdentity(state) {
    if (!isNativeProjectileEntity(state?.nativeEntity)) return state;
    const sourceKey = String(state?.sourceKey || '');
    const active = isNativeProjectileActive(state);
    const nativeGeneration = Math.max(0, int(state?.nativeEntity?.projectileGeneration));
    if (nativeGeneration > 0) {
      this.projectileGenerations.set(sourceKey, nativeGeneration);
      this.projectileActive.set(sourceKey, active);
      if (!active) return Object.freeze({ ...state, runtimeGeneration: nativeGeneration, runtimeInstanceKey: null,
        runtimeLifecycle: state?.nativeEntity?.projectileCooldownFrames > 0 ? 'projectile-cooldown' : 'projectile-dormant' });
      const localKey = nativeProjectileInstanceKey(state, nativeGeneration);
      return Object.freeze({ ...state, runtimeGeneration: nativeGeneration,
        runtimeInstanceKey: localKey ? `session:${this.runtimeSession}:${localKey}` : null,
        runtimeLifecycle: 'active-projectile' });
    }
    const wasActive = this.projectileActive.get(sourceKey) === true;
    let generation = this.projectileGenerations.get(sourceKey) || 0;
    if (active && !wasActive) {
      generation += 1;
      this.projectileGenerations.set(sourceKey, generation);
    }
    this.projectileActive.set(sourceKey, active);
    if (!active) return Object.freeze({ ...state, runtimeGeneration: generation, runtimeInstanceKey: null });
    const localKey = nativeProjectileInstanceKey(state, generation);
    return Object.freeze({ ...state, runtimeGeneration: generation,
      runtimeInstanceKey: localKey ? `session:${this.runtimeSession}:${localKey}` : null,
      runtimeLifecycle: 'active-projectile' });
  }

  record(snapshot, presentationItems = snapshot?.presentation || []) {
    const frameSerial = int(snapshot?.frameSerial, -1);
    if (frameSerial >= 0 && frameSerial === this.frameSerial) return this.current;
    this.frameSerial = frameSerial;
    const rawStates = nativeRuntimeStates(snapshot, presentationItems);
    const states = new Map([...rawStates].map(([sourceKey, state]) =>
      [sourceKey, this.withRuntimeIdentity(this.rebasePhaseZeroState(state))]));
    this.current = states;
    for (const [sourceKey, state] of states) {
      let record = this.records.get(sourceKey);
      if (!record) {
        record = { sourceKey, samples: [], signatures: new Map(), loopStart: null, loopPeriod: null };
        this.records.set(sourceKey, record);
      }
      if (record.samples.length >= this.maxSamples) continue;
      const phase = record.samples.length;
      const sample = Object.freeze({ ...state, phase });
      const signature = motionSignature(sample);
      if (record.loopPeriod == null) {
        const previous = record.signatures.get(signature) || [];
        for (let p = previous.length - 1; p >= 0; p -= 1) {
          const start = previous[p];
          const period = phase - start;
          if (period < this.minLoopPeriod) continue;
          if (!movedBetween(record.samples, start, phase - 1)) continue;
          record.loopStart = start;
          record.loopPeriod = period;
          break;
        }
        previous.push(phase);
        record.signatures.set(signature, previous);
      }
      record.samples.push(sample);
    }
    return states;
  }

  currentStates() { return this.current; }

  sourceRecord(sourceKey) {
    const row = this.records.get(String(sourceKey || ''));
    if (!row || !row.samples.length) return null;
    const samples = row.samples.slice();
    const result = {
      sourceKey: row.sourceKey,
      samples,
      trackPeriod: samples.length,
      trajectoryCaptureHorizon: samples.length,
      trajectoryKind: 'native-session-capture',
      authority: 'native-xrick-live-session'
    };
    if (row.loopPeriod != null) {
      result.trajectoryLoopStart = row.loopStart;
      result.trajectoryLoopPeriod = row.loopPeriod;
      result.trajectoryLoopAuthority = 'native-motion-state-recurrence';
    }
    return Object.freeze(result);
  }

  sourceStateAt(sourceKey, tick) {
    const record = this.records.get(String(sourceKey || ''));
    if (!record?.samples?.length) return null;
    let index = Math.max(0, int(tick));
    if (index >= record.samples.length && record.loopPeriod != null && index >= record.loopStart) {
      index = record.loopStart + ((index - record.loopStart) % record.loopPeriod);
    }
    index = Math.min(index, record.samples.length - 1);
    return record.samples[index] || null;
  }

  statesAt(tick, { pinSourceKey = null } = {}) {
    if (pinSourceKey) {
      const states = new Map(this.current);
      const pinned = this.sourceStateAt(pinSourceKey, tick);
      if (pinned) states.set(String(pinSourceKey), pinned);
      return states;
    }
    const states = new Map();
    for (const key of this.records.keys()) {
      const sample = this.sourceStateAt(key, tick);
      if (sample) states.set(key, sample);
    }
    return states;
  }
}
