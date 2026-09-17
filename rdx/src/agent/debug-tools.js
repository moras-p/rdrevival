import { forceGameplayDebugFrame, gameplayAgentState, setGameplayFrameObserver, withGameplayFrontendFreeze } from './gameplay-control.js';

export const DEBUG_ACTION_MASKS = Object.freeze({
  none: 0,
  move_right: 1,
  move_left: 2,
  move_down: 4,
  move_up: 8,
  fire: 16,
  right: 1,
  left: 2,
  down: 4,
  up: 8
});

const EVENT_NAMES = Object.freeze({ 1:'action', 2:'collision_sample', 3:'decision', 4:'entity', 5:'ladder', 6:'descriptor_state', 7:'death' });
const BRANCH_NAMES = Object.freeze({
  0:'none', 1:'static_solid', 2:'dynamic_entity', 3:'ladder_constraint',
  4:'fallback_to_classic', 5:'descriptor_rdx', 6:'move_accepted',
  7:'vertical_blocked', 8:'ladder_acquired', 9:'ladder_released',
  10:'lethal', 11:'room_edge'
});
const COLLISION_POLICIES = Object.freeze({
  verified_only_pause: 0,
  classic_fallback_warn: 1,
  classic_only: 2,
  rdx_verified: 3
});
const BLOCKING_BRANCHES = new Set(['static_solid','dynamic_entity','ladder_constraint','vertical_blocked','lethal']);
const TRACE_HISTORY_LIMIT = 32;
const traceHistory = new Map();
let nextTraceId = 1;

function requireDebugBridge(bridge) {
  const methods = ['debugCheckpointSave','debugCheckpointLoad','debugCheckpointDiscard','debugTraceBegin','debugTraceFinish','debugTraceEvents'];
  for (const method of methods) if (typeof bridge?.[method] !== 'function') throw new Error(`Native debug bridge is missing ${method}`);
  return bridge;
}

function decodeDecision(branch, values) {
  const result = values[0] | 0;
  switch (branch) {
    case 'static_solid':
    case 'dynamic_entity':
      return {
        result, previousX:values[1] | 0, requestedX:values[2] | 0, resolvedX:values[3] | 0,
        environmentFlags:values[4] >>> 0, causeEventIndex:(values[5] | 0) >= 0 ? values[5] | 0 : null
      };
    case 'move_accepted':
      return { result, previousX:values[1] | 0, acceptedX:values[2] | 0, worldY:values[3] | 0, environmentFlags:values[4] >>> 0 };
    case 'vertical_blocked':
      return { result, worldX:values[1] | 0, previousY:values[2] | 0, requestedY:values[3] | 0, environmentFlags:values[4] >>> 0 };
    case 'ladder_constraint':
      return { result, previousX:values[1] | 0, requestedX:values[2] | 0, currentLadder:!!values[3], requestedLadder:!!values[4] };
    case 'room_edge':
      return { result, direction:values[1] < 0 ? 'left' : 'right', previousX:values[2] | 0, requestedX:values[3] | 0, worldY:values[4] | 0 };
    case 'lethal':
      return { result, worldX:values[1] | 0, worldY:values[2] | 0, environmentFlags:values[3] >>> 0 };
    default:
      return { result, nativeArguments:values.slice(1, 5).map(value => value | 0) };
  }
}

function decodeTrace(raw) {
  const events = (raw?.events || []).map((event, index) => {
    const type = EVENT_NAMES[event.type] || `type_${event.type}`;
    const branch = BRANCH_NAMES[event.branch] || `branch_${event.branch}`;
    const values = event.values || [];
    let detail = { nativeValues:values };
    if (type === 'collision_sample') {
      const descriptor = values[5] >>> 0;
      detail = {
        classicCell: { row: values[0], col: values[1] },
        requestedMask: values[2] >>> 0,
        classicFlags: values[3] >>> 0,
        resultFlags: values[4] >>> 0,
        provenance: branch === 'descriptor_rdx' ? 'rdx_descriptor' :
          branch === 'fallback_to_classic' ? 'classic_fallback' : 'classic_policy',
        descriptor: { mt:descriptor & 0xff, ml:(descriptor >>> 8) & 0xff },
        world: { x: values[6], y: values[7] }
      };
    } else if (type === 'descriptor_state') {
      detail = { world:{ x:values[0], y:values[1] }, mt:values[2] >>> 0, ml:values[3] >>> 0 };
    } else if (type === 'death') {
      detail = {cause:values[7] ? 'dynamite_explosion' : ({0:'unattributed_native_death',1:'actor_contact',2:'trap',3:'rubble_landing'}[values[0]] || 'native_death'),source:values[1],mark:values[2],n:values[3],xrickLocal:{x:values[4],y:values[5]},prevented:!!values[6]};
    } else if (type === 'decision') {
      detail = decodeDecision(branch, values);
    } else if (type === 'entity') {
      detail = {
        slot:values[0] >>> 0, mark:values[1] >>> 0, n:values[2] >>> 0,
        role:(values[0] >>> 0) === 1 ? 'player' : 'actor',
        bounds:{ left:values[3], top:values[4], right:values[5], bottom:values[6] }
      };
    } else if (type === 'action') {
      detail = { controlMask:values[0] >>> 0, phase:values[1] ? 'begin' : 'end' };
    }
    return { index, type, branch, ...detail };
  });
  const decisions = events.filter(event => event.type === 'decision');
  const trace = {
    overflow: !!raw?.overflow,
    events,
    collisionSamples: events.filter(event => event.type === 'collision_sample'),
    descriptorStates: events.filter(event => event.type === 'descriptor_state'),
    relevantEntities: events.filter(event => event.type === 'entity'),
    decisions,
    deaths:events.filter(event => event.type === 'death'),
    exactBranch: decisions.length ? decisions.at(-1).branch : null
  };
  return summarizeTraceResult(trace);
}

function enrichTraceMappings(bridge, trace) {
  if (typeof bridge?.debugMapPoint !== 'function') return trace;
  for (const sample of trace.collisionSamples) {
    const mapping = bridge.debugMapPoint(sample.world.x, sample.world.y);
    sample.coordinateMapping = {
      world:{ ...sample.world },
      classic:{ ...mapping.classic, row:sample.classicCell.row, col:sample.classicCell.col,
        sampledFlags:sample.classicFlags },
      rdx:{ ...mapping.rdx, mt:sample.descriptor.mt, ml:sample.descriptor.ml,
        sampledFlags:sample.resultFlags, provenance:sample.provenance }
    };
  }
  return summarizeTraceResult(trace);
}

function collisionSampleOrdinal(trace, sample) {
  return sample ? trace.collisionSamples.indexOf(sample) : -1;
}

function summarizeTraceResult(trace) {
  const terminal = trace.decisions.at(-1) || null;
  trace.terminal = terminal ? {
    branch:terminal.branch,
    allowed:terminal.branch === 'move_accepted' || terminal.branch === 'room_edge' || terminal.branch === 'ladder_acquired',
    result:terminal.result,
    causeEventIndex:terminal.causeEventIndex ?? null
  } : null;
  trace.blocker = null;
  if (!terminal || !BLOCKING_BRANCHES.has(terminal.branch)) return trace;

  const priorSamples = trace.collisionSamples.filter(sample => sample.index < terminal.index);
  const causalEventIndex = Number.isInteger(terminal.causeEventIndex) ? terminal.causeEventIndex : null;
  let sample = causalEventIndex == null ? null : priorSamples.find(candidate => candidate.index === causalEventIndex) || null;
  /* Static collision attribution is emitted by the native resolver. Never infer
   * a different blocker from later body/feet probes (for example FGND). */
  if (!sample && terminal.branch !== 'static_solid' && priorSamples.length) sample = priorSamples.at(-1);
  const entity = terminal.branch === 'dynamic_entity'
    ? trace.relevantEntities.filter(item => item.index < terminal.index).at(-1) || null
    : null;
  trace.blocker = {
    kind:terminal.branch,
    sampleIndex:collisionSampleOrdinal(trace, sample),
    eventIndex:sample?.index ?? terminal.index,
    world:sample ? { ...sample.world } : terminal.worldX != null ? { x:terminal.worldX, y:terminal.worldY } : null,
    requestedMask:sample?.requestedMask ?? null,
    resultFlags:sample?.resultFlags ?? terminal.environmentFlags ?? null,
    descriptor:sample ? { ...sample.descriptor } : null,
    provenance:sample?.provenance ?? (entity ? 'dynamic_entity' : null),
    coordinateMapping:sample?.coordinateMapping || null,
    entity:entity ? { slot:entity.slot, mark:entity.mark, n:entity.n, bounds:{ ...entity.bounds } } : null
  };
  return trace;
}

function rememberTrace({ frameSerial, action, controlMask, trace }) {
  const id = `trace-${nextTraceId++}`;
  traceHistory.set(id, { id, frameSerial:frameSerial >>> 0, action:String(action), controlMask:controlMask >>> 0, trace });
  while (traceHistory.size > TRACE_HISTORY_LIMIT) traceHistory.delete(traceHistory.keys().next().value);
  return id;
}

function recalledTrace(traceId) {
  return traceHistory.get(String(traceId || '')) || null;
}

function loadCheckpointPreservingFrontendPause(bridge, slot) {
  const canPause = typeof bridge?.frontendPaused === 'function' && typeof bridge?.setFrontendPaused === 'function';
  const paused = canPause ? !!bridge.frontendPaused() : false;
  const restored = bridge.debugCheckpointLoad(slot);
  if (canPause && !!bridge.frontendPaused() !== paused) bridge.setFrontendPaused(paused);
  return restored;
}

function actionMask(action) {
  const mask = DEBUG_ACTION_MASKS[String(action || '')];
  if (mask == null) throw new Error(`Unsupported gameplay action '${action}'`);
  return mask;
}

function stateDelta(before, after) {
  return {
    worldX: after.hero.worldX - before.hero.worldX,
    worldY: after.hero.worldY - before.hero.worldY,
    frameSerial: (after.frameSerial - before.frameSerial) | 0,
    motion: `${before.hero.motion}->${after.hero.motion}`
  };
}

export function explainGameplayAction(bridge, { action, apply = false, freeze = true } = {}) {
  requireDebugBridge(bridge);
  if (typeof bridge.setDebugControl !== 'function' || typeof bridge.forceBrowserFrame !== 'function') throw new Error('Gameplay stepping bridge is not ready');
  return withGameplayFrontendFreeze(bridge, !!freeze, () => {
    const mask = actionMask(action);
    const checkpointSlot = 0;
    const before = gameplayAgentState(bridge);
    const beforeSnapshot = bridge.snapshot();
    if (!apply && !bridge.debugCheckpointSave(checkpointSlot)) throw new Error('Could not save native debug checkpoint');
    let attemptedAfter = before;
    let trace;
    try {
      bridge.debugTraceBegin(mask);
      bridge.setDebugControl(mask);
      forceGameplayDebugFrame(bridge);
      bridge.setDebugControl(0);
      bridge.debugTraceFinish();
      attemptedAfter = gameplayAgentState(bridge);
      trace = enrichTraceMappings(bridge, decodeTrace(bridge.debugTraceEvents()));
    } finally {
      bridge.setDebugControl(0);
      bridge.debugTraceFinish();
      if (!apply) {
        if (!loadCheckpointPreservingFrontendPause(bridge, checkpointSlot)) throw new Error('Could not restore native debug checkpoint');
        bridge.debugCheckpointDiscard(checkpointSlot);
      }
    }
    const traceId = rememberTrace({ frameSerial:before.frameSerial, action, controlMask:mask, trace });
    const nearby = (beforeSnapshot.entities || []).filter(entity => {
      const box = entity.actorCollision;
      if (!box) return false;
      const cx = (box.left + box.right) / 2;
      const cy = (box.top + box.bottom) / 2;
      return Math.abs(cx - before.hero.worldX) <= 96 && Math.abs(cy - before.hero.worldY) <= 96;
    });
    return {
      schema:'rdr.gameplay.explain_action.v2',
      traceId,
      action:String(action), controlMask:mask, apply:!!apply, freeze:!!freeze,
      result:{ branch:trace.exactBranch, allowed:!!trace.terminal?.allowed, blocked:!!trace.blocker },
      blocker:trace.blocker,
      attemptedTransition:{ before, after:attemptedAfter, delta:stateDelta(before, attemptedAfter) },
      trace,
      relevantEntities: nearby,
      restored: apply ? null : gameplayAgentState(bridge),
      authority:'native_c_gameplay_path'
    };
  });
}

function playerSpriteBounds(snapshot) {
  const item = (snapshot.presentation || []).find(entry => entry.slot === 1);
  if (item) return { source:'rdx_presentation', coordinateSpace:'screen', left:item.drawX, top:item.drawY, right:item.drawX + item.width - 1, bottom:item.drawY + item.height - 1 };
  const entity = (snapshot.entities || []).find(entry => entry.slot === 1);
  if (!entity) return null;
  return { source:'classic_entity', coordinateSpace:'xrick_entity', left:entity.x, top:entity.y, right:entity.x + entity.w, bottom:entity.y + entity.h };
}

function compactGeometry(geometry) {
  return (geometry?.primitives || []).map(row => ({ type:row.type, flags:row.flags, sourceId:row.sourceId, bounds:{ left:row.x0, top:row.y0, right:row.x1, bottom:row.y1 } }));
}

function nearbyGeometry(rows, player, marginX = 192, marginY = 128) {
  if (!player) return [];
  return rows.filter(row => {
    const box = row.bounds;
    const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
    return Math.abs(cx - player.worldX) <= marginX && Math.abs(cy - player.worldY) <= marginY;
  });
}

function traceForSnapshot(bridge, frameSerial, { action = null, traceId = null } = {}) {
  if (action && traceId) throw new Error('capture_snapshot accepts either action or traceId, not both');
  if (action) {
    const explanation = explainGameplayAction(bridge, { action, apply:false, freeze:false });
    return { traceId:explanation.traceId, action:explanation.action, controlMask:explanation.controlMask, trace:explanation.trace };
  }
  if (traceId) {
    const remembered = recalledTrace(traceId);
    if (!remembered) throw new Error(`Unknown action trace '${traceId}'`);
    if ((remembered.frameSerial >>> 0) !== (frameSerial >>> 0)) {
      throw new Error(`Trace ${traceId} belongs to frame ${remembered.frameSerial}, not current frame ${frameSerial}; pass action to capture a fresh frame-locked trace`);
    }
    return remembered;
  }
  return null;
}

function queriedCells(traceLink) {
  return (traceLink?.trace?.collisionSamples || []).map((sample, index) => ({
    sampleIndex:index,
    branch:sample.branch,
    world:{ ...sample.world },
    classicCell:{ ...sample.classicCell },
    requestedMask:sample.requestedMask,
    resultFlags:sample.resultFlags,
    descriptor:{ ...sample.descriptor },
    provenance:sample.provenance,
    blocking:traceLink.trace.blocker?.sampleIndex === index
  }));
}

export function captureGameplaySnapshot(bridge, {
  overlay = [], action = null, traceId = null, includeGeometry = false, freeze = true
} = {}, { captureScreenshot = null } = {}) {
  requireDebugBridge(bridge);
  if (typeof bridge.presentationFramebufferForFrame !== 'function') {
    throw new Error('Native frame-locked presentation capture is unavailable');
  }
  return withGameplayFrontendFreeze(bridge, !!freeze, () => {
    const snapshot = bridge.snapshot();
    const frameSerial = snapshot.frameSerial >>> 0;
    const traceLink = traceForSnapshot(bridge, frameSerial, { action, traceId });
    const native = bridge.nativeCollisionSnapshot();
    const playerGeometry = typeof bridge.debugPlayerGeometry === 'function' ? bridge.debugPlayerGeometry() : null;
    const body = playerGeometry?.body || null;
    const feet = playerGeometry?.feet || null;
    const probes = {};
    if (typeof bridge.debugMapPoint === 'function' && body && feet) {
      probes.bodyCenter = bridge.debugMapPoint((body.left + body.right) >> 1, (body.top + body.bottom) >> 1);
      probes.feetLeft = bridge.debugMapPoint(feet.left, feet.y + 1);
      probes.feetRight = bridge.debugMapPoint(feet.right, feet.y + 1);
    }
    const classicGeometry = typeof bridge.debugGeometry === 'function' ? compactGeometry(bridge.debugGeometry(0)) : [];
    const rdxGeometry = typeof bridge.debugGeometry === 'function' ? compactGeometry(bridge.debugGeometry(1)) : [];
    const playerState = gameplayAgentState(bridge).hero;
    const nearbyClassicGeometry = nearbyGeometry(classicGeometry, playerState);
    const nearbyRdxGeometry = nearbyGeometry(rdxGeometry, playerState);
    const collision = typeof bridge.collisionSnapshot === 'function' ? bridge.collisionSnapshot() : snapshot.collision;
    const queryCells = queriedCells(traceLink);
    const machine = {
      schema:'rdr.debug.snapshot.v2', frameSerial,
      presentation: bridge.classicAssets() ? 'classic' : 'rdx',
      room:{ map:snapshot.map, submap:snapshot.submap, mapFrow:snapshot.mapFrow, visibleTopRow:snapshot.visibleTopRow },
      camera:{ deltaRows:snapshot.cameraDeltaRows, offsetPx:snapshot.cameraOffsetPx, worldY:snapshot.cameraY },
      player:{
        state:playerState,
        spriteBounds:playerSpriteBounds(snapshot),
        bodyBounds:body ? { ...body, coordinateSpace:'rdx_world', provenance:'production_xrick_actor_collision_box' } : null,
        feetBounds:feet ? { left:feet.left, right:feet.right, top:feet.y, bottom:feet.y, coordinateSpace:'rdx_world', provenance:'production_xrick_support_span' } : null,
        interactionBounds:body ? { ...body, coordinateSpace:'rdx_world', provenance:'production_xrick_actor_overlap_box' } : null,
        coordinateMappings:probes,
        contacts:native.playerContacts >>> 0,
        lastDescriptor:{ mt:native.playerLastMt >>> 0, ml:native.playerLastMl >>> 0 }
      },
      collision:{
        policy: collision?.policy ?? null,
        availability: collision?.availability ?? null,
        evidenceId: collision?.evidenceId ?? null,
        datasetHash: collision?.datasetHash ?? null,
        fallbackQueries: collision?.fallbackQueries ?? null,
        verifiedQueries: collision?.verifiedQueries ?? null
      },
      actionTrace:traceLink ? {
        traceId:traceLink.id || traceLink.traceId,
        action:traceLink.action,
        controlMask:traceLink.controlMask,
        blocker:traceLink.trace.blocker,
        exactBranch:traceLink.trace.exactBranch,
        queriedCells:queryCells
      } : null,
      nearbyDynamicEntities:(snapshot.entities || []).filter(entity => {
        if (!entity.n || entity.slot === 1 || !body || !entity.actorCollision?.source) return false;
        const box = entity.actorCollision;
        const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
        const px = (body.left + body.right) / 2, py = (body.top + body.bottom) / 2;
        return Math.abs(cx - px) <= 160 && Math.abs(cy - py) <= 120;
      }).map(entity => ({
        slot:entity.slot, n:entity.n, mark:entity.mark, flags:entity.flags,
        actorCollision:entity.actorCollision,
        trigger:entity.trigW || entity.trigH ? { x:entity.trigX, y:entity.trigY, w:entity.trigW, h:entity.trigH, coordinateSpace:'xrick_entity' } : null
      })),
      triggerVolumes:nearbyRdxGeometry.filter(row => row.type === 5),
      geometrySummary:{ classicPrimitives:classicGeometry.length, rdxPrimitives:rdxGeometry.length },
      ...(includeGeometry ? { geometry:{ classic:nearbyClassicGeometry, rdx:nearbyRdxGeometry } } : {}),
      overlay:[...overlay],
      overlayLegend:[
        ...(overlay.includes('player_bounds') ? [{ key:'player_bounds', label:'player body / feet' }] : []),
        ...(overlay.includes('collision_cells') ? [{ key:'collision_cells', label:'body / feet probe cells' }] : []),
        ...(overlay.includes('queried_cells') ? [{ key:'queried_cells', label:'cells queried by action trace' }] : []),
        ...(overlay.includes('blocking_sample') ? [{ key:'blocking_sample', label:'terminal blocking collision sample' }] : []),
        ...(overlay.includes('entities') ? [{ key:'entities', label:'nearby entities / triggers' }] : [])
      ]
    };
    const pixels = bridge.presentationFramebufferForFrame(frameSerial);
    const afterCopySerial = bridge.snapshot().frameSerial >>> 0;
    if (afterCopySerial !== frameSerial) throw new Error(`Atomic snapshot lost frame lock while copying pixels (${frameSerial} -> ${afterCopySerial})`);
    const screenshot = typeof captureScreenshot === 'function'
      ? captureScreenshot(machine, overlay, { frameSerial, width:320, height:200, pixels })
      : null;
    const afterSerial = bridge.snapshot().frameSerial >>> 0;
    if (afterSerial !== frameSerial) throw new Error(`Atomic snapshot lost frame lock (${frameSerial} -> ${afterSerial})`);
    return { ...machine, screenshot };
  });
}

function comparableState(state) {
  return {
    map:state.map,
    submap:state.submap,
    hero:{
      active:state.hero.active, motion:state.hero.motion, worldX:state.hero.worldX, worldY:state.hero.worldY,
      screenX:state.hero.screenX, screenY:state.hero.screenY, velocityY:state.hero.velocityY,
      grounded:state.hero.grounded, climbing:state.hero.climbing, crawling:state.hero.crawling,
      state:state.hero.state, direction:state.hero.direction, controlMask:state.hero.controlMask
    },
    camera:{ ...state.camera }, inventory:state.inventory, score:state.score, debug:state.debug
  };
}

function comparableFrame(frame) {
  return {
    frameAdvance:(frame.after.frameSerial - frame.before.frameSerial) | 0,
    after:comparableState(frame.after),
    exactBranch:frame.trace.exactBranch,
    collision:frame.trace.collisionSamples.map(sample => ({
      branch:sample.branch,
      world:sample.world,
      classicCell:sample.classicCell,
      classicFlags:sample.classicFlags,
      resultFlags:sample.resultFlags,
      descriptor:sample.descriptor,
      provenance:sample.provenance,
      coordinateMapping:sample.coordinateMapping ? {
        classic:{ row:sample.coordinateMapping.classic.row, col:sample.coordinateMapping.classic.col },
        rdx:{
          logicX:sample.coordinateMapping.rdx.logicX, logicY:sample.coordinateMapping.rdx.logicY,
          visualX:sample.coordinateMapping.rdx.visualX, visualY:sample.coordinateMapping.rdx.visualY
        }
      } : null
    }))
  };
}

function firstReplayMismatch(originalFrames, replayedFrames) {
  const count = Math.min(originalFrames.length, replayedFrames.length);
  for (let index = 0; index < count; index += 1) {
    const original = comparableFrame(originalFrames[index]);
    const replay = comparableFrame(replayedFrames[index]);
    if (JSON.stringify(original) !== JSON.stringify(replay)) return { frame:index, reason:'state_or_trace', original, replay };
  }
  if (originalFrames.length !== replayedFrames.length) return { frame:count, reason:'frame_count', originalCount:originalFrames.length, replayCount:replayedFrames.length };
  return null;
}

function hashPixels(pixels) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < pixels.length; index += 1) {
    hash ^= pixels[index];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8,'0')}`;
}

function comparePixels(a, b, width = 320, height = 200) {
  let changedPixels = 0, channelDelta = 0, maxChannelDelta = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let pixel = 0, offset = 0; pixel < width * height; pixel += 1, offset += 4) {
    let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(a[offset + channel] - b[offset + channel]);
      if (delta) changed = true;
      channelDelta += delta;
      if (delta > maxChannelDelta) maxChannelDelta = delta;
    }
    if (!changed) continue;
    changedPixels += 1;
    const x = pixel % width, y = Math.floor(pixel / width);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return {
    changedPixels,
    changedRatio:Number((changedPixels / (width * height)).toFixed(6)),
    meanAbsoluteRgbDelta:Number((channelDelta / (width * height * 3)).toFixed(3)),
    maxChannelDelta,
    bounds:changedPixels ? { left:minX, top:minY, right:maxX, bottom:maxY } : null
  };
}

function geometryAlignment(classicRows, rdxRows) {
  const remaining = rdxRows.map((row, index) => ({ row, index }));
  const shifts = new Map();
  let matched = 0, exact = 0, shifted = 0;
  const examples = [];
  const center = box => ({ x:(box.left + box.right) / 2, y:(box.top + box.bottom) / 2 });
  const size = box => ({ w:box.right - box.left, h:box.bottom - box.top });

  for (const leftRow of classicRows) {
    const a = leftRow.bounds, ac = center(a), as = size(a);
    let bestAt = -1, bestScore = Infinity;
    for (let at = 0; at < remaining.length; at += 1) {
      const rightRow = remaining[at].row;
      if (rightRow.type !== leftRow.type) continue;
      const b = rightRow.bounds, bc = center(b), bs = size(b);
      const sourcePenalty = leftRow.sourceId && rightRow.sourceId && leftRow.sourceId === rightRow.sourceId ? -32 : 0;
      const score = Math.abs(ac.x - bc.x) + Math.abs(ac.y - bc.y) +
        4 * (Math.abs(as.w - bs.w) + Math.abs(as.h - bs.h)) + sourcePenalty;
      if (score < bestScore) { bestScore = score; bestAt = at; }
    }
    /* Geometry modes are different representations of the same local scene;
     * do not fabricate a match between unrelated primitives merely because
     * their type agrees somewhere else in the room. */
    if (bestAt < 0 || bestScore > 64) continue;
    const [{ row:rightRow }] = remaining.splice(bestAt, 1);
    const b = rightRow.bounds, bs = size(b);
    matched += 1;
    const sameSize = as.w === bs.w && as.h === bs.h;
    const dx = b.left - a.left, dy = b.top - a.top;
    const exactPair = dx === 0 && dy === 0 && a.right === b.right && a.bottom === b.bottom;
    if (exactPair) exact += 1;
    else {
      shifted += 1;
      if (examples.length < 8) examples.push({
        type:leftRow.type,
        sourceIds:{ classic:leftRow.sourceId, rdx:rightRow.sourceId },
        classic:a, rdx:b, translation:sameSize ? { dx, dy } : null
      });
    }
    if (sameSize) shifts.set(`${dx},${dy}`, (shifts.get(`${dx},${dy}`) || 0) + 1);
  }

  let dominantTranslation = null;
  let dominantNonZeroTranslation = null;
  for (const [key, count] of shifts) {
    const [dx,dy] = key.split(',').map(Number);
    if (!dominantTranslation || count > dominantTranslation.count) dominantTranslation = { dx, dy, count };
    if ((dx || dy) && (!dominantNonZeroTranslation || count > dominantNonZeroTranslation.count)) {
      dominantNonZeroTranslation = { dx, dy, count };
    }
  }
  return {
    scope:'near_player', matching:'nearest_same_type_with_source_preference',
    matched, exact, shifted,
    unmatchedClassic:classicRows.length - matched,
    unmatchedRdx:remaining.length,
    dominantTranslation, dominantNonZeroTranslation,
    examples
  };
}

export function createGameplayDebugController(bridge, {
  resetRoomEntry = null, renderPresentationPair = null
} = {}) {
  requireDebugBridge(bridge);
  let recording = null;
  let nextRecordingId = 1;
  const baselineSlot = 1;
  const liveSlot = 2;
  const visualSlot = 3;

  function emptyTrace() { return { events:[], decisions:[], collisionSamples:[], exactBranch:null, blocker:null, terminal:null, overflow:false }; }

  const observer = {
    beforeFrame({ controlMask }) {
      if (!recording?.active) return null;
      const before = gameplayAgentState(bridge);
      if (recording.decisions) bridge.debugTraceBegin(controlMask);
      const priorSerial = recording.frames.length ? recording.frames.at(-1).after.frameSerial : recording.baseline.frameSerial;
      const unrecordedFramesBefore = Math.max(0, (before.frameSerial - priorSerial) | 0);
      return { before, unrecordedFramesBefore };
    },
    afterFrame({ controlMask, advanced, token }) {
      if (!recording?.active || !token) return;
      if (recording.decisions) bridge.debugTraceFinish();
      const trace = recording.decisions ? enrichTraceMappings(bridge, decodeTrace(bridge.debugTraceEvents())) : emptyTrace();
      if (advanced) {
        recording.unrecordedFrames += token.unrecordedFramesBefore;
        const frame = { index:recording.frames.length, before:token.before, after:gameplayAgentState(bridge), trace, unrecordedFramesBefore:token.unrecordedFramesBefore };
        if (recording.inputs) frame.controlMask = controlMask;
        recording.frames.push(frame);
        if (recording.inputs) recording.inputMasks.push(controlMask);
      }
    }
  };

  function installObserver() { setGameplayFrameObserver(observer); }
  function removeObserver() { setGameplayFrameObserver(null); }

  function releaseRecordingFreeze(target) {
    if (!target?.freezeHeld || typeof bridge.setFrontendPaused !== 'function') return;
    bridge.setFrontendPaused(!!target.frontendPausedBefore);
    target.freezeHeld = false;
  }

  function pendingUnrecordedFrames(target) {
    if (!target?.active || target.freeze) return 0;
    const priorSerial = target.frames.length ? target.frames.at(-1).after.frameSerial : target.baseline.frameSerial;
    const currentSerial = gameplayAgentState(bridge).frameSerial;
    return Math.max(0, (currentSerial - priorSerial) | 0);
  }

  function settlePendingUnrecordedFrames(target) {
    const pending = pendingUnrecordedFrames(target);
    if (pending > 0) target.unrecordedFrames += pending;
    return pending;
  }

  function deactivate(target, { releaseFreeze = true } = {}) {
    if (!target) return;
    target.active = false;
    removeObserver();
    if (releaseFreeze) releaseRecordingFreeze(target);
  }

  function start({ checkpoint = 'current', inputs = true, decisions = true, freeze = true } = {}) {
    if (recording) {
      deactivate(recording);
      bridge.debugCheckpointDiscard(baselineSlot);
    }
    const frontendPausedBefore = typeof bridge.frontendPaused === 'function' ? !!bridge.frontendPaused() : false;
    if (freeze && typeof bridge.setFrontendPaused === 'function' && !frontendPausedBefore) bridge.setFrontendPaused(true);
    try {
      if (checkpoint === 'room_entry') {
        if (typeof resetRoomEntry !== 'function') throw new Error('room_entry checkpoint is unavailable');
        if (resetRoomEntry() === false) throw new Error('Could not establish deterministic room_entry checkpoint');
      } else if (checkpoint !== 'current') throw new Error(`Unsupported checkpoint '${checkpoint}'`);
      if (!bridge.debugCheckpointSave(baselineSlot)) throw new Error('Could not save recording baseline');
      recording = {
        id:`repro-${nextRecordingId++}`, active:true, checkpoint, inputs:!!inputs, decisions:!!decisions, freeze:!!freeze,
        freezeHeld:!!freeze && !frontendPausedBefore, frontendPausedBefore,
        baseline:gameplayAgentState(bridge), presentation:bridge.classicAssets() ? 'classic' : 'rdx',
        collisionPolicy:typeof bridge.collisionPolicy === 'function' ? bridge.collisionPolicy() : null,
        frames:[], inputMasks:[], unrecordedFrames:0
      };
      installObserver();
      return {
        recordingId:recording.id, checkpoint, baseline:recording.baseline, active:true,
        freeze:recording.freeze, frontendPaused:typeof bridge.frontendPaused === 'function' ? !!bridge.frontendPaused() : null,
        replayable:recording.inputs,
        guidance:recording.freeze
          ? 'Frontend simulation is frozen between WebMCP calls; only forced rdr.gameplay frames are captured.'
          : 'Frontend remains live; unrecorded frame gaps will be reported and temporal replay is not guaranteed.'
      };
    } catch (error) {
      if (freeze && typeof bridge.setFrontendPaused === 'function' && !frontendPausedBefore) bridge.setFrontendPaused(false);
      throw error;
    }
  }

  function requireRecording(recordingId) {
    if (!recording || (recordingId && recordingId !== recording.id)) throw new Error(`Unknown recording '${recordingId || ''}'`);
    return recording;
  }

  function requireReplayable(target) {
    if (!target.inputs) throw new Error(`Recording ${target.id} was created with inputs=false and cannot be replayed`);
  }

  function replayFrames(target, { presentation = null, collisionPolicy = null } = {}) {
    requireReplayable(target);
    if (!loadCheckpointPreservingFrontendPause(bridge, baselineSlot)) throw new Error('Could not restore recording baseline');
    if (presentation) bridge.setClassicAssets(presentation === 'classic');
    if (collisionPolicy != null) bridge.setCollisionPolicy(collisionPolicy);
    const frames = [];
    try {
      for (let index = 0; index < target.inputMasks.length; index += 1) {
        const controlMask = target.inputMasks[index];
        const before = gameplayAgentState(bridge);
        bridge.debugTraceBegin(controlMask);
        bridge.setDebugControl(controlMask);
        forceGameplayDebugFrame(bridge);
        bridge.debugTraceFinish();
        frames.push({ index:frames.length, controlMask, before, after:gameplayAgentState(bridge), trace:enrichTraceMappings(bridge, decodeTrace(bridge.debugTraceEvents())) });
      }
    } finally {
      bridge.setDebugControl(0);
      bridge.debugTraceFinish();
    }
    return frames;
  }

  function stop(recordingId = null) {
    const target = requireRecording(recordingId);
    settlePendingUnrecordedFrames(target);
    deactivate(target);
    return { recordingId:target.id, active:false, frames:target.frames.length, unrecordedFrames:target.unrecordedFrames, deterministic:target.freeze && target.unrecordedFrames === 0, replayable:target.inputs, frontendPaused:typeof bridge.frontendPaused === 'function' ? !!bridge.frontendPaused() : null };
  }

  function replay(recordingId = null, { freeze = true } = {}) {
    const target = requireRecording(recordingId);
    requireReplayable(target);
    const wasPaused = typeof bridge.frontendPaused === 'function' ? !!bridge.frontendPaused() : false;
    if (freeze && typeof bridge.setFrontendPaused === 'function' && !wasPaused) bridge.setFrontendPaused(true);
    settlePendingUnrecordedFrames(target);
    target.active = false;
    removeObserver();
    let frames;
    try {
      frames = replayFrames(target, { presentation:target.presentation, collisionPolicy:target.collisionPolicy });
    } finally {
      if (freeze && typeof bridge.setFrontendPaused === 'function') {
        bridge.setFrontendPaused(true);
        target.freezeHeld = !target.frontendPausedBefore;
      } else if (target.freezeHeld) {
        releaseRecordingFreeze(target);
      } else if (typeof bridge.setFrontendPaused === 'function') {
        bridge.setFrontendPaused(wasPaused);
      }
    }
    const firstMismatch = firstReplayMismatch(target.frames, frames);
    return {
      recordingId:target.id, frames, final:gameplayAgentState(bridge), deterministicFrames:frames.length,
      matchedOriginal:!firstMismatch, firstMismatch,
      source:{ frames:target.frames.length, unrecordedFrames:target.unrecordedFrames, deterministic:target.freeze && target.unrecordedFrames === 0 }
    };
  }

  function captureVisualComparison(target, { collisionPolicy, screenshotMode = 'first' } = {}) {
    requireReplayable(target);
    if (!loadCheckpointPreservingFrontendPause(bridge, baselineSlot)) throw new Error('Could not restore recording baseline for visual comparison');
    if (collisionPolicy != null) bridge.setCollisionPolicy(collisionPolicy);
    const originalClassic = bridge.classicAssets();
    const frames = [];
    const screenshotPairs = [];

    function captureVariant(classic, state) {
      if (!loadCheckpointPreservingFrontendPause(bridge, visualSlot)) throw new Error('Could not restore frame checkpoint for presentation capture');
      /* Fast-state restore reinstates the presentation selector but not the DOM
       * consumer's last painted pixels. Force a presentation repaint even when
       * the restored selector already matches the requested variant. */
      if (bridge.classicAssets() === classic) bridge.setClassicAssets(!classic);
      bridge.setClassicAssets(classic);
      const presentationFrameSerial = bridge.snapshot().frameSerial >>> 0;
      const pixels = bridge.presentationFramebufferForFrame(presentationFrameSerial);
      const geometryAll = typeof bridge.debugGeometry === 'function' ? compactGeometry(bridge.debugGeometry(classic ? 0 : 1)) : [];
      return {
        pixels,
        hash:hashPixels(pixels),
        presentationFrameSerial,
        geometry:nearbyGeometry(geometryAll, state.hero)
      };
    }

    try {
      for (let index = 0; index < target.inputMasks.length; index += 1) {
        const controlMask = target.inputMasks[index];
        bridge.setDebugControl(controlMask);
        forceGameplayDebugFrame(bridge);
        const state = gameplayAgentState(bridge);
        const gameplayFrameSerial = state.frameSerial >>> 0;
        if (!bridge.debugCheckpointSave(visualSlot)) throw new Error('Could not save frame checkpoint for presentation capture');
        const classic = captureVariant(true, state);
        const rdx = captureVariant(false, state);
        if (!loadCheckpointPreservingFrontendPause(bridge, visualSlot)) throw new Error('Could not restore gameplay frame after presentation capture');
        bridge.debugCheckpointDiscard(visualSlot);

        const diff = comparePixels(classic.pixels, rdx.pixels);
        const geometry = geometryAlignment(classic.geometry, rdx.geometry);
        const frame = {
          index, gameplayFrameSerial,
          classic:{ hash:classic.hash, presentationFrameSerial:classic.presentationFrameSerial },
          rdx:{ hash:rdx.hash, presentationFrameSerial:rdx.presentationFrameSerial },
          pixelDifference:diff, geometryAlignment:geometry
        };
        frames.push(frame);
        const shouldRender = screenshotMode === 'all' || (screenshotMode === 'first' && screenshotPairs.length === 0 && (diff.changedPixels > 0 || geometry.shifted > 0));
        if (shouldRender && typeof renderPresentationPair === 'function') {
          screenshotPairs.push(renderPresentationPair({
            index, frameSerial:gameplayFrameSerial, state, classicPixels:classic.pixels, rdxPixels:rdx.pixels,
            pixelDifference:diff, geometryAlignment:geometry,
            append:screenshotMode === 'all' && screenshotPairs.length > 0
          }));
        }
      }
    } finally {
      bridge.setDebugControl(0);
      bridge.debugCheckpointDiscard(visualSlot);
      bridge.setClassicAssets(originalClassic);
    }
    const firstVisualDivergence = frames.find(frame => frame.pixelDifference.changedPixels > 0 || frame.geometryAlignment.shifted > 0 || frame.geometryAlignment.unmatchedClassic > 0 || frame.geometryAlignment.unmatchedRdx > 0) || null;
    return {
      frames,
      firstVisualDivergence:firstVisualDivergence ? {
        frame:firstVisualDivergence.index, gameplayFrameSerial:firstVisualDivergence.gameplayFrameSerial,
        pixelDifference:firstVisualDivergence.pixelDifference, geometryAlignment:firstVisualDivergence.geometryAlignment
      } : null,
      screenshots:screenshotPairs
    };
  }

  function compare(recordingId = null, {
    presentation = ['classic','rdx'], collisionPolicy = 'recorded', freeze = true,
    visual = true, screenshots = 'first'
  } = {}) {
    const target = requireRecording(recordingId);
    requireReplayable(target);
    const variants = [...new Set(presentation.map(value => value === 'revival' ? 'rdx' : value))];
    if (!variants.every(value => value === 'classic' || value === 'rdx')) throw new Error('presentation must contain classic and/or rdx');
    if (!['none','first','all'].includes(screenshots)) throw new Error(`Unknown screenshots mode '${screenshots}'`);
    const policy = collisionPolicy === 'recorded' ? target.collisionPolicy : COLLISION_POLICIES[collisionPolicy];
    if (policy == null) throw new Error(`Unknown collision policy '${collisionPolicy}'`);
    settlePendingUnrecordedFrames(target);
    target.active = false;
    removeObserver();
    if (!bridge.debugCheckpointSave(liveSlot)) throw new Error('Could not save live state before compare');
    const wasPaused = typeof bridge.frontendPaused === 'function' ? !!bridge.frontendPaused() : false;
    if (freeze && typeof bridge.setFrontendPaused === 'function' && !wasPaused) bridge.setFrontendPaused(true);
    const results = [];
    let visualComparison = null;
    try {
      for (const variant of variants) {
        const frames = replayFrames(target, { presentation:variant, collisionPolicy:policy });
        results.push({
          presentation:variant,
          collisionPolicy:policy,
          frames,
          firstMismatch:firstReplayMismatch(target.frames, frames)
        });
      }
      if (visual && variants.includes('classic') && variants.includes('rdx')) {
        visualComparison = captureVisualComparison(target, { collisionPolicy:policy, screenshotMode:screenshots });
      }
    } finally {
      if (!loadCheckpointPreservingFrontendPause(bridge, liveSlot)) throw new Error('Could not restore live state after compare');
      bridge.debugCheckpointDiscard(liveSlot);
      if (freeze && typeof bridge.setFrontendPaused === 'function') {
        bridge.setFrontendPaused(true);
        target.freezeHeld = !target.frontendPausedBefore;
      } else if (target.freezeHeld) {
        releaseRecordingFreeze(target);
      } else if (typeof bridge.setFrontendPaused === 'function') {
        bridge.setFrontendPaused(wasPaused);
      }
    }
    let firstDivergence = null;
    if (results.length >= 2) {
      const a = results[0], b = results[1];
      const count = Math.min(a.frames.length, b.frames.length);
      for (let index = 0; index < count; index += 1) {
        const av = comparableFrame(a.frames[index]);
        const bv = comparableFrame(b.frames[index]);
        if (JSON.stringify(av) !== JSON.stringify(bv)) { firstDivergence = { frame:index, [a.presentation]:av, [b.presentation]:bv }; break; }
      }
      if (!firstDivergence && a.frames.length !== b.frames.length) firstDivergence = { frame:count, reason:'frame_count' };
    }
    return { recordingId:target.id, collisionPolicy:policy, variants:results, firstDivergence, visualComparison, restored:true };
  }

  function status() {
    if (!recording) return { active:false, recording:null };
    const pendingFrames = pendingUnrecordedFrames(recording);
    const totalUnrecordedFrames = recording.unrecordedFrames + pendingFrames;
    const deathAttempts = recording.frames.filter(frame =>
      Number(frame.after.debug?.wouldDieCount || 0) > Number(frame.before.debug?.wouldDieCount || 0)
    ).map(frame => ({
      frame:frame.index,
      before:{ frameSerial:frame.before.frameSerial, hero:frame.before.hero, camera:frame.before.camera },
      after:{ frameSerial:frame.after.frameSerial, hero:frame.after.hero, camera:frame.after.camera },
      preventedDeaths:Number(frame.after.debug.wouldDieCount) - Number(frame.before.debug.wouldDieCount),
      trace:{
        exactBranch:frame.trace.exactBranch,
        terminal:frame.trace.terminal,
        blocker:frame.trace.blocker,
        relevantEntities:frame.trace.relevantEntities
      }
    }));
    return {
      active:recording.active, recordingId:recording.id, checkpoint:recording.checkpoint,
      frames:recording.frames.length, baseline:recording.baseline, inputs:recording.inputs, decisions:recording.decisions,
      freeze:recording.freeze, frontendPaused:typeof bridge.frontendPaused === 'function' ? !!bridge.frontendPaused() : null,
      unrecordedFrames:totalUnrecordedFrames, pendingUnrecordedFrames:pendingFrames,
      deterministic:recording.freeze && totalUnrecordedFrames === 0, deathAttempts,
      replayable:recording.inputs
    };
  }

  function inspect(recordingId = null, { from = 0, limit = 20, kind = 'all' } = {}) {
    const target = requireRecording(recordingId);
    const first = Math.max(0, Number(from) | 0);
    const count = Math.max(1, Math.min(64, Number(limit) | 0));
    if (!['all','contact','death','transition'].includes(kind)) throw new Error(`Unknown recording event kind '${kind}'`);
    const events = target.frames.map(frame => {
      const preventedDeaths = Number(frame.after.debug?.wouldDieCount || 0) - Number(frame.before.debug?.wouldDieCount || 0);
      const actorContacts = frame.trace.relevantEntities || [];
      const transitioned = frame.before.hero.active !== frame.after.hero.active ||
        frame.before.hero.state !== frame.after.hero.state || frame.before.hero.motion !== frame.after.hero.motion;
      return {
        frame:frame.index,
        before:{ frameSerial:frame.before.frameSerial, hero:frame.before.hero, camera:frame.before.camera },
        after:{ frameSerial:frame.after.frameSerial, hero:frame.after.hero, camera:frame.after.camera },
        preventedDeaths, actorContacts,
        transition:transitioned ? { from:frame.before.hero.motion, to:frame.after.hero.motion } : null,
        trace:{ exactBranch:frame.trace.exactBranch, terminal:frame.trace.terminal, blocker:frame.trace.blocker }
      };
    }).filter(event => kind === 'all' ||
      (kind === 'contact' && event.actorContacts.length > 0) ||
      (kind === 'death' && event.preventedDeaths > 0) ||
      (kind === 'transition' && event.transition));
    return {
      recordingId:target.id, kind, totalMatches:events.length,
      events:events.slice(first, first + count), next:first + count < events.length ? first + count : null
    };
  }

  return { start, stop, replay, compare, status, inspect };
}

export function readGameplayTrace(bridge) {
  return enrichTraceMappings(bridge, decodeTrace(bridge.debugTraceEvents()));
}
