import { createHeroActionRunner, ACTION_CONDITIONS } from './action-runner.js';
import { installWebMcpTools } from './webmcp.js';
import { gameplayAgentState, stepGameplayControls, walkGameplayUntil, withGameplayFrontendFreeze } from './gameplay-control.js';
import { captureGameplaySnapshot, createGameplayDebugController, explainGameplayAction } from './debug-tools.js';
import { XRICK_GAMEPLAY_CONTROL_BY_NAME } from '../runtime/controls.js';

function gameplayWebMcpState(runtime) {
  return gameplayAgentState(runtime.bridge);
}

function ensureWebMcpDebugPreview() {
  let panel = document.getElementById('rdr-webmcp-debug-preview');
  if (panel) return panel;
  panel = document.createElement('aside');
  panel.id = 'rdr-webmcp-debug-preview';
  panel.setAttribute('aria-label', 'WebMCP debug capture');
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;max-width:min(680px,calc(100vw - 24px));padding:7px;background:#081018;border:1px solid #52606d;border-radius:7px;box-shadow:0 10px 36px #000a;color:#dce6ef;font:10px monospace;display:none';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px';
  const title = document.createElement('strong');
  title.dataset.role = 'title';
  title.textContent = 'WebMCP debug capture';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close WebMCP debug capture');
  close.style.cssText = 'width:22px;height:20px;padding:0;border:1px solid #42515f;background:#101923;color:#dce6ef;border-radius:4px;cursor:pointer';
  close.addEventListener('click', () => { panel.style.display = 'none'; });
  head.append(title, close);
  const body = document.createElement('div');
  body.dataset.role = 'body';
  body.style.cssText = 'display:flex;gap:6px;align-items:flex-start;overflow:auto';
  const legend = document.createElement('div');
  legend.dataset.role = 'legend';
  legend.style.cssText = 'margin-top:5px;color:#98aabd;line-height:1.4;white-space:pre-wrap';
  panel.append(head, body, legend);
  document.body.append(panel);
  return panel;
}

function showWebMcpDebugImages({ title, images, legend = '', append = false }) {
  const panel = ensureWebMcpDebugPreview();
  panel.querySelector('[data-role="title"]').textContent = title;
  const body = panel.querySelector('[data-role="body"]');
  if (!append) body.replaceChildren();
  for (const item of images) {
    const wrap = document.createElement('figure');
    wrap.style.cssText = 'margin:0;display:grid;gap:3px';
    const img = document.createElement('img');
    img.alt = item.label || title;
    img.src = item.dataUrl;
    img.width = 320; img.height = 200;
    img.style.cssText = 'display:block;width:320px;height:200px;image-rendering:pixelated;border:1px solid #354554;background:#000';
    const cap = document.createElement('figcaption');
    cap.textContent = item.label || '';
    cap.style.cssText = 'color:#9eb0c0;text-align:center';
    wrap.append(img, cap);
    body.append(wrap);
  }
  panel.querySelector('[data-role="legend"]').textContent = legend;
  panel.style.display = 'block';
  return { elementId:panel.id, visible:true };
}

function captureWebMcpGameplayScreenshot(machine, overlay = [], nativeFrame = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (!nativeFrame || nativeFrame.frameSerial !== machine.frameSerial ||
      nativeFrame.width !== 320 || nativeFrame.height !== 200 ||
      !(nativeFrame.pixels instanceof Uint8ClampedArray) || nativeFrame.pixels.length !== 320 * 200 * 4) {
    throw new Error(`Native screenshot pixels do not match machine frame ${machine.frameSerial}`);
  }
  ctx.putImageData(new ImageData(nativeFrame.pixels, nativeFrame.width, nativeFrame.height), 0, 0);
  const player = machine.player?.state;
  const dx = player ? player.worldX - player.screenX : 0;
  const dy = player ? player.worldY - player.screenY : 0;
  const worldRect = (bounds, lineWidth = 1) => {
    if (!bounds) return;
    const x = bounds.left - dx, y = bounds.top - dy;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5,
                   Math.max(1, bounds.right - bounds.left), Math.max(1, bounds.bottom - bounds.top));
  };
  const traceCell = (cell, lineWidth = 1) => {
    if (!cell?.world) return;
    const x = Math.floor((cell.world.x - dx) / 8) * 8;
    const y = Math.floor((cell.world.y - dy) / 8) * 8;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x + 0.5, y + 0.5, 7, 7);
  };
  ctx.save();
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';
  if (overlay.includes('player_bounds')) {
    ctx.strokeStyle = '#ffdf4d';
    worldRect(machine.player.bodyBounds, 1);
    worldRect(machine.player.feetBounds, 1);
  }
  if (overlay.includes('entities')) {
    ctx.strokeStyle = '#ff5f5f';
    for (const entity of machine.nearbyDynamicEntities || []) worldRect(entity.actorCollision, 1);
    for (const trigger of machine.triggerVolumes || []) worldRect(trigger.bounds, 1);
  }
  if (overlay.includes('collision_cells')) {
    ctx.strokeStyle = '#55e6ff';
    for (const probe of Object.values(machine.player.coordinateMappings || {})) {
      const wx = probe?.world?.x, wy = probe?.world?.y;
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
      const cellX = Math.floor((wx - dx) / 8) * 8;
      const cellY = Math.floor((wy - dy) / 8) * 8;
      ctx.strokeRect(cellX + 0.5, cellY + 0.5, 7, 7);
    }
  }
  if (overlay.includes('queried_cells')) {
    ctx.strokeStyle = '#59d8ff';
    for (const cell of machine.actionTrace?.queriedCells || []) traceCell(cell, 1);
  }
  if (overlay.includes('blocking_sample') && machine.actionTrace?.blocker) {
    const blockerIndex = machine.actionTrace.blocker.sampleIndex;
    const blocker = (machine.actionTrace.queriedCells || []).find(cell => cell.sampleIndex === blockerIndex);
    ctx.strokeStyle = '#ff4b31';
    traceCell(blocker || { world:machine.actionTrace.blocker.world }, 3);
    if (machine.actionTrace.blocker.world) {
      const x = machine.actionTrace.blocker.world.x - dx;
      const y = machine.actionTrace.blocker.world.y - dy;
      ctx.fillStyle = '#ff4b31';
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
    }
  }
  if (overlay.includes('coordinates') && player) {
    const text = `F${machine.frameSerial} W(${player.worldX},${player.worldY}) S(${player.screenX},${player.screenY})`;
    const width = Math.ceil(ctx.measureText(text).width) + 4;
    ctx.fillStyle = '#000';
    ctx.fillRect(1, 1, width, 11);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, 3, 2);
  }
  const legendRows = machine.overlayLegend || [];
  if (legendRows.length) {
    const labels = legendRows.map(row => row.label);
    const width = Math.max(...labels.map(label => Math.ceil(ctx.measureText(label).width))) + 16;
    const height = labels.length * 10 + 4;
    const x = 319 - width, y = 1;
    ctx.fillStyle = '#000c';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#fff';
    labels.forEach((label, index) => ctx.fillText(label, x + 4, y + 2 + index * 10));
  }
  ctx.restore();
  const dataUrl = canvas.toDataURL('image/png');
  const preview = showWebMcpDebugImages({
    title:`WebMCP snapshot · frame ${machine.frameSerial}`,
    images:[{ label:machine.presentation, dataUrl }],
    legend:(machine.overlayLegend || []).map(row => row.label).join(' · ')
  });
  return { mimeType:'image/png', width:320, height:200, frameSerial:machine.frameSerial, preview };
}

function captureWebMcpPresentationPair({ frameSerial, classicPixels, rdxPixels, pixelDifference, geometryAlignment, append = false }) {
  const image = pixels => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.putImageData(new ImageData(pixels, 320, 200), 0, 0);
    return canvas.toDataURL('image/png');
  };
  const classicDataUrl = image(classicPixels);
  const rdxDataUrl = image(rdxPixels);
  const preview = showWebMcpDebugImages({
    title:append ? 'Classic ↔ RDX replay comparison' : `Classic ↔ RDX · frame ${frameSerial}`,
    images:[{ label:`F${frameSerial} · Classic`, dataUrl:classicDataUrl }, { label:`F${frameSerial} · RDX`, dataUrl:rdxDataUrl }],
    legend:`pixel change ${(pixelDifference.changedRatio * 100).toFixed(1)}% · geometry shift ${geometryAlignment.shifted}/${geometryAlignment.matched}`,
    append
  });
  return { frameSerial, preview };
}

export async function installGameplayWebMcp({ runtime, aiController, elements = {}, actions = {} }) {
  const { assetToggleButton, resetLevelButton, invulnerableToggle } = elements;
  const { requestSubmap } = actions;
  const debugController = createGameplayDebugController(runtime.bridge, {
    /* Use the same canonical deterministic seed as native AI proof work.  The
     * ordinary UI reset only queues a reset for a later browser frame and is
     * therefore not a valid recording checkpoint. */
    resetRoomEntry: () => runtime.bridge.restartCurrentLevelForAi(),
    renderPresentationPair: captureWebMcpPresentationPair
  });
  runtime.setGameplayDebugController?.(debugController);
  const actionRunner = createHeroActionRunner(runtime.bridge, {afterRun:result => aiController.recordActionRun(result), beforeRun:() => {
    if (debugController.status().active) throw new Error('Stop the debug recording before executing an action list');
    aiController.stopCoach('Agent action list took control.');
  }});
  let simulationOwner = null;
  const guardActionRun = tool => {
    if (tool.name === 'cancel_actions') return;
    if (tool.readOnly && tool.name !== 'capture_snapshot') return;
    if (simulationOwner) {
      if (tool.name === 'stop' && !actionRunner.busy()) return;
      throw new Error(`${simulationOwner} owns native simulation; wait or cancel before other mutations`);
    }
    simulationOwner = tool.name;
    return () => { simulationOwner = null; };
  };
  const controlBits = XRICK_GAMEPLAY_CONTROL_BY_NAME;
  const gameplayHandle = await installWebMcpTools({
    namespace: 'rdr.gameplay', beforeExecute:guardActionRun,
    tools: [
      {
        name:'run_actions', title:'Execute deterministic hero action list',
        description:'Execute native controls from current state or restore baselineId for a revised attempt. Empty controls wait/fall; up jumps/climbs, down crouches/descends, fire combines with direction for native weapons. Coordinate conditions use Rick bottom-centre world pixels. Bounds total at most 12000 frames. Stop on death, timeout, unexpected room transition or cancellation; return native evidence and hold state.',
        inputSchema:{type:'object',required:['actions'],additionalProperties:false,properties:{baselineId:{type:'string'},actions:{type:'array',minItems:1,maxItems:256,items:{type:'object',required:['controls'],additionalProperties:false,properties:{controls:{type:'array',uniqueItems:true,items:{type:'string',enum:['left','right','up','down','fire']}},frames:{type:'integer',minimum:1,maximum:4000},until:{type:'string',enum:ACTION_CONDITIONS},target:{type:'integer'},maxFrames:{type:'integer',minimum:1,maximum:4000}}}}}},
        execute:options => actionRunner.run(options)
      },
      {name:'replay_actions',title:'Replay exact hero input tape',description:'Restore the retained native baseline and compare each frame of the exact resolved input tape. Stops on the first divergence and holds the result.',inputSchema:{type:'object',additionalProperties:false,properties:{baselineId:{type:'string'}}},execute:options => actionRunner.replay(options)},
      {name:'get_actions',title:'Inspect action baseline and native actors',readOnly:true,description:'Observe action status, native live actor fields and runtime options without advancing simulation. Actor state and counters describe reactive timing; they are not independent browser predictions.',execute:() => actionRunner.state()},
      {name:'cancel_actions',title:'Cancel hero action list',description:'Stop the action list at its next cooperative boundary and hold the native state.',execute:() => actionRunner.cancel()},

      {
        name: 'get_state', title: 'Observe Rick gameplay state', readOnly: true,
        description: 'Read a compact agent-oriented native gameplay observation: Rick world/screen position, grounded/rising/falling state, vertical velocity, camera, inventory, map/submap and presentation. Use this for feedback instead of screen-reading.',
        execute: () => gameplayWebMcpState(runtime)
      },
      {
        name: 'explain_action', title: 'Explain one native gameplay action',
        description: 'Execute one real native C gameplay frame under an exact action, return the attempted state transition, every captured collision sample, Classic/RDX coordinate provenance, relevant dynamic entities and the exact native decision branches. apply=false restores the byte-exact native checkpoint afterward.',
        inputSchema: {
          type:'object',
          properties:{
            action:{ type:'string', enum:['move_left','move_right','move_up','move_down','fire'] },
            apply:{ type:'boolean', default:false },
            freeze:{ type:'boolean', default:true, description:'Temporarily pause the normal frontend loop while the native dry-run executes.' }
          },
          required:['action'], additionalProperties:false
        },
        execute: ({ action, apply = false, freeze = true }) => explainGameplayAction(runtime.bridge, { action, apply, freeze })
      },
      {
        name: 'set_presentation', title: 'Set gameplay presentation',
        description: 'Switch the running game between Classic and Revival presentation while preserving native gameplay state.',
        inputSchema: { type:'object', properties:{ presentation:{ type:'string', enum:['classic','revival'] } }, required:['presentation'], additionalProperties:false },
        execute: ({ presentation }) => {
          if (!runtime.bridge || !assetToggleButton || assetToggleButton.disabled) throw new Error('Presentation switching is not ready');
          const wantClassic = presentation === 'classic';
          if (runtime.bridge.classicAssets() !== wantClassic) assetToggleButton.click();
          return gameplayWebMcpState(runtime);
        }
      },
      {
        name: 'select_submap', title: 'Open gameplay submap',
        description: 'Start a mapped gameplay submap by zero-based SM number (SM00 is 0).',
        inputSchema: { type:'object', properties:{ submap:{ type:'integer', minimum:0, maximum:46 } }, required:['submap'], additionalProperties:false },
        execute: ({ submap }) => {
          if (!requestSubmap(submap)) throw new Error(`Submap ${submap} is not available`);
          return gameplayWebMcpState(runtime);
        }
      },
      {
        name: 'reset_level', title: 'Reset current level',
        description: 'Reset the current native xrick level to its start state.',
        execute: () => {
          if (!runtime.bridge || !resetLevelButton) throw new Error('xrick runtime is not ready');
          resetLevelButton.click();
          return gameplayWebMcpState(runtime);
        }
      },
      {
        name: 'set_invincible', title: 'Set invincibility',
        description: 'Enable or disable the gameplay debug invincibility mode used for inspection and traversal.',
        inputSchema: { type:'object', properties:{ enabled:{ type:'boolean' } }, required:['enabled'], additionalProperties:false },
        execute: ({ enabled }) => {
          if (!runtime.bridge || !invulnerableToggle) throw new Error('Invincibility controls are not ready');
          if (invulnerableToggle.checked !== !!enabled) {
            invulnerableToggle.checked = !!enabled;
            invulnerableToggle.dispatchEvent(new Event('change'));
          }
          return gameplayWebMcpState(runtime);
        }
      },
      {
        name: 'step_controls', title: 'Step Rick controls',
        description: 'Preferred low-level agent control. Apply native Rick controls for an exact bounded number of forced simulation frames and return concise before/after hero state. This does not require canvas focus or keyboard events.',
        inputSchema: {
          type:'object',
          properties:{
            controls:{ type:'array', items:{ type:'string', enum:['left','right','up','down','fire'] }, minItems:1, uniqueItems:true },
            frames:{ type:'integer', minimum:1, maximum:600, default:1 },
            freeze:{ type:'boolean', default:true, description:'Hold the normal frontend loop during this synchronous WebMCP control call; explicit debug frames still advance.' }
          },
          required:['controls'], additionalProperties:false
        },
        execute: ({ controls, frames = 1, freeze = true }) => {
          const mask = controls.reduce((value, control) => value | (controlBits[control] || 0), 0);
          return aiController.runCoachGameplayIntervention('step-controls', { controls, frames, freeze }, () =>
            withGameplayFrontendFreeze(runtime.bridge, !!freeze, () => stepGameplayControls(runtime.bridge, mask, frames)));
        }
      },
      {
        name: 'wait_frames', title: 'Wait native gameplay frames',
        description: 'Advance an exact bounded number of native production frames with all Rick controls released. Use this during AI coaching to wait for enemies, projectiles, moving platforms or mechanism timing without keyboard events.',
        inputSchema: {
          type:'object',
          properties:{
            frames:{ type:'integer', minimum:1, maximum:600, default:1 },
            freeze:{ type:'boolean', default:true, description:'Hold the normal frontend loop during this synchronous WebMCP control call; explicit debug frames still advance.' }
          },
          additionalProperties:false
        },
        execute: ({ frames = 1, freeze = true }) => aiController.runCoachGameplayIntervention('wait-frames', { frames, freeze }, () =>
          withGameplayFrontendFreeze(runtime.bridge, !!freeze, () => stepGameplayControls(runtime.bridge, 0, frames)))
      },
      {
        name: 'walk_until', title: 'Walk Rick until condition',
        description: "Preferred tool for semantic horizontal movement such as 'walk right until Rick falls'. Drive native left/right input frame-by-frame and stop immediately when the requested condition is observed. Do not click the canvas or send keyboard events for this task.",
        inputSchema: {
          type:'object',
          properties:{
            direction:{ type:'string', enum:['left','right'] },
            until:{ type:'string', enum:['falling','airborne','blocked','x_at_least','x_at_most','inactive','submap_changed','landed'], default:'falling' },
            targetX:{ type:'integer' },
            maxFrames:{ type:'integer', minimum:1, maximum:1200, default:600 },
            blockedWindow:{ type:'integer', minimum:2, maximum:120, default:12 },
            freeze:{ type:'boolean', default:true, description:'Hold the normal frontend loop during this synchronous WebMCP control call; explicit debug frames still advance.' }
          },
          required:['direction'], additionalProperties:false
        },
        execute: ({ direction, until = 'falling', targetX = null, maxFrames = 600, blockedWindow = 12, freeze = true }) => {
          const request = { direction, until, targetX, maxFrames, blockedWindow, freeze };
          return aiController.runCoachGameplayIntervention('walk-until', request, () =>
            withGameplayFrontendFreeze(runtime.bridge, !!freeze, () => walkGameplayUntil(runtime.bridge, {
              direction,
              directionMask: controlBits[direction],
              until,
              targetX,
              maxFrames,
              blockedWindow
            })));
        }
      },
      {
        name: 'hold_controls', title: 'Drive Rick (compatibility)',
        description: 'Compatibility alias for deterministic native-frame control. Prefer step_controls for short maneuvers and walk_until for semantic movement; no canvas focus or synthetic keyboard input is needed.',
        inputSchema: {
          type:'object',
          properties:{
            controls:{ type:'array', items:{ type:'string', enum:['left','right','up','down','fire'] }, minItems:1, uniqueItems:true },
            frames:{ type:'integer', minimum:1, maximum:600, default:1 },
            freeze:{ type:'boolean', default:true, description:'Hold the normal frontend loop during this synchronous WebMCP control call; explicit debug frames still advance.' }
          },
          required:['controls'], additionalProperties:false
        },
        execute: ({ controls, frames = 1, freeze = true }) => {
          const mask = controls.reduce((value, control) => value | (controlBits[control] || 0), 0);
          return aiController.runCoachGameplayIntervention('hold-controls', { controls, frames, freeze }, () =>
            withGameplayFrontendFreeze(runtime.bridge, !!freeze, () => stepGameplayControls(runtime.bridge, mask, frames)));
        }
      }
    ]
  });

  const debugHandle = await installWebMcpTools({
    namespace: 'rdr.debug', beforeExecute:guardActionRun,
    tools: [
      {
        name:'capture_snapshot', title:'Capture atomic gameplay snapshot', readOnly:true,
        description:'Return a frame-locked native snapshot and show its annotated production screenshot directly on the page. Optionally dry-run an action (or reuse a traceId from explain_action) so queried collision cells and the terminal blocker are highlighted on that exact frame.',
        inputSchema:{ type:'object', properties:{
          overlay:{ type:'array', items:{ type:'string', enum:['player_bounds','collision_cells','queried_cells','blocking_sample','entities','coordinates'] }, uniqueItems:true, default:[] },
          action:{ type:'string', enum:['move_left','move_right','move_up','move_down','fire'] },
          traceId:{ type:'string' },
          includeGeometry:{ type:'boolean', default:false },
          freeze:{ type:'boolean', default:true, description:'Temporarily pause the normal frontend loop while state and pixels are captured.' }
        }, additionalProperties:false },
        execute:({ overlay = [], action = null, traceId = null, includeGeometry = false, freeze = true }) => captureGameplaySnapshot(runtime.bridge, { overlay, action, traceId, includeGeometry, freeze }, { captureScreenshot:captureWebMcpGameplayScreenshot })
      },
      {
        name:'record', title:'Start deterministic native repro recording',
        description:'Save an exact native checkpoint and start recording subsequent WebMCP gameplay frames. freeze=true (default) holds the normal frontend loop between calls so only captured forced frames advance simulation; freeze=false leaves the game live and reports any unrecorded frame gaps.',
        inputSchema:{ type:'object', properties:{ checkpoint:{ type:'string', enum:['current','room_entry'], default:'current' }, inputs:{ type:'boolean', default:true, description:'Retain exact per-frame input masks; required for replay/compare.' }, decisions:{ type:'boolean', default:true }, freeze:{ type:'boolean', default:true } }, additionalProperties:false },
        execute:options => debugController.start(options)
      },
      {
        name:'stop_recording', title:'Stop deterministic native repro recording',
        description:'Stop capturing frames and release any recording-owned frontend freeze while retaining the checkpoint and recorded data for later replay/compare.',
        inputSchema:{ type:'object', properties:{ recordingId:{ type:'string' } }, additionalProperties:false },
        execute:({ recordingId = null }) => debugController.stop(recordingId)
      },
      {
        name:'get_recording', title:'Inspect repro recording', readOnly:true,
        description:'Return recording status, captured frame count and any currently pending unrecorded frontend drift without advancing gameplay.',
        execute:() => debugController.status()
      },
      {
        name:'inspect_recording', title:'Inspect recorded native frames', readOnly:true,
        description:'Inspect a bounded page of deterministic recording frames, filtered for native actor contacts, prevented deaths, or player-state transitions. Each event includes the exact native actor contact boxes and before/after camera phases.',
        inputSchema:{ type:'object', properties:{
          recordingId:{ type:'string' }, from:{ type:'integer', minimum:0, default:0 },
          limit:{ type:'integer', minimum:1, maximum:64, default:20 },
          kind:{ type:'string', enum:['all','contact','death','transition'], default:'all' }
        }, additionalProperties:false },
        execute:({ recordingId = null, from = 0, limit = 20, kind = 'all' }) => debugController.inspect(recordingId, { from, limit, kind })
      },
      {
        name:'replay', title:'Replay deterministic native repro',
        description:'Restore the recording baseline and replay the exact recorded per-frame native input masks. Validate every replayed state/trace against the original recording and return firstMismatch. freeze=true leaves the reproduced final state paused for immediate inspection; stop_recording releases recording-owned freeze.',
        inputSchema:{ type:'object', properties:{ recordingId:{ type:'string' }, freeze:{ type:'boolean', default:true } }, additionalProperties:false },
        execute:({ recordingId = null, freeze = true }) => debugController.replay(recordingId, { freeze })
      },
      {
        name:'compare', title:'Compare deterministic native repro',
        description:'Replay one recording from the same native baseline across Classic and RDX while holding collision policy constant. Report gameplay firstDivergence plus frame-locked pixel/nearby-geometry visual divergence; restore the live gameplay state afterward. freeze=true leaves that restored state paused for immediate inspection; stop_recording releases recording-owned freeze.',
        inputSchema:{
          type:'object',
          properties:{
            recordingId:{ type:'string' },
            presentation:{ type:'array', items:{ type:'string', enum:['classic','rdx','revival'] }, minItems:1, uniqueItems:true, default:['classic','rdx'] },
            collisionPolicy:{ type:'string', enum:['recorded','verified_only_pause','classic_fallback_warn','classic_only','rdx_verified'], default:'recorded' },
            freeze:{ type:'boolean', default:true },
            visual:{ type:'boolean', default:true, description:'Capture frame-locked Classic/RDX presentation metrics on the same replayed native frame.' },
            screenshots:{ type:'string', enum:['none','first','all'], default:'first' }
          }, additionalProperties:false
        },
        execute:({ recordingId = null, presentation = ['classic','rdx'], collisionPolicy = 'recorded', freeze = true, visual = true, screenshots = 'first' }) => debugController.compare(recordingId, { presentation, collisionPolicy, freeze, visual, screenshots })
      }
    ]
  });

  const aiHandle = await installWebMcpTools({
    namespace: 'rdr.ai', beforeExecute:guardActionRun,
    tools: [
      {name:'run_until_blocked',title:'Run GAI to a held handoff',description:'Plan from exact current native state, execute certified progress, automatically recapture after irreversible native prerequisite clears, and report the first real blockage or scheduling limit. After native intervention call again without restart. Never silently restart the room.',inputSchema:{type:'object',additionalProperties:false,properties:{restart:{type:'boolean',default:false},validationBudget:{type:'integer',minimum:1,maximum:1000000,default:24},maxFrames:{type:'integer',minimum:1,maximum:4000,default:4000}}},execute:options => aiController.runUntilBlocked(options)},

      {
        name: 'get_state', title: 'Inspect GAI state', readOnly: true,
        description: 'Observe native GAI and Rick state. Compact mode is tuned for the drive/feedback loop; diagnostic mode returns the full planner rejection history when investigating a blocker.',
        inputSchema: {
          type:'object',
          properties:{ detail:{ type:'string', enum:['compact','diagnostic'], default:'compact' } },
          additionalProperties:false
        },
        execute: ({ detail = 'compact' }) => aiController.agentState({ diagnostic:detail === 'diagnostic' })
      },
      {
        name: 'configure', title: 'Configure GAI coaching',
        description: 'Configure the native GAI coaching contract before a run. Mortal mode requires certified safe routing; invulnerable_reachability is a diagnostic reachability policy that permits lethal contacts. Validation budget 0 means unlimited.',
        inputSchema: {
          type:'object',
          properties:{
            mode:{ type:'string', enum:['mortal','invulnerable_reachability'], default:'mortal' },
            validationBudget:{ type:'integer', minimum:0, maximum:1000000, default:0 },
            continueRooms:{ type:'boolean', default:true }
          },
          additionalProperties:false
        },
        execute: options => aiController.configureCoach(options)
      },
      {
        name: 'start', title: 'Start coached GAI run',
        description: 'Start a new measured coaching session from the canonical restart of the current room, precompute the native full-room deterministic certificate/prefix, and return planner diagnostics. Use this instead of clicking AI Play.',
        inputSchema: {
          type:'object',
          properties:{
            mode:{ type:'string', enum:['mortal','invulnerable_reachability'], default:'mortal' },
            validationBudget:{ type:'integer', minimum:0, maximum:1000000, default:0 },
            continueRooms:{ type:'boolean', default:true }
          },
          additionalProperties:false
        },
        execute: options => aiController.startCoach(options)
      },
      {
        name: 'advance', title: 'Advance native GAI',
        description: 'Deterministically execute the current native GAI certificate for bounded production frames without canvas focus or keyboard input. Stops at a handoff/blocker, room transition, planning boundary, simulation stall, or frame limit and returns feedback for the next decision.',
        inputSchema: {
          type:'object',
          properties:{
            maxFrames:{ type:'integer', minimum:1, maximum:4000, default:1200 },
            framesPerPaint:{ type:'integer', minimum:1, maximum:60, default:2, description:'Native production frames per visible browser paint. Lower values are smoother; 2 is the default coaching cadence.' }
          },
          additionalProperties:false
        },
        execute: ({ maxFrames = 1200, framesPerPaint = 2 }) => aiController.advanceCoach(maxFrames, framesPerPaint)
      },
      {
        name: 'replan', title: 'Replan GAI from live state',
        description: 'Hand the exact current live Rick/world state back to native GAI after an external-agent intervention. No restart or browser-side pathfinding is performed. Full-room planning is preferred so the next blocker remains a certified handoff.',
        inputSchema: {
          type:'object',
          properties:{ fullRoom:{ type:'boolean', default:true } },
          additionalProperties:false
        },
        execute: ({ fullRoom = true }) => aiController.replanCoach({ fullRoom })
      },
      {
        name: 'plan_route', title: 'Plan reusable GAI route',
        description: 'Plan a deterministic same-room A-to-B route with native GAI. A is the current Rick bottom-centre world coordinate unless from is supplied. Mortal mode requires the normal safe certificate; immortal mode uses diagnostic reachability with invincibility. The resulting exact input tape and native baseline are retained for repeated replay.',
        inputSchema: {
          type:'object',
          required:['to'],
          properties:{
            from:{
              type:'object', required:['x','y'], additionalProperties:false,
              properties:{ x:{type:'integer', minimum:-32768, maximum:32767}, y:{type:'integer', minimum:-32768, maximum:32767}, crawling:{type:'boolean', default:false} }
            },
            to:{
              type:'object', required:['x','y'], additionalProperties:false,
              properties:{ x:{type:'integer', minimum:-32768, maximum:32767}, y:{type:'integer', minimum:-32768, maximum:32767} }
            },
            mode:{ type:'string', enum:['mortal','immortal'], default:'mortal' },
            tolerance:{ type:'integer', minimum:0, maximum:32, default:4 },
            validationBudget:{ type:'integer', minimum:0, maximum:1000000, default:0 }
          },
          additionalProperties:false
        },
        execute: options => aiController.planReusableRoute(options)
      },
      {
        name: 'get_route', title: 'Inspect reusable GAI route', readOnly:true,
        description: 'Inspect the currently retained A-to-B route artifact without advancing gameplay. The input tape itself stays internal so repeated WebMCP use remains compact.',
        inputSchema:{ type:'object', properties:{ routeId:{type:'string'} }, additionalProperties:false },
        execute:({ routeId = null }) => aiController.reusableRouteState(routeId)
      },
      {
        name: 'replay_route', title: 'Replay reusable GAI route',
        description: 'Restore the retained native A baseline and replay its exact input tape through production gameplay. Every frame is compared with the materialized reference; the first divergence is returned and left held for diagnosis. Replaying the same route again always starts from the same baseline.',
        inputSchema:{
          type:'object',
          properties:{ routeId:{type:'string'}, freeze:{type:'boolean', default:true} },
          additionalProperties:false
        },
        execute:({ routeId = null, freeze = true }) => aiController.replayReusableRoute(routeId, { freeze })
      },
      {
        name: 'stop', title: 'Stop GAI coaching',
        description: 'Release GAI controls without resetting gameplay, preserving the exact live state for inspection or external-agent intervention.',
        inputSchema: {
          type:'object',
          properties:{ reason:{ type:'string', maxLength:240 } },
          additionalProperties:false
        },
        execute: ({ reason = 'External agent stopped GAI coaching.' }) => aiController.stopCoach(reason)
      },
      {
        name: 'get_session_report', title: 'Analyze GAI coaching session', readOnly: true,
        description: 'Return aggregate planner outcomes, proof counts, AI-vs-agent frame share, blockers, interventions and recent coaching events for performance analysis.',
        inputSchema: {
          type:'object',
          properties:{ eventLimit:{ type:'integer', minimum:0, maximum:96, default:24 } },
          additionalProperties:false
        },
        execute: ({ eventLimit = 24 }) => aiController.coachSessionReport(eventLimit)
      }
    ]
  });

  return Object.freeze({
    supported: !!(gameplayHandle.supported || debugHandle.supported || aiHandle.supported),
    registered: Object.freeze([...gameplayHandle.registered, ...debugHandle.registered, ...aiHandle.registered]),
    dispose() { gameplayHandle.dispose(); debugHandle.dispose(); aiHandle.dispose(); }
  });
}
