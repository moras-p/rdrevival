import { RDX_WEB_CONTRACT_VERSION } from './generated/rdx-web-contract.js';
import { RUNTIME_OPTIONS, RUNTIME_OPTION_BY_ID, RUNTIME_OPTION_BY_KEY } from './generated/runtime-options.js';
export { RDX_WEB_CONTRACT_VERSION };
export { RUNTIME_OPTIONS, RUNTIME_OPTION_BY_ID, RUNTIME_OPTION_BY_KEY };

export const XRICK_WIDTH = 320;
export const XRICK_HEIGHT = 200;
export const XRICK_PLAYFIELD = Object.freeze({ x: 32, y: 8, width: 256, height: 192 });
export const RDX_PLAYFIELD = Object.freeze({
  x: 0,
  y: 8,
  width: 320,
  height: 192,
  /* The verified xrick corridor begins 32 pixels inside each RDX room.
   * Expanding the old 256px window symmetrically therefore moves the RDX
   * viewport 32px left while leaving xrick gameplay pixels at their native
   * screen coordinates. */
  cameraOffsetX: -32,
  classicOriginX: 32,
  classicShiftX: 0
});


export function validateRoomManifestParity(bridge, manifest) {
  if (!bridge || typeof bridge.mappedMdForSubmap !== 'function') {
    throw new TypeError('A C bridge with mappedMdForSubmap() is required');
  }
  const rooms = Array.isArray(manifest?.rooms) ? manifest.rooms : [];
  const mismatches = [];
  for (const room of rooms) {
    const submap = Number(room.submap) >>> 0;
    const expected = Number(room.mapId) >>> 0;
    const actual = bridge.mappedMdForSubmap(submap);
    if (actual !== expected) {
      mismatches.push(`${room.submapName || `SM${submap.toString(16).toUpperCase().padStart(2, '0')}`}: JS manifest MD${String(expected).padStart(4, '0')} != C MD${String(actual).padStart(4, '0')}`);
    }
  }
  if (mismatches.length) {
    throw new Error(`RDX room-manifest parity failure. Rebuild JavaScript and WASM from the same source tree: ${mismatches.join('; ')}`);
  }
  return Object.freeze({ rooms: rooms.length, contractVersion: bridge.contractVersion() });
}

export class XrickWasmBridge {
  constructor(module) {
    if (!module || typeof module.cwrap !== 'function') {
      throw new TypeError('An initialized Emscripten Module with cwrap is required');
    }
    this.module = module;
    const wrap0 = (name, result = 'number') => module.cwrap(name, result, []);
    const wrap1 = (name, result = 'number') => module.cwrap(name, result, ['number']);
    const wrapN = (name, count, result = 'number') => module.cwrap(name, result, Array(count).fill('number'));
    this.api = {
      getContractVersion: wrap0('xrick_rdx_get_contract_version'),
      getResolvedLevelsFingerprint: wrap0('xrick_rdx_get_resolved_levels_fingerprint'),
      getRuntimeSourceFingerprint: wrap0('xrick_rdx_get_runtime_source_fingerprint'),
      setPresentationDiagnostics: wrap1('xrick_rdx_set_presentation_diagnostics'),
      getPresentationDiagnostics: wrap0('xrick_rdx_get_presentation_diagnostics'),
      resumeBrowserLoop: wrap0('xrick_rdx_resume_browser_loop', null),
      forceBrowserFrame: wrap0('xrick_rdx_force_browser_frame', null),
      debugForceBrowserFrame: wrap0('xrick_rdx_debug_force_browser_frame', null),
      setFrontendPaused: wrap1('xrick_rdx_web_set_frontend_paused', null),
      frontendPaused: wrap0('xrick_rdx_web_frontend_paused'),
      setAiTransitionHold: wrap1('xrick_rdx_web_set_ai_transition_hold', null),
      setAiAudioHold: wrap1('xrick_rdx_web_set_ai_audio_hold', null),
      setDeathTransitionHold: wrap1('xrick_rdx_set_death_transition_hold', null),
      getDeathTransitionHold: wrap0('xrick_rdx_get_death_transition_hold'),
      getMappedMdForSubmap: wrap1('xrick_rdx_get_mapped_md_for_submap'),
      optionGet: wrap1('xrick_option_get'),
      optionSet: wrapN('xrick_option_set', 2),
      setTargetFpsOverride: wrap1('xrick_rdx_set_target_fps_override'),
      getTargetFpsOverride: wrap0('xrick_rdx_get_target_fps_override'),
      debugCheckpointSave: wrap1('xrick_rdx_debug_checkpoint_save'),
      debugCheckpointLoad: wrap1('xrick_rdx_debug_checkpoint_load'),
      debugCheckpointDiscard: wrap1('xrick_rdx_debug_checkpoint_discard', null),
      debugTraceBegin: wrap1('xrick_rdx_debug_trace_begin'),
      debugTraceFinish: wrap0('xrick_rdx_debug_trace_finish', null),
      debugTraceCount: wrap0('xrick_rdx_debug_trace_count'),
      debugTraceOverflow: wrap0('xrick_rdx_debug_trace_overflow'),
      debugTraceType: wrap1('xrick_rdx_debug_trace_type'),
      debugTraceBranch: wrap1('xrick_rdx_debug_trace_branch'),
      debugTraceValue: wrapN('xrick_rdx_debug_trace_value', 2),
      debugSetCrawlFallPose: wrap1('xrick_rdx_debug_set_crawl_fall_pose'),
      debugGetCrawlFallPose: wrap0('xrick_rdx_debug_get_crawl_fall_pose'),
      debugSetDirectionalEnemyDeath: wrap1('xrick_rdx_debug_set_directional_enemy_death'),
      debugGetDirectionalEnemyDeath: wrap0('xrick_rdx_debug_get_directional_enemy_death'),
      debugSetSimulateAllTriggers: wrap1('xrick_rdx_debug_set_simulate_all_triggers'),
      debugGetSimulateAllTriggers: wrap0('xrick_rdx_debug_get_simulate_all_triggers'),
      debugSetEditorProjectileHitsNonlethal: wrap1('xrick_rdx_debug_set_editor_projectile_hits_nonlethal'),
      debugGetEditorProjectileHitsNonlethal: wrap0('xrick_rdx_debug_get_editor_projectile_hits_nonlethal'),
      setEnabled: wrap1('xrick_rdx_set_enabled', null),
      getEnabled: wrap0('xrick_rdx_get_enabled'),
      setSpriteMode: wrap1('xrick_rdx_set_sprite_mode', null),
      getSpriteMode: wrap0('xrick_rdx_get_sprite_mode'),
      setDynamiteSource: wrap1('xrick_rdx_set_dynamite_source', null),
      getDynamiteSource: wrap0('xrick_rdx_get_dynamite_source'),
      setSpriteReplacementMask: wrap1('xrick_rdx_set_sprite_replacement_mask', null),
      getSpriteReplacementMask: wrap0('xrick_rdx_get_sprite_replacement_mask'),
      loadPresentationRom: wrap1('xrick_rdx_load_rom_from_module'),
      unloadPresentationRom: wrap0('xrick_rdx_unload_rom', null),
      presentationReady: wrap0('xrick_rdx_presentation_ready'),
      copyPresentationRgba: wrap0('xrick_rdx_copy_presentation_rgba'),
      copyPresentationRgbaForFrame: wrap1('xrick_rdx_copy_presentation_rgba_for_frame'),
      inspectRenderCurrent: wrap0('xrick_rdx_inspect_render_current'),
      inspectRenderViewport: wrapN('xrick_rdx_inspect_render_viewport', 5),
      copyInspectionRgba: wrap0('xrick_rdx_copy_inspection_rgba'),
      inspectionHash: wrap0('xrick_rdx_inspection_hash'),
      inspectionExact: wrap0('xrick_rdx_inspection_exact'),
      presentationMappedCount: wrap0('xrick_rdx_presentation_mapped_count'),
      presentationFallbackCount: wrap0('xrick_rdx_presentation_fallback_count'),
      presentationSuppressedCount: wrap0('xrick_rdx_presentation_suppressed_count'),
      presentationDecorationCount: wrap0('xrick_rdx_presentation_decoration_count'),
      soundAvailable: wrap0('xrick_rdx_sound_available'),
      soundMuted: wrap0('xrick_rdx_sound_muted'),
      soundActiveSfxCount: wrap0('xrick_rdx_sound_active_sfx_count'),
      soundSetMuted: wrap1('xrick_rdx_sound_set_muted', null),
      soundSetSfxSuppressed: wrapN('xrick_rdx_sound_set_sfx_suppressed', 2),
      soundClearSfxSuppressions: wrap0('xrick_rdx_sound_clear_sfx_suppressions', null),
      soundSfxEventSerial: wrap0('xrick_rdx_sound_sfx_event_serial'),
      soundSfxEventLogicalId: wrap1('xrick_rdx_sound_sfx_event_logical_id'),
      soundSfxEventScreenX: wrap1('xrick_rdx_sound_sfx_event_screen_x'),
      soundSfxEventSuppressed: wrap1('xrick_rdx_sound_sfx_event_suppressed'),
      soundSource: wrap0('xrick_rdx_sound_source'),
      soundSetSource: wrap1('xrick_rdx_sound_set_source'),
      soundQuality: wrap0('xrick_rdx_sound_quality'),
      soundSetQuality: wrap1('xrick_rdx_sound_set_quality'),
      soundFilter: wrap0('xrick_rdx_sound_filter'),
      soundSetFilter: wrap1('xrick_rdx_sound_set_filter'),
      soundSpatial: wrap0('xrick_rdx_sound_spatial'),
      soundSetSpatial: wrap1('xrick_rdx_sound_set_spatial'),
      soundLabEventSerial: wrap0('xrick_rdx_soundlab_event_serial'),
      soundLabEventId: wrap1('xrick_rdx_soundlab_event_id'),
      soundLabEventTick: wrap1('xrick_rdx_soundlab_event_tick'),
      soundLabEventSubmap: wrap1('xrick_rdx_soundlab_event_submap'),
      soundLabEventActorSlot: wrap1('xrick_rdx_soundlab_event_actor_slot'),
      soundLabEventMark: wrap1('xrick_rdx_soundlab_event_mark'),
      soundLabEventWorldX: wrap1('xrick_rdx_soundlab_event_world_x'),
      soundLabEventWorldY: wrap1('xrick_rdx_soundlab_event_world_y'),
      soundLabEventDx: wrap1('xrick_rdx_soundlab_event_dx'),
      soundLabEventDy: wrap1('xrick_rdx_soundlab_event_dy'),
      soundLabEventNormalX: wrap1('xrick_rdx_soundlab_event_normal_x'),
      soundLabEventNormalY: wrap1('xrick_rdx_soundlab_event_normal_y'),
      soundLabEventDirection: wrap1('xrick_rdx_soundlab_event_direction'),
      soundLabEventScreenX: wrap1('xrick_rdx_soundlab_event_screen_x'),
      soundLabSetEventSuppressed: wrapN('xrick_rdx_soundlab_set_event_suppressed', 2),
      soundLabClearEventSuppressions: wrap0('xrick_rdx_soundlab_clear_event_suppressions', null),
      getPresentationMode: wrap0('xrick_rdx_get_presentation_mode'),
      setClassicAssets: wrap1('xrick_rdx_set_classic_assets', null),
      getClassicAssets: wrap0('xrick_rdx_get_classic_assets'),
      setFallbackMode: wrap1('xrick_rdx_set_fallback_mode', null),
      getFallbackMode: wrap0('xrick_rdx_get_fallback_mode'),
      getSpriteFallbackMask: wrap0('xrick_rdx_get_sprite_fallback_mask'),
      getRickState: wrap0('xrick_rdx_get_rick_state'),
      getExitWalkActive: wrap0('xrick_rdx_get_exit_walk_active'),
      getExitWalkDirection: wrap0('xrick_rdx_get_exit_walk_direction'),
      getExitWalkOffsetX: wrap0('xrick_rdx_get_exit_walk_offset_x'),
      getExitWalkFrame: wrap0('xrick_rdx_get_exit_walk_frame'),
      getExitWalkTotalFrames: wrap0('xrick_rdx_get_exit_walk_total_frames'),
      getGameDir: wrap0('xrick_rdx_get_game_dir'),
      getControlStatus: wrap0('xrick_rdx_get_control_status'),
      copyFramebuffer: wrap0('xrick_rdx_copy_framebuffer'),
      copyEntityRgba: wrap1('xrick_rdx_copy_entity_rgba'),
      copyEntityBackgroundRgba: wrap1('xrick_rdx_copy_entity_background_rgba'),
      copyForegroundMask: wrap0('xrick_rdx_copy_foreground_mask'),
      copyPresentationLayerMask: wrap0('xrick_rdx_copy_presentation_layer_mask'),
      getBullets: wrap0('xrick_rdx_get_bullets'),
      getDynamite: wrap0('xrick_rdx_get_dynamite'),
      getLives: wrap0('xrick_rdx_get_lives'),
      getScore: wrap0('xrick_rdx_get_score'),
      getFrameSerial: wrap0('xrick_rdx_get_frame_serial'),
      getBombTicker: wrap0('xrick_rdx_get_bomb_ticker'),
      getBombLethal: wrap0('xrick_rdx_get_bomb_lethal'),
      getBombNearMissSerial: wrap0('xrick_rdx_get_bomb_near_miss_serial'),
      getBombNearMissStrengthPercent: wrap0('xrick_rdx_get_bomb_near_miss_strength_percent'),
      getBombNearMissDistancePx: wrap0('xrick_rdx_get_bomb_near_miss_distance_px'),
      getMap: wrap0('xrick_rdx_get_map'),
      getSubmap: wrap0('xrick_rdx_get_submap'),
      getMapFrow: wrap0('xrick_rdx_get_map_frow'),
      getVisibleTopRow: wrap0('xrick_rdx_get_visible_top_row'),
      getReachableStartRow: wrap1('xrick_rdx_get_reachable_start_row'),
      getCameraDeltaRows: wrap0('xrick_rdx_get_camera_delta_rows'),
      getCameraOffsetPx: wrap0('xrick_rdx_get_camera_offset_px'),
      getRenderCameraOffsetPx: wrap0('xrick_rdx_get_render_camera_offset_px'),
      debugGeometryRefresh: wrap1('xrick_rdx_debug_geometry_refresh'),
      debugGeometryMode: wrap0('xrick_rdx_debug_geometry_mode'),
      debugGeometryCount: wrap0('xrick_rdx_debug_geometry_count'),
      debugGeometryType: wrap1('xrick_rdx_debug_geometry_type'),
      debugGeometryFlags: wrap1('xrick_rdx_debug_geometry_flags'),
      debugGeometrySourceId: wrap1('xrick_rdx_debug_geometry_source_id'),
      debugGeometryX0: wrap1('xrick_rdx_debug_geometry_x0'),
      debugGeometryY0: wrap1('xrick_rdx_debug_geometry_y0'),
      debugGeometryX1: wrap1('xrick_rdx_debug_geometry_x1'),
      debugGeometryY1: wrap1('xrick_rdx_debug_geometry_y1'),
      getPaletteRgba: wrap1('xrick_rdx_get_palette_rgba'),
      getEntityCount: wrap0('xrick_rdx_get_entity_count'),
      getEntityN: wrap1('xrick_rdx_get_entity_n'),
      getEntityX: wrap1('xrick_rdx_get_entity_x'),
      getEntityY: wrap1('xrick_rdx_get_entity_y'),
      getEntityXsave: wrap1('xrick_rdx_get_entity_xsave'),
      getEntityYsave: wrap1('xrick_rdx_get_entity_ysave'),
      getEntitySprite: wrap1('xrick_rdx_get_entity_sprite'),
      getEntitySprbase: wrap1('xrick_rdx_get_entity_sprbase'),
      getEntityOffsy: wrap1('xrick_rdx_get_entity_offsy'),
      getEntityFront: wrap1('xrick_rdx_get_entity_front'),
      getEntityW: wrap1('xrick_rdx_get_entity_w'),
      getEntityH: wrap1('xrick_rdx_get_entity_h'),
      getEntityFlags: wrap1('xrick_rdx_get_entity_flags'),
      getEntityMark: wrap1('xrick_rdx_get_entity_mark'),
      getEntityMovingPlatformState: wrap1('xrick_rdx_get_entity_moving_platform_state'),
      getEntityC1: wrap1('xrick_rdx_get_entity_c1'),
      getEntityLatency: wrap1('xrick_rdx_get_entity_latency'),
      getEntityC2: wrap1('xrick_rdx_get_entity_c2'),
      getEntityProjectileActive: wrap1('xrick_rdx_get_entity_projectile_active'),
      getEntityProjectileGeneration: wrap1('xrick_rdx_get_entity_projectile_generation'),
      getEntityProjectileActiveUpdates: wrap1('xrick_rdx_get_entity_projectile_active_updates'),
      getEntityProjectileCooldownFrames: wrap1('xrick_rdx_get_entity_projectile_cooldown_frames'),
      getEntityTrigX: wrap1('xrick_rdx_get_entity_trig_x'),
      getEntityTrigY: wrap1('xrick_rdx_get_entity_trig_y'),
      getEntityTrigW: wrap1('xrick_rdx_get_entity_trig_w'),
      getEntityTrigH: wrap1('xrick_rdx_get_entity_trig_h'),
      presentationAuditCount: wrap0('xrick_rdx_presentation_audit_count'),
      presentationAuditSlot: wrap1('xrick_rdx_presentation_audit_slot'),
      presentationAuditPn: wrap1('xrick_rdx_presentation_audit_pn'),
      presentationAuditActorId: wrap1('xrick_rdx_presentation_audit_actor_id'),
      presentationAuditDrawX: wrap1('xrick_rdx_presentation_audit_draw_x'),
      presentationAuditDrawY: wrap1('xrick_rdx_presentation_audit_draw_y'),
      presentationAuditWidth: wrap1('xrick_rdx_presentation_audit_width'),
      presentationAuditHeight: wrap1('xrick_rdx_presentation_audit_height'),
      presentationAuditVisiblePixels: wrap1('xrick_rdx_presentation_audit_visible_pixels'),
      presentationAuditActorDepth: wrap1('xrick_rdx_presentation_audit_actor_depth'),
      presentationAuditFront: wrap1('xrick_rdx_presentation_audit_front'),
      presentationAuditMirrorX: wrap1('xrick_rdx_presentation_audit_mirror_x'),
      presentationAuditMirrorY: wrap1('xrick_rdx_presentation_audit_mirror_y'),
      presentationAuditOriginX: wrap1('xrick_rdx_presentation_audit_origin_x'),
      presentationAuditOriginY: wrap1('xrick_rdx_presentation_audit_origin_y'),
      presentationAuditTick: wrap1('xrick_rdx_presentation_audit_tick'),
      getEntityEdgePolicy: wrap1('xrick_rdx_get_entity_edge_policy'),
      getEntityEdgeTurns: wrap1('xrick_rdx_get_entity_edge_turns'),
      getEntityLedgeDrops: wrap1('xrick_rdx_get_entity_ledge_drops'),
      actorCollisionSetVerified: wrapN('xrick_rdx_actor_collision_set_verified', 8),
      actorCollisionClear: wrap1('xrick_rdx_actor_collision_clear', null),
      actorCollisionSource: wrap1('xrick_rdx_actor_collision_source'),
      actorCollisionActorId: wrap1('xrick_rdx_actor_collision_actor_id'),
      actorCollisionLeft: wrap1('xrick_rdx_actor_collision_left'),
      actorCollisionTop: wrap1('xrick_rdx_actor_collision_top'),
      actorCollisionRight: wrap1('xrick_rdx_actor_collision_right'),
      actorCollisionBottom: wrap1('xrick_rdx_actor_collision_bottom'),
      actorCollisionFlags: wrap1('xrick_rdx_actor_collision_flags'),
      actorCollisionEvidenceId: wrap1('xrick_rdx_actor_collision_evidence_id'),
      actorCollisionVerifiedQueries: wrap0('xrick_rdx_actor_collision_verified_queries'),
      actorCollisionFallbackQueries: wrap0('xrick_rdx_actor_collision_fallback_queries'),
      debugSetControl: wrap1('xrick_rdx_debug_set_control', null),
      debugGetControl: wrap0('xrick_rdx_debug_get_control'),
      debugRestartCurrentLevelNow: wrap0('xrick_rdx_debug_restart_current_level_now'),
      debugRestartCurrentLevelForAi: wrap0('xrick_rdx_debug_restart_current_level_for_ai'),
      aiSetPreferSafe: wrap1('xrick_gai_set_prefer_safe'),
      aiPreferSafe: wrap0('xrick_gai_prefer_safe'),
      aiSetValidationBudget: wrap1('xrick_gai_set_validation_budget'),
      aiValidationBudget: wrap0('xrick_gai_validation_budget'),
      aiReset: wrap0('xrick_gai_reset'),
      aiPlan: wrap1('xrick_gai_plan'),
      aiPlanFull: wrap1('xrick_gai_plan_full'),
      aiPlanFullContinue: wrap1('xrick_gai_plan_full_continue'),
      aiPlanFullToPoint: wrapN('xrick_gai_plan_full_to_point', 4),
      aiRestartPlanFull: wrap1('xrick_gai_restart_and_plan_full'),
      aiTick: wrap0('xrick_gai_tick'),
      aiStatus: wrap0('xrick_gai_status'),
      aiPhaseIndex: wrap0('xrick_gai_phase_index'),
      aiPhaseCount: wrap0('xrick_gai_phase_count'),
      aiRouteEdgeCount: wrap0('xrick_gai_route_edge_count'),
      aiRouteDebugCount: wrap0('xrick_gai_route_debug_count'),
      aiRouteDebugFrom: wrap1('xrick_gai_route_debug_from'),
      aiRouteDebugTo: wrap1('xrick_gai_route_debug_to'),
      aiRouteDebugKind: wrap1('xrick_gai_route_debug_kind'),
      aiRouteDebugSourceId: wrap1('xrick_gai_route_debug_source_id'),
      aiRouteDebugTargetId: wrap1('xrick_gai_route_debug_target_id'),
      aiRouteDebugSourceY: wrap1('xrick_gai_route_debug_source_y'),
      aiRouteDebugTargetY: wrap1('xrick_gai_route_debug_target_y'),
      aiRouteDebugLaunchX0: wrap1('xrick_gai_route_debug_launch_x0'),
      aiRouteDebugLaunchX1: wrap1('xrick_gai_route_debug_launch_x1'),
      aiRouteDebugProvedLaunchX: wrap1('xrick_gai_route_debug_proved_launch_x'),
      aiRouteDebugProvedLandingX: wrap1('xrick_gai_route_debug_proved_landing_x'),
      aiRouteDebugSourceContactX: wrap1('xrick_gai_route_debug_source_contact_x'),
      aiRouteDebugSourceContactY: wrap1('xrick_gai_route_debug_source_contact_y'),
      aiRouteDebugDestinationEntryX: wrap1('xrick_gai_route_debug_destination_entry_x'),
      aiRouteDebugDestinationEntryY: wrap1('xrick_gai_route_debug_destination_entry_y'),
      aiRouteDebugDestinationSubmap: wrap1('xrick_gai_route_debug_destination_submap'),
      aiRouteDebugFrames: wrap1('xrick_gai_route_debug_frames'),
      aiRouteDebugHazardContacts: wrap1('xrick_gai_route_debug_hazard_contacts'),
      aiRouteDebugDeathEpisodes: wrap1('xrick_gai_route_debug_death_episodes'),
      aiRouteDebugSafeWaitFrames: wrap1('xrick_gai_route_debug_safe_wait_frames'),
      aiRouteDebugTimingCalculatedWait: wrap1('xrick_gai_route_debug_timing_calculated_wait'),
      aiRouteDebugTimingStableWait: wrap1('xrick_gai_route_debug_timing_stable_wait'),
      aiRouteDebugTimingSafeWindowFrames: wrap1('xrick_gai_route_debug_timing_safe_window_frames'),
      aiRouteDebugActivationWaitFrames: wrap1('xrick_gai_route_debug_activation_wait_frames'),
      aiRouteDebugActivationStartDelayFrames: wrap1('xrick_gai_route_debug_activation_start_delay_frames'),
      aiRouteDebugSafeWaitX: wrap1('xrick_gai_route_debug_safe_wait_x'),
      aiRouteDebugActivationWaitX: wrap1('xrick_gai_route_debug_activation_wait_x'),
      aiRouteDebugSafeWaitInputMask: wrap1('xrick_gai_route_debug_safe_wait_input_mask'),
      aiRouteDebugActivationWaitInputMask: wrap1('xrick_gai_route_debug_activation_wait_input_mask'),
      aiRouteDebugTimingPredictableHazard: wrap1('xrick_gai_route_debug_timing_predictable_hazard'),
      aiRouteDebugTimingWindowFound: wrap1('xrick_gai_route_debug_timing_window_found'),
      aiRouteDebugTimingHoldAttempts: wrap1('xrick_gai_route_debug_timing_hold_attempts'),
      aiRouteDebugFallSegmentCount: wrap1('xrick_gai_route_debug_fall_segment_count'),
      aiRouteDebugDemolitionOnly: wrap1('xrick_gai_route_debug_demolition_only'),
      aiRouteDebugObservedActivationPlatform: wrap1('xrick_gai_route_debug_observed_activation_platform'),
      aiRouteDebugObservedActivationActorId: wrap1('xrick_gai_route_debug_observed_activation_actor_id'),
      aiRouteDebugSpeculativeEnemyRisk: wrap1('xrick_gai_route_debug_speculative_enemy_risk'),
      aiRouteDebugReactiveExposure: wrap1('xrick_gai_route_debug_reactive_exposure'),
      aiRouteDebugPredictedWaitFrames: wrap1('xrick_gai_route_debug_predicted_wait_frames'),
      aiRouteDebugPredictedSafeWindowFrames: wrap1('xrick_gai_route_debug_predicted_safe_window_frames'),
      aiRouteDebugSpeculativeTimingState: wrap1('xrick_gai_route_debug_speculative_timing_state'),
      aiRouteDebugMutationEffectClass: wrap1('xrick_gai_route_debug_mutation_effect_class'),
      aiRouteDebugMutationEvidence: wrap1('xrick_gai_route_debug_mutation_evidence'),
      aiRouteDebugMutationPriority: wrap1('xrick_gai_route_debug_mutation_priority'),
      aiRouteDebugCausalPrerequisite: wrap1('xrick_gai_route_debug_causal_prerequisite'),
      aiRouteDebugExactProofSafe: wrap1('xrick_gai_route_debug_exact_proof_safe'),
      aiRouteDebugBombs: wrap1('xrick_gai_route_debug_bombs'),
      aiRouteDebugBullets: wrap1('xrick_gai_route_debug_bullets'),
      aiSegmentCount: wrap0('xrick_gai_segment_count'),
      aiReplanCount: wrap0('xrick_gai_replan_count'),
      aiCompletePlan: wrap0('xrick_gai_complete_plan'),
      aiPartialPlan: wrap0('xrick_gai_partial_plan'),
      aiBackendAvailable: wrap0('xrick_gai_backend_available'),
      aiBackendKind: wrap0('xrick_gai_backend_kind'),
      aiRouteHazardContacts: wrap0('xrick_gai_route_hazard_contacts'),
      aiRouteDeathEpisodes: wrap0('xrick_gai_route_death_episodes'),
      aiRouteBombsUsed: wrap0('xrick_gai_route_bombs_used'),
      aiRouteBulletsUsed: wrap0('xrick_gai_route_bullets_used'),
      aiRouteCollectibles: wrap0('xrick_gai_route_collectibles'),
      aiRouteProjectileCrawls: wrap0('xrick_gai_route_projectile_crawls'),
      aiRouteCrossfireActions: wrap0('xrick_gai_route_crossfire_actions'),
      aiRouteResetTriggers: wrap0('xrick_gai_route_reset_triggers'),
      aiRouteTimedBlockages: wrap0('xrick_gai_route_timed_blockages'),
      aiRouteRemoteDemolitions: wrap0('xrick_gai_route_remote_demolitions'),
      aiRoutePrerequisiteClears: wrap0('xrick_gai_route_prerequisite_clears'),
      aiHazardousRouteEdges: wrap0('xrick_gai_hazardous_route_edges'),
      aiBlockingKind: wrap0('xrick_gai_blocking_kind'),
      aiBlockingFrom: wrap0('xrick_gai_blocking_from'),
      aiBlockingTo: wrap0('xrick_gai_blocking_to'),
      aiValidationAttempts: wrap0('xrick_gai_validation_attempts'),
      aiBudgetExhausted: wrap0('xrick_gai_budget_exhausted'),
      aiBestGoalDistance: wrap0('xrick_gai_best_goal_distance'),
      aiBestPrefixUpdates: wrap0('xrick_gai_best_prefix_updates'),
      aiDominatedRouteCandidates: wrap0('xrick_gai_dominated_route_candidates'),
      aiProvedEdgeCount: wrap0('xrick_gai_proved_edge_count'),
      aiRejectedEdgeCount: wrap0('xrick_gai_rejected_edge_count'),
      aiFailureStage: wrap0('xrick_gai_failure_stage'),
      aiFailureDetail: wrap0('xrick_gai_failure_detail'),
      aiNodeCount: wrap0('xrick_gai_node_count'),
      aiEdgeCount: wrap0('xrick_gai_edge_count'),
      aiStartNode: wrap0('xrick_gai_start_node'),
      aiGoalNode: wrap0('xrick_gai_goal_node'),
      aiCandidateWalk: wrap0('xrick_gai_candidate_walk'),
      aiCandidateCrawl: wrap0('xrick_gai_candidate_crawl'),
      aiCandidateDrop: wrap0('xrick_gai_candidate_drop'),
      aiCandidateJump: wrap0('xrick_gai_candidate_jump'),
      aiCandidateLadder: wrap0('xrick_gai_candidate_ladder'),
      aiCandidateExit: wrap0('xrick_gai_candidate_exit'),
      aiCandidateDynamite: wrap0('xrick_gai_candidate_dynamite'),
      aiCandidateShoot: wrap0('xrick_gai_candidate_shoot'),
      aiDynamicPlatformCount: wrap0('xrick_gai_dynamic_platform_count'),
      aiDynamicPlatformStopCount: wrap0('xrick_gai_dynamic_platform_stop_count'),
      aiDynamicPlatformLinkCount: wrap0('xrick_gai_dynamic_platform_link_count'),
      aiTriggerableDeactivatorCount: wrap0('xrick_gai_triggerable_deactivator_count'),
      aiCausalPrerequisiteCount: wrap0('xrick_gai_causal_prerequisite_count'),
      aiMutationCandidateCount: wrap0('xrick_gai_mutation_candidate_count'),
      aiCausalMutationsSelected: wrap0('xrick_gai_causal_mutations_selected'),
      aiTopologyRecaptures: wrap0('xrick_gai_topology_recaptures'),
      aiTimingPredictableEdgeCount: wrap0('xrick_gai_timing_predictable_edge_count'),
      aiTimingNarrowEdgeCount: wrap0('xrick_gai_timing_narrow_edge_count'),
      aiTimingBlockedEdgeCount: wrap0('xrick_gai_timing_blocked_edge_count'),
      aiTimingWaitEdgeCount: wrap0('xrick_gai_timing_wait_edge_count'),
      aiReactiveExposureEdgeCount: wrap0('xrick_gai_reactive_exposure_edge_count'),
      aiReactiveExposureTotal: wrap0('xrick_gai_reactive_exposure_total'),
      aiUnresolvedTransitionCount: wrap0('xrick_gai_unresolved_transition_count'),
      aiRepeatedSemanticStateCount: wrap0('xrick_gai_repeated_semantic_state_count'),
      aiReplanCycleCount: wrap0('xrick_gai_replan_cycle_count'),
      aiFailureCacheHits: wrap0('xrick_gai_failure_cache_hits'),
      aiAvoidedProofAttempts: wrap0('xrick_gai_avoided_proof_attempts'),
      aiRepeatedBlockerCount: wrap0('xrick_gai_repeated_blocker_count'),
      aiLocalSalvageAttempts: wrap0('xrick_gai_local_salvage_attempts'),
      aiProofWorkLimitHits: wrap0('xrick_gai_proof_work_limit_hits'),
      aiSemanticStateHash: wrap0('xrick_gai_semantic_state_hash'),
      aiTopologyEpoch: wrap0('xrick_gai_topology_epoch'),
      aiOutcome: wrap0('xrick_gai_outcome'),
      aiStaticExitReachable: wrap0('xrick_gai_static_exit_reachable'),
      aiCausalPrerequisiteRequired: wrap0('xrick_gai_causal_prerequisite_required'),
      aiMutationSelectedFrom: wrap0('xrick_gai_mutation_selected_from'),
      aiMutationSelectedTo: wrap0('xrick_gai_mutation_selected_to'),
      aiMutationSelectedMechanism: wrap0('xrick_gai_mutation_selected_mechanism'),
      aiMutationSelectedKind: wrap0('xrick_gai_mutation_selected_kind'),
      aiMutationFeasibility: wrap0('xrick_gai_mutation_feasibility'),
      aiMutationSelectedMechanismId: wrap0('xrick_gai_mutation_selected_mechanism_id'),
      aiRouteMechanismActivations: wrap0('xrick_gai_route_mechanism_activations'),
      aiRoutePlatformActivations: wrap0('xrick_gai_route_platform_activations'),
      aiWorldNativeRdx: wrap0('xrick_gai_world_native_rdx'),
      aiPlayerX: wrap0('xrick_gai_player_x'),
      aiPlayerY: wrap0('xrick_gai_player_y'),
      aiPlayerSupportId: wrap0('xrick_gai_player_support_id'),
      aiActorCount: wrap0('xrick_gai_actor_count'),
      aiMechanismCount: wrap0('xrick_gai_mechanism_count'),
      aiWorldFrameSerial: wrap0('xrick_gai_world_frame_serial'),
      aiLayoutHash: wrap0('xrick_gai_layout_hash'),
      aiLastProofFailureStage: wrap0('xrick_gai_last_proof_failure_stage'),
      aiLastProofExecutorStatus: wrap0('xrick_gai_last_proof_executor_status'),
      aiLastProofInputMask: wrap0('xrick_gai_last_proof_input_mask'),
      aiLastProofKind: wrap0('xrick_gai_last_proof_kind'),
      aiLastProofFrom: wrap0('xrick_gai_last_proof_from'),
      aiLastProofTo: wrap0('xrick_gai_last_proof_to'),
      aiLastProofFrame: wrap0('xrick_gai_last_proof_frame'),
      aiLastProofPhase: wrap0('xrick_gai_last_proof_phase'),
      aiLastProofPlayerX: wrap0('xrick_gai_last_proof_player_x'),
      aiLastProofPlayerY: wrap0('xrick_gai_last_proof_player_y'),
      aiLastProofPlayerSupportId: wrap0('xrick_gai_last_proof_player_support_id'),
      aiLastProofTargetId: wrap0('xrick_gai_last_proof_target_id'),
      aiLastProofLaunchX: wrap0('xrick_gai_last_proof_launch_x'),
      aiLastProofLandingX: wrap0('xrick_gai_last_proof_landing_x'),
      aiLastProofHazardContacts: wrap0('xrick_gai_last_proof_hazard_contacts'),
      aiLastProofDeathEpisodes: wrap0('xrick_gai_last_proof_death_episodes'),
      aiDropSearchResult: wrap0('xrick_gai_drop_search_result'),
      aiDropSearchLandingHintUsed: wrap0('xrick_gai_drop_search_landing_hint_used'),
      aiDropSearchPreferSafe: wrap0('xrick_gai_drop_search_prefer_safe'),
      aiDropSearchAttemptsTruncated: wrap0('xrick_gai_drop_search_attempts_truncated'),
      aiDropSearchAttemptCount: wrap0('xrick_gai_drop_search_attempt_count'),
      aiDropSearchSourceId: wrap0('xrick_gai_drop_search_source_id'),
      aiDropSearchTargetId: wrap0('xrick_gai_drop_search_target_id'),
      aiDropSearchSourceX0: wrap0('xrick_gai_drop_search_source_x0'),
      aiDropSearchSourceX1: wrap0('xrick_gai_drop_search_source_x1'),
      aiDropSearchSourceY: wrap0('xrick_gai_drop_search_source_y'),
      aiDropSearchTargetX0: wrap0('xrick_gai_drop_search_target_x0'),
      aiDropSearchTargetX1: wrap0('xrick_gai_drop_search_target_x1'),
      aiDropSearchTargetY: wrap0('xrick_gai_drop_search_target_y'),
      aiDropSearchPreferredLandingX: wrap0('xrick_gai_drop_search_preferred_landing_x'),
      aiDropAttemptOutcome: wrap1('xrick_gai_drop_attempt_outcome'),
      aiDropAttemptSegmentCount: wrap1('xrick_gai_drop_attempt_segment_count'),
      aiDropAttemptForceCrawl: wrap1('xrick_gai_drop_attempt_force_crawl'),
      aiDropAttemptInputMask: wrapN('xrick_gai_drop_attempt_input_mask', 2),
      aiDropAttemptInputFrames: wrapN('xrick_gai_drop_attempt_input_frames', 2),
      aiDropAttemptRequestedLaunchX: wrap1('xrick_gai_drop_attempt_requested_launch_x'),
      aiDropAttemptActualLaunchX: wrap1('xrick_gai_drop_attempt_actual_launch_x'),
      aiDropAttemptFramesSimulated: wrap1('xrick_gai_drop_attempt_frames_simulated'),
      aiDropAttemptEndX: wrap1('xrick_gai_drop_attempt_end_x'),
      aiDropAttemptEndY: wrap1('xrick_gai_drop_attempt_end_y'),
      aiDropAttemptEndSupportId: wrap1('xrick_gai_drop_attempt_end_support_id'),
      aiDropAttemptHazardContacts: wrap1('xrick_gai_drop_attempt_hazard_contacts'),
      aiDropAttemptDeathEpisodes: wrap1('xrick_gai_drop_attempt_death_episodes'),
      aiRejectionHistoryCount: wrap0('xrick_gai_rejection_history_count'),
      aiRejectionKind: wrap1('xrick_gai_rejection_kind'),
      aiRejectionFrom: wrap1('xrick_gai_rejection_from'),
      aiRejectionTo: wrap1('xrick_gai_rejection_to'),
      aiRejectionProofStage: wrap1('xrick_gai_rejection_proof_stage'),
      aiRejectionExecutorStatus: wrap1('xrick_gai_rejection_executor_status'),
      aiRejectionInputMask: wrap1('xrick_gai_rejection_input_mask'),
      aiRejectionFrame: wrap1('xrick_gai_rejection_frame'),
      aiRejectionPhase: wrap1('xrick_gai_rejection_phase'),
      aiRejectionPlayerX: wrap1('xrick_gai_rejection_player_x'),
      aiRejectionPlayerY: wrap1('xrick_gai_rejection_player_y'),
      aiRejectionPlayerSupportId: wrap1('xrick_gai_rejection_player_support_id'),
      aiRejectionLaunchX: wrap1('xrick_gai_rejection_launch_x'),
      aiRejectionLandingX: wrap1('xrick_gai_rejection_landing_x'),
      aiSupportCount: wrap0('xrick_gai_support_count'),
      aiSupportId: wrap1('xrick_gai_support_id'),
      aiSupportX0: wrap1('xrick_gai_support_x0'),
      aiSupportX1: wrap1('xrick_gai_support_x1'),
      aiSupportY: wrap1('xrick_gai_support_y'),
      aiSupportClearance: wrap1('xrick_gai_support_clearance'),
      aiSupportType: wrap1('xrick_gai_support_type'),
      aiExitCount: wrap0('xrick_gai_exit_count'),
      aiImplicitNeutralFrames: wrap0('xrick_gai_implicit_neutral_frames'),
      aiPhaseInput: wrap1('xrick_gai_phase_input'),
      aiPhaseWatchdog: wrap1('xrick_gai_phase_watchdog'),
      aiPhaseGuardCount: wrap1('xrick_gai_phase_guard_count'),
      aiPhaseGuardKind: wrapN('xrick_gai_phase_guard_kind', 2),
      aiPhaseGuardA: wrapN('xrick_gai_phase_guard_a', 2),
      aiPhaseGuardB: wrapN('xrick_gai_phase_guard_b', 2),
      aiPhaseGuardC: wrapN('xrick_gai_phase_guard_c', 2),
      aiPhaseGuardD: wrapN('xrick_gai_phase_guard_d', 2),
      aiPhaseGuardId: wrapN('xrick_gai_phase_guard_id', 2),
      debugSetInvincible: wrap1('xrick_rdx_debug_set_invincible', null),
      debugSetIgnoreExplodableCollision: wrap1('xrick_rdx_debug_set_ignore_explodable_collision', null),
      debugGetIgnoreExplodableCollision: wrap0('xrick_rdx_debug_get_ignore_explodable_collision'),
      debugGetInvincible: wrap0('xrick_rdx_debug_get_invincible'),
      debugSetInfiniteResources: wrap1('xrick_rdx_debug_set_infinite_resources', null),
      debugGetInfiniteResources: wrap0('xrick_rdx_debug_get_infinite_resources'),
      debugAgentBuildEnabled: wrap0('xrick_rdx_debug_agent_build_enabled'),
      debugSetInfiniteLives: wrap1('xrick_rdx_debug_set_infinite_lives', null),
      debugGetInfiniteLives: wrap0('xrick_rdx_debug_get_infinite_lives'),
      debugRefillResources: wrap1('xrick_rdx_debug_refill_resources'),
      debugSetDeathRestartPose: wrapN('xrick_rdx_debug_set_death_restart_pose', 8),
      debugClearDeathRestartPose: wrap0('xrick_rdx_debug_clear_death_restart_pose', null),
      debugGetDeathRestartPoseEnabled: wrap0('xrick_rdx_debug_get_death_restart_pose_enabled'),
      gameplaySetExplosionNearBounceLiftFp: wrap1('xrick_rdx_gameplay_set_explosion_near_bounce_lift_fp', null),
      gameplayGetExplosionNearBounceLiftFp: wrap0('xrick_rdx_gameplay_get_explosion_near_bounce_lift_fp'),
      gameplaySetCoyoteFrames: wrap1('xrick_rdx_gameplay_set_coyote_frames', null),
      gameplayGetCoyoteFrames: wrap0('xrick_rdx_gameplay_get_coyote_frames'),
      gameplaySetJumpBufferFrames: wrap1('xrick_rdx_gameplay_set_jump_buffer_frames', null),
      gameplayGetJumpBufferFrames: wrap0('xrick_rdx_gameplay_get_jump_buffer_frames'),
      gameplaySetJumpTakeoffFp: wrap1('xrick_rdx_gameplay_set_jump_takeoff_fp', null),
      gameplayGetJumpTakeoffFp: wrap0('xrick_rdx_gameplay_get_jump_takeoff_fp'),
      gameplaySetGravityFp: wrap1('xrick_rdx_gameplay_set_gravity_fp', null),
      gameplayGetGravityFp: wrap0('xrick_rdx_gameplay_get_gravity_fp'),
      gameplaySetApexGravityPercent: wrap1('xrick_rdx_gameplay_set_apex_gravity_percent', null),
      gameplayGetApexGravityPercent: wrap0('xrick_rdx_gameplay_get_apex_gravity_percent'),
      gameplaySetJumpReleasePercent: wrap1('xrick_rdx_gameplay_set_jump_release_percent', null),
      gameplayGetJumpReleasePercent: wrap0('xrick_rdx_gameplay_get_jump_release_percent'),
      gameplaySetMaxFallFp: wrap1('xrick_rdx_gameplay_set_max_fall_fp', null),
      gameplayGetMaxFallFp: wrap0('xrick_rdx_gameplay_get_max_fall_fp'),
      gameplaySetCeilingCorrectionPx: wrap1('xrick_rdx_gameplay_set_ceiling_correction_px', null),
      gameplayGetCeilingCorrectionPx: wrap0('xrick_rdx_gameplay_get_ceiling_correction_px'),
      gameplaySetGroundSnapPx: wrap1('xrick_rdx_gameplay_set_ground_snap_px', null),
      gameplayGetGroundSnapPx: wrap0('xrick_rdx_gameplay_get_ground_snap_px'),
      gameplaySetWalkSpeedPx: wrap1('xrick_rdx_gameplay_set_walk_speed_px', null),
      gameplayGetWalkSpeedPx: wrap0('xrick_rdx_gameplay_get_walk_speed_px'),
      gameplaySetFallBounceMinHeight: wrap1('xrick_rdx_gameplay_set_fall_bounce_min_height', null),
      gameplayGetFallBounceMinHeight: wrap0('xrick_rdx_gameplay_get_fall_bounce_min_height'),
      gameplaySetPlatformCurveMode: wrap1('xrick_rdx_gameplay_set_platform_curve_mode', null),
      gameplayGetPlatformCurveMode: wrap0('xrick_rdx_gameplay_get_platform_curve_mode'),
      gameplaySetPlatformCurveCustom: wrapN('xrick_rdx_gameplay_set_platform_curve_custom', 4, null),
      gameplayGetPlatformCurveCustom: wrap1('xrick_rdx_gameplay_get_platform_curve_custom'),
      debugGetWouldDieCount: wrap0('xrick_rdx_debug_get_would_die_count'),
      debugGetWouldDieFrame: wrap0('xrick_rdx_debug_get_would_die_frame'),
      debugSelectSubmap: wrap1('xrick_rdx_debug_select_submap'),
      debugResetCurrentLevel: wrap0('xrick_rdx_debug_reset_current_level', null),
      debugResetCurrentRoomTriggers: wrap0('xrick_rdx_debug_reset_current_room_triggers'),
      debugUnpause: wrap0('xrick_rdx_debug_unpause', null),
      scorpionEntryAnchorAvailable: wrapN('xrick_rdx_scorpion_entry_anchor_available', 2),
      scorpionEntryAnchorWorldX: wrapN('xrick_rdx_scorpion_entry_anchor_world_x', 2),
      scorpionEntryAnchorWorldY: wrapN('xrick_rdx_scorpion_entry_anchor_world_y', 2),
      debugTeleportWorld: wrapN('xrick_rdx_debug_teleport_world', 3),
      debugPlacePreviewPose: wrapN('xrick_rdx_debug_place_preview_pose', 4),
      debugTeleportClassic: wrapN('xrick_rdx_debug_teleport_classic', 2),
      debugSetCameraFrow: wrap1('xrick_rdx_debug_set_camera_frow'),
      collisionReset: wrap0('xrick_rdx_collision_reset', null),
      collisionSetPolicy: wrap1('xrick_rdx_collision_set_policy', null),
      collisionGetPolicy: wrap0('xrick_rdx_collision_get_policy'),
      collisionGetAvailability: wrap0('xrick_rdx_collision_get_availability'),
      collisionGetVerifiedClasses: wrap0('xrick_rdx_collision_get_verified_classes'),
      collisionGetUnresolvedClasses: wrap0('xrick_rdx_collision_get_unresolved_classes'),
      collisionGetMdId: wrap0('xrick_rdx_collision_get_md_id'),
      collisionGetSubmap: wrap0('xrick_rdx_collision_get_submap'),
      collisionGetEvidenceId: wrap0('xrick_rdx_collision_get_evidence_id'),
      collisionGetDatasetHash: wrap0('xrick_rdx_collision_get_dataset_hash'),
      collisionGetFallbackQueries: wrap0('xrick_rdx_collision_get_fallback_queries'),
      collisionGetVerifiedQueries: wrap0('xrick_rdx_collision_get_verified_queries'),
      collisionGetOutOfBoundsQueries: wrap0('xrick_rdx_collision_get_out_of_bounds_queries'),
      collisionShouldPause: wrap0('xrick_rdx_collision_should_pause'),
      collisionLoadRoom: wrapN('rdx_collision_load_room', 11),
      nativeWorldReset: wrap0('xrick_rdx_native_world_reset', null),
      nativeWorldGeneration: wrap0('xrick_rdx_native_world_generation'),
      nativeWorldRestoreOriginal: wrap0('xrick_rdx_native_world_restore_original', null),
      nativeWorldSetCell: wrapN('xrick_rdx_native_world_set_cell', 4),
      mapEditorClearCollisionOverrides: wrap0('xrick_rdx_map_editor_clear_collision_overrides', null),
      mapEditorAddCollisionOverride: wrapN('xrick_rdx_map_editor_add_collision_override', 5),
      mapEditorClearVisualOverrides: wrap0('xrick_rdx_map_editor_clear_visual_overrides', null),
      mapEditorAddVisualOverride: wrapN('xrick_rdx_map_editor_add_visual_override', 10),
      mapEditorClearPresentationDepthOverrides: wrap0('xrick_rdx_map_editor_clear_presentation_depth_overrides', null),
      mapEditorAddPresentationDepthOverride: wrapN('xrick_rdx_map_editor_add_presentation_depth_override', 8),
      mapEditorClearEntities: wrap0('xrick_rdx_map_editor_clear_entities', null),
      mapEditorAddEntity: wrapN('xrick_rdx_map_editor_add_entity', 16),
      mapEditorSuppressMark: wrapN('xrick_rdx_map_editor_suppress_mark', 2),
      mapEditorOverrideSourcePn: wrapN('xrick_rdx_map_editor_override_source_pn', 3),
      mapEditorTranslateSource: wrapN('xrick_rdx_map_editor_translate_source', 4),
      mapEditorOverrideSourceEntity: wrapN('xrick_rdx_map_editor_override_source_entity', 3),
      mapEditorOverrideSourcePatrol: wrapN('xrick_rdx_map_editor_override_source_patrol', 5),
      mapEditorOverrideSourceVisualOffset: wrapN('xrick_rdx_map_editor_override_source_visual_offset', 4),
      mapEditorOverrideSourceStateVisualOffset: wrapN('xrick_rdx_map_editor_override_source_state_visual_offset', 5),
      mapEditorOverrideSourceStatePn: wrapN('xrick_rdx_map_editor_override_source_state_pn', 4),
      mapEditorOverrideSourceDepth: wrapN('xrick_rdx_map_editor_override_source_depth', 3),
      mapEditorOverrideSourceFront: wrapN('xrick_rdx_map_editor_override_source_front', 3),
      mapEditorClearTransitions: wrap0('xrick_rdx_map_editor_clear_transitions', null),
      mapEditorAddTransition: wrapN('xrick_rdx_map_editor_add_transition', 8),
      nativeWorldLoaded: wrap0('xrick_rdx_native_world_loaded'),
      nativeWorldReady: wrap0('xrick_rdx_native_world_ready'),
      nativeWorldMdId: wrap0('xrick_rdx_native_world_md_id'),
      nativeWorldCapabilities: wrap0('xrick_rdx_native_world_capabilities'),
      nativeWorldUnsupportedContacts: wrap0('xrick_rdx_native_world_unsupported_contacts'),
      nativeWorldLastMl: wrap0('xrick_rdx_native_world_last_ml'),
      nativeWorldLastMt: wrap0('xrick_rdx_native_world_last_mt'),
      nativeWorldLastX: wrap0('xrick_rdx_native_world_last_x'),
      nativeWorldLastY: wrap0('xrick_rdx_native_world_last_y'),
      nativeWorldInvalidSpawn: wrap0('xrick_rdx_native_world_invalid_spawn'),
      nativeWorldMutationCount: wrap0('xrick_rdx_native_world_mutation_count'),
      nativeWorldMechanismCount: wrap0('xrick_rdx_native_world_mechanism_count'),
      nativeWorldLastMechanismMl: wrap0('xrick_rdx_native_world_last_mechanism_ml'),
      nativeWorldLastMechanismX: wrap0('xrick_rdx_native_world_last_mechanism_x'),
      nativeWorldLastMechanismY: wrap0('xrick_rdx_native_world_last_mechanism_y'),
      nativeWorldMechanismLatch: wrap0('xrick_rdx_native_world_mechanism_latch'),
      nativeWorldWalkableSurfaceCount: wrap0('xrick_rdx_native_world_walkable_surface_count'),
      nativeWorldWalkableSurfaceX0: wrap1('xrick_rdx_native_world_walkable_surface_x0'),
      nativeWorldWalkableSurfaceX1: wrap1('xrick_rdx_native_world_walkable_surface_x1'),
      nativeWorldWalkableSurfaceY: wrap1('xrick_rdx_native_world_walkable_surface_y'),
      nativeWorldWalkableSurfaceType: wrap1('xrick_rdx_native_world_walkable_surface_type'),
      nativeWorldLadderRunCount: wrap0('xrick_rdx_native_world_ladder_run_count'),
      nativeWorldLadderRunX: wrap1('xrick_rdx_native_world_ladder_run_x'),
      nativeWorldLadderRunY0: wrap1('xrick_rdx_native_world_ladder_run_y0'),
      nativeWorldLadderRunY1: wrap1('xrick_rdx_native_world_ladder_run_y1'),
      nativeWorldLoadRoom: wrapN('rdx_world_load_room', 10),
      nativePlayerActive: wrap0('xrick_rdx_native_player_active'),
      nativePlayerWorldX: wrap0('xrick_rdx_native_player_world_x'),
      nativePlayerWorldY: wrap0('xrick_rdx_native_player_world_y'),
      nativePlayerVelocityY: wrap0('xrick_rdx_native_player_velocity_y'),
      nativePlayerContacts: wrap0('xrick_rdx_native_player_contacts'),
      nativePlayerLastMt: wrap0('xrick_rdx_native_player_last_mt'),
      nativePlayerLastMl: wrap0('xrick_rdx_native_player_last_ml'),
      nativePlayerFloorType: wrap0('xrick_rdx_native_player_floor_type'),
      nativePlayerBounceCount: wrap0('xrick_rdx_native_player_bounce_count'),
      nativePlayerLastBounceVelocity: wrap0('xrick_rdx_native_player_last_bounce_velocity'),
      nativePlayerScreenX: wrap0('xrick_rdx_native_player_screen_x'),
      nativePlayerScreenY: wrap0('xrick_rdx_native_player_screen_y'),
      debugPlayerBodyLeft: wrap0('xrick_rdx_debug_player_body_left'),
      debugPlayerBodyTop: wrap0('xrick_rdx_debug_player_body_top'),
      debugPlayerBodyRight: wrap0('xrick_rdx_debug_player_body_right'),
      debugPlayerBodyBottom: wrap0('xrick_rdx_debug_player_body_bottom'),
      debugPlayerFeetLeft: wrap0('xrick_rdx_debug_player_feet_left'),
      debugPlayerFeetRight: wrap0('xrick_rdx_debug_player_feet_right'),
      debugPlayerFeetY: wrap0('xrick_rdx_debug_player_feet_y'),
      debugPointProbe: wrapN('xrick_rdx_debug_point_probe', 2),
      debugPointClassicCol: wrap0('xrick_rdx_debug_point_classic_col'),
      debugPointClassicRow: wrap0('xrick_rdx_debug_point_classic_row'),
      debugPointLogicX: wrap0('xrick_rdx_debug_point_logic_x'),
      debugPointLogicY: wrap0('xrick_rdx_debug_point_logic_y'),
      debugPointVisualX: wrap0('xrick_rdx_debug_point_visual_x'),
      debugPointVisualY: wrap0('xrick_rdx_debug_point_visual_y'),
      debugPointMt: wrap0('xrick_rdx_debug_point_mt'),
      debugPointMl: wrap0('xrick_rdx_debug_point_ml'),
      debugPointClassicFlags: wrap0('xrick_rdx_debug_point_classic_flags'),
      debugPointRdxFlags: wrap0('xrick_rdx_debug_point_rdx_flags'),
      debugPointRdxKnown: wrap0('xrick_rdx_debug_point_rdx_known'),
      nativePlayerGrounded: wrap0('xrick_rdx_native_player_grounded'),
      nativePlayerClimbing: wrap0('xrick_rdx_native_player_climbing'),
      nativePlayerCrawling: wrap0('xrick_rdx_native_player_crawling'),
      nativePlayerSpawnValid: wrap0('xrick_rdx_native_player_spawn_valid'),
      nativePlayerAnchorUsed: wrap0('xrick_rdx_native_player_anchor_used'),
      nativePlayerAnchorEvidenceId: wrap0('xrick_rdx_native_player_anchor_evidence_id')
    };
    this.paletteCache = new Map();
    const contract = this.api.getContractVersion() >>> 0;
    if (contract !== RDX_WEB_CONTRACT_VERSION) {
      throw new Error(`RDX C/JavaScript contract mismatch: C=0x${contract.toString(16)} JS=0x${RDX_WEB_CONTRACT_VERSION.toString(16)}. Rebuild xrick.js/.wasm from this source tree.`);
    }
  }

  contractVersion() { return this.api.getContractVersion() >>> 0; }
  resolvedLevelsFingerprint() { return this.api.getResolvedLevelsFingerprint() >>> 0; }
  runtimeSourceFingerprint() { return this.api.getRuntimeSourceFingerprint() >>> 0; }
  setPresentationDiagnostics(enabled) { return !!this.api.setPresentationDiagnostics(enabled ? 1 : 0); }
  presentationDiagnostics() { return !!this.api.getPresentationDiagnostics(); }
  resumeBrowserLoop() { this.api.resumeBrowserLoop(); }
  forceBrowserFrame() { this.api.forceBrowserFrame(); }
  debugForceBrowserFrame() { this.api.debugForceBrowserFrame(); }
  setFrontendPaused(paused) { this.api.setFrontendPaused(paused ? 1 : 0); }
  frontendPaused() { return !!this.api.frontendPaused(); }
  setAiTransitionHold(held) { this.api.setAiTransitionHold(held ? 1 : 0); }
  setAiAudioHold(held) { this.api.setAiAudioHold(held ? 1 : 0); }
  setDeathTransitionHold(hold) { this.api.setDeathTransitionHold(hold ? 1 : 0); }
  deathTransitionHold() { return !!this.api.getDeathTransitionHold(); }
  mappedMdForSubmap(submap) { return this.api.getMappedMdForSubmap(Number(submap) >>> 0) >>> 0; }

  debugCheckpointSave(slot) { return !!this.api.debugCheckpointSave(Number(slot) >>> 0); }
  debugCheckpointLoad(slot) { return !!this.api.debugCheckpointLoad(Number(slot) >>> 0); }
  debugCheckpointDiscard(slot) { this.api.debugCheckpointDiscard(Number(slot) >>> 0); }
  debugTraceBegin(controlMask = 0) { return !!this.api.debugTraceBegin(Number(controlMask) & 0xff); }
  debugTraceFinish() { this.api.debugTraceFinish(); }
  debugTraceEvents() {
    const count = Math.min(this.api.debugTraceCount() >>> 0, 4096);
    const events = [];
    for (let index = 0; index < count; index += 1) {
      const values = [];
      for (let field = 0; field < 8; field += 1) values.push(this.api.debugTraceValue(index, field) | 0);
      events.push({
        type: this.api.debugTraceType(index) >>> 0,
        branch: this.api.debugTraceBranch(index) >>> 0,
        values
      });
    }
    return { overflow: !!this.api.debugTraceOverflow(), events };
  }
  submap() { return this.api.getSubmap() >>> 0; }

  runtimeOptionDescriptor(keyOrId) {
    const option = typeof keyOrId === 'string' ? RUNTIME_OPTION_BY_KEY[keyOrId] : RUNTIME_OPTION_BY_ID[Number(keyOrId)];
    if (!option) throw new RangeError(`Unknown runtime option '${keyOrId}'`);
    return option;
  }

  runtimeOption(keyOrId) {
    const option = this.runtimeOptionDescriptor(keyOrId);
    const raw = this.api.optionGet(option.id) >>> 0;
    const value = option.values.find(row => row.value === raw);
    return value?.key ?? option.values.find(row => row.value === option.default)?.key;
  }

  setRuntimeOption(keyOrId, requested) {
    const option = this.runtimeOptionDescriptor(keyOrId);
    const value = option.values.find(row => row.key === String(requested) || row.value === Number(requested));
    if (!value) return this.runtimeOption(option.key);
    const applied = this.api.optionSet(option.id, value.value) >>> 0;
    return option.values.find(row => row.value === applied)?.key ?? this.runtimeOption(option.key);
  }

  runtimeOptionsSnapshot() {
    return Object.freeze(Object.fromEntries(RUNTIME_OPTIONS.map(option => [option.key, this.runtimeOption(option.key)])));
  }

  setSpeedMultiplier(multiplier) {
    const requested = Math.max(1, Math.min(3, Number(multiplier) | 0));
    return Number(this.setRuntimeOption('gameplay_speed', requested));
  }

  speedMultiplier() {
    return Number(this.runtimeOption('gameplay_speed'));
  }

  setTargetFpsOverride(fps) {
    return this.api.setTargetFpsOverride(Math.max(0, Number(fps) | 0)) >>> 0;
  }

  targetFpsOverride() {
    return this.api.getTargetFpsOverride() >>> 0;
  }

  setCameraMode(mode) {
    const value = String(mode).toLowerCase();
    return this.setRuntimeOption('camera_mode', value === 'classic' || Number(mode) === 1 ? 'classic' : 'fluid_v2');
  }
  cameraMode() { return this.runtimeOption('camera_mode'); }

  setCrawlFallPose(enabled) { return !!this.api.debugSetCrawlFallPose(enabled ? 1 : 0); }
  crawlFallPose() { return !!this.api.debugGetCrawlFallPose(); }
  setDirectionalEnemyDeath(enabled) { return !!this.api.debugSetDirectionalEnemyDeath(enabled ? 1 : 0); }
  directionalEnemyDeath() { return !!this.api.debugGetDirectionalEnemyDeath(); }
  setSimulateAllTriggers(enabled) { return !!this.api.debugSetSimulateAllTriggers(enabled ? 1 : 0); }
  simulateAllTriggers() { return !!this.api.debugGetSimulateAllTriggers(); }
  setEditorProjectileHitsNonlethal(enabled) { return !!this.api.debugSetEditorProjectileHitsNonlethal(enabled ? 1 : 0); }
  editorProjectileHitsNonlethal() { return !!this.api.debugGetEditorProjectileHitsNonlethal(); }

  setEnabled(enabled) {
    this.api.setEnabled(enabled ? 1 : 0);
  }

  setSpriteMode(mode) {
    this.api.setSpriteMode(Number(mode) === 0 ? 0 : 1);
  }

  setDynamiteSource(source) {
    const value = String(source);
    this.api.setDynamiteSource(value === 'revival' || Number(source) === 3 ? 3 : 2);
  }

  dynamiteSource() {
    return this.api.getDynamiteSource() === 3 ? 'revival' : 'classic';
  }

  setSpriteReplacementMask(mask) {
    this.api.setSpriteReplacementMask(Number(mask) >>> 0);
  }

  spriteReplacementMask() {
    return this.api.getSpriteReplacementMask() >>> 0;
  }


  setDebugControl(mask) {
    this.api.debugSetControl(Number(mask) & 0xff);
  }

  debugControl() {
    return this.api.debugGetControl() & 0xff;
  }

  aiBackendAvailable() { return !!this.api.aiBackendAvailable(); }
  aiBackendKind() { return this.api.aiBackendKind() >>> 0; }
  aiSetPreferSafe(enabled) { return !!this.api.aiSetPreferSafe(enabled ? 1 : 0); }
  aiPreferSafe() { return !!this.api.aiPreferSafe(); }
  aiSetValidationBudget(maxAttempts = 0) { return !!this.api.aiSetValidationBudget(Number(maxAttempts) >>> 0); }
  aiValidationBudget() { return this.api.aiValidationBudget() >>> 0; }
  aiReset() { return !!this.api.aiReset(); }
  aiPlan(scenario = 2) { return !!this.api.aiPlan(Number(scenario) >>> 0); }
  aiPlanFull(scenario = 2) { return !!this.api.aiPlanFull(Number(scenario) >>> 0); }
  aiPlanFullToPoint(scenario = 2, worldX = 0, worldY = 0, tolerance = 4) {
    return !!this.api.aiPlanFullToPoint(Number(scenario) >>> 0, Number(worldX) | 0,
      Number(worldY) | 0, Number(tolerance) >>> 0);
  }
  aiTick() { return this.api.aiTick() & 0x1f; }
  aiStatus() { return this.api.aiStatus() >>> 0; }
  aiPhaseIndex() { return this.api.aiPhaseIndex() >>> 0; }
  aiPhaseCount() { return this.api.aiPhaseCount() >>> 0; }
  aiRouteEdgeCount() { return this.api.aiRouteEdgeCount() >>> 0; }
  aiRouteDebugCount() { return this.api.aiRouteDebugCount() >>> 0; }
  aiRouteDebugFrom(index) { return this.api.aiRouteDebugFrom(Number(index)>>>0) >>> 0; }
  aiRouteDebugTo(index) { return this.api.aiRouteDebugTo(Number(index)>>>0) >>> 0; }
  aiRouteDebugKind(index) { return this.api.aiRouteDebugKind(Number(index)>>>0) >>> 0; }
  aiRouteDebugSourceId(index) { return this.api.aiRouteDebugSourceId(Number(index)>>>0) >>> 0; }
  aiRouteDebugTargetId(index) { return this.api.aiRouteDebugTargetId(Number(index)>>>0) >>> 0; }
  aiRouteDebugSourceY(index) { return this.api.aiRouteDebugSourceY(Number(index)>>>0) | 0; }
  aiRouteDebugTargetY(index) { return this.api.aiRouteDebugTargetY(Number(index)>>>0) | 0; }
  aiRouteDebugLaunchX0(index) { return this.api.aiRouteDebugLaunchX0(Number(index)>>>0) | 0; }
  aiRouteDebugLaunchX1(index) { return this.api.aiRouteDebugLaunchX1(Number(index)>>>0) | 0; }
  aiRouteDebugProvedLaunchX(index) { return this.api.aiRouteDebugProvedLaunchX(Number(index)>>>0) | 0; }
  aiRouteDebugProvedLandingX(index) { return this.api.aiRouteDebugProvedLandingX(Number(index)>>>0) | 0; }
  aiRouteDebugSourceContactX(index) { return this.api.aiRouteDebugSourceContactX(Number(index)>>>0) | 0; }
  aiRouteDebugSourceContactY(index) { return this.api.aiRouteDebugSourceContactY(Number(index)>>>0) | 0; }
  aiRouteDebugDestinationEntryX(index) { return this.api.aiRouteDebugDestinationEntryX(Number(index)>>>0) | 0; }
  aiRouteDebugDestinationEntryY(index) { return this.api.aiRouteDebugDestinationEntryY(Number(index)>>>0) | 0; }
  aiRouteDebugDestinationSubmap(index) { return this.api.aiRouteDebugDestinationSubmap(Number(index)>>>0) >>> 0; }
  aiRouteDebugFrames(index) { return this.api.aiRouteDebugFrames(Number(index)>>>0) >>> 0; }
  aiRouteDebugHazardContacts(index) { return this.api.aiRouteDebugHazardContacts(Number(index)>>>0) >>> 0; }
  aiRouteDebugDeathEpisodes(index) { return this.api.aiRouteDebugDeathEpisodes(Number(index)>>>0) >>> 0; }
  aiRouteDebugSafeWaitFrames(index) { return this.api.aiRouteDebugSafeWaitFrames(Number(index)>>>0) >>> 0; }
  aiRouteDebugTimingCalculatedWait(index) { return this.api.aiRouteDebugTimingCalculatedWait(Number(index)>>>0) >>> 0; }
  aiRouteDebugTimingStableWait(index) { return this.api.aiRouteDebugTimingStableWait(Number(index)>>>0) >>> 0; }
  aiRouteDebugTimingSafeWindowFrames(index) { return this.api.aiRouteDebugTimingSafeWindowFrames(Number(index)>>>0) >>> 0; }
  aiRouteDebugActivationWaitFrames(index) { return this.api.aiRouteDebugActivationWaitFrames(Number(index)>>>0) >>> 0; }
  aiRouteDebugActivationStartDelayFrames(index) { return this.api.aiRouteDebugActivationStartDelayFrames(Number(index)>>>0) >>> 0; }
  aiRouteDebugSafeWaitX(index) { return this.api.aiRouteDebugSafeWaitX(Number(index)>>>0) | 0; }
  aiRouteDebugActivationWaitX(index) { return this.api.aiRouteDebugActivationWaitX(Number(index)>>>0) | 0; }
  aiRouteDebugSafeWaitInputMask(index) { return this.api.aiRouteDebugSafeWaitInputMask(Number(index)>>>0) >>> 0; }
  aiRouteDebugActivationWaitInputMask(index) { return this.api.aiRouteDebugActivationWaitInputMask(Number(index)>>>0) >>> 0; }
  aiRouteDebugTimingPredictableHazard(index) { return !!this.api.aiRouteDebugTimingPredictableHazard(Number(index)>>>0); }
  aiRouteDebugTimingWindowFound(index) { return !!this.api.aiRouteDebugTimingWindowFound(Number(index)>>>0); }
  aiRouteDebugTimingHoldAttempts(index) { return this.api.aiRouteDebugTimingHoldAttempts(Number(index)>>>0) >>> 0; }
  aiRouteDebugFallSegmentCount(index) { return this.api.aiRouteDebugFallSegmentCount(Number(index)>>>0) >>> 0; }
  aiRouteDebugDemolitionOnly(index) { return !!this.api.aiRouteDebugDemolitionOnly(Number(index)>>>0); }
  aiRouteDebugObservedActivationPlatform(index) { return !!this.api.aiRouteDebugObservedActivationPlatform(Number(index)>>>0); }
  aiRouteDebugObservedActivationActorId(index) { return this.api.aiRouteDebugObservedActivationActorId(Number(index)>>>0) >>> 0; }
  aiRouteDebugSpeculativeEnemyRisk(index) { return this.api.aiRouteDebugSpeculativeEnemyRisk(Number(index)>>>0) >>> 0; }
  aiRouteDebugReactiveExposure(index) { return this.api.aiRouteDebugReactiveExposure(Number(index)>>>0) >>> 0; }
  aiRouteDebugPredictedWaitFrames(index) { return this.api.aiRouteDebugPredictedWaitFrames(Number(index)>>>0) >>> 0; }
  aiRouteDebugPredictedSafeWindowFrames(index) { return this.api.aiRouteDebugPredictedSafeWindowFrames(Number(index)>>>0) >>> 0; }
  aiRouteDebugSpeculativeTimingState(index) { return this.api.aiRouteDebugSpeculativeTimingState(Number(index)>>>0) >>> 0; }
  aiRouteDebugMutationEffectClass(index) { return this.api.aiRouteDebugMutationEffectClass(Number(index)>>>0) >>> 0; }
  aiRouteDebugMutationEvidence(index) { return this.api.aiRouteDebugMutationEvidence(Number(index)>>>0) >>> 0; }
  aiRouteDebugMutationPriority(index) { return this.api.aiRouteDebugMutationPriority(Number(index)>>>0) >>> 0; }
  aiRouteDebugCausalPrerequisite(index) { return !!this.api.aiRouteDebugCausalPrerequisite(Number(index)>>>0); }
  aiRouteDebugExactProofSafe(index) { return !!this.api.aiRouteDebugExactProofSafe(Number(index)>>>0); }
  aiRouteDebugBombs(index) { return this.api.aiRouteDebugBombs(Number(index)>>>0) >>> 0; }
  aiRouteDebugBullets(index) { return this.api.aiRouteDebugBullets(Number(index)>>>0) >>> 0; }
  aiSegmentCount() { return this.api.aiSegmentCount() >>> 0; }
  aiReplanCount() { return this.api.aiReplanCount() >>> 0; }
  aiCompletePlan() { return !!this.api.aiCompletePlan(); }
  aiPartialPlan() { return !!this.api.aiPartialPlan(); }
  aiRouteHazardContacts() { return this.api.aiRouteHazardContacts() >>> 0; }
  aiRouteDeathEpisodes() { return this.api.aiRouteDeathEpisodes() >>> 0; }
  aiRouteBombsUsed() { return this.api.aiRouteBombsUsed() >>> 0; }
  aiRouteBulletsUsed() { return this.api.aiRouteBulletsUsed() >>> 0; }
  aiRouteCollectibles() { return this.api.aiRouteCollectibles() >>> 0; }
  aiRouteProjectileCrawls() { return this.api.aiRouteProjectileCrawls() >>> 0; }
  aiRouteCrossfireActions() { return this.api.aiRouteCrossfireActions() >>> 0; }
  aiRouteResetTriggers() { return this.api.aiRouteResetTriggers() >>> 0; }
  aiRouteTimedBlockages() { return this.api.aiRouteTimedBlockages() >>> 0; }
  aiRouteRemoteDemolitions() { return this.api.aiRouteRemoteDemolitions() >>> 0; }
  aiRoutePrerequisiteClears() { return this.api.aiRoutePrerequisiteClears() >>> 0; }
  aiHazardousRouteEdges() { return this.api.aiHazardousRouteEdges() >>> 0; }
  aiBlockingKind() { return this.api.aiBlockingKind() >>> 0; }
  aiBlockingFrom() { return this.api.aiBlockingFrom() >>> 0; }
  aiBlockingTo() { return this.api.aiBlockingTo() >>> 0; }
  aiValidationAttempts() { return this.api.aiValidationAttempts() >>> 0; }
  aiBudgetExhausted() { return !!this.api.aiBudgetExhausted(); }
  aiBestGoalDistance() { return this.api.aiBestGoalDistance() >>> 0; }
  aiBestPrefixUpdates() { return this.api.aiBestPrefixUpdates() >>> 0; }
  aiDominatedRouteCandidates() { return this.api.aiDominatedRouteCandidates() >>> 0; }
  aiProvedEdgeCount() { return this.api.aiProvedEdgeCount() >>> 0; }
  aiRejectedEdgeCount() { return this.api.aiRejectedEdgeCount() >>> 0; }
  aiFailureStage() { return this.api.aiFailureStage() >>> 0; }
  aiFailureDetail() { return this.api.aiFailureDetail() >>> 0; }
  aiNodeCount() { return this.api.aiNodeCount() >>> 0; }
  aiEdgeCount() { return this.api.aiEdgeCount() >>> 0; }
  aiStartNode() { return this.api.aiStartNode() >>> 0; }
  aiGoalNode() { return this.api.aiGoalNode() >>> 0; }
  aiCandidateCounts() { return {
    walk:this.api.aiCandidateWalk()>>>0, crawl:this.api.aiCandidateCrawl()>>>0,
    drop:this.api.aiCandidateDrop()>>>0, jump:this.api.aiCandidateJump()>>>0,
    ladder:this.api.aiCandidateLadder()>>>0, exit:this.api.aiCandidateExit()>>>0,
    dynamite:this.api.aiCandidateDynamite()>>>0,
    shoot:this.api.aiCandidateShoot()>>>0,
    dynamicPlatforms:this.api.aiDynamicPlatformCount()>>>0,
    dynamicPlatformStops:this.api.aiDynamicPlatformStopCount()>>>0,
    dynamicPlatformLinks:this.api.aiDynamicPlatformLinkCount()>>>0,
    triggerableDeactivators:this.api.aiTriggerableDeactivatorCount()>>>0,
    routeMechanismActivations:this.api.aiRouteMechanismActivations()>>>0,
    routePlatformActivations:this.api.aiRoutePlatformActivations()>>>0
  }; }
  aiCausalPrerequisiteCount() { return this.api.aiCausalPrerequisiteCount() >>> 0; }
  aiMutationCandidateCount() { return this.api.aiMutationCandidateCount() >>> 0; }
  aiCausalMutationsSelected() { return this.api.aiCausalMutationsSelected() >>> 0; }
  aiTopologyRecaptures() { return this.api.aiTopologyRecaptures() >>> 0; }
  aiTimingPredictableEdgeCount() { return this.api.aiTimingPredictableEdgeCount() >>> 0; }
  aiTimingNarrowEdgeCount() { return this.api.aiTimingNarrowEdgeCount() >>> 0; }
  aiTimingBlockedEdgeCount() { return this.api.aiTimingBlockedEdgeCount() >>> 0; }
  aiTimingWaitEdgeCount() { return this.api.aiTimingWaitEdgeCount() >>> 0; }
  aiReactiveExposureEdgeCount() { return this.api.aiReactiveExposureEdgeCount() >>> 0; }
  aiReactiveExposureTotal() { return this.api.aiReactiveExposureTotal() >>> 0; }
  aiUnresolvedTransitionCount() { return this.api.aiUnresolvedTransitionCount() >>> 0; }
  aiRepeatedSemanticStateCount() { return this.api.aiRepeatedSemanticStateCount() >>> 0; }
  aiReplanCycleCount() { return this.api.aiReplanCycleCount() >>> 0; }
  aiFailureCacheHits() { return this.api.aiFailureCacheHits() >>> 0; }
  aiAvoidedProofAttempts() { return this.api.aiAvoidedProofAttempts() >>> 0; }
  aiRepeatedBlockerCount() { return this.api.aiRepeatedBlockerCount() >>> 0; }
  aiLocalSalvageAttempts() { return this.api.aiLocalSalvageAttempts() >>> 0; }
  aiProofWorkLimitHits() { return this.api.aiProofWorkLimitHits() >>> 0; }
  aiSemanticStateHash() { return this.api.aiSemanticStateHash() >>> 0; }
  aiTopologyEpoch() { return this.api.aiTopologyEpoch() >>> 0; }
  aiOutcome() { return this.api.aiOutcome() >>> 0; }
  aiStaticExitReachable() { return !!this.api.aiStaticExitReachable(); }
  aiCausalPrerequisiteRequired() { return !!this.api.aiCausalPrerequisiteRequired(); }
  aiMutationSelectedFrom() { return this.api.aiMutationSelectedFrom() >>> 0; }
  aiMutationSelectedTo() { return this.api.aiMutationSelectedTo() >>> 0; }
  aiMutationSelectedMechanism() { return this.api.aiMutationSelectedMechanism() >>> 0; }
  aiMutationSelectedKind() { return this.api.aiMutationSelectedKind() >>> 0; }
  aiMutationFeasibility() { return this.api.aiMutationFeasibility() >>> 0; }
  aiMutationSelectedMechanismId() { return this.api.aiMutationSelectedMechanismId() >>> 0; }
  aiWorldNativeRdx() { return !!this.api.aiWorldNativeRdx(); }
  aiPlayerX() { return this.api.aiPlayerX() | 0; }
  aiPlayerY() { return this.api.aiPlayerY() | 0; }
  aiPlayerSupportId() { return this.api.aiPlayerSupportId() >>> 0; }
  aiActorCount() { return this.api.aiActorCount() >>> 0; }
  aiMechanismCount() { return this.api.aiMechanismCount() >>> 0; }
  aiWorldFrameSerial() { return this.api.aiWorldFrameSerial() >>> 0; }
  aiLayoutHash() { return this.api.aiLayoutHash() >>> 0; }
  aiLastProofFailureStage() { return this.api.aiLastProofFailureStage() >>> 0; }
  aiLastProofExecutorStatus() { return this.api.aiLastProofExecutorStatus() >>> 0; }
  aiLastProofInputMask() { return this.api.aiLastProofInputMask() >>> 0; }
  aiLastProofKind() { return this.api.aiLastProofKind() >>> 0; }
  aiLastProofFrom() { return this.api.aiLastProofFrom() >>> 0; }
  aiLastProofTo() { return this.api.aiLastProofTo() >>> 0; }
  aiLastProofFrame() { return this.api.aiLastProofFrame() >>> 0; }
  aiLastProofPhase() { return this.api.aiLastProofPhase() >>> 0; }
  aiLastProofPlayerX() { return this.api.aiLastProofPlayerX() | 0; }
  aiLastProofPlayerY() { return this.api.aiLastProofPlayerY() | 0; }
  aiLastProofPlayerSupportId() { return this.api.aiLastProofPlayerSupportId() >>> 0; }
  aiLastProofTargetId() { return this.api.aiLastProofTargetId() >>> 0; }
  aiLastProofLaunchX() { return this.api.aiLastProofLaunchX() | 0; }
  aiLastProofLandingX() { return this.api.aiLastProofLandingX() | 0; }
  aiLastProofHazardContacts() { return this.api.aiLastProofHazardContacts() >>> 0; }
  aiLastProofDeathEpisodes() { return this.api.aiLastProofDeathEpisodes() >>> 0; }
  aiDropSearchResult() { return this.api.aiDropSearchResult() >>> 0; }
  aiDropSearchLandingHintUsed() { return !!this.api.aiDropSearchLandingHintUsed(); }
  aiDropSearchPreferSafe() { return !!this.api.aiDropSearchPreferSafe(); }
  aiDropSearchAttemptsTruncated() { return !!this.api.aiDropSearchAttemptsTruncated(); }
  aiDropSearchAttemptCount() { return this.api.aiDropSearchAttemptCount() >>> 0; }
  aiDropSearchSourceId() { return this.api.aiDropSearchSourceId() >>> 0; }
  aiDropSearchTargetId() { return this.api.aiDropSearchTargetId() >>> 0; }
  aiDropSearchSourceX0() { return this.api.aiDropSearchSourceX0() | 0; }
  aiDropSearchSourceX1() { return this.api.aiDropSearchSourceX1() | 0; }
  aiDropSearchSourceY() { return this.api.aiDropSearchSourceY() | 0; }
  aiDropSearchTargetX0() { return this.api.aiDropSearchTargetX0() | 0; }
  aiDropSearchTargetX1() { return this.api.aiDropSearchTargetX1() | 0; }
  aiDropSearchTargetY() { return this.api.aiDropSearchTargetY() | 0; }
  aiDropSearchPreferredLandingX() { return this.api.aiDropSearchPreferredLandingX() | 0; }
  aiDropAttemptOutcome(index) { return this.api.aiDropAttemptOutcome(Number(index)>>>0) >>> 0; }
  aiDropAttemptSegmentCount(index) { return this.api.aiDropAttemptSegmentCount(Number(index)>>>0) >>> 0; }
  aiDropAttemptForceCrawl(index) { return !!this.api.aiDropAttemptForceCrawl(Number(index)>>>0); }
  aiDropAttemptInputMask(attempt, segment) { return this.api.aiDropAttemptInputMask(Number(attempt)>>>0, Number(segment)>>>0) >>> 0; }
  aiDropAttemptInputFrames(attempt, segment) { return this.api.aiDropAttemptInputFrames(Number(attempt)>>>0, Number(segment)>>>0) >>> 0; }
  aiDropAttemptRequestedLaunchX(index) { return this.api.aiDropAttemptRequestedLaunchX(Number(index)>>>0) | 0; }
  aiDropAttemptActualLaunchX(index) { return this.api.aiDropAttemptActualLaunchX(Number(index)>>>0) | 0; }
  aiDropAttemptFramesSimulated(index) { return this.api.aiDropAttemptFramesSimulated(Number(index)>>>0) >>> 0; }
  aiDropAttemptEndX(index) { return this.api.aiDropAttemptEndX(Number(index)>>>0) | 0; }
  aiDropAttemptEndY(index) { return this.api.aiDropAttemptEndY(Number(index)>>>0) | 0; }
  aiDropAttemptEndSupportId(index) { return this.api.aiDropAttemptEndSupportId(Number(index)>>>0) >>> 0; }
  aiDropAttemptHazardContacts(index) { return this.api.aiDropAttemptHazardContacts(Number(index)>>>0) >>> 0; }
  aiDropAttemptDeathEpisodes(index) { return this.api.aiDropAttemptDeathEpisodes(Number(index)>>>0) >>> 0; }
  aiRejectionHistoryCount() { return this.api.aiRejectionHistoryCount() >>> 0; }
  aiRejectionKind(index) { return this.api.aiRejectionKind(Number(index)>>>0) >>> 0; }
  aiRejectionFrom(index) { return this.api.aiRejectionFrom(Number(index)>>>0) >>> 0; }
  aiRejectionTo(index) { return this.api.aiRejectionTo(Number(index)>>>0) >>> 0; }
  aiRejectionProofStage(index) { return this.api.aiRejectionProofStage(Number(index)>>>0) >>> 0; }
  aiRejectionExecutorStatus(index) { return this.api.aiRejectionExecutorStatus(Number(index)>>>0) >>> 0; }
  aiRejectionInputMask(index) { return this.api.aiRejectionInputMask(Number(index)>>>0) >>> 0; }
  aiRejectionFrame(index) { return this.api.aiRejectionFrame(Number(index)>>>0) >>> 0; }
  aiRejectionPhase(index) { return this.api.aiRejectionPhase(Number(index)>>>0) >>> 0; }
  aiRejectionPlayerX(index) { return this.api.aiRejectionPlayerX(Number(index)>>>0) | 0; }
  aiRejectionPlayerY(index) { return this.api.aiRejectionPlayerY(Number(index)>>>0) | 0; }
  aiRejectionPlayerSupportId(index) { return this.api.aiRejectionPlayerSupportId(Number(index)>>>0) >>> 0; }
  aiRejectionLaunchX(index) { return this.api.aiRejectionLaunchX(Number(index)>>>0) | 0; }
  aiRejectionLandingX(index) { return this.api.aiRejectionLandingX(Number(index)>>>0) | 0; }
  aiPlanFullContinue(scenario) { return !!this.api.aiPlanFullContinue(Number(scenario)>>>0); }
  aiRestartPlanFull(scenario) { return !!this.api.aiRestartPlanFull(Number(scenario)>>>0); }
  aiSupportCount() { return this.api.aiSupportCount() >>> 0; }
  aiSupportId(index) { return this.api.aiSupportId(Number(index)>>>0) >>> 0; }
  aiSupportX0(index) { return this.api.aiSupportX0(Number(index)>>>0) | 0; }
  aiSupportX1(index) { return this.api.aiSupportX1(Number(index)>>>0) | 0; }
  aiSupportY(index) { return this.api.aiSupportY(Number(index)>>>0) | 0; }
  aiSupportClearance(index) { return this.api.aiSupportClearance(Number(index)>>>0) >>> 0; }
  aiSupportType(index) { return this.api.aiSupportType(Number(index)>>>0) >>> 0; }
  aiExitCount() { return this.api.aiExitCount() >>> 0; }
  aiImplicitNeutralFrames() { return this.api.aiImplicitNeutralFrames() >>> 0; }
  aiPhaseInput(index) { return this.api.aiPhaseInput(Number(index)>>>0) >>> 0; }
  aiPhaseWatchdog(index) { return this.api.aiPhaseWatchdog(Number(index)>>>0) >>> 0; }
  aiPhaseGuardCount(index) { return this.api.aiPhaseGuardCount(Number(index)>>>0) >>> 0; }
  aiPhaseGuardKind(phase, guard) { return this.api.aiPhaseGuardKind(Number(phase)>>>0, Number(guard)>>>0) >>> 0; }
  aiPhaseGuardA(phase, guard) { return this.api.aiPhaseGuardA(Number(phase)>>>0, Number(guard)>>>0) | 0; }
  aiPhaseGuardB(phase, guard) { return this.api.aiPhaseGuardB(Number(phase)>>>0, Number(guard)>>>0) | 0; }
  aiPhaseGuardC(phase, guard) { return this.api.aiPhaseGuardC(Number(phase)>>>0, Number(guard)>>>0) | 0; }
  aiPhaseGuardD(phase, guard) { return this.api.aiPhaseGuardD(Number(phase)>>>0, Number(guard)>>>0) | 0; }
  aiPhaseGuardId(phase, guard) { return this.api.aiPhaseGuardId(Number(phase)>>>0, Number(guard)>>>0) >>> 0; }

  setDebugInvincible(enabled) {
    this.api.debugSetInvincible(enabled ? 1 : 0);
  }

  setIgnoreExplodableCollision(enabled) {
    this.api.debugSetIgnoreExplodableCollision(enabled ? 1 : 0);
  }

  ignoreExplodableCollision() {
    return !!this.api.debugGetIgnoreExplodableCollision();
  }

  selectSubmap(submap) {
    return !!this.api.debugSelectSubmap(Number(submap) >>> 0);
  }

  resetCurrentLevel() {
    this.api.debugResetCurrentLevel();
  }

  resetCurrentRoomTriggers() {
    return Number(this.api.debugResetCurrentRoomTriggers()) >>> 0;
  }

  restartCurrentLevelNow() {
    return !!this.api.debugRestartCurrentLevelNow();
  }

  restartCurrentLevelForAi() {
    return !!this.api.debugRestartCurrentLevelForAi();
  }

  unpause() {
    this.api.debugUnpause();
  }

  scorpionEntryAnchor(mapId, submap) {
    const md = Number(mapId) >>> 0, sm = Number(submap) >>> 0;
    if (!this.api.scorpionEntryAnchorAvailable(md, sm)) return null;
    return { x: this.api.scorpionEntryAnchorWorldX(md, sm) | 0, y: this.api.scorpionEntryAnchorWorldY(md, sm) | 0 };
  }

  reachableStartRow(submap) {
    return this.api.getReachableStartRow(Number(submap) >>> 0) >>> 0;
  }

  teleportWorld(worldX, worldY, crawling = false) {
    return !!this.api.debugTeleportWorld(Number(worldX) | 0, Number(worldY) | 0, crawling ? 1 : 0);
  }

  placePreviewPose(worldX, worldY, crawling = false, desiredScreenY = 150) {
    return !!this.api.debugPlacePreviewPose(Number(worldX) | 0, Number(worldY) | 0, crawling ? 1 : 0, Number(desiredScreenY) | 0);
  }

  teleportClassic(entityX, entityY) {
    return !!this.api.debugTeleportClassic(Number(entityX) >>> 0, Number(entityY) >>> 0);
  }

  setCameraFrow(frow) {
    return !!this.api.debugSetCameraFrow(Number(frow) >>> 0);
  }
  setDeathRestartPose(pose) {
    if (!pose) return false;
    return !!this.api.debugSetDeathRestartPose(
      Number(pose.submap) >>> 0, Number(pose.mapFrow) >>> 0,
      Number(pose.entityX) >>> 0, Number(pose.entityY) >>> 0,
      Number(pose.worldX) | 0, Number(pose.worldY) | 0,
      pose.nativeValid ? 1 : 0, pose.crawling ? 1 : 0);
  }
  clearDeathRestartPose() { this.api.debugClearDeathRestartPose(); }
  deathRestartPoseEnabled() { return !!this.api.debugGetDeathRestartPoseEnabled(); }
  setExplosionNearBounceLift(liftFp) {
    this.api.gameplaySetExplosionNearBounceLiftFp(Number(liftFp) >>> 0);
    return this.explosionNearBounceLift();
  }
  explosionNearBounceLift() {
    return this.api.gameplayGetExplosionNearBounceLiftFp() >>> 0;
  }
  nativeWorldGeneration() { return this.api.nativeWorldGeneration() >>> 0; }
  restoreNativeWorldOriginal() { this.api.nativeWorldRestoreOriginal(); return true; }
  setNativeWorldCell(logicX, logicY, mt, ml) {
    return !!this.api.nativeWorldSetCell(Number(logicX)|0, Number(logicY)|0, Number(mt)&0xff, Number(ml)&0xff);
  }
  clearMapEditorCollisionOverrides() { this.api.mapEditorClearCollisionOverrides(); return true; }
  addMapEditorCollisionOverride(submap, mapId, g8X, g8Y, kind) { return !!this.api.mapEditorAddCollisionOverride(Number(submap)>>>0, Number(mapId)>>>0, Number(g8X)|0, Number(g8Y)|0, Number(kind)>>>0); }
  clearMapEditorVisualOverrides() { this.api.mapEditorClearVisualOverrides(); return true; }
  addMapEditorVisualOverride(mapId, targetX, targetY, sourceX, sourceY, targetPlane, sourcePlane, clear = false, sourceMapId = mapId, mirrorX = false) {
    return !!this.api.mapEditorAddVisualOverride(Number(mapId)>>>0, Number(targetX)>>>0, Number(targetY)>>>0,
      Number(sourceMapId)>>>0, Number(sourceX)|0, Number(sourceY)|0, Number(targetPlane)>>>0, Number(sourcePlane)>>>0, clear ? 1 : 0, mirrorX ? 1 : 0);
  }
  clearMapEditorPresentationDepthOverrides() { this.api.mapEditorClearPresentationDepthOverrides(); return true; }
  addMapEditorPresentationDepthOverride(submap, mapId, x, y, width, height, plane, band) {
    return !!this.api.mapEditorAddPresentationDepthOverride(Number(submap)>>>0, Number(mapId)>>>0, Number(x)|0, Number(y)|0,
      Number(width)>>>0, Number(height)>>>0, Number(plane)>>>0, Number(band)>>>0);
  }
  clearMapEditorEntities() { this.api.mapEditorClearEntities(); return true; }
  clearMapEditorTransitions() { this.api.mapEditorClearTransitions(); return true; }
  addMapEditorTransition(sourceSubmap, direction, contactRow, targetSubmap, rowIn, entryX, entryY, entryFrow) {
    return !!this.api.mapEditorAddTransition(Number(sourceSubmap)>>>0, Number(direction)|0, Number(contactRow)>>>0, Number(targetSubmap)>>>0, Number(rowIn)>>>0, Number(entryX)>>>0, Number(entryY)>>>0, Number(entryFrow)>>>0);
  }
  addMapEditorEntity(submap, entityN, flags, worldX, worldY, patrolWorldX = worldX, patrolWorldY = worldY, triggerWorldX = worldX, triggerWorldY = worldY, latency = 0, actionPeriod = 1, front = false, presentationPn = -1, mirrorX = false, mirrorY = false, presentationFrame = -1) {
    return this.api.mapEditorAddEntity(Number(submap)>>>0, Number(entityN)>>>0, Number(flags)>>>0, Number(worldX)|0, Number(worldY)|0, Number(patrolWorldX)|0, Number(patrolWorldY)|0, Number(triggerWorldX)|0, Number(triggerWorldY)|0, Number(latency)>>>0, Number(actionPeriod)>>>0, front ? 1 : 0, Number(presentationPn)|0, mirrorX ? 1 : 0, mirrorY ? 1 : 0, Number(presentationFrame)|0) >>> 0;
  }
  suppressMapEditorMark(submap, mark) { return !!this.api.mapEditorSuppressMark(Number(submap)>>>0, Number(mark)>>>0); }
  overrideMapEditorSourcePn(submap, mark, pn) { return !!this.api.mapEditorOverrideSourcePn(Number(submap)>>>0, Number(mark)>>>0, Number(pn)>>>0); }
  translateMapEditorSource(submap, mark, dx, dy) { return !!this.api.mapEditorTranslateSource(Number(submap)>>>0, Number(mark)>>>0, Number(dx)|0, Number(dy)|0); }
  overrideMapEditorSourceEntity(submap, mark, entityN) { return !!this.api.mapEditorOverrideSourceEntity(Number(submap)>>>0, Number(mark)>>>0, Number(entityN)>>>0); }
  overrideMapEditorSourcePatrol(submap, mark, distancePx, initialDx, startupLatencyTicks) { return !!this.api.mapEditorOverrideSourcePatrol(Number(submap)>>>0, Number(mark)>>>0, Number(distancePx)>>>0, Number(initialDx)|0, Number(startupLatencyTicks)>>>0); }
  overrideMapEditorSourceVisualOffset(submap, mark, dx, dy) { return !!this.api.mapEditorOverrideSourceVisualOffset(Number(submap)>>>0, Number(mark)>>>0, Number(dx)|0, Number(dy)|0); }
  overrideMapEditorSourceStateVisualOffset(submap, mark, pn, dx, dy) { return !!this.api.mapEditorOverrideSourceStateVisualOffset(Number(submap)>>>0, Number(mark)>>>0, Number(pn)>>>0, Number(dx)|0, Number(dy)|0); }
  overrideMapEditorSourceStatePn(submap, mark, sourcePn, targetPn) { return !!this.api.mapEditorOverrideSourceStatePn(Number(submap)>>>0, Number(mark)>>>0, Number(sourcePn)>>>0, Number(targetPn)>>>0); }
  overrideMapEditorSourceDepth(submap, mark, depth) { const value = depth === 'front' ? 1 : depth === 'behind-midground' ? 2 : 0; return !!this.api.mapEditorOverrideSourceDepth(Number(submap)>>>0, Number(mark)>>>0, value); }
  overrideMapEditorSourceFront(submap, mark, front) { return !!this.api.mapEditorOverrideSourceFront(Number(submap)>>>0, Number(mark)>>>0, front ? 1 : 0); }

  resetCollision() {
    this.api.collisionReset();
    delete this.module.rdxCollisionContacts;
    delete this.module.rdxCollisionVerified;
    delete this.module.rdxNativeMt;
    delete this.module.rdxNativeMl;
  }

  setCollisionPolicy(policy) {
    this.api.collisionSetPolicy(Number(policy) >>> 0);
  }

  collisionPolicy() { return this.api.collisionGetPolicy() >>> 0; }

  loadCollisionRoom({ submap, mapId, baseDxPx, baseDyPx, room, datasetHash }) {
    const count = room.width * room.height;
    if (!(room.contacts instanceof Uint16Array) || room.contacts.length !== count) {
      throw new Error(`Invalid collision contacts grid for MD${Number(mapId).toString(16).toUpperCase().padStart(4, '0')}`);
    }
    if (!(room.verified instanceof Uint16Array) || room.verified.length !== count) {
      throw new Error(`Invalid collision verification grid for MD${Number(mapId).toString(16).toUpperCase().padStart(4, '0')}`);
    }
    this.module.rdxCollisionContacts = new Uint16Array(room.contacts);
    this.module.rdxCollisionVerified = new Uint16Array(room.verified);
    const copied = this.api.collisionLoadRoom(
      Number(submap) >>> 0,
      Number(mapId) >>> 0,
      Number(baseDxPx) | 0,
      Number(baseDyPx) | 0,
      room.width >>> 0,
      room.height >>> 0,
      room.availability >>> 0,
      room.verifiedClasses >>> 0,
      room.unresolvedClasses >>> 0,
      room.evidenceId >>> 0,
      Number(datasetHash) >>> 0
    ) >>> 0;
    if (copied !== count) throw new Error(`Collision grid copy failed: copied ${copied} of ${count} cells`);
    return copied;
  }

  loadNativeCollisionRoom({ submap, mapId, baseDxPx, baseDyPx, dimensions, logic, mt, ml, capabilityMask, nativeReady }) {
    const count = logic.width * logic.height;
    if (!(mt instanceof Uint8Array) || mt.length !== count) {
      throw new Error(`Invalid native MT grid for MD${Number(mapId).toString(16).toUpperCase().padStart(4, '0')}`);
    }
    if (!(ml instanceof Uint8Array) || ml.length !== count) {
      throw new Error(`Invalid native ML grid for MD${Number(mapId).toString(16).toUpperCase().padStart(4, '0')}`);
    }
    this.module.rdxNativeMt = new Uint8Array(mt);
    this.module.rdxNativeMl = new Uint8Array(ml);
    const copied = this.api.nativeWorldLoadRoom(
      Number(submap) >>> 0,
      Number(mapId) >>> 0,
      Number(baseDxPx) | 0,
      Number(baseDyPx) | 0,
      dimensions.width >>> 0,
      dimensions.height >>> 0,
      logic.width >>> 0,
      logic.height >>> 0,
      Number(capabilityMask) >>> 0,
      nativeReady ? 1 : 0
    ) >>> 0;
    if (copied !== count) throw new Error(`Native MT/ML copy failed: copied ${copied} of ${count} cells`);
    return copied;
  }

  setVerifiedActorCollision({ slot, actorId, left, top, right, bottom, flags = 0, evidenceId }) {
    const ok = this.api.actorCollisionSetVerified(
      Number(slot) >>> 0,
      Number(actorId) >>> 0,
      Number(left) | 0,
      Number(top) | 0,
      Number(right) | 0,
      Number(bottom) | 0,
      Number(flags) >>> 0,
      Number(evidenceId) >>> 0
    ) >>> 0;
    if (!ok) throw new Error(`Rejected verified actor collision box for slot ${slot}`);
    return ok;
  }

  clearActorCollision(slot) {
    this.api.actorCollisionClear(Number(slot) >>> 0);
  }

  actorCollisionSnapshot(slot) {
    const source = this.api.actorCollisionSource(slot) >>> 0;
    if (!source) return { source: 0 };
    return {
      source,
      actorId: this.api.actorCollisionActorId(slot) >>> 0,
      left: this.api.actorCollisionLeft(slot) | 0,
      top: this.api.actorCollisionTop(slot) | 0,
      right: this.api.actorCollisionRight(slot) | 0,
      bottom: this.api.actorCollisionBottom(slot) | 0,
      flags: this.api.actorCollisionFlags(slot) >>> 0,
      evidenceId: this.api.actorCollisionEvidenceId(slot) >>> 0
    };
  }

  nativeWalkableSurfaces() {
    const count = this.api.nativeWorldWalkableSurfaceCount() >>> 0;
    const surfaces = [];
    for (let index = 0; index < count; index += 1) {
      surfaces.push({
        x0: this.api.nativeWorldWalkableSurfaceX0(index) | 0,
        x1: this.api.nativeWorldWalkableSurfaceX1(index) | 0,
        y: this.api.nativeWorldWalkableSurfaceY(index) | 0,
        type: this.api.nativeWorldWalkableSurfaceType(index) >>> 0
      });
    }
    return surfaces;
  }

  debugMapPoint(worldX, worldY) {
    const available = !!this.api.debugPointProbe(Number(worldX) | 0, Number(worldY) | 0);
    const known = !!this.api.debugPointRdxKnown();
    return {
      world: { x: Number(worldX) | 0, y: Number(worldY) | 0 },
      classic: {
        col: this.api.debugPointClassicCol() | 0,
        row: this.api.debugPointClassicRow() | 0,
        flags: this.api.debugPointClassicFlags() >>> 0
      },
      rdx: {
        available,
        logicX: this.api.debugPointLogicX() | 0,
        logicY: this.api.debugPointLogicY() | 0,
        visualX: this.api.debugPointVisualX() | 0,
        visualY: this.api.debugPointVisualY() | 0,
        mt: this.api.debugPointMt() >>> 0,
        ml: this.api.debugPointMl() >>> 0,
        flags: this.api.debugPointRdxFlags() >>> 0,
        known,
        provenance: known ? 'rdx_descriptor' : available ? 'classic_fallback' : 'unavailable'
      }
    };
  }

  debugPlayerGeometry() {
    return {
      body: {
        left: this.api.debugPlayerBodyLeft() | 0,
        top: this.api.debugPlayerBodyTop() | 0,
        right: this.api.debugPlayerBodyRight() | 0,
        bottom: this.api.debugPlayerBodyBottom() | 0
      },
      feet: {
        left: this.api.debugPlayerFeetLeft() | 0,
        right: this.api.debugPlayerFeetRight() | 0,
        y: this.api.debugPlayerFeetY() | 0
      }
    };
  }

  nativeCollisionSnapshot() {
    return {
      worldLoaded: !!this.api.nativeWorldLoaded(),
      worldGeneration: this.api.nativeWorldGeneration() >>> 0,
      worldReady: !!this.api.nativeWorldReady(),
      mapId: this.api.nativeWorldMdId() >>> 0,
      capabilities: this.api.nativeWorldCapabilities() >>> 0,
      unsupportedContacts: this.api.nativeWorldUnsupportedContacts() >>> 0,
      lastUnsupportedMl: this.api.nativeWorldLastMl() >>> 0,
      lastUnsupportedMt: this.api.nativeWorldLastMt() >>> 0,
      lastUnsupportedX: this.api.nativeWorldLastX() | 0,
      lastUnsupportedY: this.api.nativeWorldLastY() | 0,
      invalidSpawn: !!this.api.nativeWorldInvalidSpawn(),
      mutationCount: this.api.nativeWorldMutationCount() >>> 0,
      mechanismCount: this.api.nativeWorldMechanismCount() >>> 0,
      lastMechanismMl: this.api.nativeWorldLastMechanismMl() >>> 0,
      lastMechanismX: this.api.nativeWorldLastMechanismX() | 0,
      lastMechanismY: this.api.nativeWorldLastMechanismY() | 0,
      mechanismLatch: !!this.api.nativeWorldMechanismLatch(),
      playerActive: !!this.api.nativePlayerActive(),
      playerWorldX: this.api.nativePlayerWorldX() | 0,
      playerWorldY: this.api.nativePlayerWorldY() | 0,
      playerVelocityY: this.api.nativePlayerVelocityY() | 0,
      playerContacts: this.api.nativePlayerContacts() >>> 0,
      playerLastMt: this.api.nativePlayerLastMt() >>> 0,
      playerLastMl: this.api.nativePlayerLastMl() >>> 0,
      playerFloorType: this.api.nativePlayerFloorType() >>> 0,
      playerBounceCount: this.api.nativePlayerBounceCount() >>> 0,
      playerLastBounceVelocity: this.api.nativePlayerLastBounceVelocity() | 0,
      playerScreenX: this.api.nativePlayerScreenX() | 0,
      playerScreenY: this.api.nativePlayerScreenY() | 0,
      playerGrounded: !!this.api.nativePlayerGrounded(),
      playerClimbing: !!this.api.nativePlayerClimbing(),
      playerCrawling: !!this.api.nativePlayerCrawling(),
      playerSpawnValid: !!this.api.nativePlayerSpawnValid(),
      playerAnchorUsed: !!this.api.nativePlayerAnchorUsed(),
      playerAnchorEvidenceId: this.api.nativePlayerAnchorEvidenceId() >>> 0
    };
  }

  collisionSnapshot() {
    return {
      policy: this.api.collisionGetPolicy() >>> 0,
      availability: this.api.collisionGetAvailability() >>> 0,
      verifiedClasses: this.api.collisionGetVerifiedClasses() >>> 0,
      unresolvedClasses: this.api.collisionGetUnresolvedClasses() >>> 0,
      mapId: this.api.collisionGetMdId() >>> 0,
      submap: this.api.collisionGetSubmap() >>> 0,
      evidenceId: this.api.collisionGetEvidenceId() >>> 0,
      datasetHash: this.api.collisionGetDatasetHash() >>> 0,
      fallbackQueries: this.api.collisionGetFallbackQueries() >>> 0,
      verifiedQueries: this.api.collisionGetVerifiedQueries() >>> 0,
      outOfBoundsQueries: this.api.collisionGetOutOfBoundsQueries() >>> 0,
      actorVerifiedQueries: this.api.actorCollisionVerifiedQueries() >>> 0,
      actorFallbackQueries: this.api.actorCollisionFallbackQueries() >>> 0,
      paused: !!this.api.collisionShouldPause(),
      native: this.nativeCollisionSnapshot()
    };
  }

  loadPresentationRom(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      throw new TypeError('RDX ROM bytes must be a non-empty Uint8Array');
    }
    this.module.rdxRomBytes = new Uint8Array(bytes);
    let copied = 0;
    try {
      copied = this.api.loadPresentationRom(bytes.length) >>> 0;
    } finally {
      delete this.module.rdxRomBytes;
    }
    if (copied !== bytes.length || !this.api.presentationReady()) {
      throw new Error(`C RDX presentation ROM load failed: copied ${copied} of ${bytes.length} bytes`);
    }
    return copied;
  }

  unloadPresentationRom() {
    this.api.unloadPresentationRom();
    delete this.module.rdxPresentationRgba;
    delete this.module.rdxInspectionRgba;
  }

  presentationReady() {
    return !!this.api.presentationReady();
  }

  presentationFramebuffer() {
    const expected = XRICK_WIDTH * XRICK_HEIGHT * 4;
    const copied = this.api.copyPresentationRgba() >>> 0;
    const pixels = this.module.rdxPresentationRgba;
    if (copied !== expected || !(pixels instanceof Uint8ClampedArray) || pixels.length !== expected) {
      throw new Error(`C RDX presentation copy failed: copied ${copied} of ${expected} bytes`);
    }
    return pixels;
  }

  presentationFramebufferForFrame(frameSerial) {
    const expected = XRICK_WIDTH * XRICK_HEIGHT * 4;
    const serial = Number(frameSerial) >>> 0;
    const copied = this.api.copyPresentationRgbaForFrame(serial) >>> 0;
    const pixels = this.module.rdxPresentationRgba;
    if (copied !== expected || !(pixels instanceof Uint8ClampedArray) || pixels.length !== expected) {
      throw new Error(`C RDX presentation copy for frame ${serial} failed: copied ${copied} of ${expected} bytes`);
    }
    /* The module-owned staging array is reused on the next native copy.  The
     * debug snapshot must retain immutable pixels for the frame it stamped. */
    return new Uint8ClampedArray(pixels);
  }

  inspectionCurrentFramebuffer() {
    if (!this.api.inspectRenderCurrent()) {
      throw new Error('C inspection renderer could not snapshot the active production viewport');
    }
    return this.#copyInspectionFramebuffer();
  }

  inspectionViewport({ submap, viewportX, viewportY, phase = 0, layerMask = 0x03 }) {
    const ok = this.api.inspectRenderViewport(
      Number(submap) >>> 0, Number(viewportX) | 0, Number(viewportY) | 0,
      Number(phase) >>> 0, Number(layerMask) >>> 0
    ) >>> 0;
    if (!ok) throw new Error('C inspection renderer rejected the viewport request');
    return {
      pixels: this.#copyInspectionFramebuffer(),
      hash: this.api.inspectionHash() >>> 0,
      exactProductionSnapshot: !!this.api.inspectionExact()
    };
  }

  #copyInspectionFramebuffer() {
    const expected = XRICK_WIDTH * XRICK_HEIGHT * 4;
    const copied = this.api.copyInspectionRgba() >>> 0;
    const pixels = this.module.rdxInspectionRgba;
    if (copied !== expected || !(pixels instanceof Uint8ClampedArray) || pixels.length !== expected) {
      throw new Error(`C inspection copy failed: copied ${copied} of ${expected} bytes`);
    }
    return pixels;
  }

  presentationStats() {
    return {
      mapped: this.api.presentationMappedCount() >>> 0,
      fallback: this.api.presentationFallbackCount() >>> 0,
      suppressed: this.api.presentationSuppressedCount() >>> 0,
      decorations: this.api.presentationDecorationCount() >>> 0
    };
  }

  soundAvailable() {
    return !!this.api.soundAvailable();
  }

  soundMuted() {
    return !!this.api.soundMuted();
  }

  soundActiveSfxCount() {
    return this.api.soundActiveSfxCount() >>> 0;
  }

  setSoundMuted(muted) {
    this.api.soundSetMuted(muted ? 1 : 0);
  }

  setSoundSfxSuppressed(logicalId, suppressed) {
    return !!this.api.soundSetSfxSuppressed(Number(logicalId) >>> 0, suppressed ? 1 : 0);
  }

  clearSoundSfxSuppressions() {
    this.api.soundClearSfxSuppressions();
  }

  soundSfxEventSerial() { return this.api.soundSfxEventSerial() >>> 0; }

  soundSfxEventsSince(afterSerial = 0, maxEvents = 32) {
    const latest = this.soundSfxEventSerial();
    let cursor = Number(afterSerial) >>> 0;
    if (!latest || latest === cursor) return [];
    /* The native ring retains the latest 32 requests. If the browser was
     * paused/throttled longer than that, resume from the oldest retained row
     * rather than fabricating missing event identities. */
    const distance = (latest - cursor) >>> 0;
    if (!cursor || distance > 32) cursor = (latest - Math.min(32, latest)) >>> 0;
    const out = [];
    const limit = Math.max(1, Math.min(32, Number(maxEvents) || 32));
    while (cursor !== latest && out.length < limit) {
      cursor = (cursor + 1) >>> 0;
      const logicalId = this.api.soundSfxEventLogicalId(cursor) >>> 0;
      if (logicalId === 0xffffffff) continue;
      out.push({
        serial: cursor,
        logicalId,
        screenX: this.api.soundSfxEventScreenX(cursor) | 0,
        suppressed: !!this.api.soundSfxEventSuppressed(cursor)
      });
    }
    return out;
  }

  soundLabEventSerial() { return this.api.soundLabEventSerial() >>> 0; }

  setSoundLabEventSuppressed(eventId, suppressed) { return !!this.api.soundLabSetEventSuppressed(Number(eventId) >>> 0, suppressed ? 1 : 0); }

  clearSoundLabEventSuppressions() { this.api.soundLabClearEventSuppressions(); }

  soundLabEventsSince(afterSerial = 0, maxEvents = 64) {
    const latest = this.soundLabEventSerial();
    let cursor = Number(afterSerial) >>> 0;
    if (!latest || latest === cursor) return [];
    const distance = (latest - cursor) >>> 0;
    if (!cursor || distance > 64) cursor = (latest - Math.min(64, latest)) >>> 0;
    const out = [];
    const limit = Math.max(1, Math.min(64, Number(maxEvents) || 64));
    const eventNames = { 1: 'boulder.impact' };
    while (cursor !== latest && out.length < limit) {
      cursor = (cursor + 1) >>> 0;
      const eventId = this.api.soundLabEventId(cursor) >>> 0;
      if (!eventId) continue;
      out.push({
        serial: cursor,
        eventId,
        event: eventNames[eventId] || `event.${eventId}`,
        tick: this.api.soundLabEventTick(cursor) >>> 0,
        submap: this.api.soundLabEventSubmap(cursor) >>> 0,
        actor: { slot: this.api.soundLabEventActorSlot(cursor) >>> 0, mark: this.api.soundLabEventMark(cursor) >>> 0 },
        world: [this.api.soundLabEventWorldX(cursor) | 0, this.api.soundLabEventWorldY(cursor) >>> 0],
        frameDelta: [this.api.soundLabEventDx(cursor) | 0, this.api.soundLabEventDy(cursor) | 0],
        normal: [this.api.soundLabEventNormalX(cursor) | 0, this.api.soundLabEventNormalY(cursor) | 0],
        direction: this.api.soundLabEventDirection(cursor) | 0,
        screenX: this.api.soundLabEventScreenX(cursor) | 0
      });
    }
    return out;
  }

  soundSource() {
    return this.api.soundSource() >>> 0;
  }

  setSoundSource(source) {
    return this.api.soundSetSource(Number(source) >>> 0) >>> 0;
  }

  soundQuality() {
    return this.api.soundQuality() >>> 0;
  }

  setSoundQuality(quality) {
    return this.api.soundSetQuality(Number(quality) >>> 0) >>> 0;
  }

  soundFilter() {
    return this.api.soundFilter() >>> 0;
  }

  setSoundFilter(mode) {
    return this.api.soundSetFilter(Number(mode) >>> 0) >>> 0;
  }

  soundSpatial() {
    return this.api.soundSpatial() >>> 0;
  }

  setSoundSpatial(mode) {
    return this.api.soundSetSpatial(Number(mode) >>> 0) >>> 0;
  }

  setClassicAssets(enabled) {
    this.api.setClassicAssets(enabled ? 1 : 0);
  }

  classicAssets() {
    return !!this.api.getClassicAssets();
  }

  setFallbackMode(mode) {
    this.api.setFallbackMode(Number(mode) >>> 0);
  }

  fallbackMode() {
    return this.api.getFallbackMode() >>> 0;
  }

  spriteFallbackMask() {
    return this.api.getSpriteFallbackMask() >>> 0;
  }

  supportsInfiniteResources() { return typeof this.api.debugSetInfiniteResources === 'function'; }
  setInfiniteResources(enabled) { this.api.debugSetInfiniteResources(enabled ? 1 : 0); }
  infiniteResources() { return !!this.api.debugGetInfiniteResources(); }
  agentDebugBuildEnabled() { return !!this.api.debugAgentBuildEnabled(); }
  supportsEditorResourceLoop() { return typeof this.api.debugRefillResources === 'function'; }
  setInfiniteLives(enabled) { this.api.debugSetInfiniteLives(enabled ? 1 : 0); }
  infiniteLives() { return !!this.api.debugGetInfiniteLives(); }
  refillResources(mask) { return this.api.debugRefillResources(Number(mask) >>> 0) >>> 0; }
  setCoyoteFrames(frames) { this.api.gameplaySetCoyoteFrames(Number(frames) >>> 0); return this.coyoteFrames(); }
  coyoteFrames() { return this.api.gameplayGetCoyoteFrames() >>> 0; }
  setJumpBufferFrames(frames) { this.api.gameplaySetJumpBufferFrames(Number(frames) >>> 0); return this.jumpBufferFrames(); }
  jumpBufferFrames() { return this.api.gameplayGetJumpBufferFrames() >>> 0; }
  setJumpTakeoff(value) { this.api.gameplaySetJumpTakeoffFp(Math.round(Number(value) * 256) >>> 0); return this.jumpTakeoff(); }
  jumpTakeoff() { return (this.api.gameplayGetJumpTakeoffFp() >>> 0) / 256; }
  setGravity(value) { this.api.gameplaySetGravityFp(Math.round(Number(value) * 256) >>> 0); return this.gravity(); }
  gravity() { return (this.api.gameplayGetGravityFp() >>> 0) / 256; }
  setApexGravityPercent(percent) { this.api.gameplaySetApexGravityPercent(Number(percent) >>> 0); return this.apexGravityPercent(); }
  apexGravityPercent() { return this.api.gameplayGetApexGravityPercent() >>> 0; }
  setJumpReleasePercent(percent) { this.api.gameplaySetJumpReleasePercent(Number(percent) >>> 0); return this.jumpReleasePercent(); }
  jumpReleasePercent() { return this.api.gameplayGetJumpReleasePercent() >>> 0; }
  setMaxFall(value) { this.api.gameplaySetMaxFallFp(Math.round(Number(value) * 256) >>> 0); return this.maxFall(); }
  maxFall() { return (this.api.gameplayGetMaxFallFp() >>> 0) / 256; }
  setCeilingCorrection(pixels) { this.api.gameplaySetCeilingCorrectionPx(Number(pixels) >>> 0); return this.ceilingCorrection(); }
  ceilingCorrection() { return this.api.gameplayGetCeilingCorrectionPx() >>> 0; }
  setGroundSnap(pixels) { this.api.gameplaySetGroundSnapPx(Number(pixels) >>> 0); return this.groundSnap(); }
  groundSnap() { return this.api.gameplayGetGroundSnapPx() >>> 0; }
  setWalkSpeed(pixels) { this.api.gameplaySetWalkSpeedPx(Number(pixels) >>> 0); return this.walkSpeed(); }
  walkSpeed() { return this.api.gameplayGetWalkSpeedPx() >>> 0; }
  setFallBounceMinHeight(pixels) { this.api.gameplaySetFallBounceMinHeight(Number(pixels) >>> 0); return this.fallBounceMinHeight(); }
  fallBounceMinHeight() { return this.api.gameplayGetFallBounceMinHeight() >>> 0; }
  setPlatformCurveMode(mode) { this.api.gameplaySetPlatformCurveMode(Number(mode) >>> 0); return this.platformCurveMode(); }
  platformCurveMode() { return this.api.gameplayGetPlatformCurveMode() >>> 0; }
  setPlatformCurveCustom({ x1, y1, x2, y2 }) {
    this.api.gameplaySetPlatformCurveCustom(Math.round(Number(x1) * 1000), Math.round(Number(y1) * 1000), Math.round(Number(x2) * 1000), Math.round(Number(y2) * 1000));
    return this.platformCurveCustom();
  }
  platformCurveCustom() {
    return {
      x1: this.api.gameplayGetPlatformCurveCustom(0) / 1000,
      y1: this.api.gameplayGetPlatformCurveCustom(1) / 1000,
      x2: this.api.gameplayGetPlatformCurveCustom(2) / 1000,
      y2: this.api.gameplayGetPlatformCurveCustom(3) / 1000
    };
  }

  entityRgba(slot) {
    const expected = XRICK_WIDTH * XRICK_HEIGHT * 4;
    const copied = this.api.copyEntityRgba(Number(slot) >>> 0) >>> 0;
    const pixels = this.module.rdxEntityRgba;
    if (copied !== expected || !(pixels instanceof Uint8ClampedArray) || pixels.length !== expected) {
      throw new Error(`Actor RGBA copy failed: copied ${copied} of ${expected} bytes`);
    }
    return pixels;
  }

  entityBackgroundRgba(slot) {
    const expected = XRICK_WIDTH * XRICK_HEIGHT * 4;
    const copied = this.api.copyEntityBackgroundRgba(Number(slot) >>> 0) >>> 0;
    const pixels = this.module.rdxEntityBackgroundRgba;
    if (copied !== expected || !(pixels instanceof Uint8ClampedArray) || pixels.length !== expected) {
      throw new Error(`Actor background RGBA copy failed: copied ${copied} of ${expected} bytes`);
    }
    return pixels;
  }

  foregroundMask() {
    const expected = XRICK_WIDTH * XRICK_HEIGHT;
    const copied = this.api.copyForegroundMask() >>> 0;
    const mask = this.module.rdxForegroundMask;
    if (copied !== expected || !(mask instanceof Uint8Array) || mask.length !== expected) {
      throw new Error(`Foreground mask copy failed: copied ${copied} of ${expected} bytes`);
    }
    return mask;
  }

  presentationLayerMask() {
    const expected = XRICK_WIDTH * XRICK_HEIGHT;
    const copied = this.api.copyPresentationLayerMask() >>> 0;
    const mask = this.module.rdxPresentationLayerMask;
    if (copied !== expected || !(mask instanceof Uint8Array) || mask.length !== expected) {
      throw new Error(`Presentation layer mask copy failed: copied ${copied} of ${expected} bytes`);
    }
    return mask;
  }

  framebuffer() {
    const expected = XRICK_WIDTH * XRICK_HEIGHT;
    const copied = this.api.copyFramebuffer() >>> 0;
    const pixels = this.module.rdxFramebuffer;
    if (copied !== expected || !(pixels instanceof Uint8Array) || pixels.length !== expected) {
      throw new Error(`xrick framebuffer copy failed: copied ${copied} of ${expected} bytes`);
    }
    return pixels;
  }

  palette(index) {
    const key = index & 0xff;
    const packed = this.api.getPaletteRgba(key) >>> 0;
    const cached = this.paletteCache.get(key);
    if (cached?.packed === packed) return cached.rgba;
    const rgba = [packed >>> 24, (packed >>> 16) & 0xff, (packed >>> 8) & 0xff, packed & 0xff];
    this.paletteCache.set(key, { packed, rgba });
    return rgba;
  }

  debugGeometry(requestedMode = 0) {
    this.api.debugGeometryRefresh(Number(requestedMode) === 1 ? 1 : 0);
    const mode = this.api.debugGeometryMode() === 1 ? 'rdx' : 'classic';
    const count = Math.min(this.api.debugGeometryCount() >>> 0, 4096);
    const primitives = new Array(count);
    for (let index = 0; index < count; index += 1) {
      primitives[index] = Object.freeze({
        type: this.api.debugGeometryType(index) >>> 0,
        flags: this.api.debugGeometryFlags(index) >>> 0,
        sourceId: this.api.debugGeometrySourceId(index) >>> 0,
        x0: this.api.debugGeometryX0(index) | 0,
        y0: this.api.debugGeometryY0(index) | 0,
        x1: this.api.debugGeometryX1(index) | 0,
        y1: this.api.debugGeometryY1(index) | 0
      });
    }
    return Object.freeze({ mode, primitives: Object.freeze(primitives) });
  }

  nativeLadderRuns() {
    const count = Math.min(this.api.nativeWorldLadderRunCount() >>> 0, 2048);
    const runs = [];
    for (let index = 0; index < count; index += 1) runs.push({
      x: this.api.nativeWorldLadderRunX(index) | 0,
      y0: this.api.nativeWorldLadderRunY0(index) | 0,
      y1: this.api.nativeWorldLadderRunY1(index) | 0
    });
    return runs;
  }

  presentationItems() {
    const count = Math.min(this.api.presentationAuditCount() >>> 0, 128);
    const items = [];
    for (let index = 0; index < count; index += 1) items.push({
      index,
      slot: this.api.presentationAuditSlot(index) >>> 0,
      pn: this.api.presentationAuditPn(index) >>> 0,
      actorId: this.api.presentationAuditActorId(index) >>> 0,
      drawX: this.api.presentationAuditDrawX(index) | 0,
      drawY: this.api.presentationAuditDrawY(index) | 0,
      width: this.api.presentationAuditWidth(index) >>> 0,
      height: this.api.presentationAuditHeight(index) >>> 0,
      visiblePixels: this.api.presentationAuditVisiblePixels(index) >>> 0,
      actorDepth: ['normal','front','behind-midground'][this.api.presentationAuditActorDepth(index) >>> 0] || 'normal',
      front: !!this.api.presentationAuditFront(index),
      mirrorX: !!this.api.presentationAuditMirrorX(index),
      mirrorY: !!this.api.presentationAuditMirrorY(index),
      originX: this.api.presentationAuditOriginX(index) | 0,
      originY: this.api.presentationAuditOriginY(index) | 0,
      tick: this.api.presentationAuditTick(index) >>> 0
    });
    return items;
  }

  snapshot() {
    const submap = this.api.getSubmap() >>> 0;
    const visibleTopRow = this.api.getVisibleTopRow() >>> 0;
    const reachableStartRow = this.api.getReachableStartRow(submap) >>> 0;
    const cameraDeltaRows = this.api.getCameraDeltaRows() | 0;
    const rawCameraOffsetPx = this.api.getCameraOffsetPx() | 0;
    const cameraOffsetPx = rawCameraOffsetPx !== 0 || cameraDeltaRows === 0
      ? rawCameraOffsetPx : cameraDeltaRows * 8;
    const renderCameraOffsetPx = this.api.getRenderCameraOffsetPx() | 0;
    const entities = [];
    const entityCount = Math.min(this.api.getEntityCount() >>> 0, 64);
    for (let slot = 0; slot < entityCount; slot += 1) {
      entities.push({
        slot,
        n: this.api.getEntityN(slot) >>> 0,
        x: this.api.getEntityX(slot) >>> 0,
        y: this.api.getEntityY(slot) >>> 0,
        xsave: this.api.getEntityXsave(slot) >>> 0,
        ysave: this.api.getEntityYsave(slot) >>> 0,
        sprite: this.api.getEntitySprite(slot) >>> 0,
        sprbase: this.api.getEntitySprbase(slot) >>> 0,
        offsy: this.api.getEntityOffsy(slot) | 0,
        front: this.api.getEntityFront(slot) >>> 0,
        w: this.api.getEntityW(slot) >>> 0,
        h: this.api.getEntityH(slot) >>> 0,
        flags: this.api.getEntityFlags(slot) >>> 0,
        mark: this.api.getEntityMark(slot) >>> 0,
        movingPlatformState: this.api.getEntityMovingPlatformState(slot) >>> 0,
        c1: this.api.getEntityC1(slot) | 0,
        latency: this.api.getEntityLatency(slot) >>> 0,
        c2: this.api.getEntityC2(slot) | 0,
        projectileActive: !!this.api.getEntityProjectileActive(slot),
        projectileGeneration: this.api.getEntityProjectileGeneration(slot) >>> 0,
        projectileActiveUpdates: this.api.getEntityProjectileActiveUpdates(slot) >>> 0,
        projectileCooldownFrames: this.api.getEntityProjectileCooldownFrames(slot) >>> 0,
        trigX: this.api.getEntityTrigX(slot) >>> 0,
        trigY: this.api.getEntityTrigY(slot) >>> 0,
        trigW: this.api.getEntityTrigW(slot) >>> 0,
        trigH: this.api.getEntityTrigH(slot) >>> 0,
        edgePolicy: this.api.getEntityEdgePolicy(slot) >>> 0,
        edgeTurns: this.api.getEntityEdgeTurns(slot) >>> 0,
        ledgeDrops: this.api.getEntityLedgeDrops(slot) >>> 0,
        actorCollision: this.actorCollisionSnapshot(slot)
      });
    }
    return {
      enabled: !!this.api.getEnabled(),
      runtimeOptions: this.runtimeOptionsSnapshot(),
      speedMultiplier: this.speedMultiplier(),
      cameraMode: this.cameraMode(),
      spriteMode: this.api.getSpriteMode() >>> 0,
      spriteReplacementMask: this.api.getSpriteReplacementMask() >>> 0,
      presentationMode: this.api.getPresentationMode() >>> 0,
      classicAssets: !!this.api.getClassicAssets(),
      frameSerial: this.api.getFrameSerial() >>> 0,
      map: this.api.getMap() >>> 0,
      submap,
      mapFrow: this.api.getMapFrow() >>> 0,
      visibleTopRow,
      reachableStartRow,
      cameraDeltaRows,
      cameraOffsetPx,
      cameraY: cameraOffsetPx,
      renderCameraOffsetPx,
      renderCameraY: renderCameraOffsetPx,
      rick: {
        state: this.api.getRickState() >>> 0,
        direction: this.api.getGameDir() >>> 0,
        control: this.api.getControlStatus() >>> 0,
        exitWalk: {
          active: !!this.api.getExitWalkActive(),
          direction: this.api.getExitWalkDirection() | 0,
          offsetX: this.api.getExitWalkOffsetX() | 0,
          frame: this.api.getExitWalkFrame() >>> 0,
          totalFrames: this.api.getExitWalkTotalFrames() >>> 0
        }
      },
      bomb: {
        ticker: this.api.getBombTicker() >>> 0,
        lethal: !!this.api.getBombLethal(),
        nearMissSerial: this.api.getBombNearMissSerial() >>> 0,
        nearMissStrengthPercent: this.api.getBombNearMissStrengthPercent() >>> 0,
        nearMissDistancePx: this.api.getBombNearMissDistancePx() >>> 0
      },
      inventory: {
        bullets: this.api.getBullets() >>> 0,
        dynamite: this.api.getDynamite() >>> 0,
        lives: this.api.getLives() >>> 0
      },
      score: this.api.getScore() >>> 0,
      debug: {
        invincible: !!this.api.debugGetInvincible(),
        infiniteResources: !!this.api.debugGetInfiniteResources(),
        ignoreExplodableCollision: !!this.api.debugGetIgnoreExplodableCollision(),
        wouldDieCount: this.api.debugGetWouldDieCount() >>> 0,
        wouldDieFrame: this.api.debugGetWouldDieFrame() >>> 0
      },
      collision: this.collisionSnapshot(),
      entities,
      presentation: this.presentationItems()
    };
  }
}

export function renderClassicFramebuffer(bridge, targetContext, options = {}) {
  const framebuffer = bridge.framebuffer();
  const image = targetContext.createImageData(XRICK_WIDTH, XRICK_HEIGHT);
  const transparentZero = options.transparentZero ?? bridge.api.getEnabled() !== 0;
  const playfieldShiftX = Number(options.playfieldShiftX || 0) | 0;
  const playfieldTop = Number(options.playfieldTop ?? XRICK_PLAYFIELD.y) | 0;
  const data = image.data;
  for (let i = 0; i < framebuffer.length; i += 1) {
    const colorIndex = framebuffer[i];
    const sourceX = i % XRICK_WIDTH;
    const sourceY = Math.floor(i / XRICK_WIDTH);
    const destinationX = sourceY >= playfieldTop ? sourceX + playfieldShiftX : sourceX;
    if (destinationX < 0 || destinationX >= XRICK_WIDTH) continue;
    const offset = (sourceY * XRICK_WIDTH + destinationX) * 4;
    if (transparentZero && colorIndex === 0) continue;
    const color = bridge.palette(colorIndex);
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = color[3];
  }
  targetContext.putImageData(image, 0, 0);
}
