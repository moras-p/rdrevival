// GENERATED FILE. Do not edit by hand.
// Authority: revival/game-juice-presets.json
// Regenerate: node tools/build/generate_game_juice_presets.mjs
export const GAME_JUICE_PRODUCTION_PRESETS = Object.freeze({
  "schema": "rdr.game-juice-presets.v1",
  "description": "Production Revival feedback presets. All rendering is opaque/masked, integer-positioned, fixed-frame and CD32-plausible; no alpha blending or real-time sprite scaling is permitted.",
  "recipes": {
    "raw": {},
    "micro_dust": {
      "particles": {
        "count": 2,
        "speed": 10,
        "gravity": 40,
        "size": 2,
        "color": "tan",
        "lifeMs": 160,
        "spread": 1
      }
    },
    "skid": {
      "particles": {
        "count": 3,
        "speed": 14,
        "gravity": 40,
        "size": 2,
        "color": "tan",
        "lifeMs": 200,
        "spread": 1
      },
      "spriteImpulse": {
        "x": -1,
        "y": 0,
        "frames": 2
      }
    },
    "grounded_skid_cd32": {
      "particles": {
        "count": 4,
        "speed": 22,
        "gravity": 20,
        "size": 4,
        "color": "tan",
        "shape": "puff",
        "spawnRadius": 3,
        "lifeMs": 230,
        "spread": 1
      },
      "spriteImpulse": {
        "x": -1,
        "y": 0,
        "frames": 2
      }
    },
    "jump_takeoff_cd32": {
      "particles": {
        "count": 6,
        "speed": 18,
        "gravity": 40,
        "size": 4,
        "color": "gray",
        "shape": "puff",
        "spawnRadius": 4,
        "emitterWidth": 10,
        "emitterHeight": 2,
        "shrink": true,
        "lifeMs": 280,
        "spread": 1.4
      },
      "spriteImpulse": {
        "x": 0,
        "y": -2,
        "frames": 3
      }
    },
    "jump": {
      "particles": {
        "count": 2,
        "speed": 9,
        "gravity": 40,
        "size": 2,
        "color": "tan",
        "lifeMs": 160,
        "spread": 1
      }
    },
    "land_soft": {
      "particles": {
        "count": 2,
        "speed": 8,
        "gravity": 40,
        "size": 2,
        "color": "tan",
        "lifeMs": 120,
        "spread": 1
      }
    },
    "land_responsive": {
      "particles": {
        "count": 4,
        "speed": 12,
        "gravity": 40,
        "size": 2,
        "color": "tan",
        "lifeMs": 200,
        "spread": 1
      },
      "camera": {
        "amplitude": 1,
        "frames": 2
      }
    },
    "weapon_classic": {
      "flash": {
        "radius": 3,
        "frames": 1,
        "color": "white"
      },
      "spriteImpulse": {
        "x": -2,
        "y": 0,
        "frames": 1
      }
    },
    "weapon_retro": {
      "flash": {
        "radius": 4,
        "frames": 1,
        "color": "white"
      },
      "spriteImpulse": {
        "x": -2,
        "y": 0,
        "frames": 1
      }
    },
    "weapon_retro_smoke": {
      "flash": {
        "radius": 4,
        "frames": 1,
        "color": "white"
      },
      "spriteImpulse": {
        "x": -2,
        "y": 0,
        "frames": 1
      },
      "poseEmitters": [
        {
          "id": "gun-smoke",
          "holdMode": "frames",
          "frames": 2,
          "referenceDirection": 1,
          "anchorX": 21,
          "anchorY": 8,
          "mirrorX": true,
          "flipH": false,
          "flipV": false,
          "refX": 6,
          "refY": 0,
          "refW": 21,
          "refH": 21,
          "count": 6,
          "speed": 12,
          "lifeMs": 660,
          "spread": 0.35,
          "gravity": -30,
          "size": 3,
          "tone": "smoke",
          "playbackMode": "loop",
          "cadenceFrames": 3
        }
      ]
    },
    "weapon_punchy": {
      "flash": {
        "radius": 4,
        "frames": 1,
        "color": "white"
      },
      "camera": {
        "amplitude": 1,
        "frames": 2
      },
      "spriteImpulse": {
        "x": -2,
        "y": 0,
        "frames": 1
      }
    },
    "wall_chip": {
      "flash": {
        "radius": 2,
        "frames": 1,
        "color": "white"
      }
    },
    "wall_spark": {
      "flash": {
        "radius": 2,
        "frames": 1,
        "color": "white"
      },
      "particles": {
        "count": 4,
        "speed": 26,
        "gravity": 20,
        "size": 2,
        "color": "white",
        "lifeMs": 160,
        "spread": 1
      }
    },
    "target_clean": {
      "actorFlash": {
        "frames": 1,
        "color": "white"
      }
    },
    "target_freeze": {
      "actorFlash": {
        "frames": 1,
        "color": "white"
      },
      "hitStop": 1
    },
    "target_punchy": {
      "actorFlash": {
        "frames": 2,
        "color": "white"
      },
      "particles": {
        "count": 4,
        "speed": 22,
        "gravity": 20,
        "size": 2,
        "color": "white",
        "lifeMs": 200,
        "spread": 1
      },
      "camera": {
        "amplitude": 1,
        "frames": 2
      },
      "hitStop": 1
    },
    "player_red": {
      "flash": {
        "radius": 10,
        "frames": 2,
        "color": "red"
      },
      "camera": {
        "amplitude": 1,
        "frames": 3
      }
    },
    "player_freeze": {
      "flash": {
        "radius": 10,
        "frames": 1,
        "color": "white"
      },
      "camera": {
        "amplitude": 1,
        "frames": 3
      },
      "hitStop": 1
    },
    "player_impact": {
      "flash": {
        "radius": 12,
        "frames": 2,
        "color": "red"
      },
      "particles": {
        "count": 4,
        "speed": 18,
        "gravity": 40,
        "size": 2,
        "color": "white",
        "lifeMs": 200,
        "spread": 1
      },
      "camera": {
        "amplitude": 2,
        "frames": 4
      },
      "hitStop": 2
    },
    "near_miss": {
      "camera": {
        "amplitude": 1,
        "frames": 1
      }
    },
    "fuse_minimal": {
      "flash": {
        "radius": 2,
        "frames": 1,
        "color": "orange"
      }
    },
    "fuse_spark": {
      "flash": {
        "radius": 2,
        "frames": 1,
        "color": "orange"
      },
      "particles": {
        "count": 2,
        "speed": 12,
        "gravity": 20,
        "size": 2,
        "color": "orange",
        "lifeMs": 120,
        "spread": 1
      }
    },
    "explode_palette": {
      "ring": {
        "radius": 28,
        "width": 2,
        "frames": 3,
        "color": "white"
      },
      "camera": {
        "amplitude": 2,
        "frames": 4
      }
    },
    "explode_ripple": {
      "ring": {
        "radius": 38,
        "width": 2,
        "frames": 4,
        "color": "orange"
      },
      "particles": {
        "count": 4,
        "speed": 18,
        "gravity": 40,
        "size": 2,
        "color": "orange",
        "lifeMs": 240,
        "spread": 1
      },
      "camera": {
        "amplitude": 2,
        "frames": 5
      },
      "hitStop": 1
    },
    "explode_debris": {
      "ring": {
        "radius": 44,
        "width": 2,
        "frames": 4,
        "color": "orange"
      },
      "particles": {
        "count": 8,
        "speed": 28,
        "gravity": 60,
        "size": 3,
        "color": "tan",
        "lifeMs": 320,
        "spread": 1
      },
      "camera": {
        "amplitude": 3,
        "frames": 6
      },
      "hitStop": 2
    },
    "explode_retro_heavy": {
      "worldFlash": {
        "radius": 104,
        "blockSize": 8,
        "ringWidth": 22,
        "frames": 3,
        "color": "white",
        "layerMask": [
          "backdrop",
          "foreground"
        ],
        "foregroundDelayFrames": 0,
        "backgroundDelayFrames": 2,
        "backgroundColor": "gray"
      },
      "camera": {
        "amplitude": 3,
        "frames": 3
      },
      "hitStop": 2
    },
    "explosion_target": {
      "actorFlash": {
        "frames": 2,
        "color": "white"
      },
      "camera": {
        "amplitude": 1,
        "frames": 2
      },
      "hitStop": 1
    },
    "explosion_player": {
      "flash": {
        "radius": 14,
        "frames": 2,
        "color": "red"
      },
      "camera": {
        "amplitude": 3,
        "frames": 6
      },
      "hitStop": 2
    },
    "explosion_bounce": {
      "ring": {
        "radius": 18,
        "width": 2,
        "frames": 2,
        "color": "gray"
      },
      "camera": {
        "amplitude": 1,
        "frames": 2
      }
    },
    "player_freeze_static": {
      "flash": {
        "radius": 10,
        "frames": 1,
        "color": "white"
      },
      "hitStop": 1
    },
    "explode_palette_static": {
      "flash": {
        "radius": 25,
        "frames": 2,
        "color": "warm-white",
        "block": true
      },
      "worldFlash": {
        "radius": 56,
        "blockSize": 8,
        "ringWidth": 16,
        "frames": 1,
        "color": "white",
        "layerMask": [
          "backdrop",
          "midground",
          "actors",
          "foreground",
          "frontActors"
        ],
        "foregroundDelayFrames": 0,
        "backgroundDelayFrames": 1,
        "backgroundColor": "off-white"
      },
      "hitStop": 1
    },
    "explosion_player_static": {
      "flash": {
        "radius": 14,
        "frames": 2,
        "color": "red"
      },
      "hitStop": 2
    },
    "explosion_bounce_static": {
      "ring": {
        "radius": 18,
        "width": 2,
        "frames": 2,
        "color": "gray"
      }
    },
    "pickup_clean": {
      "flash": {
        "radius": 4,
        "frames": 1,
        "color": "white"
      }
    },
    "pickup_pop": {
      "flash": {
        "radius": 5,
        "frames": 1,
        "color": "white"
      },
      "particles": {
        "count": 3,
        "speed": 10,
        "gravity": -20,
        "size": 2,
        "color": "white",
        "lifeMs": 160,
        "spread": 1
      }
    },
    "hud_gray": {
      "hud": {
        "frames": 2,
        "jitter": 0,
        "color": "gray"
      }
    },
    "hud_white": {
      "hud": {
        "frames": 2,
        "jitter": 0,
        "color": "white"
      }
    },
    "hud_jitter": {
      "hud": {
        "frames": 2,
        "jitter": 1,
        "color": "white"
      }
    },
    "pickup_smoke_puff": {
      "particles": {
        "count": 8,
        "speed": 8,
        "gravity": -25,
        "size": 8,
        "color": "gray",
        "spawnRadius": 8,
        "shrink": true,
        "shape": "puff",
        "lifeMs": 250,
        "spread": 1.6
      }
    },
    "castle_blockage_crumble_cd32": {
      "particles": {
        "count": 8,
        "speed": 8,
        "gravity": 200,
        "size": 3,
        "color": "gray",
        "spawnRadius": 0,
        "emitterWidth": 32,
        "emitterHeight": 21,
        "shrink": false,
        "shape": "block",
        "lifeMs": 480,
        "spread": 0.85
      }
    },
    "player_suppressed_lethal": {
      "actorFlash": {
        "frames": 2,
        "color": "red"
      }
    },
    "platform_release_puff": {
      "particles": {
        "count": 8,
        "speed": 3,
        "gravity": -18,
        "size": 8,
        "color": "gray",
        "spawnRadius": 6,
        "shrink": false,
        "shape": "puff",
        "lifeMs": 290,
        "spread": 1.2
      }
    },
    "boulder_impact": {
      "particles": {
        "count": 6,
        "speed": 10,
        "gravity": 35,
        "size": 4,
        "color": "tan",
        "shape": "puff",
        "spawnRadius": 0,
        "emitterWidth": 12,
        "emitterHeight": 1,
        "shrink": true,
        "lifeMs": 220,
        "spread": 0.8
      },
      "camera": {
        "amplitude": 2,
        "frames": 3
      }
    },
    "castle_barrel_impact_dust": {
      "particles": {
        "count": 8,
        "speed": 6,
        "gravity": -8,
        "size": 14,
        "color": "gray",
        "shape": "puff",
        "spawnRadius": 3,
        "emitterWidth": 20,
        "emitterHeight": 20,
        "shrink": true,
        "lifeMs": 400,
        "spread": 1.05
      }
    }
  },
  "presets": [
    {
      "value": 0,
      "key": "off",
      "label": "Off",
      "nativeLabel": "OFF",
      "libretroValue": "off",
      "editorStyleId": "reset-all",
      "actions": {
        "player.suppressed_lethal_hit": "player_suppressed_lethal"
      }
    },
    {
      "value": 1,
      "key": "amiga_palette_punch",
      "label": "Amiga/CD32 - Palette punch",
      "nativeLabel": "AMIGA CD32",
      "libretroValue": "amiga-cd32",
      "editorStyleId": "amiga-palette-punch",
      "actions": {
        "player.turn": "grounded_skid_cd32",
        "player.jump": "jump_takeoff_cd32",
        "player.bounce_back": "raw",
        "player.land": "land_soft",
        "weapon.fire": "weapon_retro_smoke",
        "bullet.wall_hit": "wall_chip",
        "bullet.target_hit": "target_freeze",
        "enemy.stick_hit": "target_clean",
        "player.projectile_hit": "player_freeze_static",
        "projectile.near_miss": "raw",
        "dynamite.place": "raw",
        "dynamite.fuse": "fuse_minimal",
        "dynamite.explode": "explode_retro_heavy",
        "ammo.explode": "explode_palette_static",
        "dynamite.target_hit": "target_freeze",
        "player.explosion_hit": "explosion_player_static",
        "player.explosion_near_miss": "explosion_bounce_static",
        "pickup.collect": "pickup_smoke_puff",
        "ammo.deplete": "hud_gray",
        "ammo.collect": "hud_white",
        "points.collect": "hud_white",
        "player.suppressed_lethal_hit": "player_suppressed_lethal",
        "platform.release": "platform_release_puff",
        "blockage.crumble": "castle_blockage_crumble_cd32",
        "boulder.impact": "boulder_impact",
        "barrel.impact": "castle_barrel_impact_dust"
      }
    },
    {
      "value": 2,
      "key": "readable_danger",
      "label": "Readable danger",
      "nativeLabel": "READABLE",
      "libretroValue": "readable",
      "editorStyleId": "spelunky-readable",
      "actions": {
        "player.turn": "skid",
        "player.jump": "jump",
        "player.bounce_back": "raw",
        "player.land": "land_soft",
        "weapon.fire": "weapon_classic",
        "bullet.wall_hit": "wall_chip",
        "bullet.target_hit": "target_clean",
        "player.projectile_hit": "player_red",
        "projectile.near_miss": "near_miss",
        "dynamite.place": "raw",
        "dynamite.fuse": "fuse_minimal",
        "dynamite.explode": "explode_palette",
        "ammo.explode": "explode_palette",
        "dynamite.target_hit": "target_clean",
        "player.explosion_hit": "player_red",
        "player.explosion_near_miss": "explosion_bounce",
        "pickup.collect": "pickup_clean",
        "ammo.deplete": "hud_gray",
        "ammo.collect": "hud_white",
        "points.collect": "hud_white",
        "player.suppressed_lethal_hit": "player_suppressed_lethal",
        "boulder.impact": "boulder_impact",
        "barrel.impact": "castle_barrel_impact_dust"
      }
    },
    {
      "value": 3,
      "key": "crisp_movement",
      "label": "Crisp movement",
      "nativeLabel": "CRISP",
      "libretroValue": "crisp",
      "editorStyleId": "celeste-crisp",
      "actions": {
        "player.step": "micro_dust",
        "player.turn": "skid",
        "player.jump": "jump",
        "player.bounce_back": "raw",
        "player.apex": "raw",
        "player.land": "land_responsive",
        "weapon.fire": "weapon_classic",
        "bullet.wall_hit": "wall_chip",
        "bullet.target_hit": "target_clean",
        "player.projectile_hit": "player_freeze",
        "projectile.near_miss": "near_miss",
        "dynamite.place": "raw",
        "dynamite.fuse": "fuse_minimal",
        "dynamite.explode": "explode_ripple",
        "ammo.explode": "explode_ripple",
        "dynamite.target_hit": "target_clean",
        "player.explosion_hit": "player_freeze",
        "player.explosion_near_miss": "explosion_bounce",
        "pickup.collect": "pickup_clean",
        "ammo.deplete": "hud_gray",
        "ammo.collect": "hud_white",
        "points.collect": "hud_white",
        "player.suppressed_lethal_hit": "player_suppressed_lethal",
        "boulder.impact": "boulder_impact",
        "barrel.impact": "castle_barrel_impact_dust"
      }
    },
    {
      "value": 4,
      "key": "retro_punch",
      "label": "Retro punch",
      "nativeLabel": "RETRO",
      "libretroValue": "retro",
      "editorStyleId": "shovel-knight-retro",
      "actions": {
        "player.step": "micro_dust",
        "player.turn": "skid",
        "player.jump": "jump",
        "player.bounce_back": "raw",
        "player.land": "land_soft",
        "weapon.fire": "weapon_retro",
        "bullet.wall_hit": "wall_chip",
        "bullet.target_hit": "target_freeze",
        "player.projectile_hit": "player_red",
        "projectile.near_miss": "near_miss",
        "dynamite.place": "raw",
        "dynamite.fuse": "fuse_minimal",
        "dynamite.explode": "explode_ripple",
        "ammo.explode": "explode_ripple",
        "dynamite.target_hit": "target_clean",
        "player.explosion_hit": "player_freeze",
        "player.explosion_near_miss": "explosion_bounce",
        "pickup.collect": "pickup_clean",
        "ammo.deplete": "hud_gray",
        "ammo.collect": "hud_white",
        "points.collect": "hud_white",
        "player.suppressed_lethal_hit": "player_suppressed_lethal",
        "boulder.impact": "boulder_impact",
        "barrel.impact": "castle_barrel_impact_dust"
      }
    },
    {
      "value": 5,
      "key": "impact_priority",
      "label": "Impact priority",
      "nativeLabel": "IMPACT",
      "libretroValue": "impact",
      "editorStyleId": "dead-cells-impact",
      "actions": {
        "player.turn": "skid",
        "player.jump": "jump",
        "player.bounce_back": "raw",
        "player.land": "land_responsive",
        "weapon.fire": "weapon_punchy",
        "bullet.wall_hit": "wall_spark",
        "bullet.target_hit": "target_punchy",
        "player.projectile_hit": "player_impact",
        "projectile.near_miss": "near_miss",
        "dynamite.place": "raw",
        "dynamite.fuse": "fuse_spark",
        "dynamite.explode": "explode_debris",
        "ammo.explode": "explode_debris",
        "dynamite.target_hit": "explosion_target",
        "player.explosion_hit": "explosion_player",
        "player.explosion_near_miss": "explosion_bounce",
        "pickup.collect": "pickup_pop",
        "ammo.deplete": "hud_gray",
        "ammo.collect": "hud_jitter",
        "points.collect": "hud_jitter",
        "player.suppressed_lethal_hit": "player_suppressed_lethal",
        "boulder.impact": "boulder_impact",
        "barrel.impact": "castle_barrel_impact_dust"
      }
    }
  ]
});
