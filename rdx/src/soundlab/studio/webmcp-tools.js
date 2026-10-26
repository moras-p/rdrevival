/* WebMCP surface for SoundLab Studio. Every tool is a thin call into the same
 * app actions the UI uses, so whatever an agent does is visible on screen and
 * a person can take over at any point. */

import { CATALOG, EVENT_GROUPS, FAMILIES, groupOf, stageOf } from './catalog.js';
import { spanEventId } from './context.js';
import { CONTAINER_MODES, CURVES, FILTER_TYPES, LAYER_KINDS, MAPPING_SOURCES, MOVEMENT_METHODS, MOVEMENT_PARAMS, NOISE_COLORS, PARAMS, SEGMENTS, TRANSITION_MODES, TRANSITION_TIME, WAVEFORMS, mappingTargets } from './design.js';
import { EQ_BANDS, EQ_LIMIT_DB, FOLEY_MODELS, FOLEY_PARAMS, MATERIALS } from './foley.js';
import { EARSHOT_DIRECTIONS } from './earshot.js';
import { REVIEW_TAGS, VERDICTS } from './review.js';

const OBJ = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const INT = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const STR = (description, extra = {}) => ({ type: 'string', description, ...extra });
const EVENT = STR('Catalog event id from list_events', { enum: CATALOG.map(e => e.id) });
const TARGET = STR('Occurrence id (from find_occurrences) or span id to audition against; defaults to the selected or first recorded occurrence');
const BOOL = description => ({ type: 'boolean', description });
const NUM = (description, extra = {}) => ({ type: 'number', description, ...extra });

/* The Foley generator's controls, as ranges, for agents. */
export function foleyVocabulary() {
  return {
    models: Object.fromEntries(Object.entries(FOLEY_MODELS).map(([k, m]) => [k, { label: m.label, continuous: !!m.continuous, help: m.help }])),
    materials: Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [k, m.label])),
    params: Object.fromEntries(Object.entries(FOLEY_PARAMS).map(([k, [min, max, def, unit, label, help]]) => [k, { min, max, default: def, unit, label, help }])),
    eqBands: EQ_BANDS, eqLimitDb: EQ_LIMIT_DB,
    flags: { followMotion: 'continuous models: follow the recorded speed over time instead of a fixed speed and length' }
  };
}

function base64ToBytes(b64) {
  const text = String(b64).replace(/^data:[^,]*,/, '');
  if (typeof atob === 'function') { const bin = atob(text); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out.buffer; }
  const buf = Buffer.from(text, 'base64'); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const foleyState = bench => ({ recipe: bench.foley.recipe ? { ...bench.foley.recipe } : null, description: bench.foley.description, understood: bench.foley.terms, reference: bench.foley.reference ? { label: bench.foley.reference.label, durationMs: Math.round(bench.foley.reference.features.durationMs), centroidHz: Math.round(bench.foley.reference.features.centroidHz) } : null, referenceWeight: bench.foley.referenceWeight, allowModelChange: !!bench.foley.allowModelChange, fit: bench.foley.fit, takes: bench.takesView(), rounds: bench.foleyRounds(), earshot: bench.earshotStatus() });

/* The parameter vocabulary an agent patches with, as ranges. */
export function designVocabulary(design) {
  const ranges = table => Object.fromEntries(Object.entries(table).map(([k, [min, max, def, unit, label]]) => [k, { min, max, default: def, unit, label }]));
  return {
    layerKinds: LAYER_KINDS, waveforms: WAVEFORMS, noiseColors: NOISE_COLORS, filterTypes: FILTER_TYPES, segments: SEGMENTS,
    containerModes: CONTAINER_MODES, curves: CURVES,
    layer: ranges(PARAMS.layer), master: ranges(PARAMS.master), variation: ranges(PARAMS.variation), loop: ranges(PARAMS.loop),
    mappingSources: MAPPING_SOURCES, mappingTargets: design ? mappingTargets(design) : [],
    transitions: { in: TRANSITION_MODES.in, out: TRANSITION_MODES.out, timeMs: { min: TRANSITION_TIME[0], max: TRANSITION_TIME[1], default: TRANSITION_TIME[2] } },
    movement: { methods: MOVEMENT_METHODS, params: Object.fromEntries(Object.entries(MOVEMENT_PARAMS).map(([k, [min, max, def, unit, label, help]]) => [k, { min, max, default: def, unit, label, help }])) }
  };
}

export function soundlabWebMcpTools(app) {
  return [
    {
      name: 'get_state', title: 'Read SoundLab state', readOnly: true,
      description: 'Session summary (start room, recorded frame range, live/playing state), the playhead frame and the current selection.',
      execute: () => app.summary()
    },
    {
      name: 'list_events', title: 'List sound events', readOnly: true,
      description: 'The catalog of every game sound event with family, status (original = recovered game sound only, soundlab = has a SoundLab design, needs-hook = the game cannot emit it yet) and how often each occurred in the current session and in which rooms.',
      inputSchema: OBJ({ family: STR('Optional family filter', { enum: FAMILIES.map(f => f.id) }) }),
      execute: ({ family } = {}) => {
        const coverage = app.session().coverage();
        return CATALOG.filter(e => !family || e.family === family).map(e => ({
          id: e.id, family: e.family, label: e.label, description: e.description, status: e.status, group: groupOf(e.id)?.id || null, stage: stageOf(e.id),
          occurrences: coverage[e.id]?.count || 0, rooms: coverage[e.id]?.rooms || []
        }));
      }
    },
    {
      name: 'start_session', title: 'Start a recording session',
      description: 'Reset the game to a room\'s start pose and begin a new recording. Room numbers are submaps (0 = SM00, the first jungle room). The previous recording is discarded.',
      inputSchema: OBJ({ submap: INT('Start room (submap number)', { minimum: 0, maximum: 70 }) }, ['submap']),
      execute: async ({ submap }) => app.startSession(submap)
    },
    {
      name: 'run_frames', title: 'Advance the game',
      description: 'Advance the game by N native 25 Hz frames while holding a control mask, recording every frame. Mask bits: 1 right, 2 left, 4 down, 8 up, 16 fire (24 = fire+up = gun, 20 = fire+down = dynamite). Returns the sounds that fired.',
      inputSchema: OBJ({ frames: INT('Frames to advance (1-3000)', { minimum: 1, maximum: 3000 }), mask: INT('Control mask held for every frame', { minimum: 0, maximum: 31 }) }, ['frames']),
      execute: ({ frames, mask = 0 }) => app.runFrames(frames, mask)
    },
    {
      name: 'set_playback', title: 'Play or pause',
      description: 'Play the game in real time (the human can control it with the keyboard) or pause it.',
      inputSchema: OBJ({ playing: { type: 'boolean' } }, ['playing']),
      execute: ({ playing }) => app.setPlaying(playing)
    },
    {
      name: 'find_occurrences', title: 'Find occurrences of an event', readOnly: true,
      description: 'Every recorded occurrence of a catalog event (or of a raw sound name such as "walk" or "ent3"), optionally limited to one room.',
      inputSchema: OBJ({
        eventId: STR('Catalog event id from list_events'),
        name: STR('Raw sound or cue name instead of an event id'),
        submap: INT('Optional room filter', { minimum: 0 }),
        limit: INT('Maximum rows (default 50)', { minimum: 1, maximum: 500 })
      }),
      execute: ({ eventId, name, submap, limit = 50 } = {}) => app.findOccurrences({ eventId, name, submap, limit })
    },
    {
      name: 'seek', title: 'Move the playhead',
      description: 'Show a recorded frame (or an occurrence, which is also selected) in the game view and inspector. The live game itself does not rewind.',
      inputSchema: OBJ({ frame: INT('Recorded frame number'), occurrenceId: STR('Occurrence id from find_occurrences') }),
      execute: ({ frame, occurrenceId } = {}) => app.seek({ frame, occurrenceId })
    },
    {
      name: 'get_occurrence_state', title: 'Inspect one occurrence', readOnly: true,
      description: 'Game state behind one sound: source actor type, position, velocity (px/s), acceleration, direction, platform state, room and region, distance to Rick, stereo pan, active motion spans and the other sounds within half a second.',
      inputSchema: OBJ({ occurrenceId: STR('Occurrence id') }, ['occurrenceId']),
      execute: ({ occurrenceId }) => app.inspect(occurrenceId)
    },
    {
      name: 'get_frame', title: 'Read one recorded frame', readOnly: true,
      description: 'Actors, control input and sounds of one recorded frame, plus a PNG of the game view with the overlay when image=true.',
      inputSchema: OBJ({ frame: INT('Recorded frame number'), image: { type: 'boolean', description: 'Include a PNG data URL' } }, ['frame']),
      execute: async ({ frame, image = false }) => app.frameDetail(frame, { image })
    },
    {
      name: 'export_session', title: 'Export the session', readOnly: true,
      description: 'The recorded session as JSON (start room, per-frame inputs, actors and sounds). Pass it back to replay_session to reproduce it exactly.',
      execute: () => app.session().toJSON()
    },
    {
      name: 'replay_session', title: 'Replay a saved session',
      description: 'Reset to the saved start room and replay its input log in real time, recording a fresh session.',
      inputSchema: OBJ({ session: { type: 'object', description: 'A soundlab.studio-session.v1 object from export_session' } }, ['session']),
      execute: async ({ session }) => app.replaySession(session)
    },
    {
      name: 'list_event_groups', title: 'List event groups', readOnly: true,
      description: 'Groups of events that are one moving thing heard in stages (boulder: release → rolling → comes to rest; moving platform; pipe fire). Each group is designed as one staged design on its lead event (get_design with the lead id): layers play in the start, move (loop segment, following the recorded speed) or stop stage, joined by in/out transitions (patch_design container.transitions). The movement plays as bites per distance travelled, a seamless loop or generated along the run (container.movement); render_candidate reports its measurements (bite brightness spread, seam roughness). Returns stages with their events, related events that keep their own designs, and how many runs were recorded.',
      execute: () => EVENT_GROUPS.map(g => ({
        id: g.id, label: g.label, lead: g.lead, also: g.also,
        stages: g.stages.map(st => ({ id: st.id, label: st.label, events: st.events })),
        runs: app.session().spans.filter(sp => spanEventId(sp) === g.lead).map(sp => ({ spanId: sp.id, start: sp.start, end: sp.end }))
      }))
    },
    {
      name: 'get_design', title: 'Open a sound design',
      description: 'Open the design for a catalog event in the Design tab and return it: layers (foley/sample/tone/noise with envelope, pitch, filter, EQ, drive), variation, container (oneshot or loop with start/loop/stop segments), game-parameter mappings and master/space settings, plus the parameter vocabulary with ranges, the selectable samples, the occurrences it can be auditioned against and the highlighted context range. A new design starts from what the game plays today.',
      inputSchema: OBJ({ eventId: EVENT, target: TARGET }, ['eventId']),
      execute: async ({ eventId, target }) => {
        const out = app.bench.open(eventId, { target });
        app.selectTab('design');
        return { ...out, vocabulary: designVocabulary(out.design), samples: app.bench.library.catalogue() };
      }
    },
    {
      name: 'patch_design', title: 'Change a sound design',
      description: 'Apply a patch to the open design (or eventId). Keys: master {gain,pitch,panAmount,distanceAmount,room,limiter}, variation {count,pitch,gain,time,filter,seed}, container {mode,noRepeat,crossfade,length,stopTail,transitions:{in:{mode,timeMs},out:{mode,timeMs}}, movement:{method:"bites"|"loop"|"synth",bitePx,variants,pitchFollow,refSpeed,loopMs,xfadeMs}}, layers [{id, ...layer params, waveform, color, filter, segment, source:{type:"original"|"published"|"classic",name}, foley:{...recipe}, enabled, solo}], addLayer {kind, ...params}, removeLayer "<id>", mappings [{source,target,curve,inMin,inMax,outMin,outMax}] (replaces all; targets include layer:<id>.foley.<param>), notes. Out-of-range values are clamped and unknown keys rejected; the report says which. The person sees the sliders move.',
      inputSchema: OBJ({ eventId: EVENT, patch: { type: 'object', description: 'Design patch (see description)' } }, ['patch']),
      execute: ({ eventId, patch }) => app.bench.patch(eventId || null, patch, { by: 'agent' })
    },
    {
      name: 'reset_design', title: 'Reset a design to the game sound',
      description: 'Discard the saved draft for an event; the design starts again from what the game plays today.',
      inputSchema: OBJ({ eventId: EVENT }, ['eventId']),
      execute: ({ eventId }) => app.bench.reset(eventId)
    },
    {
      name: 'render_candidate', title: 'Render and measure the design', readOnly: true,
      description: 'Render the open design at its audition context (game values: speed, distance, pan, nearby sounds, room acoustics) and return objective measurements next to the game sound it would replace: length, attack, decay, peak/RMS/loudest-50ms level, crest, spectral centroid, band balance and a comparison (loudness difference, length ratio, spectral distance and similarity). detail=true adds the waveform envelope and spectrogram. play=true also plays it on the person\'s speakers.',
      inputSchema: OBJ({ variant: INT('Variant index (0 = authored design)', { minimum: 0, maximum: 7 }), segment: STR('Container segment to render', { enum: ['oneshot', 'start', 'loop', 'stop'] }), target: TARGET, detail: BOOL('Include envelope and spectrogram'), play: BOOL('Also play it') }),
      execute: async ({ variant = 0, segment = 'oneshot', target, detail = false, play = false } = {}) => {
        if (target) app.bench.setTarget(target);
        const r = await app.bench.renderCandidate({ variant, segment });
        if (play) await app.bench.play('design', { variant });
        return app.bench.report(r, { detail });
      }
    },
    {
      name: 'play_sound', title: 'Play the design or the game sound',
      description: 'Play the open design (one variant, or every variant in turn, each announced) or the game sound it replaces, as heard at the audition moment. Any new playback or stop_playback ends the previous one.',
      inputSchema: OBJ({ which: STR('What to play', { enum: ['design', 'game', 'variants'] }), variant: INT('Variant index for which=design', { minimum: 0, maximum: 7 }) }),
      execute: async ({ which = 'design', variant = 0 } = {}) => (which === 'variants' ? app.bench.playVariants() : app.bench.play(which, { variant }))
    },
    {
      name: 'set_playback_options', title: 'Set volume and looping',
      description: 'Volume (0-1) of everything SoundLab plays, and whether recording playback (timeline and in context) loops the range. Both apply immediately, also to what is playing.',
      inputSchema: OBJ({ volume: NUM('0-1', { minimum: 0, maximum: 1 }), loop: BOOL('Loop range playback') }),
      execute: ({ volume, loop } = {}) => app.setPlaybackOptions({ volume, loop })
    },
    {
      name: 'stop_playback', title: 'Stop playback',
      description: 'Stop whatever SoundLab is playing (design, variants, takes, timeline or in-context playback).',
      execute: () => { app.bench.stop(); return { stopped: true }; }
    },
    {
      name: 'set_context_range', title: 'Set the listening range',
      description: 'Set (or clear with clear=true) the highlighted stretch of the recording that in-context playback plays; widen it to hear more context. Frames are native 25 Hz recorded frames. Opening an event or choosing a target resets it to about a second around the moment.',
      inputSchema: OBJ({ from: INT('First frame'), to: INT('Last frame'), clear: BOOL('Remove the range') }),
      execute: ({ from, to, clear = false } = {}) => ({ range: clear ? app.bench.setRange(null) : app.bench.setRange({ from, to }) })
    },
    {
      name: 'play_in_context', title: 'Play the recorded moment with the design',
      description: 'Rebuild the soundscape of the highlighted range (default: about a second around the target) from every sound the game played, at its recorded time and stereo position, with the design swapped in for its event (mode candidate), as the game sounds today (original) or the design alone (solo). Muted or soloed timeline lanes apply. The game view replays the recorded frames in step for the person. Returns which voices played when.',
      inputSchema: OBJ({ target: TARGET, mode: STR('What to hear', { enum: ['candidate', 'original', 'solo'] }), play: BOOL('false = only build the mix and report it') }),
      execute: async ({ target, mode = 'candidate', play = true } = {}) => app.bench.playInContext({ target: target || app.bench.target, mode, play })
    },
    {
      name: 'play_recording', title: 'Play the recording from a frame',
      description: 'Play the recorded session from a frame (default: the playhead) to another (default: the end, at most 90 s), with the game sounds (hear=game) or with every drafted design swapped in (hear=designs). loop=true repeats the highlighted range. The game view follows.',
      inputSchema: OBJ({ from: INT('Start frame'), to: INT('End frame'), hear: STR('Sounds to hear', { enum: ['game', 'designs'] }), loop: BOOL('Repeat the highlighted range'), play: BOOL('false = only build the mix and report it') }),
      execute: async ({ from = null, to = null, hear = 'game', loop = false, play = true } = {}) => {
        if (!play) return app.bench.playRange({ from: from ?? undefined, to: to ?? undefined, mode: hear === 'designs' ? 'candidate' : 'original', designs: hear === 'designs' ? app.bench.drafts() : {}, play: false });
        return app.playFromHere({ toggle: false, from, to, hear, loop });
      }
    },
    {
      name: 'set_lane', title: 'Mute or solo a sound source',
      description: 'Toggle mute or solo of one timeline lane (sound source) for every recording playback: "rick", "world" or "<actor type>:<mark>" (the lane key; get_lanes lists them).',
      inputSchema: OBJ({ lane: STR('Lane key'), kind: STR('Toggle', { enum: ['mute', 'solo'] }), on: BOOL('Set explicitly instead of toggling') }, ['lane', 'kind']),
      execute: ({ lane, kind, on = null }) => {
        const st = app.bench.laneState(), active = (kind === 'solo' ? st.soloed : st.muted).includes(lane);
        if (on == null || on !== active) return app.bench.toggleLane(lane, kind);
        return st;
      }
    },
    {
      name: 'get_lanes', title: 'List timeline lanes', readOnly: true,
      description: 'The timeline lanes (one per sound source) with their key, label, number of sounds, and whether each is muted or soloed.',
      execute: () => {
        const st = app.bench.laneState();
        return app.session().lanes().map(l => ({ key: l.key, label: l.label, sounds: l.occurrences.length, spans: l.spans.length, muted: st.muted.includes(l.key), soloed: st.soloed.includes(l.key) }));
      }
    },
    {
      name: 'list_emitters', title: 'List emitter locations', readOnly: true,
      description: 'Every place in the level where an event\'s sound emitter is placed (each dog trap, fire jet, boulder ...): room, actor type and mark, and whether and how often it was heard in this session (with the first occurrence id).',
      inputSchema: OBJ({ eventId: EVENT }, ['eventId']),
      execute: async ({ eventId }) => app.emitters(eventId)
    },
    {
      name: 'goto_emitter', title: 'Go to an emitter location',
      description: 'Jump to one emitter location (index into list_emitters). A heard location selects its first occurrence. An unheard one needs startNewSession=true, which starts a new recording in its room (discarding the current one) and outlines the emitter on the game view.',
      inputSchema: OBJ({ eventId: EVENT, index: INT('Index into list_emitters', { minimum: 0 }), startNewSession: BOOL('Allow starting a new session in that room') }, ['eventId', 'index']),
      execute: async ({ eventId, index, startNewSession = false }) => app.gotoEmitter(index, { eventId, startNewSession })
    },
    {
      name: 'get_foley_scene', title: 'Read the scene for Foley', readOnly: true,
      description: 'Open the Foley tab for the open event (or eventId/target; for a staged group design, stage picks start, move or stop) and return what the recording says about the moment as facts (source, material, surface, size, speed, impact, distance, room), the starting Foley recipe derived from it, the recorded speed trace, the current recipe/description/reference/takes, and the generator vocabulary (models, materials, parameter ranges).',
      inputSchema: OBJ({ eventId: EVENT, target: TARGET, stage: STR('Stage of a staged group design', { enum: ['start', 'move', 'stop'] }) }),
      execute: ({ eventId, target, stage } = {}) => {
        if (eventId && eventId !== app.bench.eventId) app.bench.open(eventId, { target });
        else if (target) app.bench.setTarget(target);
        if (stage) app.bench.setFoleyStage(stage);
        app.selectTab('foley');
        return { scene: app.bench.foleyScene(), ...foleyState(app.bench), vocabulary: foleyVocabulary() };
      }
    },
    {
      name: 'set_foley', title: 'Set Foley controls',
      description: 'Change the Foley generator recipe: model, material, surface, followMotion, the numeric controls (intensity, size, weight, hardness, roughness, resonance, brightness, density, bounce, distance, speed, durationMs, seed) and eq (8 band gains in dB at the vocabulary eqBands, ±18; null = flat). Values are clamped; the report lists what was applied. The person sees the controls move.',
      inputSchema: OBJ({ recipe: { type: 'object', description: 'Partial Foley recipe' } }, ['recipe']),
      execute: ({ recipe }) => app.bench.setFoley(recipe)
    },
    {
      name: 'describe_foley', title: 'Describe the Foley sound',
      description: 'Set the recipe from a plain-language description on top of the scene (e.g. "heavy granite boulder rolling slowly over gritty sand, slightly distant"). Returns the recipe and the words understood. fromScene=false applies it to the current recipe instead.',
      inputSchema: OBJ({ text: STR('Description'), fromScene: BOOL('Start from the scene recipe (default true)') }, ['text']),
      execute: ({ text, fromScene = true }) => app.bench.describeFoley(text, { fromScene })
    },
    {
      name: 'set_foley_reference', title: 'Set a reference sound',
      description: 'Give the generator a reference recording to steer toward: a library sample (source), the game sound of an occurrence (occurrenceId), or a 16/24/32-bit PCM or float WAV as base64 (wavBase64). Returns its measured features. clear=true removes it. weight (0-1) sets how strongly it outweighs the scene.',
      inputSchema: OBJ({
        source: OBJ({ type: STR('Sample type', { enum: ['original', 'published', 'classic'] }), name: STR('Sample name') }, ['type', 'name']),
        occurrenceId: STR('Occurrence whose game sound to use'),
        wavBase64: STR('WAV file, base64 (data URL allowed)'),
        label: STR('Label shown to the person'),
        weight: NUM('Steer strength 0-1', { minimum: 0, maximum: 1 }),
        clear: BOOL('Remove the reference')
      }),
      execute: async ({ source = null, occurrenceId = null, wavBase64 = null, label = null, weight = null, clear = false } = {}) => {
        if (clear) { app.bench.clearReference(); return { reference: null }; }
        let out = null;
        if (source || occurrenceId || wavBase64) out = await app.bench.setReference({ source, occurrenceId, wav: wavBase64 ? base64ToBytes(wavBase64) : null, label });
        if (weight != null) app.bench.setReferenceWeight(weight);
        return { reference: out, referenceWeight: app.bench.foley.referenceWeight };
      }
    },
    {
      name: 'fit_foley_reference', title: 'Match the reference',
      description: 'Search the Foley controls for a recipe that sounds like the reference (spectrum, envelope, noisiness, length, attack), balanced against the current recipe by the reference weight, then set a match EQ toward the reference spectrum. allowModelChange=true also tries every model and material. lock lists controls to keep (any control, or "eq"). Returns the new recipe and the match before and after (0-1).',
      inputSchema: OBJ({ iterations: INT('Search steps (default 48)', { minimum: 4, maximum: 200 }), referenceWeight: NUM('0-1, default the current weight', { minimum: 0, maximum: 1 }), allowModelChange: BOOL('Also try other models and materials'), lock: { type: 'array', items: { type: 'string' }, description: 'Controls to keep fixed' } }),
      execute: async ({ iterations = 48, referenceWeight, allowModelChange, lock = [] } = {}) => app.bench.fitReference({ iterations, referenceWeight, lock, ...(allowModelChange == null ? {} : { allowModelChange }) })
    },
    {
      name: 'generate_foley_takes', title: 'Generate Foley takes',
      description: 'Render several takes around the current recipe (spread = how far they wander), each measured and, with a reference set, ranked by match. Returns take ids for play_foley_take and use_foley_take.',
      inputSchema: OBJ({ count: INT('Takes (default 4)', { minimum: 1, maximum: 8 }), spread: NUM('Take variation 0-1; sets the slider (default: its current value, 0.15 at first)', { minimum: 0, maximum: 1 }), seed: INT('Seed') }),
      execute: ({ count = 4, spread, seed = null } = {}) => { if (spread != null) app.bench.setTakeSpread(spread); return app.bench.generateTakes({ count, seed }); }
    },
    {
      name: 'generate_earshot_takes', title: 'Generate Earshot takes',
      description: 'Four takes from Earshot (an optional offline generator, available when the Studio was opened from the SoundLab authoring service with Earshot; get_foley_scene reports earshot.available). With parentTake (an Earshot take id of the last round) and a direction it refines that take. Lengths default to what the open event or stage needs (enough for the bites or loop of a staged movement). Takes are measured, matched to the reference when one is set, and recorded as a round (get_foley_scene rounds: best match, loudness, brightness, length per round) so iterations can be compared; which sounds better is the person\'s call. Use them with play_foley_take and use_foley_take (they become sample layers).',
      inputSchema: OBJ({ direction: STR('Refinement direction', { enum: Object.keys(EARSHOT_DIRECTIONS) }), parentTake: STR('Earshot take id to refine (e1…e4)'), durationMs: INT('Take length in ms', { minimum: 40, maximum: 2000 }), seed: INT('Seed') }),
      execute: ({ direction = 'variation', parentTake = null, durationMs = null, seed = null } = {}) => app.bench.earshotRound({ direction, parent: parentTake, durationMs, seed })
    },
    {
      name: 'play_foley_take', title: 'Play a Foley take',
      description: 'Play one take on its own, or in the recorded scene (inContext=true) with the take in the design, or play the reference (take="reference").',
      inputSchema: OBJ({ take: STR('Take id, or "reference"'), inContext: BOOL('Play in the highlighted range of the recording') }, ['take']),
      execute: async ({ take, inContext = false }) => (take === 'reference' ? app.bench.playReference() : inContext ? app.bench.playTakeInContext(take) : app.bench.playTake(take))
    },
    {
      name: 'use_foley_take', title: 'Put a take into the design',
      description: 'mode replace: the take becomes the design\'s Foley layer (other layers are muted, not deleted); mode add: it is added as an extra layer. In a staged group design it goes into the Foley tab\'s stage (or `stage`) and only that stage\'s layers are muted. Continuous takes for events the game cannot play yet switch the design to a loop container.',
      inputSchema: OBJ({ take: STR('Take id'), mode: STR('How', { enum: ['replace', 'add'] }), stage: STR('Stage of a staged design', { enum: ['start', 'move', 'stop'] }) }, ['take']),
      execute: ({ take, mode = 'replace', stage = null }) => app.bench.useTake(take, { mode, stage, by: 'agent' })
    },
    {
      name: 'submit_for_review', title: 'Submit the design for human review',
      description: 'Freeze the open design with its measurements and audition occurrence into the review queue. The name defaults to the event and the date and time. Only a person can record a verdict (fits / close / wrong, tags, notes, optional blind A/B); a "fits" verdict makes it publishable.',
      inputSchema: OBJ({ rationale: STR('What the reviewer should listen for and why this design should fit'), name: STR('Optional name') }, ['rationale']),
      execute: async ({ rationale, name = '' }) => app.bench.submit({ rationale, name, by: 'agent' })
    },
    {
      name: 'rename_candidate', title: 'Rename a review candidate',
      description: 'Change the display name of a submitted candidate.',
      inputSchema: OBJ({ candidateId: STR('Candidate id'), name: STR('New name') }, ['candidateId', 'name']),
      execute: ({ candidateId, name }) => app.bench.renameCandidate(candidateId, name)
    },
    {
      name: 'list_reviews', title: 'Read the review queue', readOnly: true,
      description: `Submitted candidates with their name, status (pending, ${VERDICTS.join(', ')}) and the person's reviews (verdict, tags from ${REVIEW_TAGS.length} fixed tags such as "too bright", note, blind A/B preference).`,
      inputSchema: OBJ({ eventId: EVENT, status: STR('Status filter', { enum: ['pending', ...VERDICTS] }) }),
      execute: ({ eventId, status } = {}) => app.bench.store.list({ eventId, status })
    },
    {
      name: 'get_review', title: 'Read one candidate', readOnly: true,
      description: 'One candidate with its frozen design, measurements and every review.',
      inputSchema: OBJ({ candidateId: STR('Candidate id from list_reviews') }, ['candidateId']),
      execute: ({ candidateId }) => { const c = app.bench.store.get(candidateId); if (!c) throw new Error(`Unknown candidate ${candidateId}`); return c; }
    },
    {
      name: 'export_approved', title: 'Export approved designs', readOnly: true,
      description: 'The bundle of the latest "fits" candidate per event (designs plus reviews), the hand-off for promoting sounds into the game.',
      execute: () => app.bench.exportBundle()
    }
  ];
}
