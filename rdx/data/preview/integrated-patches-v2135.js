// Generated v2.1.35 shipped patch baseline. Do not edit browser-local review state here.
export const INTEGRATED_PREVIEW_PATCH_BASELINE = {
  "schema": "rdx.preview_patches.v1",
  "version": "2026-08-07-absolute-targets",
  "game": {
    "project": "xrick/RDX Web",
    "appVersion": "2.1.35",
    "rdxRomSha256": "06ba20d676fe3ded0f79ace313cb8379e6fe30a4cc9794fffdb392b585180a00"
  },
  "purpose": "Shipped integration baseline. Rows here are already represented by v2.1.35 source/preview/native behavior and must not be re-exported unless the reviewer changes them.",
  "createdAt": "2026-08-07T11:00:17.315Z",
  "updatedAt": "2026-08-07T11:00:17.315Z",
  "rooms": [
    {
      "submap": 8,
      "submapName": "SM08",
      "mapId": 11,
      "mapName": "MD0011",
      "world": "Jungle",
      "visualSource": "rdx",
      "patches": [
        {
          "elementId": "MD0011#debug-hazard#terrain-hazard:md0011-floor-spikes-904",
          "sourceKey": "terrain-hazard:md0011-floor-spikes-904",
          "instanceKey": null,
          "traceCollection": null,
          "elementKind": "debug-hazard",
          "category": "hazard",
          "port": "debug",
          "debugOnly": true,
          "observed": {
            "x": 72,
            "y": 908,
            "bounds": [
              64,
              904,
              16,
              8
            ],
            "visible": true,
            "authority": "verified-ROM-foreground-tile-signature"
          },
          "change": {
            "dx": 197,
            "dy": -373,
            "enabled": true,
            "bugged": "shouldn't be present here at all - not sure where this entity is coming from but remove it and find out why it was here in the first place"
          },
          "updatedAt": "2026-08-07T08:14:16.891Z",
          "introducedInVersion": "2.1.30",
          "integratedInVersion": "2.1.31"
        },
        {
          "elementId": "MD0011#debug-hazard#bounds:hazard:mark:87",
          "sourceKey": "mark:87",
          "instanceKey": null,
          "traceCollection": "actors",
          "elementKind": "debug-hazard",
          "category": "hazard",
          "port": "debug",
          "debugOnly": true,
          "observed": {
            "x": 128,
            "y": 137,
            "bounds": [
              122,
              107,
              44,
              36
            ],
            "visible": true,
            "authority": "hazard"
          },
          "change": {
            "dx": 0,
            "dy": 0,
            "enabled": false,
            "bugged": "lets hide this element as it is impossible to go around and finish the map"
          },
          "updatedAt": "2026-08-07T08:15:33.500Z",
          "introducedInVersion": "2.1.30",
          "integratedInVersion": "2.1.31"
        },
        {
          "elementId": "MD0011#rdx-trap#mark:93",
          "sourceKey": "mark:93",
          "instanceKey": null,
          "traceCollection": "actors",
          "elementKind": "rdx-trap",
          "category": "trap",
          "port": "rdx",
          "debugOnly": false,
          "observed": {
            "x": 160,
            "y": 616,
            "bounds": [
              154,
              610,
              36,
              44
            ],
            "visible": true,
            "authority": "hazard"
          },
          "change": {
            "dx": -13,
            "dy": 1,
            "enabled": true,
            "bugged": "corrected position recovered from actual user-visible map preview screenshot"
          },
          "updatedAt": "2026-08-07T15:51:00.000Z",
          "introducedInVersion": "2.1.32",
          "integratedInVersion": "2.1.35",
          "target": {
            "x": 147,
            "y": 617,
            "bounds": [
              141,
              611,
              36,
              44
            ],
            "visible": true
          },
          "supersedesIntegratedTarget": {
            "x": 44,
            "y": 618,
            "integratedInVersion": "2.1.31"
          }
        },
        {
          "elementId": "MD0011#rdx-enemy#mark:94",
          "sourceKey": "mark:94",
          "instanceKey": null,
          "traceCollection": "actors",
          "elementKind": "rdx-enemy",
          "category": "enemy",
          "port": "rdx",
          "debugOnly": false,
          "introducedInVersion": "2.1.32",
          "observed": {
            "x": 240,
            "y": 672,
            "bounds": [
              222,
              643,
              36,
              36
            ],
            "visible": true,
            "authority": "reviewed-single-element-patch+production-c-runtime"
          },
          "target": {
            "x": 240,
            "y": 672,
            "bounds": [
              222,
              643,
              36,
              36
            ],
            "visible": true
          },
          "change": {
            "dx": 0,
            "dy": 0,
            "enabled": true,
            "bugged": "this enemy does not appear in-game, only in map-preview - fix the core issue"
          },
          "updatedAt": "2026-08-07T11:00:17.315Z",
          "integratedInVersion": "2.1.33"
        }
      ]
    }
  ]
};
