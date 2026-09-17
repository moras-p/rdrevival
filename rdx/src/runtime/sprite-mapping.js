const CONFIDENCE_RANK = Object.freeze({ low: 1, medium: 2, high: 3 });

const DYNAMITE_FUSE_SPRITES = new Set([
  0x22, 0x23,
  ...Array.from({ length: 0x0f }, (_, index) => 0x99 + index)
]);
const DYNAMITE_EXPLOSION_SPRITES = new Set([
  ...Array.from({ length: 5 }, (_, index) => 0x24 + index),
  ...Array.from({ length: 5 }, (_, index) => 0xa8 + index)
]);

/** Source-derived utility mapping from the corrected sprite animation audit.
 * PN indices here are decimal catalogue indices: PN036 is the lit dynamite
 * fuse and PN041 is the Jungle-colour explosion. */
export function resolveRdxUtilitySprite(entity) {
  const n = Number(entity?.n || 0) & 0x7f;
  const sprite = Number(entity?.sprite || 0) & 0xff;
  /* xrick's live bullet entity is the production source of truth for both the
   * normal viewport and whole-map preview.  Sprite 0x20 moves right and 0x21
   * moves left (see e_bullet_init).  PN13/PN14 are the recovered matching RDX
   * projectiles; keeping this in the shared mapper prevents preview-only art. */
  if (n === 0x02 && (sprite === 0x20 || sprite === 0x21)) {
    const direction = sprite === 0x21 ? 'left' : 'right';
    return {
      status: 'mapped',
      score: 220,
      mappingId: 'sourcefix-player-bullet-projectile',
      assetKey: 'x:entity_02',
      row: null,
      xAction: { action: 'projectile', direction, frameIds: [sprite] },
      action: 'projectile',
      role: 'projectile',
      direction,
      rdxDirection: direction,
      mirrorX: rdxDirectionalMirrorX(direction),
      pn: direction === 'left' ? 14 : 13,
      confidence: 'high',
      sourceFrame: sprite
    };
  }
  if ((n === 0x3b || n === 0x40) && sprite >= 0x7a && sprite <= 0x7c) {
    /* Original xrick has no entity-level sprite reflection and therefore draws
     * both pipe-fire Type-3 records with the same left-shooting 0x7a..0x7c
     * artwork. RDX carries the intended directional pair explicitly. Keep the
     * ROM frames unmirrored: PN033 shoots left, PN034 shoots right. */
    const rightShooting = n === 0x3b;
    const direction = rightShooting ? 'left' : 'right';
    return {
      status: 'mapped', score: 220,
      mappingId: rightShooting ? 'manual_x_entity_3B__r_pn_034' : 'manual_x_entity_40__r_pn_033',
      assetKey: `x:entity_${hexByte(n)}`, row: null,
      xAction: { action: 'scripted_active_loop', direction:'neutral', frameIds:[sprite] },
      action: 'move', role: 'active', direction, rdxDirection: direction,
      mirrorX: false, pn: rightShooting ? 0x34 : 0x33,
      confidence: 'high', sourceFrame: sprite
    };
  }
  if (n !== 0x03) return null;
  if (DYNAMITE_FUSE_SPRITES.has(sprite)) {
    return {
      status: 'mapped',
      score: 200,
      mappingId: 'sourcefix-player-weapon-dynamite-fuse',
      assetKey: 'x:utility_dynamite',
      row: null,
      xAction: { action: 'dynamite_fuse', direction: 'neutral', frameIds: [sprite] },
      action: 'dynamite_fuse',
      role: 'dynamite_fuse',
      direction: 'neutral',
      rdxDirection: 'neutral',
      mirrorX: false,
      pn: 36,
      confidence: 'high',
      sourceFrame: sprite
    };
  }
  if (DYNAMITE_EXPLOSION_SPRITES.has(sprite)) {
    return {
      status: 'mapped',
      score: 200,
      mappingId: 'sourcefix-player-weapon-dynamite-explosion',
      assetKey: 'x:utility_dynamite',
      row: null,
      xAction: { action: 'dynamite_explosion', direction: 'neutral', frameIds: [sprite] },
      action: 'dynamite_explosion',
      role: 'dynamite_explosion',
      direction: 'neutral',
      rdxDirection: 'neutral',
      mirrorX: false,
      pn: 41,
      confidence: 'high',
      sourceFrame: sprite
    };
  }
  return null;
}

function hexByte(value) {
  return (Number(value) & 0xff).toString(16).toUpperCase().padStart(2, '0');
}

function confidenceRank(value) {
  return CONFIDENCE_RANK[String(value || '').toLowerCase()] || 0;
}

function directionFromMotion(motion) {
  if (motion?.direction === 'left' || motion?.direction === 'right') return motion.direction;
  return 'right';
}

/** Production sourcefix-v27 orientation policy. Directional PN rows use the
 * ROM-facing convention opposite the xrick presentation convention, so both
 * left and right directional actions are mirrored at draw time. Keep this
 * helper shared by the live adapter and whole-map preview to prevent the two
 * views from drifting. */
export function rdxDirectionalMirrorX(direction) {
  return direction === 'left' || direction === 'right';
}

function semanticRole(xAction, row) {
  const explicitRole = String(xAction?.presentationRole || '').trim().toLowerCase();
  if (explicitRole) return explicitRole;
  const name = String(xAction?.action || '');
  if (/^(walk_|type2_patrol_)/.test(name)) return 'walk';
  if (/^(die_zombie|zombie_formula)$/.test(name)) return 'die';
  if (/^crawl_/.test(name)) return 'crawl';
  if (/^jump_/.test(name)) return 'jump';
  if (/^shoot_/.test(name)) return 'shoot';
  if (/^stop_/.test(name)) return 'stand';
  if (/^extra_pose_/.test(name)) return 'jump_alt';
  if (name === 'climb' || name === 'type2_climb') return 'ladder_climb';
  if (name === 'idle_collectible') return 'idle';
  if (name === 'score_popup') return 'score_popup';
  if (name === 'explode_box') return 'explode';
  if (name === 'idle_box') return 'idle';
  const purpose = String(row?.actionPurpose || '').toLowerCase();
  /* Initial/wait frames remain static for mechanisms, but several v27 enemy
   * bundles use their first visible walk frame as the waiting pose. Preserve
   * that curated enemy identity rather than treating it as a generic object. */
  if (name === 'scripted_initial_or_wait') {
    if (purpose.includes('enemy_character')) return 'walk';
    return 'idle';
  }
  if (name === 'scripted_active_loop') return 'active';

  if (purpose.includes('rolling') || purpose.includes('boulder')) return 'roll';
  if (purpose.includes('robot')) return 'robot_motion';
  if (purpose.includes('enemy')) return 'walk';
  return name || 'idle';
}

function actionAffinity(role, candidate) {
  const action = String(candidate?.action || '');
  if (action === role) return 80;
  if (role === 'ladder_climb' && action === 'climb') return 70;
  if (role === 'die' && /^(die|death|explode)/.test(action)) return 65;
  if (role === 'explode' && /^(explode|die|death)/.test(action)) return 60;
  if (role === 'idle' && /^(idle|stand|move)$/.test(action)) return action === 'idle' ? 70 : 35;
  if (role === 'active' && /^(walk|roll|move|robot_motion|idle)/.test(action)) return 35;
  if (role === 'roll' && /^(roll|move)/.test(action)) return action === 'roll' ? 70 : 40;
  if (role === 'walk' && /^(walk|move|robot_motion)/.test(action)) return action === 'walk' ? 70 : 40;
  if (role === 'robot_motion' && /^(robot_motion|move|walk)/.test(action)) return action === 'robot_motion' ? 70 : 35;
  return 0;
}

function candidateScore(candidate, role, direction, order) {
  const confidence = confidenceRank(candidate.confidence);
  let score = confidence * 20 + actionAffinity(role, candidate) - order;
  if (candidate.direction === direction) score += 30;
  else if (candidate.direction === 'neutral') score += 12;
  else if (direction === 'neutral') score += 3;
  else score -= 20;
  return score;
}

function matchingXActions(row, sprite) {
  return (row?.xrick?.actions || []).filter(action =>
    (action.frameIds || []).some(frame => (Number(frame) & 0xff) === (Number(sprite) & 0xff)));
}

/**
 * Runtime resolver for rd.asset_mapping.v1. It maps the xrick entity's
 * current source sprite/action to one RDX PN action. Low-confidence PN rows
 * remain classic fallbacks by default.
 */
export class RdxSemanticSpriteMapper {
  constructor(mapping, options = {}) {
    this.mapping = mapping;
    this.minimumConfidence = options.minimumConfidence || 'medium';
  }

  rowsForEntity(entity) {
    const n = Number(entity?.n || 0) & 0x7f;
    const sprbase = Number(entity?.sprbase || 0) & 0xff;
    const keys = [];
    /* sourcefix-v27 keeps the shared 500-point feedback sprite separate from
     * collectible/object bundles. It has no entity-specific sidecar action,
     * so identify it by the exact xrick source frame. */
    if ((Number(entity?.sprite || 0) & 0xff) === 0xad) keys.push('x:score_popup_500');
    if (sprbase) keys.push(`x:artbase_${hexByte(sprbase)}`);
    keys.push(`x:entity_${hexByte(n)}`);
    /* SM03 entity 0x2f is invisible while dormant. Only its awake 0x2b
     * frame is the lure idol, so share bonus entity 0x12's mapping strictly
     * during that visible phase instead of turning sprite zero into PN27. */
    if (n === 0x2f && sprbase === 0x39 && (Number(entity?.sprite || 0) & 0xff) === 0x2b) keys.push('x:entity_12');
    if (n === 0x47) keys.push('x:entity_47');

    const rows = [];
    const seen = new Set();
    for (const key of keys) {
      for (const row of this.mapping.rowsForXrickAsset(key)) {
        if (seen.has(row.mappingId)) continue;
        seen.add(row.mappingId);
        rows.push({ key, row });
      }
    }
    return rows;
  }

  resolveRick(action, direction) {
    const rows = this.mapping.rowsForXrickAsset('x:rick_player');
    return this.#choose(rows.map(row => ({ key: 'x:rick_player', row })), null,
      { action, direction, confidence: 'high' }, direction);
  }

  resolveRickEntity(entity, fallbackAction = null) {
    const rows = this.mapping.rowsForXrickAsset('x:rick_player');
    const sprite = Number(entity?.sprite || 0) & 0xff;
    let best = null;
    for (const row of rows) {
      for (const xAction of matchingXActions(row, sprite)) {
        const direction = xAction.direction === 'left' || xAction.direction === 'right'
          ? xAction.direction : (fallbackAction?.direction || 'right');
        const chosen = this.#choose([{ key: 'x:rick_player', row }], xAction, xAction, direction);
        if (chosen.status === 'mapped' && (!best || chosen.score > best.score)) best = chosen;
      }
    }
    if (best) return best;
    if (fallbackAction) return this.resolveRick(fallbackAction.action, fallbackAction.direction);
    return {
      status: 'fallback',
      reason: `No v27 Rick action contains sprite 0x${hexByte(sprite)}`,
      assetKey: 'x:rick_player',
      row: rows[0] || null
    };
  }

  resolveEntity(entity, motion = null) {
    const utility = resolveRdxUtilitySprite(entity);
    if (utility) return utility;
    const rows = this.rowsForEntity(entity);
    const entityType = Number(entity?.n || 0) & 0x7f;
    const artbase = Number(entity?.sprbase || 0) & 0xff;
    /* Keep killed enemies in their RDX family from the first zombie frame.
     * xrick sets n=0x47 before e_them_z_action necessarily updates sprite, so
     * deriving the source death frame from sprbase mirrors native C and avoids
     * a one-frame/whole-flight Classic fallback in browser adapters. */
    let sprite = entityType === 0x47 && artbase
      ? ((artbase + ((Number(entity?.x || 0) & 0x04) ? 7 : 6)) & 0xff)
      : (Number(entity?.sprite || 0) & 0xff);
    if (entityType === 0x2f && artbase === 0x39 && (sprite === 0x39 || sprite === 0)) sprite = 0x2b;
    const motionDirection = directionFromMotion(motion);
    const candidates = [];

    for (const entry of rows) {
      const matches = matchingXActions(entry.row, sprite);
      if (entry.key === 'x:score_popup_500' && sprite === 0xad && matches.length === 0) {
        matches.push({ action: 'score_popup', direction: 'neutral', frameIds: [0xad], confidence: 'high' });
      }
      for (const xAction of matches) {
        const direction = xAction.direction === 'left' || xAction.direction === 'right'
          ? xAction.direction : motionDirection;
        candidates.push({ ...entry, xAction, direction });
      }
    }

    if (!candidates.length) {
      return {
        status: 'fallback',
        reason: `No v27 xrick action contains sprite 0x${hexByte(sprite)}`,
        assetKey: rows[0]?.key || null,
        row: rows[0]?.row || null
      };
    }

    let best = null;
    for (const candidate of candidates) {
      const chosen = this.#choose([candidate], candidate.xAction, candidate.xAction, candidate.direction);
      if (chosen.status !== 'mapped') continue;
      if (!best || chosen.score > best.score) best = chosen;
    }
    return best || {
      status: 'fallback',
      reason: `No medium-or-better RDX action for sprite 0x${hexByte(sprite)}`,
      assetKey: candidates[0]?.key || null,
      row: candidates[0]?.row || null
    };
  }

  #choose(entries, xAction, actionDescriptor, direction) {
    const minimum = confidenceRank(this.minimumConfidence);
    let best = null;
    for (const entry of entries) {
      const role = semanticRole(xAction || actionDescriptor, entry.row);
      const actions = (entry.row?.rdx?.actions || []).filter(action => !Array.isArray(action.sourceActions) || action.sourceActions.includes((xAction || actionDescriptor)?.action));
      actions.forEach((action, order) => {
        if (!Number.isInteger(action.pnDec) || confidenceRank(action.confidence) < minimum) return;
        const affinity = actionAffinity(role, action);
        /* Do not turn an unresolved action into a visually unrelated mapped
         * action. This is especially important for ammo-box destruction and
         * collectible score feedback, which v27 explicitly keeps separate. */
        if (affinity <= 0) return;
        if ((direction === 'left' || direction === 'right') &&
            (action.direction === 'left' || action.direction === 'right') &&
            action.direction !== direction) return;
        const score = candidateScore(action, role, direction, order);
        if (!best || score > best.score) {
          best = {
            status: 'mapped',
            score,
            mappingId: entry.row.mappingId,
            assetKey: entry.key,
            row: entry.row,
            xAction: xAction || actionDescriptor,
            action: action.action,
            direction: action.direction === 'neutral' ? direction : action.direction,
            rdxDirection: action.direction,
            mirrorX: rdxDirectionalMirrorX(action.direction),
            pn: action.pnDec,
            confidence: action.confidence,
            role
          };
        }
      });
    }
    return best || {
      status: 'fallback',
      reason: 'No RDX action meets the runtime confidence threshold',
      row: entries[0]?.row || null,
      assetKey: entries[0]?.key || null
    };
  }
}

/* sourcefix-v27 matcher convention. xrick renders every ST sprite in a
 * fixed 32x21 visual cell. Entity w/h are collision dimensions and must not
 * be used for replacement placement. Entity coordinates are map-space; the
 * GFXST path maps y through MAPS_FB_Y=64 and its historical +8 framebuffer
 * adjustment. Returned coordinates are framebuffer-relative inside the
 * 256x192 playfield, before the outer +32,+8 playfield offset. */
export function xrickEntityFootOrigin(entity) {
  return {
    x: Number(entity?.x || 0) + 16,
    y: Number(entity?.y || 0) - 64 + 21
  };
}

/** Slot-zero STOPRICK entities use their collision rectangle as the visible
 * support surface. Unlike ordinary 32x21 actors, their classic entity origin
 * is not shifted down by three pixels, and their collision height is often
 * 16px. Anchoring replacements to the generic 21px cell therefore sinks a
 * moving stone/block by five pixels. */
export function xrickBlockingFootOrigin(entity) {
  const height = Math.max(1, Number(entity?.h || 0));
  return {
    x: Number(entity?.x || 0) + 16,
    y: Number(entity?.y || 0) - 64 + height
  };
}

/** GFXST moves the classic dynamite entity down by five pixels because the ST
 * bomb artwork needs that correction. RDX PN36/PN41 are already foot-aligned,
 * so browser replacements must undo the source-only adjustment. */
export function xrickDynamiteFootOrigin(entity) {
  const foot = xrickEntityFootOrigin(entity);
  return { x: foot.x, y: foot.y - 5 };
}
