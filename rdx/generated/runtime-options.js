// GENERATED FILE. Do not edit by hand.
// Authority: revival/runtime-options.json (+ revival/game-juice-presets.json for sourced values)
// Regenerate: node tools/build/generate_runtime_options.mjs
export const RUNTIME_OPTIONS = Object.freeze([
  {
    "id": 1,
    "key": "gameplay_speed",
    "type": "enum",
    "default": 1,
    "label": "Gameplay speed",
    "surfaces": [
      "nativeMenu",
      "libretro",
      "browser"
    ],
    "nativeLabel": "GAMEPLAY@SPEED",
    "browserControlId": "rdx-speed-mode",
    "libretroKey": "rdrevival_gameplay_speed",
    "values": [
      {
        "value": 1,
        "key": "1",
        "label": "1×",
        "nativeLabel": "1X",
        "libretroValue": "1x"
      },
      {
        "value": 2,
        "key": "2",
        "label": "1.5×",
        "nativeLabel": "1.5X",
        "libretroValue": "1.5x"
      },
      {
        "value": 3,
        "key": "3",
        "label": "2×",
        "nativeLabel": "2X",
        "libretroValue": "2x"
      }
    ]
  },
  {
    "id": 20,
    "key": "display_refresh",
    "type": "enum",
    "default": 0,
    "label": "Display refresh",
    "surfaces": [
      "libretro",
      "browser"
    ],
    "nativeLabel": "DISPLAY@REFRESH",
    "browserControlId": "rdx-display-refresh",
    "libretroKey": "rdrevival_display_refresh",
    "values": [
      {
        "value": 0,
        "key": "gameplay_rate",
        "label": "Gameplay rate (25/36/50 Hz) (default)",
        "nativeLabel": "GAME RATE",
        "libretroValue": "gameplay-rate"
      },
      {
        "value": 60,
        "key": "60_hz",
        "label": "60 Hz",
        "nativeLabel": "60 HZ",
        "libretroValue": "60-hz"
      },
      {
        "value": 50,
        "key": "50_hz",
        "label": "50 Hz",
        "nativeLabel": "50 HZ",
        "libretroValue": "50-hz"
      },
      {
        "value": 100,
        "key": "100_hz",
        "label": "100 Hz",
        "nativeLabel": "100 HZ",
        "libretroValue": "100-hz"
      },
      {
        "value": 120,
        "key": "120_hz",
        "label": "120 Hz",
        "nativeLabel": "120 HZ",
        "libretroValue": "120-hz"
      }
    ]
  },
  {
    "id": 2,
    "key": "camera_mode",
    "type": "enum",
    "default": 2,
    "label": "Camera",
    "surfaces": [
      "libretro",
      "browser"
    ],
    "nativeLabel": "CAMERA",
    "browserControlId": "rdx-camera-mode",
    "libretroKey": "rdrevival_camera_mode",
    "values": [
      {
        "value": 2,
        "key": "fluid_v2",
        "label": "Fluid v2 (default)",
        "nativeLabel": "FLUID V2",
        "libretroValue": "fluid-v2"
      },
      {
        "value": 1,
        "key": "classic",
        "label": "Classic stop-the-world rows",
        "nativeLabel": "CLASSIC",
        "libretroValue": "classic"
      }
    ]
  },
  {
    "id": 4,
    "key": "bullet_graphics",
    "type": "enum",
    "default": 2,
    "label": "Bullet graphics",
    "surfaces": [
      "libretro",
      "browser"
    ],
    "browserControlId": "rdx-bullet-source",
    "libretroKey": "rdrevival_bullet_source",
    "values": [
      {
        "value": 0,
        "key": "classic",
        "label": "Classic",
        "libretroValue": "classic"
      },
      {
        "value": 2,
        "key": "revival",
        "label": "Revival animated (default)",
        "libretroValue": "revival"
      }
    ]
  },
  {
    "id": 11,
    "key": "dynamite_graphics",
    "type": "enum",
    "default": 3,
    "label": "Dynamite graphics",
    "surfaces": [
      "libretro",
      "browser"
    ],
    "browserControlId": "rdx-dynamite-source",
    "libretroKey": "rdrevival_dynamite_source",
    "values": [
      {
        "value": 2,
        "key": "classic",
        "label": "Classic",
        "libretroValue": "classic"
      },
      {
        "value": 3,
        "key": "revival",
        "label": "Revival volumetric blast (default)",
        "libretroValue": "revival"
      }
    ]
  },
  {
    "id": 21,
    "key": "castle_blockage_graphics",
    "type": "enum",
    "default": 0,
    "label": "Castle blockage graphics",
    "surfaces": [
      "libretro",
      "browser"
    ],
    "browserControlId": "rdx-castle-blockage-source",
    "libretroKey": "rdrevival_castle_blockage_graphics",
    "values": [
      {
        "value": 0,
        "key": "classic",
        "label": "Classic (default)",
        "libretroValue": "classic"
      },
      {
        "value": 1,
        "key": "retouched",
        "label": "Classic retouched for Castle",
        "libretroValue": "retouched"
      }
    ]
  },
  {
    "id": 22,
    "key": "golden_idol_graphics",
    "type": "enum",
    "default": 1,
    "label": "Golden idol graphics",
    "surfaces": [
      "libretro",
      "browser"
    ],
    "browserControlId": "rdx-golden-idol-source",
    "libretroKey": "rdrevival_golden_idol_graphics",
    "values": [
      {
        "value": 0,
        "key": "rdx",
        "label": "RDX original",
        "libretroValue": "rdx"
      },
      {
        "value": 1,
        "key": "revival",
        "label": "Revival improved (default)",
        "libretroValue": "revival"
      }
    ]
  },
  {
    "id": 23,
    "key": "ammo_box_graphics",
    "type": "enum",
    "default": 1,
    "label": "Ammo box graphics",
    "surfaces": [
      "libretro",
      "browser"
    ],
    "browserControlId": "rdx-ammo-box-source",
    "libretroKey": "rdrevival_ammo_box_graphics",
    "values": [
      {
        "value": 0,
        "key": "rdx",
        "label": "RDX original",
        "libretroValue": "rdx"
      },
      {
        "value": 1,
        "key": "revival",
        "label": "Revival Classic-restyled (default)",
        "libretroValue": "revival"
      }
    ]
  },
  {
    "id": 5,
    "key": "projectile_speed",
    "type": "enum",
    "default": 100,
    "label": "Hostile projectile speed",
    "surfaces": [
      "libretro"
    ],
    "libretroKey": "rdrevival_projectile_speed",
    "values": [
      {
        "value": 100,
        "key": "1.0x",
        "label": "1.0× (default)",
        "libretroValue": "1.0x"
      },
      {
        "value": 80,
        "key": "0.8x",
        "label": "0.8×",
        "libretroValue": "0.8x"
      },
      {
        "value": 50,
        "key": "0.5x",
        "label": "0.5×",
        "libretroValue": "0.5x"
      }
    ]
  },
  {
    "id": 8,
    "key": "projectile_cadence",
    "type": "enum",
    "default": 100,
    "label": "Hostile projectile cadence",
    "surfaces": [
      "libretro"
    ],
    "libretroKey": "rdrevival_projectile_cadence",
    "values": [
      {
        "value": 100,
        "key": "1.0x",
        "label": "1.0× (default)",
        "libretroValue": "1.0x"
      },
      {
        "value": 80,
        "key": "0.8x",
        "label": "0.8×",
        "libretroValue": "0.8x"
      },
      {
        "value": 50,
        "key": "0.5x",
        "label": "0.5×",
        "libretroValue": "0.5x"
      }
    ]
  },
  {
    "id": 6,
    "key": "extended_viewport",
    "type": "enum",
    "default": 1,
    "label": "Extended viewport",
    "surfaces": [
      "libretro"
    ],
    "libretroKey": "rdrevival_extended_viewport",
    "values": [
      {
        "value": 1,
        "key": "enabled",
        "label": "Enabled (320x240, default)",
        "libretroValue": "enabled"
      },
      {
        "value": 0,
        "key": "disabled",
        "label": "Disabled (320x200)",
        "libretroValue": "disabled"
      }
    ]
  },
  {
    "id": 7,
    "key": "transition_preset",
    "type": "enum",
    "default": 0,
    "label": "Transition effect",
    "surfaces": [
      "browser"
    ],
    "nativeLabel": "TRANSITION",
    "browserControlId": "rdx-transition-preset",
    "values": [
      {
        "value": 0,
        "key": "random",
        "label": "Random (default)",
        "nativeLabel": "RANDOM",
        "libretroValue": "random"
      },
      {
        "value": 10,
        "key": "off",
        "label": "Off",
        "nativeLabel": "OFF",
        "libretroValue": "off"
      },
      {
        "value": 1,
        "key": "checker-wipe",
        "label": "Checker wipe",
        "nativeLabel": "CHECKER",
        "libretroValue": "checker-wipe"
      },
      {
        "value": 2,
        "key": "blitter-bars",
        "label": "Blitter bars",
        "nativeLabel": "BLITTER",
        "libretroValue": "blitter-bars"
      },
      {
        "value": 3,
        "key": "tile-iris",
        "label": "Tile iris",
        "nativeLabel": "TILE IRIS",
        "libretroValue": "tile-iris"
      },
      {
        "value": 4,
        "key": "copper-curtain",
        "label": "Copper curtain",
        "nativeLabel": "COPPER",
        "libretroValue": "copper-curtain"
      },
      {
        "value": 5,
        "key": "raster-shutters",
        "label": "Raster shutters",
        "nativeLabel": "SHUTTERS",
        "libretroValue": "raster-shutters"
      },
      {
        "value": 6,
        "key": "mosaic-collapse",
        "label": "Mosaic collapse",
        "nativeLabel": "MOSAIC",
        "libretroValue": "mosaic-collapse"
      },
      {
        "value": 7,
        "key": "tunnel-iris",
        "label": "Tunnel iris",
        "nativeLabel": "TUNNEL",
        "libretroValue": "tunnel-iris"
      },
      {
        "value": 8,
        "key": "pixel-dissolve",
        "label": "Pixel dissolve",
        "nativeLabel": "DISSOLVE",
        "libretroValue": "pixel-dissolve"
      },
      {
        "value": 9,
        "key": "scanline-squeeze",
        "label": "Scanline squeeze",
        "nativeLabel": "SCANLINE",
        "libretroValue": "scanline-squeeze"
      }
    ]
  },
  {
    "id": 9,
    "key": "dynamite_bounce_radius",
    "type": "enum",
    "default": 200,
    "label": "Dynamite bounce radius",
    "surfaces": [
      "browser"
    ],
    "browserControlId": "rdx-dynamite-bounce-radius",
    "values": [
      {
        "value": 0,
        "key": "off",
        "label": "Off (Classic)",
        "libretroValue": "Off"
      },
      {
        "value": 200,
        "key": "200_percent",
        "label": "200% (default)",
        "libretroValue": "200%"
      },
      {
        "value": 150,
        "key": "150_percent",
        "label": "150%",
        "libretroValue": "150%"
      },
      {
        "value": 100,
        "key": "100_percent",
        "label": "100% (no bounce band)",
        "libretroValue": "100%"
      }
    ]
  },
  {
    "id": 10,
    "key": "game_juice_preset",
    "type": "enum",
    "default": 1,
    "label": "Game juice preset",
    "surfaces": [
      "nativeMenu",
      "libretro",
      "browser"
    ],
    "nativeLabel": "GAME@JUICE",
    "browserControlId": "rdx-game-juice-preset",
    "libretroKey": "rdrevival_game_juice_preset",
    "values": [
      {
        "value": 0,
        "key": "off",
        "label": "Off",
        "nativeLabel": "OFF",
        "libretroValue": "off"
      },
      {
        "value": 1,
        "key": "amiga_palette_punch",
        "label": "Amiga/CD32 - Palette punch",
        "nativeLabel": "AMIGA CD32",
        "libretroValue": "amiga-cd32"
      },
      {
        "value": 2,
        "key": "readable_danger",
        "label": "Readable danger",
        "nativeLabel": "READABLE",
        "libretroValue": "readable"
      },
      {
        "value": 3,
        "key": "crisp_movement",
        "label": "Crisp movement",
        "nativeLabel": "CRISP",
        "libretroValue": "crisp"
      },
      {
        "value": 4,
        "key": "retro_punch",
        "label": "Retro punch",
        "nativeLabel": "RETRO",
        "libretroValue": "retro"
      },
      {
        "value": 5,
        "key": "impact_priority",
        "label": "Impact priority",
        "nativeLabel": "IMPACT",
        "libretroValue": "impact"
      }
    ]
  },
  {
    "id": 24,
    "key": "stick_hit_sound",
    "type": "enum",
    "default": 0,
    "label": "Enemy stick-hit sound",
    "surfaces": [
      "libretro",
      "browser"
    ],
    "browserControlId": "rdx-stick-hit-sound",
    "libretroKey": "rdrevival_stick_hit_sound",
    "values": [
      {
        "value": 0,
        "key": "off",
        "label": "Off (default)",
        "libretroValue": "disabled"
      },
      {
        "value": 1,
        "key": "on",
        "label": "On",
        "libretroValue": "enabled"
      }
    ]
  },
  {
    "id": 13,
    "key": "kids_mode",
    "type": "enum",
    "default": 0,
    "label": "Kids mode",
    "surfaces": [
      "nativeMenu",
      "libretro"
    ],
    "nativeLabel": "KIDS@MODE",
    "libretroKey": "rdrevival_kids_mode",
    "values": [
      {
        "value": 0,
        "key": "off",
        "label": "Off (default)",
        "nativeLabel": "OFF",
        "libretroValue": "disabled"
      },
      {
        "value": 1,
        "key": "on",
        "label": "On - slow enemies, easy mode, 0.5x projectile cadence",
        "nativeLabel": "ON",
        "libretroValue": "enabled"
      }
    ]
  },
  {
    "id": 14,
    "key": "open_square_holes",
    "type": "enum",
    "default": 1,
    "label": "Open square holes",
    "surfaces": [
      "libretro"
    ],
    "libretroKey": "rdrevival_open_square_holes",
    "values": [
      {
        "value": 0,
        "key": "off",
        "label": "Off (raw RDX solid cells)",
        "nativeLabel": "OFF",
        "libretroValue": "disabled"
      },
      {
        "value": 1,
        "key": "on",
        "label": "On (Classic clearance)",
        "nativeLabel": "ON",
        "libretroValue": "enabled"
      }
    ]
  },
  {
    "id": 15,
    "key": "moving_platform_cog_sound",
    "type": "enum",
    "default": 0,
    "label": "Moving-platform cog sound",
    "surfaces": [
      "libretro",
      "browser"
    ],
    "browserControlId": "rdx-moving-platform-cog-sound",
    "libretroKey": "rdrevival_moving_platform_cog_sound",
    "values": [
      {
        "value": 0,
        "key": "off",
        "label": "Off (default)",
        "libretroValue": "disabled"
      },
      {
        "value": 2,
        "key": "low",
        "label": "Low · deep CLACK-chunk",
        "libretroValue": "low"
      },
      {
        "value": 1,
        "key": "mid",
        "label": "Mid · CLACK-chunk",
        "libretroValue": "mid"
      },
      {
        "value": 3,
        "key": "high",
        "label": "High · lighter CLACK-chunk",
        "libretroValue": "high"
      }
    ]
  },
  {
    "id": 16,
    "key": "moving_platform_cog_cadence",
    "type": "enum",
    "default": 18,
    "label": "Moving-platform cog cadence",
    "surfaces": [
      "browser"
    ],
    "browserControlId": "rdx-moving-platform-cog-cadence",
    "values": [
      {
        "value": 12,
        "key": "12_ticks",
        "label": "Quick · 12 ticks · 480 ms"
      },
      {
        "value": 18,
        "key": "18_ticks",
        "label": "Default · 18 ticks · 720 ms"
      },
      {
        "value": 24,
        "key": "24_ticks",
        "label": "Heavy · 24 ticks · 960 ms"
      },
      {
        "value": 30,
        "key": "30_ticks",
        "label": "Very heavy · 30 ticks · 1200 ms"
      }
    ]
  },
  {
    "id": 18,
    "key": "ladder_top_entry_tolerance",
    "type": "enum",
    "default": 1,
    "label": "Ladder top-entry extra tolerance",
    "surfaces": [],
    "values": [
      {
        "value": 0,
        "key": "0",
        "label": "0 px (previous behavior)"
      },
      {
        "value": 1,
        "key": "1",
        "label": "1 px (default)"
      },
      {
        "value": 2,
        "key": "2",
        "label": "2 px"
      },
      {
        "value": 3,
        "key": "3",
        "label": "3 px"
      },
      {
        "value": 4,
        "key": "4",
        "label": "4 px"
      },
      {
        "value": 5,
        "key": "5",
        "label": "5 px"
      },
      {
        "value": 6,
        "key": "6",
        "label": "6 px"
      }
    ]
  },
  {
    "id": 19,
    "key": "jump_button_climbs_ladders",
    "type": "enum",
    "default": 1,
    "label": "Jump button climbs ladders",
    "surfaces": [
      "libretro"
    ],
    "libretroKey": "rdrevival_jump_button_climbs_ladders",
    "values": [
      {
        "value": 1,
        "key": "on",
        "label": "On (default)",
        "libretroValue": "enabled"
      },
      {
        "value": 0,
        "key": "off",
        "label": "Off (jump only)",
        "libretroValue": "disabled"
      }
    ]
  },
  {
    "id": 25,
    "key": "movement_feel_preview",
    "type": "enum",
    "default": 0,
    "label": "Movement feel preview",
    "surfaces": [],
    "values": [
      {
        "value": 0,
        "key": "off",
        "label": "Off (current behavior)"
      },
      {
        "value": 1,
        "key": "on",
        "label": "On (buffered ladder intent + hero interpolation)"
      }
    ]
  }
]);
export const RUNTIME_OPTION_BY_KEY = Object.freeze(Object.fromEntries(RUNTIME_OPTIONS.map(option => [option.key, option])));
export const RUNTIME_OPTION_BY_ID = Object.freeze(Object.fromEntries(RUNTIME_OPTIONS.map(option => [option.id, option])));
