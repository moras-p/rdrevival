import { installWebMcpTools } from "../agent/webmcp.js";
const string = { type: "string" },
  integer = { type: "integer" },
  boolean = { type: "boolean" },
  array = (items) => ({ type: "array", items }),
  object = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
const target = { frameId: string, layerId: string },
  rectangle = { type: "array", items: integer, minItems: 4, maxItems: 4 };
const operation = (type, props, required = []) =>
  object({ type: { const: type }, ...props }, ["type", ...required]);
const SELECTOR_SCHEMA = {
  type: "object",
  description: "Deterministic selector expression. Supported types: rect, opaque, color, component, handle/component-id, checkpoint-delta, layer-role, bounds, contour, union, intersect, subtract, invert-within-region. Nested selector operators use selector/selectors/base/subtract/within.",
};
const numericConstraint = {
  oneOf: [integer, object({ exact: integer, min: integer, max: integer })],
};
const assertionTarget = object({ frameId: string, layerId: string, selector: SELECTOR_SCHEMA }, ["frameId"]);
const ASSERTIONS_SCHEMA = object({
  changedPixels: numericConstraint,
  changedBoundsWithin: rectangle,
  unchanged: array(assertionTarget),
  paletteUnchanged: boolean,
  anchorsUnchanged: boolean,
  clipsUnchanged: boolean,
  structureUnchanged: boolean,
  opaqueBounds: array(object({ ...assertionTarget.properties, exact: rectangle, within: rectangle }, ["frameId"])),
  componentCount: array(object({ ...assertionTarget.properties, count: numericConstraint }, ["frameId", "count"])),
  colorsUsed: array(object({ ...assertionTarget.properties, subset: array(integer), exact: array(integer), maxCount: integer }, ["frameId"])),
  noNewWarnings: { oneOf: [boolean, { const: "all" }, array(string)] },
  checkpointDeltaWithin: object({ checkpoint: string, maxChangedPixels: integer, changedBoundsWithin: rectangle }, ["checkpoint"]),
});
const AGENT_OP_SCHEMA = {
  type: "object",
  description: "Agent-first operation. type is one of transform_selection, shade_step, remap_ramp, delete_frame, duplicate_frames, bulk_anchor, delete_layer, duplicate_layer, reorder_layers, merge_layers, flatten_visible, cel, palette_add, palette_remove, palette_reorder, palette_ramp, trim_to_selection, pad_canvas, handoff. These operations use selectors/targets and explicit policies documented in PIXEL_ART_EDITOR.md.",
  properties: { type: { enum: ["transform_selection", "shade_step", "remap_ramp", "delete_frame", "duplicate_frames", "bulk_anchor", "delete_layer", "duplicate_layer", "reorder_layers", "merge_layers", "flatten_visible", "cel", "palette_add", "palette_remove", "palette_reorder", "palette_ramp", "trim_to_selection", "pad_canvas", "handoff"] } },
  required: ["type"],
  additionalProperties: true,
};
export const OP_SCHEMA = {
  oneOf: [
    operation(
      "resize",
      {
        width: integer,
        height: integer,
        fit: { enum: ["preserve", "nearest"] },
        allowCrop: boolean,
      },
      ["width", "height", "fit"],
    ),
    operation(
      "stamp",
      {
        ...target,
        referenceId: string,
        rect: rectangle,
        x: integer,
        y: integer,
      },
      ["frameId", "layerId", "referenceId", "rect", "x", "y"],
    ),
    operation(
      "pixels",
      {
        ...target,
        rows: {
          type: "array",
          description: "Rows [y, startX, paletteIndices]",
          items: { type: "array" },
        },
      },
      ["frameId", "layerId", "rows"],
    ),
    operation(
      "line",
      {
        ...target,
        x1: integer,
        y1: integer,
        x2: integer,
        y2: integer,
        color: integer,
      },
      ["frameId", "layerId", "x1", "y1", "x2", "y2", "color"],
    ),
    operation(
      "rectangle",
      { ...target, rect: rectangle, color: integer, filled: boolean },
      ["frameId", "layerId", "rect", "color"],
    ),
    operation("fill", { ...target, x: integer, y: integer, color: integer }, [
      "frameId",
      "layerId",
      "x",
      "y",
      "color",
    ]),
    operation("clear", { ...target, rect: rectangle }, ["frameId", "layerId"]),
    ...["copy", "move"].map((type) =>
      operation(
        type,
        { ...target, rect: rectangle, toX: integer, toY: integer },
        ["frameId", "layerId", "rect", "toX", "toY"],
      ),
    ),
    operation(
      "mirror",
      {
        ...target,
        rect: rectangle,
        axis: { enum: ["horizontal", "vertical"] },
      },
      ["frameId", "layerId", "axis"],
    ),
    operation(
      "replace",
      { ...target, rect: rectangle, from: integer, color: integer },
      ["frameId", "layerId", "from", "color"],
    ),
    operation("component_move", { ...target, x: integer, y: integer, dx: integer, dy: integer, region: rectangle, mode: { enum: ["opaque", "same-color"] } }, ["frameId", "layerId", "x", "y", "dx", "dy"]),
    operation("component_recolor", { ...target, x: integer, y: integer, from: integer, color: integer, region: rectangle, mode: { enum: ["opaque", "same-color"] } }, ["frameId", "layerId", "x", "y", "from", "color"]),
    operation("component_contour", { ...target, x: integer, y: integer, color: integer, region: rectangle, componentMode: { enum: ["opaque", "same-color"] }, contour: { enum: ["inner", "outer"] }, overwrite: boolean }, ["frameId", "layerId", "x", "y", "color", "contour"]),
    operation("ramp_remap", { ...target, x: integer, y: integer, region: rectangle, mode: { enum: ["opaque", "same-color"] }, mapping: { type: "array", items: { type: "array", items: integer, minItems: 2, maxItems: 2 } } }, ["frameId", "layerId", "mapping"]),
    operation("polygon", { ...target, points: { type: "array", items: { type: "array", items: integer, minItems: 2, maxItems: 2 } }, color: integer }, ["frameId", "layerId", "points", "color"]),
    operation("add_frame", { id: string, sourceFrameId: string }, ["id"]),
    operation("reorder_frames", { frameIds: array(string) }, ["frameIds"]),
    operation("add_layer", { id: string, name: string, role: { enum: ["generic", "silhouette/base", "shadow", "light", "accent", "temporary-guide"] } }, ["id"]),
    operation(
      "layer",
      { layerId: string, name: string, visible: boolean, locked: boolean, role: { enum: ["generic", "silhouette/base", "shadow", "light", "accent", "temporary-guide"] } },
      ["layerId"],
    ),
    operation("anchor", { frameId: string, anchor: array(integer) }, [
      "frameId",
      "anchor",
    ]),
    operation(
      "clip",
      {
        clip: object(
          {
            id: string,
            frameIds: array(string),
            durations: array(integer),
            direction: { enum: ["forward", "reverse", "ping-pong"] },
            loop: { enum: ["loop", "once"] },
          },
          ["id", "frameIds", "durations", "direction", "loop"],
        ),
      },
      ["clip"],
    ),
    operation(
      "layout",
      {
        layout: object(
          {
            columns: integer,
            marginX: integer,
            marginY: integer,
            gapX: integer,
            gapY: integer,
            cells: array({ type: ["string", "null"] }),
          },
          ["columns", "marginX", "marginY", "gapX", "gapY", "cells"],
        ),
      },
      ["layout"],
    ),
    operation(
      "constraints",
      {
        constraints: object(
          {
            protected: array(
              object({ ...target, rect: rectangle }, [
                "frameId",
                "layerId",
                "rect",
              ]),
            ),
            frameIds: { type: ["array", "null"], items: string },
            allowedPalette: { type: ["array", "null"], items: integer },
          },
          ["protected", "frameIds", "allowedPalette"],
        ),
      },
      ["constraints"],
    ),
    operation("palette", { index: integer, rgba: array(integer) }, [
      "index",
      "rgba",
    ]),
    operation("palette_locks", { indices: array(integer) }, ["indices"]),
    operation("art_direction", { direction: object({ target: string, intent: string, preserve: string, referenceNotes: string, acceptance: string }) }, ["direction"]),
    operation("palette_policy", { policy: object({ name: string, source: string, maxColors: integer, allowedIndices: array(integer) }, ["name", "source", "maxColors", "allowedIndices"]) }, ["policy"]),
    operation("style_profile", { profile: { type: "object" } }, ["profile"]),
    operation("authoring_stage", { stage: { enum: ["silhouette", "major-masses", "shading", "accents", "cleanup"] }, lockCompleted: boolean }, ["stage"]),
    operation("brief", { brief: string }, ["brief"]),
    AGENT_OP_SCHEMA,
  ],
};
const guard = {
  documentId: string,
  expectedRevision: integer,
  requestId: string,
};
export function pixelArtTools(controller) {
  const safe = (fn) => async (input) => {
    controller.store.metrics.toolCalls =
      (controller.store.metrics.toolCalls ?? 0) + 1;
    try {
      return await fn(input);
    } catch (error) {
      controller.store.metrics.toolFailures =
        (controller.store.metrics.toolFailures ?? 0) + 1;
      return {
        error: { code: error.code ?? "INVALID_INPUT", message: error.message, ...(error.details ? { details: error.details } : {}) },
        revision: controller.store.document.revision,
      };
    }
  };
  return [
    {
      name: "get_state",
      readOnly: true,
      description:
        "Read compact document state. detail includes palette, frames, layers, clips, constraints and handles. Pixels are read separately.",
      inputSchema: object({ detail: boolean }),
      execute: safe((i) => controller.state(i)),
    },
    {
      name: "document",
      description:
        "Create, open, import, attach an inspiration reference, save or export using selected-file/artifact handles. Generic reference attachment accepts only the inspiration roles exposed as capabilities.attachableReferenceRoles and never grants exact-copy authority; editable imports and locally registered game-asset plugins own copy-authoritative sources. Every action, including save/export, requires documentId, expectedRevision and requestId. Always use the returned revision. No filesystem or network access. Use import-sheet options.layout with explicit occupied cells; options.rectangles supports irregular atlas coordinates.",
      inputSchema: object(
        {
          ...guard,
          action: {
            enum: [
              "create",
              "open",
              "import-image",
              "import-sheet",
              "reference",
              "save",
              "export",
              "production-import",
              "import-rdx-sprite",
              "production-export",
              "asset-import",
              "asset-export",
            ],
          },
          handle: string,
          format: { enum: ["png", "sheet", "project", "report"] },
          options: {
            type: "object",
            description:
              "Creation: width,height,ratio:[w,h],frameCount,columns,background,brief,palette. Import: fit preserve|contain|cover|stretch, quantize boolean, frameId,layerId, layout or rectangles, clips. For fixed imports: fixedPalette:true, paletteName, paletteSource, maxColors (opaque), allowedIndices. palettePolicy:source extracts colors only, not a full map palette. asset-import: pluginId plus plugin options from get_state capabilities.assetPlugins. asset-export resolves the bound plugin; sourceHandle optionally verifies the current owning source. Legacy import-rdx-sprite: mapId and pn. No implicit conversions.",
          },
        },
        ["action", "documentId", "expectedRevision", "requestId"],
      ),
      execute: safe((i) => controller.documentCommand(i)),
    },
    {
      name: "view",
      description:
        "Prepare a revision-tagged canvas for host image capture. Returns a handle and selector, never image bytes. Host must capture #art-observation; this response alone does not deliver an image.",
      inputSchema: object({
        expectedRevision: integer,
        mode: {
          enum: [
            "asset",
            "crop",
            "reference",
            "strip",
            "onion",
            "diff",
            "review",
            "sheet",
            "playback",
            "critique",
            "silhouette",
            "value",
            "palette-role",
            "frame-delta",
            "animation-review",
            "production",
          ],
        },
        frameId: string,
        referenceId: string,
        region: rectangle,
        zoom: integer,
        checkpoint: string,
        adjacent: { enum: ["previous", "next", "both"] },
        previewOptions: { type: "object" },
      }),
      execute: safe((i) => controller.view(i)),
    },
    {
      name: "read_region",
      readOnly: true,
      description:
        "Read bounded palette-index spans. Half-open region [x,y,width,height]; continuation is a pixel offset.",
      inputSchema: object(
        { ...target, region: rectangle, offset: integer, limit: integer },
        ["frameId"],
      ),
      execute: safe((i) => controller.read(i)),
    },
    {
      name: "inspect",
      readOnly: true,
      description:
        "Resolve a deterministic revision-bound pixel selector and return only requested compact spatial facts. The returned selection/component handles are valid only for the exact document revision and scope.",
      inputSchema: object({
        expectedRevision: integer,
        frameId: string,
        layerId: string,
        selector: SELECTOR_SCHEMA,
        facts: array({ enum: ["bounds", "centroid", "counts", "paletteHistogram", "components", "contour", "holes", "contacts", "occupancy", "symmetry", "anchorRelativeBounds", "layerContribution", "checkpointDelta", "neighborhood", "paletteSemantics"] }),
        checkpoint: string,
        point: { type: "array", items: integer, minItems: 2, maxItems: 2 },
        radius: integer,
        rgb: { type: "array", items: integer, minItems: 3, maxItems: 3 },
      }, ["expectedRevision", "frameId"]),
      execute: safe((i) => controller.inspect(i)),
    },
    {
      name: "simulate_ops",
      readOnly: true,
      description:
        "Dry-run the exact apply_ops validation, protection and assertion path without changing revision, history, provenance or mutation metrics. Returns a rich prospective delta or a structured failure.",
      inputSchema: object({ documentId: string, expectedRevision: integer, ops: array({ type: "object", description: "Operations use the same deterministic operation objects documented by apply_ops." }), assertions: { type: "object", description: "Optional postconditions use the same assertion object documented by apply_ops." }, label: string }, [
        "documentId",
        "expectedRevision",
        "ops",
      ]),
      execute: safe((i) => controller.simulate(i)),
    },
    {
      name: "apply_ops",
      description:
        "Atomically apply deterministic indexed commands with optional postconditions. Lines use Bresenham; fill is 4-connected; copy/move snapshot before overlap; mirror stays inside rect. Any invalid, protected or assertion-failing transaction rolls back. Returns a rich per-cel delta.",
      inputSchema: object({ ...guard, ops: array({ type: "object", description: "Deterministic operation object. Available operation families are listed by get_state.capabilities and documented in PIXEL_ART_EDITOR.md." }), assertions: ASSERTIONS_SCHEMA, label: string }, [
        "documentId",
        "expectedRevision",
        "requestId",
        "ops",
      ]),
      execute: safe((i) => controller.apply(i)),
    },
    {
      name: "apply_pixel_patch",
      description:
        "Atomic exact row spans [y,startX,indices] on an explicit cel.",
      inputSchema: object(
        {
          ...guard,
          ...target,
          rows: { type: "array", items: { type: "array" } },
        },
        [
          "documentId",
          "expectedRevision",
          "requestId",
          "frameId",
          "layerId",
          "rows",
        ],
      ),
      execute: safe((i) =>
        controller.apply({
          ...i,
          ops: [
            {
              type: "pixels",
              frameId: i.frameId,
              layerId: i.layerId,
              rows: i.rows,
            },
          ],
        }),
      ),
    },
    {
      name: "analyze",
      readOnly: true,
      description:
        "Mechanical validation and optional checkpoint comparison. Warnings do not constitute art approval.",
      inputSchema: object({ checkpoint: string, benchmarkTask: { enum: ["novel-prop", "character-pose", "short-effect", "tile-variant", "sprite-repair", "feature-shift", "multi-frame-cleanup", "animation-construction", "palette-shading", "candidate-exploration", "production-repair"] }, review: { type: "object" } }),
      execute: safe((i) => controller.analyze(i)),
    },
    {
      name: "candidates",
      description: "Fork, switch, promote, delete or list independent art candidates. Candidate branches have separate monotonic edit histories and checkpoints and are saved with the project.",
      inputSchema: { type: "object", properties: { ...guard, action: { enum: ["list", "fork", "switch", "promote", "delete", "compare", "transfer"] }, name: string, checkpoint: string, switch: boolean, replacementPrimary: string, targetCandidate: string, sourceRevision: integer, sourceFrameId: string, sourceLayerId: string, targetFrameId: string, targetLayerId: string, selector: SELECTOR_SCHEMA, simulate: boolean, assertions: ASSERTIONS_SCHEMA }, required: ["action"], additionalProperties: false },
      execute: safe((i) => controller.candidateCommand(i)),
    },
    {
      name: "recipe",
      description: "Compile a versioned transparent agent recipe to ordinary editor operations, then simulate or apply it. Returns the resolved operations. candidate-region uses guarded candidate transfer.",
      inputSchema: { type: "object", properties: { ...guard, mode: { enum: ["simulate", "apply"] }, recipe: { type: "object" }, assertions: ASSERTIONS_SCHEMA, label: string }, required: ["documentId", "expectedRevision", "requestId", "mode", "recipe"], additionalProperties: false },
      execute: safe((i) => controller.recipe(i)),
    },
    {
      name: "history",
      description:
        "Undo, redo, retain or restore a checkpoint. Every history action INCLUDING checkpoint gets a new monotonic revision; use its returned revision on the next call.",
      inputSchema: object(
        {
          ...guard,
          action: { enum: ["undo", "redo", "checkpoint", "restore"] },
          name: string,
        },
        ["documentId", "expectedRevision", "requestId", "action"],
      ),
      execute: safe((i) => controller.history(i)),
    },
  ];
}
export function installPixelArtTools(controller, options = {}) {
  return installWebMcpTools({
    namespace: "rdr.pixel_art",
    tools: pixelArtTools(controller),
    ...options,
  });
}
