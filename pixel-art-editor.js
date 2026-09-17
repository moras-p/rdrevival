import { createAssetPlugins } from "./rdx/src/pixel-art/revival-plugins.js";
import { mapPalette } from "./rdx/src/pixel-art/game-assets.js";
import { DIRECTION_FIELDS } from "./rdx/src/pixel-art/direction.js";
import { ArtController } from "./rdx/src/pixel-art/controller.js";
import {
  encodeProject,
  decodeProject,
  composite,
  requireArt,
} from "./rdx/src/pixel-art/document.js";
import {
  readImageFile,
  rgbaPixels,
  imageCanvas,
} from "./rdx/src/pixel-art/image-io.js";
import { installPixelArtTools } from "./rdx/src/pixel-art/webmcp.js";
import { indicesToRuns, resolveSelector } from "./rdx/src/pixel-art/selectors.js";
import { RevivalPixelArtMapPreview } from "./rdx/src/pixel-art/revival-preview.js";
import { mountPixelArtEditorShell } from "./rdx/src/pixel-art/ui/shell.js";
import { PixelArtEditorUI } from "./rdx/src/pixel-art/ui/editor-ui.js";

const editorRoot = document.getElementById("pixel-art-editor-root");
mountPixelArtEditorShell(editorRoot);
const ui = new PixelArtEditorUI(editorRoot);
const $ = (id) => document.getElementById(id),
  canvas = $("art-canvas"),
  ctx = canvas.getContext("2d");
let tool = "pencil",
  color = 1,
  bgColor = 0,
  selection = null,
  selectionSelector = null,
  selectionContour = null,
  pixelClipboard = null,
  pendingTransform = null,
  gesture = null,
  fileHandle = null,
  playing = false,
  timer = null,
  autosaveTimer = null,
  saveSerial = 0;
const productionPreviewProvider = new RevivalPixelArtMapPreview();
const controller = new ArtController({
  plugins: createAssetPlugins(),
  pluginContext: { productionPreviewProvider },
  onChange: () => {
    render();
    scheduleSave();
  },
  onView: showView,
});
// A shared developer handle also supports bounded browser integration checks.
globalThis.rdrPixelArt = controller;
function message(text, error = false) {
  ui.showToast(text, { error, persistent: error });
}
function run(fn) {
  return async (event) => {
    try {
      await fn(event);
    } catch (e) {
      message(`${e.code ?? "ERROR"}: ${e.message}`, true);
    }
  };
}
function command(ops) {
  pendingTransform = null;
  return controller.apply({ ...controller.guard(), ops });
}
function target() {
  return {
    frameId: controller.selectedFrame,
    layerId: controller.selectedLayer,
  };
}
function selectorForSelection() {
  requireArt(selectionSelector || selection, "SELECTION", "Select pixels first");
  return selectionSelector ?? { type: "rect", rect: selection };
}
function clearSelectionState() {
  selection = null;
  selectionSelector = null;
  selectionContour = null;
  $("selection-status").textContent = "No selection";
}
function inspectSelection(selector = selectorForSelection()) {
  return controller.inspect({
    documentId: controller.store.document.id,
    expectedRevision: controller.store.document.revision,
    ...target(),
    selector,
    facts: ["bounds", "counts", "contour"],
  });
}
function setSelectionSelector(selector, mode = $("selection-mode")?.value ?? "replace") {
  let next = selector;
  if (selectionSelector && mode === "add") next = { type: "union", selectors: [selectionSelector, selector] };
  if (selectionSelector && mode === "subtract") next = { type: "subtract", base: selectionSelector, subtract: selector };
  const inspected = inspectSelection(next);
  selectionSelector = next;
  selection = inspected.facts.bounds;
  selectionContour = inspected.facts.contour ?? null;
  pendingTransform = null;
  $("selection-status").textContent = selection
    ? `${inspected.facts.counts.selected} px · [${selection.join(", ")}]`
    : "Empty selection";
  drawCanvas();
  return inspected;
}
function shiftSelectionSelector(selector, dx, dy) {
  if (!selector || typeof selector !== "object") return null;
  if (selector.type === "handle") return null;
  const next = structuredClone(selector);
  const shiftRect = (rect) => [rect[0] + dx, rect[1] + dy, rect[2], rect[3]];
  if (next.rect) next.rect = shiftRect(next.rect);
  if (next.region) next.region = shiftRect(next.region);
  if (Number.isInteger(next.x)) next.x += dx;
  if (Number.isInteger(next.y)) next.y += dy;
  if (next.within) next.within = shiftSelectionSelector(next.within, dx, dy);
  if (next.selector) next.selector = shiftSelectionSelector(next.selector, dx, dy);
  if (Array.isArray(next.selectors)) next.selectors = next.selectors.map((entry) => shiftSelectionSelector(entry, dx, dy)).filter(Boolean);
  if (next.base) next.base = shiftSelectionSelector(next.base, dx, dy);
  if (next.subtract) next.subtract = shiftSelectionSelector(next.subtract, dx, dy);
  return next;
}
function refreshSelection() {
  if (!selectionSelector) return;
  try { setSelectionSelector(selectionSelector, "replace"); }
  catch { clearSelectionState(); }
}
function selectionTransform(action, extra = {}) {
  return {
    type: "transform_selection",
    action,
    ...target(),
    selector: selectorForSelection(),
    clipping: "reject",
    collision: "overwrite",
    anchorPolicy: "preserve",
    ...extra,
  };
}
function simulateTransform(op) {
  const d = controller.store.document;
  return controller.simulate({ documentId: d.id, expectedRevision: d.revision, ops: [op] });
}
function applySelectionTransform(action, extra = {}, commitNow = false) {
  const op = selectionTransform(action, extra), preview = simulateTransform(op);
  requireArt(preview.wouldSucceed, preview.error?.code ?? "TRANSFORM", preview.error?.message ?? "Transform would fail");
  const changed = preview.delta?.changedPixels ?? 0, key=JSON.stringify(op);
  if (!commitNow && $("preview-first")?.checked && pendingTransform?.key !== key) {
    pendingTransform={key,op,preview}; $("transform-preview").textContent=`Preview ${action} · ${changed} px · click again to apply`; drawCanvas(); return preview;
  }
  pendingTransform=null; $("transform-preview").textContent = `${action} · ${changed} px applied`;
  command([op]);
  if ((action === "translate" || action === "copy-translate") && selectionSelector) selectionSelector = shiftSelectionSelector(selectionSelector, Number(extra.dx) || 0, Number(extra.dy) || 0);
  refreshSelection(); return preview;
}
function button(label, fn) {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = run(fn);
  return b;
}
function onionCanvas(doc, frameId, tint) {
  const base=imageCanvas(doc.width,doc.height,rgbaPixels(doc,frameId)), out=document.createElement("canvas");out.width=doc.width;out.height=doc.height;const c=out.getContext("2d");c.drawImage(base,0,0);c.globalCompositeOperation="source-atop";c.fillStyle=tint;c.fillRect(0,0,out.width,out.height);c.globalCompositeOperation="source-over";return out;
}
function drawCanvas(previewFrame = null) {
  const d = controller.store.document,
    f =
      d.frames.find(
        (f) => f.id === (previewFrame ?? controller.selectedFrame),
      ) ?? d.frames[0],
    z = Number($("zoom").value);
  canvas.width = d.width * z;
  canvas.height = d.height * z;
  ctx.imageSmoothingEnabled = false;
  const frameIndex = d.frames.indexOf(f), onionRange=Math.max(1,Math.min(8,Number($("onion-range").value)||1)), onionAlpha=Number($("onion-opacity").value)||0.25;
  if ($("onion").checked) for(let n=onionRange;n>=1;n--){const at=frameIndex-n;if(at<0)continue;ctx.globalAlpha=onionAlpha*(1-(n-1)/(onionRange+1));ctx.drawImage(onionCanvas(d,d.frames[at].id,$("onion-prev-color").value),0,0,canvas.width,canvas.height);}
  if ($("onion-next").checked) for(let n=onionRange;n>=1;n--){const at=frameIndex+n;if(at>=d.frames.length)continue;ctx.globalAlpha=onionAlpha*(1-(n-1)/(onionRange+1));ctx.drawImage(onionCanvas(d,d.frames[at].id,$("onion-next-color").value),0,0,canvas.width,canvas.height);}
  ctx.globalAlpha=1;
  ctx.drawImage(
    imageCanvas(d.width, d.height, rgbaPixels(d, f.id)),
    0,
    0,
    canvas.width,
    canvas.height,
  );
  if ($("grid").checked && z >= 5) {
    ctx.strokeStyle = "#0b101844";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= d.width; x++) {
      ctx.moveTo(x * z + 0.5, 0);
      ctx.lineTo(x * z + 0.5, canvas.height);
    }
    for (let y = 0; y <= d.height; y++) {
      ctx.moveTo(0, y * z + 0.5);
      ctx.lineTo(canvas.width, y * z + 0.5);
    }
    ctx.stroke();
  }
  if (selection) {
    ctx.strokeStyle = "#b5e68c";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(
      selection[0] * z,
      selection[1] * z,
      selection[2] * z,
      selection[3] * z,
    );
    ctx.setLineDash([]);
    if (selectionContour?.innerRuns) {
      ctx.fillStyle = "#b5e68c88";
      for (const [y, x, length] of selectionContour.innerRuns) {
        for (let px = x; px < x + length; px++) ctx.fillRect(px * z, y * z, Math.max(1, Math.min(2, z)), Math.max(1, Math.min(2, z)));
      }
    }
  }
  if (pendingTransform?.preview?.delta?.bounds) {
    const [px,py,pw,ph]=pendingTransform.preview.delta.bounds;ctx.strokeStyle="#f5c575";ctx.lineWidth=2;ctx.setLineDash([2,2]);ctx.strokeRect(px*z,py*z,pw*z,ph*z);ctx.setLineDash([]);
  }
  ctx.strokeStyle = "#f5c575";
  ctx.beginPath();
  const ax = f.anchor[0] * z + z / 2,
    ay = f.anchor[1] * z + z / 2;
  ctx.moveTo(ax - 5, ay);
  ctx.lineTo(ax + 5, ay);
  ctx.moveTo(ax, ay - 5);
  ctx.lineTo(ax, ay + 5);
  ctx.stroke();
  const native = $("native-preview");
  native.width = d.width;
  native.height = d.height;
  native
    .getContext("2d")
    .drawImage(imageCanvas(d.width, d.height, rgbaPixels(d, f.id)), 0, 0);
  $("zoom-value").textContent = `${z}×`;
}
function render() {
  const d = controller.store.document;
  if (!d.frames.some((f) => f.id === controller.selectedFrame))
    controller.selectedFrame = d.frames[0].id;
  if (!d.layers.some((l) => l.id === controller.selectedLayer))
    controller.selectedLayer = d.layers[0].id;
  color = Math.min(color, d.palette.length - 1);
  if (d.palettePolicy && !d.palettePolicy.allowedIndices.includes(color)) color = d.palettePolicy.allowedIndices.find(i => i > 0) ?? 0;
  const usedPalette = new Set(composite(d, controller.selectedFrame).filter(i => i !== 0));
  const activeRamp = (d.styleProfile?.ramps ?? []).find(r => r.name === $("ramp-select").value);
  $("doc-title").textContent = d.id;
  $("dimensions").textContent =
    `${d.width} × ${d.height} px · ${d.frames.length} ${d.frames.length === 1 ? "frame" : "frames"}`;
  $("revision").textContent = `Revision ${d.revision}`;
  $("resize-w").value = d.width;
  $("resize-h").value = d.height;
  $("undo").disabled = !controller.store.undoStack.length;
  $("redo").disabled = !controller.store.redoStack.length;
  $("palette").replaceChildren(
    ...d.palette.flatMap((p, i) => {
      if (d.palettePolicy && !d.palettePolicy.allowedIndices.includes(i)) return [];
      const b = button("", () => {
        color = i;
        render();
      });
      b.oncontextmenu = (event) => { event.preventDefault(); bgColor = i; render(); };
      b.style.background = `rgba(${p.join(",")})`;
      b.title = `${i}: ${p.join(", ")}${d.paletteLocks.includes(i) ? " · locked" : ""}`;
      b.setAttribute("aria-label", b.title);
      b.disabled = !!d.palettePolicy && !d.palettePolicy.allowedIndices.includes(i);
      b.classList.toggle("active", color === i);
      b.classList.toggle("used", usedPalette.has(i));
      b.classList.toggle("unused", i !== 0 && !usedPalette.has(i));
      b.classList.toggle("ramp-member", !!activeRamp?.indices.includes(i));
      return b;
    }),
  );
  const policy = d.palettePolicy;
  $("palette-policy-status").textContent = policy ? `${policy.name} · fixed · ≤${policy.maxColors} opaque colors/frame` : "Editable palette · no fixed asset contract";
  $("fix-palette").disabled = !!policy;
  $("fix-palette").hidden = !!policy;
  $("color-budget-control").hidden = !!policy;
  $("color-budget").disabled = !!policy;
  if (policy) $("color-budget").value = policy.maxColors;
  const boundPlugin = controller.plugins.list().find(p => p.id === controller.plugins.documentId(d));
  $("production-export").disabled = !boundPlugin?.capabilities.productionExport;
  $("production-export").title = boundPlugin?.capabilities.productionExport ? "Export through the bound game asset plugin" : "This asset has no gameplay export adapter; save an editable project or PNG";
  $("set-color").disabled = !!policy || d.paletteLocks.includes(color) || color === 0;
  $("lock-color").disabled = !!policy;
  for (const field of DIRECTION_FIELDS) if (document.activeElement !== $("direction-" + field)) $("direction-" + field).value = d.artDirection?.[field] ?? "";
  $("color-label").textContent = `Index ${color}`;
  $("fg-index").textContent = color;
  bgColor = Math.min(bgColor, d.palette.length - 1);
  $("bg-index").textContent = bgColor;
  const rampValue = $("ramp-select").value;
  $("ramp-select").replaceChildren(new Option("Auto ramp", ""), ...(d.styleProfile?.ramps ?? []).map((r, i) => new Option(r.name ?? `Ramp ${i + 1}`, r.name ?? String(i))));
  if ([...$("ramp-select").options].some(o => o.value === rampValue)) $("ramp-select").value = rampValue;
  const mutablePalette = !d.palettePolicy;
  for (const id of ["palette-add", "palette-remove", "palette-left", "palette-right"]) $(id).disabled = !mutablePalette;
  $("color").value =
    "#" +
    d.palette[color]
      .slice(0, 3)
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  $("lock-color").checked = d.paletteLocks.includes(color);
  $("layers").replaceChildren(
    ...d.layers.map((l) => {
      const row = document.createElement("div");
      row.className = "row";
      const b = button(l.name, () => {
        controller.selectedLayer = l.id;
        clearSelectionState();
        render();
      });
      b.classList.toggle("active", l.id === controller.selectedLayer);
      const visible = document.createElement("input");
      visible.type = "checkbox";
      visible.checked = l.visible;
      visible.title = "Visible";
      visible.onchange = run(() =>
        command([{ type: "layer", layerId: l.id, visible: visible.checked }]),
      );
      const lock = button(l.locked ? "Locked" : "Lock", () =>
        command([{ type: "layer", layerId: l.id, locked: !l.locked }]),
      );
      const role = document.createElement("select");
      role.title = "Semantic authoring role";
      for (const value of ["generic", "silhouette/base", "shadow", "light", "accent", "temporary-guide"]) role.append(new Option(value, value));
      role.value = l.role ?? "generic";
      role.onchange = run(() => command([{ type: "layer", layerId: l.id, role: role.value }]));
      row.draggable = true; row.dataset.layerId = l.id;
      row.ondragstart = (event) => event.dataTransfer.setData("text/x-rdr-layer", l.id);
      row.ondragover = (event) => { if (event.dataTransfer.types.includes("text/x-rdr-layer")) event.preventDefault(); };
      row.ondrop = run((event) => { event.preventDefault(); const source=event.dataTransfer.getData("text/x-rdr-layer"); if(!source||source===l.id)return; const ids=d.layers.map(x=>x.id),from=ids.indexOf(source),to=ids.indexOf(l.id);ids.splice(from,1);ids.splice(to,0,source);command([{type:"reorder_layers",layerIds:ids}]); });
      row.append(visible, b, role, lock);
      return row;
    }),
  );
  $("frames").replaceChildren(
    ...d.frames.map((f, n) => {
      const b = button("", () => {
        stop();
        controller.selectedFrame = f.id;
        clearSelectionState();
        render();
      });
      const thumb = imageCanvas(d.width, d.height, rgbaPixels(d, f.id));
      thumb.style.width = `${d.width * 2}px`;
      thumb.style.height = `${d.height * 2}px`;
      const label = document.createElement("span"), memberships=d.clips.flatMap(c=>c.frameIds.map((id,i)=>id===f.id?`${c.id}:${c.durations[i]}ms`:null).filter(Boolean));
      label.textContent = `${String(n + 1).padStart(2, "0")} · ${f.id}${memberships.length ? ` · ${memberships.join(" / ")}` : ""}`;
      b.append(thumb, label);
      b.classList.toggle("active", f.id === controller.selectedFrame);
      b.draggable=true; b.ondragstart=(event)=>event.dataTransfer.setData("text/x-rdr-frame",f.id); b.ondragover=(event)=>{if(event.dataTransfer.types.includes("text/x-rdr-frame"))event.preventDefault();}; b.ondrop=run((event)=>{event.preventDefault();const source=event.dataTransfer.getData("text/x-rdr-frame");if(!source||source===f.id)return;const ids=d.frames.map(x=>x.id),from=ids.indexOf(source),to=ids.indexOf(f.id);ids.splice(from,1);ids.splice(to,0,source);command([{type:"reorder_frames",frameIds:ids}]);});
      return b;
    }),
  );
  const previousTargetFrame = $("cel-target-frame").value, previousTargetLayer = $("cel-target-layer").value;
  $("cel-target-frame").replaceChildren(...d.frames.map((frame, i) => new Option(`${i + 1} · ${frame.id}`, frame.id)));
  $("cel-target-layer").replaceChildren(...d.layers.map(layer => new Option(layer.name, layer.id)));
  $("cel-target-frame").value = d.frames.some(f => f.id === previousTargetFrame) ? previousTargetFrame : controller.selectedFrame;
  $("cel-target-layer").value = d.layers.some(l => l.id === previousTargetLayer) ? previousTargetLayer : controller.selectedLayer;
  const matrix = document.createElement("table"); matrix.className = "cel-table";
  const head = document.createElement("tr"); head.append(document.createElement("th"));
  for (const [i, frame] of d.frames.entries()) { const th=document.createElement("th"); th.textContent=String(i+1); th.title=frame.id; head.append(th); }
  matrix.append(head);
  for (const layer of d.layers) {
    const row=document.createElement("tr"), th=document.createElement("th"); th.textContent=layer.name; row.append(th);
    for (const frame of d.frames) {
      const td=document.createElement("td"), b=button(frame.cels[layer.id].some(v=>v!==0) ? "●" : "·", () => { controller.selectedFrame=frame.id; controller.selectedLayer=layer.id; clearSelectionState(); render(); });
      b.title=`${frame.id} / ${layer.id}`; b.classList.toggle("active", frame.id===controller.selectedFrame && layer.id===controller.selectedLayer); td.append(b); row.append(td);
    }
    matrix.append(row);
  }
  $("cel-matrix").replaceChildren(matrix);
  const f = d.frames.find((f) => f.id === controller.selectedFrame);
  $("anchor-x").value = f.anchor[0];
  $("anchor-y").value = f.anchor[1];
  const clip = d.clips[0];
  $("duration").value = clip?.durations[clip.frameIds.indexOf(f.id)] ?? 100;
  if (document.activeElement !== $("clip-json"))
    $("clip-json").value = JSON.stringify(clip, null, 2);
  if (document.activeElement !== $("layout-json"))
    $("layout-json").value = JSON.stringify(d.layout, null, 2);
  $("constraints").textContent =
    `${d.constraints.protected.length} protected regions · ${d.constraints.frameIds ? "selected frames only" : "all frames editable"}`;
  $("references").replaceChildren(
    ...d.references.map((r) => {
      const b = button(`${r.name ?? r.id} · ${r.role} · ${r.policy}`, () =>
        controller.view({ mode: "reference", referenceId: r.id, zoom: 1 }),
      );
      b.title = r.notes || `${r.role}: ${r.policy}`;
      return b;
    }),
  );
  $("authoring-stage").value = d.authoring?.stage ?? "silhouette";
  $("authoring-status").textContent = `Locked: ${(d.authoring?.lockedStages ?? []).join(", ") || "none"}`;
  if (document.activeElement !== $("style-profile-json")) $("style-profile-json").value = JSON.stringify(d.styleProfile ?? {}, null, 2);
  const candidate = controller.candidateState();
  const selectedCandidate = $("candidate-select").value;
  $("candidate-select").replaceChildren(...candidate.candidates.map(c => new Option(`${c.primary ? "★ " : ""}${c.name} · r${c.revision}`, c.name)));
  $("candidate-select").value = candidate.candidates.some(c => c.name === selectedCandidate) ? selectedCandidate : candidate.active;
  $("candidate-status").textContent = `Active ${candidate.active} · primary ${candidate.primary} · ${candidate.candidates.length}/4 live variants`;
  $("candidate-transfer").disabled = $("candidate-select").value === candidate.active || !selection;
  const checkpointValue = $("handoff-baseline").value;
  $("handoff-baseline").replaceChildren(new Option("None", ""), ...[...controller.store.checkpoints.keys()].map(name => new Option(name, name)));
  $("handoff-baseline").value = [...controller.store.checkpoints.keys()].includes(checkpointValue) ? checkpointValue : (d.handoff?.baselineCheckpoint ?? "");
  if (document.activeElement !== $("handoff-goal")) $("handoff-goal").value = d.handoff?.goal ?? "";
  if (document.activeElement !== $("handoff-notes")) $("handoff-notes").value = (d.handoff?.unresolvedNotes ?? []).join("\n");
  if (document.activeElement !== $("handoff-next")) $("handoff-next").value = d.handoff?.nextAction ?? "";
  $("handoff-status").textContent = `${candidate.active} · ${d.authoring?.stage ?? "?"} · ${d.handoff?.acceptedRegions?.length ?? 0} accepted region(s) · last review ${d.handoff?.lastReviewCheckpoint ?? "checkpoint?"}@${d.handoff?.lastReviewRevision ?? "?"}`;
  const previewPlugin = controller.plugins.list().find(p => p.id === controller.plugins.documentId(d));
  const previewReady = !!previewPlugin?.capabilities.nativePreview;
  $("production-preview").disabled = !previewReady;
  $("preview-capability").textContent = previewReady ? `${previewPlugin.label}: native Live-map substitution available.` : "Bind a preview-capable production asset plugin to use the real-map preview.";
  if (previewReady && document.activeElement !== $("preview-options") && $("preview-options").dataset.plugin !== previewPlugin.id) {
    const defaults = Object.fromEntries(Object.entries(previewPlugin.previewOptionsSchema?.properties ?? {}).filter(([, spec]) => spec.default !== undefined).map(([key, spec]) => [key, spec.default]));
    $("preview-options").value = JSON.stringify(defaults, null, 2);
    $("preview-options").dataset.plugin = previewPlugin.id;
  }
  const checkpoint = $("checkpoints").value;
  $("checkpoints").replaceChildren(
    new Option("Choose checkpoint", ""),
    ...[...controller.store.checkpoints.keys()].map((n) => new Option(n, n)),
  );
  $("checkpoints").value = checkpoint;
  $("artifacts").replaceChildren(
    ...[...controller.artifacts.values()].map((a) => {
      const link = document.createElement("a");
      link.href = a.url;
      link.download = a.name;
      link.textContent = `↓ ${a.name} · r${a.revision}`;
      link.title = `SHA-256 ${a.hash}`;
      return link;
    }),
  );
  ui.updateDocument({
    document: d,
    selectedFrame: controller.selectedFrame,
    selectedLayer: controller.selectedLayer,
    selection,
    activeCandidate: candidate.active,
  });
  ui.updateHistoryLabel($("checkpoints").value);
  drawCanvas();
}
function showView(view) {
  $("observation-panel").hidden = false;
  $("view-label").textContent = `${view.mode} · revision ${view.revision} · candidate ${view.activeCandidate ?? controller.activeCandidate}`;
  $("art-observation").dataset.revision = String(view.revision);
  const summary = document.createElement("p");
  if (view.mode === "review") {
    summary.textContent = `${Object.entries(view.direction ?? {}).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(" · ")}${view.brief ? ` · ${view.brief}` : ""}`;
  } else if (view.production?.context) {
    const c = view.production.context;
    summary.textContent = `Native production frame · ${c.renderer} · SM${Number(c.submap).toString(16).toUpperCase().padStart(2, "0")} · slot ${c.actor?.slot ?? "?"}`;
  } else summary.textContent = "Each panel includes native pixels plus nearest-neighbour magnification.";
  const grid = document.createElement("div");
  grid.className = "observation-grid";
  for (const item of view.panels ?? []) {
    const card = document.createElement("figure");
    card.className = "observation-panel-card";
    const title = document.createElement("strong"); title.textContent = item.label;
    const native = item.canvas; native.title = `${item.label} · native ${native.width}×${native.height}`;
    card.append(title, native);
    if (view.zoom > 1) {
      const large = document.createElement("canvas");
      large.width = native.width * view.zoom; large.height = native.height * view.zoom;
      const c = large.getContext("2d"); c.imageSmoothingEnabled = false; c.drawImage(native, 0, 0, large.width, large.height);
      card.append(large);
    }
    if (item.note) { const note = document.createElement("small"); note.textContent = item.note; card.append(note); }
    grid.append(card);
  }
  $("art-observation").replaceChildren(summary, grid);
}

function point(e) {
  const r = canvas.getBoundingClientRect(),
    d = controller.store.document;
  return [
    Math.max(
      0,
      Math.min(
        d.width - 1,
        Math.floor(((e.clientX - r.left) * d.width) / r.width),
      ),
    ),
    Math.max(
      0,
      Math.min(
        d.height - 1,
        Math.floor(((e.clientY - r.top) * d.height) / r.height),
      ),
    ),
  ];
}
function brushPoints(x, y) {
  const d = controller.store.document, size = Math.max(1, Math.min(8, Number($("brush-size").value) || 1)), pattern = $("brush-pattern").value;
  const low = -Math.floor((size - 1) / 2), high = low + size - 1, base = [];
  for (let dy = low; dy <= high; dy++) for (let dx = low; dx <= high; dx++) {
    if (pattern === "cross" && dx !== 0 && dy !== 0) continue;
    if (pattern === "checker" && ((dx - low) + (dy - low)) % 2) continue;
    const px=x+dx, py=y+dy; if (px>=0 && py>=0 && px<d.width && py<d.height) base.push([px,py]);
  }
  const all = new Map();
  const add=(px,py)=>{ if(px>=0&&py>=0&&px<d.width&&py<d.height) all.set(`${px},${py}`,[px,py]); };
  for (const [px,py] of base) { add(px,py); if ($("symmetry-x").checked) add(d.width-1-px,py); if ($("symmetry-y").checked) add(px,d.height-1-py); if ($("symmetry-x").checked && $("symmetry-y").checked) add(d.width-1-px,d.height-1-py); }
  return [...all.values()];
}
function appendLinePath(from,to,path){
  let [x,y]=from,[tx,ty]=to,dx=Math.abs(tx-x),dy=-Math.abs(ty-y),sx=x<tx?1:-1,sy=y<ty?1:-1,err=dx+dy;
  for(;;){if(!path.length||path.at(-1)[0]!==x||path.at(-1)[1]!==y)path.push([x,y]);if(x===tx&&y===ty)break;const e=2*err;if(e>=dy){err+=dy;x+=sx;}if(e<=dx){err+=dx;y+=sy;}}
}
function pixelPerfectPath(points){
  const out=[];for(const point of points){out.push(point);while(out.length>=3){const a=out.at(-3),b=out.at(-2),c=out.at(-1),diagonal=Math.abs(a[0]-c[0])===1&&Math.abs(a[1]-c[1])===1,bridge=(b[0]===a[0]&&b[1]===c[1])||(b[0]===c[0]&&b[1]===a[1]);if(!(diagonal&&bridge))break;out.splice(out.length-2,1);}}return out;
}
function spanStroke(from, to, rows) {
  if (gesture?.path) appendLinePath(from,to,gesture.path);
  let [x, y] = from, [tx, ty] = to, dx = Math.abs(tx - x), dy = -Math.abs(ty - y), sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1, err = dx + dy;
  for (;;) {
    for (const [px,py] of brushPoints(x,y)) rows.push([py,px,[tool === "eraser" ? 0 : color]]);
    if (x === tx && y === ty) break;
    const e = 2 * err; if (e >= dy) { err += dy; x += sx; } if (e <= dx) { err += dx; y += sy; }
  }
}
function ellipseRows(region, index) {
  const [x0,y0,w,h]=region, points=new Map(), cx=x0+(w-1)/2, cy=y0+(h-1)/2, rx=Math.max(.5,(w-1)/2), ry=Math.max(.5,(h-1)/2);
  const steps=Math.max(12,Math.ceil(Math.PI*2*Math.max(rx,ry)*2));
  for(let n=0;n<steps;n++){const a=n*Math.PI*2/steps, x=Math.round(cx+rx*Math.cos(a)), y=Math.round(cy+ry*Math.sin(a)); points.set(`${x},${y}`,[y,x,[index]]);}
  return [...points.values()];
}
canvas.addEventListener(
  "pointerdown",
  run((e) => {
    if (e.button !== 0) return;
    stop();
    const p = point(e);
    canvas.setPointerCapture(e.pointerId);
    gesture = { start: p, last: p, rows: [], path: [], guard: controller.guard(), target: target(), selection: selection?.slice(), selector: selectionSelector, client: [e.clientX,e.clientY], scroll: [$("canvas-stage").scrollLeft,$("canvas-stage").scrollTop] };
    if (tool === "hand") { canvas.style.cursor="grabbing"; return; }
    if (tool === "eyedropper") {
      const d = controller.store.document; color = composite(d, controller.selectedFrame)[p[1] * d.width + p[0]]; gesture = null; render(); return;
    }
    if (tool === "wand") { setSelectionSelector({ type: "component", x: p[0], y: p[1], mode: $("wand-mode").value }); gesture=null; return; }
    if (tool === "pencil" || tool === "eraser") spanStroke(p, p, gesture.rows);
  }),
);
canvas.addEventListener("pointermove", (e) => {
  const p = point(e); $("coordinates").textContent = `X ${p[0]} · Y ${p[1]}`; if (!gesture) return;
  if (tool === "hand") { const stage=$("canvas-stage"); stage.scrollLeft=gesture.scroll[0]-(e.clientX-gesture.client[0]); stage.scrollTop=gesture.scroll[1]-(e.clientY-gesture.client[1]); return; }
  if (tool === "pencil" || tool === "eraser") {
    spanStroke(gesture.last, p, gesture.rows);
    const z = Number($("zoom").value), palette = controller.store.document.palette; ctx.fillStyle = tool === "eraser" ? "#303b49" : `rgba(${palette[color].join(",")})`;
    for(const [px,py] of brushPoints(p[0],p[1])) ctx.fillRect(px*z,py*z,z,z);
  }
  if (tool === "selection") { selection = [Math.min(p[0],gesture.start[0]),Math.min(p[1],gesture.start[1]),Math.abs(p[0]-gesture.start[0])+1,Math.abs(p[1]-gesture.start[1])+1]; drawCanvas(); }
  gesture.last = p;
});
canvas.addEventListener(
  "pointerup",
  run((e) => {
    if (!gesture) return;
    const g=gesture; gesture=null; canvas.style.cursor=tool === "hand" ? "grab" : "crosshair"; if(tool==="hand") return;
    const p=point(e), r=[Math.min(p[0],g.start[0]),Math.min(p[1],g.start[1]),Math.abs(p[0]-g.start[0])+1,Math.abs(p[1]-g.start[1])+1];
    let op;
    if(tool==="pencil"||tool==="eraser") {
      const rows=$("pixel-perfect").checked ? pixelPerfectPath(g.path).flatMap(([x,y])=>brushPoints(x,y).map(([px,py])=>[py,px,[tool==="eraser"?0:color]])) : g.rows; op={type:"pixels",rows};
    }
    if(tool==="fill") op={type:"fill",x:p[0],y:p[1],color};
    if(tool==="line") op={type:"line",x1:g.start[0],y1:g.start[1],x2:p[0],y2:p[1],color};
    if(tool==="rectangle") op={type:"rectangle",rect:r,color,filled:e.shiftKey || $("shape-filled").checked};
    if(tool==="ellipse") op={type:"pixels",rows:ellipseRows(r,color)};
    if(tool==="selection") { setSelectionSelector({type:"rect",rect:r}); return; }
    if(tool==="move") {
      requireArt(g.selector || g.selection,"SELECTION","Select pixels first");
      const dx=p[0]-g.start[0],dy=p[1]-g.start[1]; if(dx||dy){ const move={type:"transform_selection",action:"translate",...g.target,selector:g.selector??{type:"rect",rect:g.selection},dx,dy,collision:"overwrite",clipping:"reject",anchorPolicy:"preserve"}; controller.apply({...g.guard,ops:[move]}); if (selectionSelector) selectionSelector = shiftSelectionSelector(selectionSelector, dx, dy); refreshSelection(); }
      return;
    }
    if(op){ try{controller.apply({...g.guard,ops:[{...g.target,...op}]});} finally{drawCanvas();} }
  }),
);
canvas.addEventListener("pointercancel",()=>{ gesture=null; canvas.style.cursor=tool === "hand" ? "grab" : "crosshair"; drawCanvas(); });
ui.bind({
  onToolChange: (nextTool) => {
    tool = nextTool;
    canvas.style.cursor = tool === "hand" ? "grab" : "crosshair";
  },
});
$("grid").onchange = () => drawCanvas();
$("onion").onchange = () => drawCanvas();
$("onion-next").onchange = () => drawCanvas();
for(const id of ["onion-range","onion-opacity","onion-prev-color","onion-next-color"]) $(id).oninput=()=>drawCanvas();
$("zoom").oninput = () => drawCanvas();
$("fit-view").onclick = () => { const d=controller.store.document, stage=$("canvas-stage"), z=Math.max(1,Math.min(20,Math.floor(Math.min((stage.clientWidth-50)/d.width,(stage.clientHeight-50)/d.height)))); $("zoom").value=String(z); drawCanvas(); };
$("canvas-stage").addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey || e.altKey)) return; e.preventDefault();
  const stage=$("canvas-stage"), old=Number($("zoom").value), next=Math.max(1,Math.min(20,old+(e.deltaY<0?1:-1))); if(next===old)return;
  const rect=canvas.getBoundingClientRect(), px=(e.clientX-rect.left)/old, py=(e.clientY-rect.top)/old; $("zoom").value=String(next); drawCanvas();
  const nr=canvas.getBoundingClientRect(); stage.scrollLeft += (nr.left + px*next) - e.clientX; stage.scrollTop += (nr.top + py*next) - e.clientY;
},{passive:false});
$("undo").onclick = run(() => {
  controller.history({ ...controller.guard(), action: "undo" });
  render();
});
$("redo").onclick = run(() => {
  controller.history({ ...controller.guard(), action: "redo" });
  render();
});
$("checkpoint").onclick = run(() => {
  const name = `checkpoint-${controller.store.document.revision}`;
  controller.history({ ...controller.guard(), action: "checkpoint", name });
  render();
  $("checkpoints").value = name;
  message(`Retained ${name}`);
});
$("restore").onclick = run(() =>
  controller.history({
    ...controller.guard(),
    action: "restore",
    name: $("checkpoints").value,
  }),
);
$("checkpoints").onchange = () => ui.updateHistoryLabel($("checkpoints").value);
function copySelectionPixels() {
  const d=controller.store.document,{frameId,layerId}=target(),frame=d.frames.find(f=>f.id===frameId),indices=resolveSelector(d,{frameId,layerId,selector:selectorForSelection()}), bounds=selection;
  requireArt(indices.length>0 && bounds,"SELECTION","Selection is empty");
  const set=new Set(indices), rows=[];
  for(let y=bounds[1];y<bounds[1]+bounds[3];y++){ let run=null; for(let x=bounds[0];x<bounds[0]+bounds[2];x++){const at=y*d.width+x;if(!set.has(at)){run=null;continue;} if(run && run[1]+run[2].length===x) run[2].push(frame.cels[layerId][at]); else {run=[y,x,[frame.cels[layerId][at]]];rows.push(run);} }}
  pixelClipboard={origin:[bounds[0],bounds[1]],bounds:bounds.slice(),rows}; $("transform-preview").textContent=`Copied ${indices.length} px`; return pixelClipboard;
}
$("flip-h").onclick = run(() => applySelectionTransform("mirror-horizontal"));
$("flip-v").onclick = run(() => applySelectionTransform("mirror-vertical"));
$("rotate-left").onclick = run(() => applySelectionTransform("rotate-270"));
$("rotate-right").onclick = run(() => applySelectionTransform("rotate-90"));
$("scale-selection").onclick = run(() => applySelectionTransform("scale-integer", { factor:Number($("selection-scale").value) }));
$("scale-ratio-selection").onclick = run(() => applySelectionTransform("scale-nearest", { numerator:Number($("scale-num").value), denominator:Number($("scale-den").value) }));
$("clear-selection").onclick = run(() => applySelectionTransform("clear"));
$("copy-selection").onclick = run(() => copySelectionPixels());
$("cut-selection").onclick = run(() => { copySelectionPixels(); applySelectionTransform("clear"); });
$("paste-selection").onclick = run(() => {
  requireArt(pixelClipboard,"CLIPBOARD","Nothing copied yet"); const origin=selection ? [selection[0],selection[1]] : pixelClipboard.origin, dx=origin[0]-pixelClipboard.origin[0],dy=origin[1]-pixelClipboard.origin[1];
  const rows=pixelClipboard.rows.map(([y,x,values])=>[y+dy,x+dx,values.slice()]); command([{type:"pixels",...target(),rows}]); setSelectionSelector({type:"rect",rect:[origin[0],origin[1],pixelClipboard.bounds[2],pixelClipboard.bounds[3]]},"replace");
});
$("swap-colors").onclick = () => { [color,bgColor]=[bgColor,color]; render(); };
function shade(step){const selector=selectionSelector??{type:"color",indices:[color]};return command([{type:"shade_step",...target(),selector,step,ramp:$("ramp-select").value||undefined,fallback:"clamp"}]);}
$("shade-down").onclick=run(()=>{shade(-1);refreshSelection();}); $("shade-up").onclick=run(()=>{shade(1);refreshSelection();});
$("select-ramp-pixels").onclick=run(()=>{const name=$("ramp-select").value;requireArt(name,"PALETTE","Choose a named ramp");const ramp=controller.store.document.styleProfile?.ramps?.find(r=>r.name===name);requireArt(ramp,"PALETTE","Unknown ramp");setSelectionSelector({type:"color",indices:ramp.indices},"replace");});
$("palette-add").onclick=run(()=>{const rgb=controller.store.document.palette[color].slice(0,3);command([{type:"palette_add",index:color+1,rgba:[...rgb,255]}]);color++;});
$("palette-remove").onclick=run(()=>{command([{type:"palette_remove",index:color}]);color=Math.max(1,color-1);});
function movePalette(delta){const d=controller.store.document,j=color+delta; if(color===0||j<=0||j>=d.palette.length)return;const order=d.palette.map((_,i)=>i);[order[color],order[j]]=[order[j],order[color]];command([{type:"palette_reorder",indices:order}]);color=j;}
$("palette-left").onclick=run(()=>movePalette(-1)); $("palette-right").onclick=run(()=>movePalette(1));
$("add-layer").onclick = run(() =>
  command([
    {
      type: "add_layer",
      id: `layer-${crypto.randomUUID().slice(0, 8)}`,
      name: `Layer ${controller.store.document.layers.length + 1}`,
    },
  ]),
);
$("duplicate-layer").onclick = run(() => {
  const source=controller.store.document.layers.find(l=>l.id===controller.selectedLayer),id=`layer-${crypto.randomUUID().slice(0,8)}`; command([{type:"duplicate_layer",layerId:source.id,id,name:`${source.name} copy`,afterLayerId:source.id}]); controller.selectedLayer=id;
});
$("delete-layer").onclick = run(() => {
  const d=controller.store.document, id=controller.selectedLayer; requireArt(d.layers.length>1,"TARGET","Keep at least one layer"); const next=d.layers.find(l=>l.id!==id).id; command([{type:"delete_layer",layerId:id}]); controller.selectedLayer=next; clearSelectionState();
});
function addFrame(duplicate) {
  const id = `frame-${crypto.randomUUID().slice(0, 8)}`,
    d = controller.store.document,
    clip = d.clips[0];
  const ops = [
    {
      type: "add_frame",
      id,
      ...(duplicate ? { sourceFrameId: controller.selectedFrame } : {}),
    },
  ];
  if (clip)
    ops.push({
      type: "clip",
      clip: {
        ...clip,
        frameIds: [...clip.frameIds, id],
        durations: [...clip.durations, 100],
      },
    });
  command(ops);
  controller.selectedFrame = id;
  render();
}
$("duplicate").onclick = run(() => addFrame(true));
$("add-frame").onclick = run(() => addFrame(false));
$("delete-frame").onclick = run(() => {
  const d=controller.store.document,id=controller.selectedFrame;requireArt(d.frames.length>1,"TARGET","Keep at least one frame");const next=d.frames.find(f=>f.id!==id).id;command([{type:"delete_frame",frameId:id}]);controller.selectedFrame=next;clearSelectionState();
});
function celAction(action){const tf=$("cel-target-frame").value,tl=$("cel-target-layer").value;return command([{type:"cel",action,sourceFrameId:controller.selectedFrame,sourceLayerId:controller.selectedLayer,targetFrameId:tf,targetLayerId:tl}]);}
$("cel-copy").onclick=run(()=>celAction("copy")); $("cel-move").onclick=run(()=>{celAction("move");clearSelectionState();}); $("cel-swap").onclick=run(()=>{celAction("swap");clearSelectionState();}); $("cel-clear").onclick=run(()=>command([{type:"cel",action:"clear",frameId:controller.selectedFrame,layerId:controller.selectedLayer,targetFrameId:controller.selectedFrame,targetLayerId:controller.selectedLayer}]));
function reorder(delta) {
  const d = controller.store.document,
    ids = d.frames.map((f) => f.id),
    i = ids.indexOf(controller.selectedFrame),
    j = i + delta;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  command([{ type: "reorder_frames", frameIds: ids }]);
}
$("frame-left").onclick = run(() => reorder(-1));
$("frame-right").onclick = run(() => reorder(1));
$("resize").onclick = run(() => {
  command([
    {
      type: "resize",
      width: Number($("resize-w").value),
      height: Number($("resize-h").value),
      fit: $("resize-fit").value,
      allowCrop: $("resize-crop").checked,
    },
  ]);
  clearSelectionState();
  render();
});
$("set-anchor").onclick = run(() =>
  command([
    {
      type: "anchor",
      frameId: controller.selectedFrame,
      anchor: [Number($("anchor-x").value), Number($("anchor-y").value)],
    },
  ]),
);
$("set-color").onclick = run(() => {
  const hex = $("color").value;
  command([
    {
      type: "palette",
      index: color,
      rgba: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(255),
    },
  ]);
});
$("lock-color").onchange = run(() => {
  const indices = controller.store.document.paletteLocks.filter(
    (i) => i !== color,
  );
  if ($("lock-color").checked) indices.push(color);
  command([{ type: "palette_locks", indices }]);
});
$("protect").onclick = run(() => {
  requireArt(selection, "SELECTION", "Select a region to protect");
  const constraints = controller.store.document.constraints;
  constraints.protected.push({ ...target(), rect: selection });
  command([{ type: "constraints", constraints }]);
});
$("scope").onclick = run(() =>
  command([
    {
      type: "constraints",
      constraints: {
        ...controller.store.document.constraints,
        frameIds: [controller.selectedFrame],
      },
    },
  ]),
);
$("clear-constraints").onclick = run(() =>
  command([
    {
      type: "constraints",
      constraints: { protected: [], frameIds: null, allowedPalette: null },
    },
  ]),
);
$("apply-clip").onclick = run(() =>
  command([{ type: "clip", clip: JSON.parse($("clip-json").value) }]),
);
$("apply-layout").onclick = run(() =>
  command([{ type: "layout", layout: JSON.parse($("layout-json").value) }]),
);
$("duration").onchange = run(() => {
  const clip = controller.store.document.clips[0],
    index = clip.frameIds.indexOf(controller.selectedFrame);
  requireArt(index >= 0, "CLIP", "Frame is not in this clip");
  clip.durations[index] = Number($("duration").value);
  command([{ type: "clip", clip }]);
});
function stop() {
  playing = false;
  clearTimeout(timer);
  $("play").textContent = "Play";
}
$("play").onclick = run(() => {
  if (playing) {
    stop();
    drawCanvas();
    return;
  }
  const d = controller.store.document,
    c = d.clips[0];
  requireArt(c, "CLIP", "Create a clip first");
  let indices = c.frameIds.map((_, i) => i);
  if (c.direction === "reverse") indices.reverse();
  if (c.direction === "ping-pong")
    indices = indices.concat(indices.slice(1, -1).reverse());
  playing = true;
  $("play").textContent = "Stop";
  let n = 0;
  function tick() {
    if (!playing) return;
    const i = indices[n];
    drawCanvas(c.frameIds[i]);
    timer = setTimeout(() => {
      n++;
      if (n === indices.length) {
        if (c.loop === "once") {
          stop();
          return;
        }
        n = 0;
      }
      tick();
    }, c.durations[i]);
  }
  tick();
});
$("sheet-view").onclick = run(() =>
  controller.view({ mode: "sheet", zoom: 2 }),
);
$("save-direction").onclick = run(() => command([{ type: "art_direction", direction: Object.fromEntries(DIRECTION_FIELDS.map(k => [k, $("direction-" + k).value])) }]));
$("fix-palette").onclick = run(() => {
  const d = controller.store.document;
  command([{ type: "palette_policy", policy: { name: "Fixed custom palette", source: "Current document palette", maxColors: Number($("color-budget").value), allowedIndices: d.palette.map((_, i) => i) } }]);
});
async function loadPalettes() {
  if (!Object.keys(controller.pluginContext.paletteEntries ?? {}).length) {
    const response = await fetch("./rdx/data/palettes.json");
    requireArt(response.ok, "PALETTE", "Could not load authoritative map palettes");
    controller.pluginContext.paletteEntries = await response.json();
  }
}
$("new-map-palette").onclick = run(async () => {
  await loadPalettes();
  const { palette, policy } = mapPalette(controller.pluginContext.paletteEntries, Number($("palette-map").value), $("palette-bank").value === "" ? null : Number($("palette-bank").value));
  const d = controller.store.document;
  await controller.documentCommand({ ...controller.guard(), action: "create", options: { width: d.width, height: d.height, palette, palettePolicy: policy } });
});
$("review").onclick = run(() => controller.view({ mode: "review", checkpoint: $("checkpoints").value, zoom: 4 }));
$("observe").onclick = run(() => controller.view({ mode: "asset", zoom: 8 }));
$("critique").onclick = run(() => controller.view({ mode: "critique", checkpoint: $("checkpoints").value || undefined, zoom: 6 }));
$("animation-review").onclick = run(() => controller.view({ mode: "animation-review", zoom: 5 }));
$("production-preview").onclick = run(() => controller.view({ mode: "production", zoom: 2, previewOptions: JSON.parse($("preview-options").value || "{}") }));
$("authoring-stage").onchange = run(() => command([{ type: "authoring_stage", stage: $("authoring-stage").value, lockCompleted: $("lock-authoring-stage").checked }]));
$("apply-style-profile").onclick = run(() => command([{ type: "style_profile", profile: JSON.parse($("style-profile-json").value || "{}") }]));
$("candidate-select").onchange = run(() => controller.candidateCommand({ ...controller.guard(), action: "switch", name: $("candidate-select").value }));
$("candidate-fork").onclick = run(() => {
  const name = $("candidate-name").value.trim();
  const result = controller.candidateCommand({ ...controller.guard(), action: "fork", name });
  $("candidate-name").value = ""; return result;
});
$("candidate-promote").onclick = run(() => controller.candidateCommand({ ...controller.guard(), action: "promote", name: $("candidate-select").value }));
$("candidate-delete").onclick = run(() => {
  const name = $("candidate-select").value, state = controller.candidateState();
  const replacementPrimary = name === state.primary ? state.candidates.find(c => c.name !== name)?.name : undefined;
  return controller.candidateCommand({ ...controller.guard(), action: "delete", name, replacementPrimary });
});
$("candidate-compare").onclick = run(() => {
  const source=$("candidate-select").value,target=controller.activeCandidate; requireArt(source!==target,"CANDIDATE","Choose another candidate to compare"); const result=controller.candidateCompare({source,target});
  $("candidate-compare-status").textContent=`${source} → ${target}\n${result.delta.changedPixels} changed px · ${result.delta.targets.length} cel(s)\nWarnings +${result.warnings.introduced.length} / -${result.warnings.removed.length}`; return result;
});
$("candidate-transfer").onclick = run(() => {
  const source=$("candidate-select").value,state=controller.candidateState(),sourceState=state.candidates.find(c=>c.name===source);requireArt(sourceState&&source!==state.active,"CANDIDATE","Choose another candidate as source");requireArt(selectionSelector||selection,"SELECTION","Select a region to transfer");
  return controller.candidateTransfer({...controller.guard(),sourceCandidate:source,targetCandidate:state.active,sourceRevision:sourceState.revision,sourceFrameId:controller.selectedFrame,sourceLayerId:controller.selectedLayer,targetFrameId:controller.selectedFrame,targetLayerId:controller.selectedLayer,selector:selectorForSelection(),label:"human candidate transfer"});
});
function handoffFromFields(extra={}) { const d=controller.store.document; return {...d.handoff,goal:$("handoff-goal").value,baselineCheckpoint:$("handoff-baseline").value||null,unresolvedNotes:$("handoff-notes").value.split("\n").map(v=>v.trim()).filter(Boolean),nextAction:$("handoff-next").value,lastReviewCheckpoint:$("checkpoints").value||d.handoff?.lastReviewCheckpoint||null,lastReviewRevision:d.revision,...extra}; }
$("save-handoff").onclick=run(()=>command([{type:"handoff",handoff:handoffFromFields()}]));
$("handoff-accept-selection").onclick=run(()=>{const d=controller.store.document,accepted=[...(d.handoff?.acceptedRegions??[])];accepted.push({name:`accepted-r${d.revision}-${accepted.length+1}`,selector:structuredClone(selectorForSelection())});return command([{type:"handoff",handoff:handoffFromFields({acceptedRegions:accepted})}]);});
$("close-view").onclick = () => {
  $("observation-panel").hidden = true;
};
$("validate").onclick = run(() => {
  const result = controller.analyze({
    checkpoint: $("checkpoints").value || undefined,
  });
  $("validation").textContent =
    `${result.errors.length} errors · ${result.warnings.length} warnings. ${
      result.warnings
        .slice(0, 8)
        .map((w) => `${w.code}${w.frameId ? " " + w.frameId : ""}`)
        .join("; ") ||
      "Mechanical checks passed. Art still needs visual review."
    }`;
  if (result.errors.length) {
    ui.openDock("output");
    message(`Validation failed with ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`, true);
  }
});
$("new").onclick = () => {
  $("new-dialog").showModal();
};
$("import").onclick = () => {
  $("import-dialog").showModal();
};
document
  .querySelectorAll("[data-close]")
  .forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
$("new-form").onsubmit = run(async (e) => {
  e.preventDefault();
  const form = new FormData(e.target),
    o = Object.fromEntries(form);
  for (const k of ["width", "height", "frameCount"]) o[k] = Number(o[k]);
  if (o.ratioW || o.ratioH) o.ratio = [Number(o.ratioW), Number(o.ratioH)];
  delete o.ratioW;
  delete o.ratioH;
  await controller.documentCommand({
    ...controller.guard(),
    action: "create",
    options: o,
  });
  clearSelectionState();
  render();
  $("new-dialog").close();
});
$("file").onchange = run(async () => {
  const file = $("file").files[0];
  if (!file) return;
  fileHandle = null;
  requireArt(file.size <= 40000000, "LIMIT", "File exceeds project size limit");
  const value = /\.(bin|rom|md)$/i.test(file.name) ? new Uint8Array(await file.arrayBuffer()) : file.type.startsWith("image/")
    ? await readImageFile(file)
    : await file.text();
  requireArt(file.size <= 40000000, "LIMIT", "File exceeds project size limit");
  fileHandle = controller.addHandle(value);
  $("file-info").textContent =
    value instanceof Uint8Array ? `${file.name} · ROM · ${file.size} bytes` : typeof value === "string"
      ? `${file.name} · ${file.size} bytes`
      : `${file.name} · ${value.width}×${value.height} · ${value.hash.slice(0, 12)}`;
  if (value instanceof Uint8Array) $("import-role").value = "asset-import";
  if (file.name.endsWith(".rdr-art.json")) $("import-role").value = "open";
  const plugin = controller.plugins.list().find(p => p.fileSuffixes?.some(suffix => file.name.endsWith(suffix)));
  if (plugin) { $("import-role").value = "asset-import"; $("asset-plugin").value = plugin.id; renderPluginOptions(); }
});
function slicing() {
  let o = JSON.parse($("slice-json").value);
  if (o.palettePolicy && typeof o.palettePolicy === "object") o.assetPalettePolicy = o.palettePolicy;
  if (o.frameWidth)
    o = {
      ...o,
      width: o.frameWidth,
      height: o.frameHeight,
      rectangles: o.frames,
    };
  return o;
}
$("slice-preview").onclick = run(() => {
  const image = controller.handles.get(fileHandle),
    o = slicing();
  requireArt(image?.rgba, "IMAGE", "Choose an image first");
  const c = $("slice-canvas");
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(imageCanvas(image.width, image.height, image.rgba), 0, 0);
  ctx.strokeStyle = "#f25cb1";
  ctx.lineWidth = 1;
  const rects =
    o.rectangles ??
    o.layout.cells.flatMap((id, n) =>
      id === null
        ? []
        : [
            {
              id,
              rect: [
                o.layout.marginX +
                  (n % o.layout.columns) * (o.width + o.layout.gapX),
                o.layout.marginY +
                  Math.floor(n / o.layout.columns) * (o.height + o.layout.gapY),
                o.width,
                o.height,
              ],
            },
          ],
    );
  rects.forEach((r) => ctx.strokeRect(...r.rect));
});
$("do-import").onclick = run(async () => {
  requireArt(fileHandle, "HANDLE", "Choose a file first");
  const action = $("import-role").value;
  if (action === "asset-import") await loadPalettes();
  const options =
    action === "reference" ? { role: $("reference-role").value, notes: `Imported as ${$("reference-role").value} reference` } :
    action === "asset-import" ? { pluginId: $("asset-plugin").value, ...JSON.parse($("plugin-options").value) } : action === "import-sheet"
      ? {
          ...slicing(),
          quantize: $("quantize").checked,
          preserveAtlas: true,
          fixedPalette: $("fixed-import").checked,
          palettePolicy: $("source-palette").checked ? "source" : "current",
        }
      : {
          ...target(),
          fit: $("fit").value,
          quantize: $("quantize").checked,
          newDocument: $("import-new-image").checked,
          fixedPalette: $("fixed-import").checked,
          palettePolicy: $("source-palette").checked ? "source" : "current",
        };
  await controller.documentCommand({
    ...controller.guard(),
    action,
    handle: fileHandle,
    options,
  });
  clearSelectionState();
  render();
  $("import-dialog").close();
});
async function exportAction(action, format) {
  const result = await controller.documentCommand({
    ...controller.guard(),
    action,
    format,
  });
  message(
    `Prepared ${result.artifacts.length} artifact(s). Use the download links in Exports.`,
  );
  render();
}
$("save").onclick = run(() => exportAction("save", "project"));
$("export").onclick = run(() =>
  exportAction(
    "export",
    controller.store.document.frames.length > 1 ? "sheet" : "png",
  ),
);
$("production-export").onclick = run(() => exportAction("production-export"));
$("report-export").onclick = run(() => exportAction("export", "report"));
document.addEventListener(
  "keydown",
  run((e) => {
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || document.querySelector("dialog[open]")) return;
    const mod=e.metaKey||e.ctrlKey,keyName=e.key.toLowerCase();
    if(mod && keyName==="z"){e.preventDefault();controller.history({...controller.guard(),action:e.shiftKey?"redo":"undo"});clearSelectionState();render();return;}
    if(mod && keyName==="c"){e.preventDefault();copySelectionPixels();return;}
    if(mod && keyName==="x"){e.preventDefault();copySelectionPixels();applySelectionTransform("clear");return;}
    if(mod && keyName==="v"){e.preventDefault();$("paste-selection").click();return;}
    if(e.key==="Delete"||e.key==="Backspace"){if(selectionSelector||selection){e.preventDefault();applySelectionTransform("clear");}return;}
    const arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(arrows[e.key]&&(selectionSelector||selection)){e.preventDefault();const [sx,sy]=arrows[e.key], step=e.shiftKey?8:1;applySelectionTransform("translate",{dx:sx*step,dy:sy*step},true);return;}
    const key={p:"pencil",e:"eraser",f:"fill",l:"line",r:"rectangle",s:"selection",w:"wand",o:"ellipse",h:"hand",m:"move",i:"eyedropper"}[keyName];
    if(key) ui.activateTool(key);
  }),
);
function db() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("rdr-pixel-art", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function persist(text) {
  const database = await db();
  try {
    await new Promise((resolve, reject) => {
      const tx = database.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(text, "current");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Autosave aborted"));
    });
  } finally {
    database.close();
  }
}
function scheduleSave() {
  const serial = ++saveSerial;
  $("saved-status").textContent = "Unsaved changes";
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    try {
      await persist(controller.sessionText());
      if (serial === saveSerial)
        $("saved-status").textContent = "Saved locally";
    } catch (e) {
      $("saved-status").textContent = "Autosave failed · export project";
      message(`Autosave failed: ${e.message}`, true);
    }
  }, 350);
}
async function restoreDraft() {
  try {
    const database = await db();
    const saved = await new Promise((resolve, reject) => {
      const r = database
        .transaction("drafts")
        .objectStore("drafts")
        .get("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    database.close();
    if (saved) {
      controller.restoreSessionText(saved);
      $("saved-status").textContent = "Restored local draft and candidates";
    }
  } catch (e) {
    $("saved-status").textContent = "Local restore failed";
    message(e.message, true);
  }
  render();
}
function renderPluginOptions() {
  const plugin = controller.plugins.list().find(p => p.id === $("asset-plugin").value);
  $("plugin-options").value = JSON.stringify(Object.fromEntries(Object.entries(plugin.optionsSchema.properties).filter(([,p]) => p.default !== undefined).map(([k,p]) => [k,p.default])), null, 2);
  const preview = plugin.capabilities.nativePreview ? " + native real-map preview" : "";
  $("plugin-capabilities").textContent = `${plugin.label}: ${plugin.capabilities.productionExport ? "editable import + production candidate export" : "editable import only; gameplay export unavailable"}${preview}. Options: ${Object.entries(plugin.optionsSchema.properties).map(([k,p]) => `${k}${p.minimum !== undefined ? ` (${p.minimum}–${p.maximum})` : ""}`).join(", ") || "none"}`;
}
$("asset-plugin").replaceChildren(...controller.plugins.list().map(p => new Option(p.label, p.id)));
$("asset-plugin").onchange = renderPluginOptions;
renderPluginOptions();
await restoreDraft();
try { await loadPalettes(); } catch (e) { message(e.message, true); }
const registration = await installPixelArtTools(controller);
ui.setConnection(
  registration.registered.length > 0,
  registration.registered.length
    ? `${registration.registered.length} WebMCP tools registered. Host image delivery needs a capture check.`
    : "WebMCP unavailable in this browser. Manual authoring is ready.",
);
