import { DOCKS, TOOL_FAMILIES, TOOL_META } from "./model.js";
import { icon } from "./icons.js";

const esc = (value) => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const iconButton = (id, iconName, label, extra = "") => `<button id="${id}" class="icon-button" title="${esc(label)}" aria-label="${esc(label)}" ${extra}>${icon(iconName)}</button>`;

function appBar() {
  return `<header class="app-bar">
    <a class="brand" href="index.html" aria-label="RDR home">RDR <span>/</span> Pixel Art</a>
    <div class="document-context" aria-live="polite"><strong id="doc-title">Untitled image</strong><span id="dimensions"></span></div>
    <div class="spacer"></div>
    <div class="history-controls" aria-label="History controls">
      ${iconButton("undo", "undo", "Undo (Ctrl/Cmd Z)")}
      ${iconButton("redo", "redo", "Redo (Ctrl/Cmd Shift Z)")}
      <details id="history-menu" class="popover history-popover">
        <summary title="History and checkpoints">${icon("history")}<span id="history-label">History</span></summary>
        <div class="popover-body history-body">
          <div class="panel-heading"><strong>History</strong><span id="history-revision">Current</span></div>
          <label>Checkpoint<select id="checkpoints" aria-label="Checkpoint"><option value="">Choose checkpoint</option></select></label>
          <div class="row"><button id="checkpoint">Create checkpoint</button><button id="restore">Restore selected</button></div>
        </div>
      </details>
    </div>
    <div class="app-actions">
      <button id="new" class="quiet-button">New</button>
      <button id="import" class="quiet-button">Import</button>
      <button id="save" class="quiet-button">Save</button>
      <button id="export" class="primary">Export</button>
    </div>
  </header>`;
}

function toolChoice(tool) {
  const meta = TOOL_META[tool];
  return `<button class="tool-choice" data-tool-choice="${tool}" title="${esc(meta.label)} (${meta.shortcut})">${icon(meta.icon)}<span>${esc(meta.label)}</span><kbd>${meta.shortcut}</kbd></button>`;
}

function toolRail() {
  return `<aside class="tool-rail" aria-label="Drawing tools">
    ${TOOL_FAMILIES.map((family) => {
      const meta = TOOL_META[family.primary];
      const alternatives = family.tools.filter((tool) => tool !== family.primary);
      return `<div class="tool-family" data-tool-family="${family.id}">
        <button class="tool-primary${family.id === "draw" ? " active" : ""}" data-tool-primary="${family.id}" data-tool="${family.primary}" title="${esc(meta.label)} (${meta.shortcut})" aria-label="${esc(meta.label)} (${meta.shortcut})">
          <span class="tool-primary-icon">${icon(meta.icon, { size: 18 })}</span><span class="tool-label">${esc(family.label)}</span>
        </button>
        ${alternatives.length ? `<div class="tool-flyout" role="menu" aria-label="${esc(family.label)} tools">${family.tools.map(toolChoice).join("")}</div>` : ""}
      </div>`;
    }).join("")}
  </aside>`;
}

function toolContextBar() {
  return `<div class="tool-context-bar" aria-label="Tool options">
    <div class="context-identity"><strong id="context-title">Pencil</strong><span id="context-hint">P</span></div>

    <div class="context-group" data-context="brush">
      <label>Size <input id="brush-size" type="number" min="1" max="8" value="1" /></label>
      <label>Shape <select id="brush-pattern"><option value="square">Square</option><option value="cross">Cross</option><option value="checker">Checker</option></select></label>
      <label class="toggle"><input id="pixel-perfect" type="checkbox" checked /> Pixel-perfect</label>
      <details class="popover context-more"><summary title="Advanced pencil options">${icon("more")}</summary><div class="popover-body compact-popover"><label class="toggle"><input id="symmetry-x" type="checkbox" /> Symmetry X</label><label class="toggle"><input id="symmetry-y" type="checkbox" /> Symmetry Y</label></div></details>
    </div>

    <div class="context-group" data-context="eraser" hidden>
      <label>Size <input data-sync-input="brush-size" type="number" min="1" max="8" value="1" /></label>
      <span class="context-note">Uses current brush shape</span>
      <label class="toggle"><input data-sync-input="pixel-perfect" type="checkbox" checked /> Pixel-perfect</label>
    </div>

    <div class="context-group" data-context="fill" hidden><span class="context-note">4-connected fill</span><span>FG <strong id="context-fg-index">1</strong></span></div>
    <div class="context-group" data-context="eyedropper" hidden><span class="context-note">Click a pixel to pick its indexed color</span></div>

    <div class="context-group" data-context="selection" hidden>
      <label>Mode <select id="selection-mode"><option value="replace">Replace</option><option value="add">Add</option><option value="subtract">Subtract</option></select></label>
      <span id="selection-dimensions" class="context-note">No selection</span>
    </div>

    <div class="context-group" data-context="wand" hidden>
      <label>Mode <select data-sync-select="selection-mode"><option value="replace">Replace</option><option value="add">Add</option><option value="subtract">Subtract</option></select></label>
      <label>Match <select id="wand-mode"><option value="same-color">Same color</option><option value="opaque">Connected opaque</option></select></label>
    </div>

    <div class="context-group" data-context="move" hidden><span class="context-note">Drag selection to move</span></div>
    <div class="context-group" data-context="shape" hidden><label class="toggle"><input id="shape-filled" type="checkbox" /> Filled rectangle</label><span class="context-note">Hold Shift for a temporary fill</span></div>
    <div class="context-group" data-context="navigate" hidden><span class="context-note">Drag canvas to pan</span></div>

    <div class="selection-context" id="selection-context" hidden>
      <span class="selection-context-label">Selection <strong id="selection-context-size">0×0</strong></span><span id="transform-preview" class="context-note"></span>
      <button id="copy-selection">Copy</button><button id="cut-selection">Cut</button><button id="paste-selection">Paste</button><button id="clear-selection">Delete</button>
      <details class="popover transform-popover"><summary>Transform ${icon("chevron")}</summary><div class="popover-body transform-menu">
        <button id="flip-h">Flip horizontal</button><button id="flip-v">Flip vertical</button><button id="rotate-left">Rotate left 90</button><button id="rotate-right">Rotate right 90</button>
        <div class="menu-separator"></div>
        <label>Integer scale <input id="selection-scale" type="number" min="2" max="8" value="2" /></label><button id="scale-selection">Scale ×N</button>
        <details><summary>Advanced rational scale</summary><div class="row"><label>Ratio <input id="scale-num" type="number" min="1" max="8" value="1" /> / <input id="scale-den" type="number" min="1" max="8" value="2" /></label><button id="scale-ratio-selection">Apply</button></div></details>
        <label class="toggle"><input id="preview-first" type="checkbox" checked /> Preview destructive transforms first</label>
      </div></details>
    </div>

    <div class="spacer"></div>
    <div class="view-context">
      <label class="icon-toggle" title="Pixel grid">${icon("grid")}<input id="grid" type="checkbox" checked /><span>Grid</span></label>
      <label class="zoom-control">Zoom <input id="zoom" type="range" min="1" max="20" value="12" /></label>
      <output id="zoom-value">12×</output>
      <button id="fit-view" class="icon-text-button" title="Fit canvas to workspace">${icon("fit")}<span>Fit</span></button>
    </div>
  </div>`;
}

function canvasWorkspace() {
  return `<section class="workspace">
    ${toolContextBar()}
    <div id="canvas-stage" class="canvas-stage"><canvas id="art-canvas" tabindex="0" aria-label="Pixel drawing canvas"></canvas></div>
    ${animationTray()}
  </section>`;
}

function animationTray() {
  return `<section id="animation-tray" class="animation-tray" hidden>
    <div class="animation-strip-bar">
      <strong>Frames</strong><div id="frames" class="frames-strip"></div><div class="spacer"></div>
      <div id="onion-quick" class="onion-quick" hidden><label class="toggle"><input data-sync-input="onion" type="checkbox" /> Prev</label><label class="toggle"><input data-sync-input="onion-next" type="checkbox" /> Next</label><label>Range <input data-sync-input="onion-range" type="number" min="1" max="8" value="2" /></label></div>
      <button id="play" class="icon-text-button">${icon("play")}<span>Play</span></button>
      <label>Duration <input id="duration" type="number" min="1" max="60000" value="100" /> ms</label>
      <button id="animation-expand" class="icon-button" title="Expand animation workspace" aria-label="Expand animation workspace">${icon("expand")}</button>
    </div>
    <div id="animation-expanded" class="animation-expanded" hidden>
      <div id="cel-matrix" class="cel-matrix" aria-label="Frame layer cel matrix"></div>
      <div class="cel-actions"><label>Target frame <select id="cel-target-frame"></select></label><label>Target layer <select id="cel-target-layer"></select></label><button id="cel-copy">Copy cel</button><button id="cel-move">Move cel</button><button id="cel-swap">Swap cels</button><button id="cel-clear">Clear cel</button></div>
      <details class="advanced-disclosure"><summary>Developer: clip order & sheet layout</summary>
        <label>Clip JSON<textarea id="clip-json" rows="3"></textarea></label><button id="apply-clip">Apply clip</button>
        <label>Layout JSON<textarea id="layout-json" rows="3"></textarea></label><button id="apply-layout">Apply layout</button><button id="sheet-view">Preview sheet</button>
      </details>
    </div>
  </section>`;
}

function dockRail() {
  return `<aside class="dock-rail" aria-label="Editor panels">
    ${DOCKS.map((dock) => `<button class="dock-button" data-dock-button="${dock.id}" title="${esc(dock.label)}" aria-label="${esc(dock.label)}">${icon(dock.icon, { size: 18 })}<span class="dock-label">${esc(dock.label)}</span><span class="dock-badge" id="${dock.id}-badge" hidden></span></button>`).join("")}
  </aside>`;
}

function drawerHeading(id, label) {
  return `<div class="drawer-heading"><strong>${label}</strong><button class="icon-button drawer-close" data-close-dock="${id}" title="Close ${label}" aria-label="Close ${label}">${icon("close")}</button></div>`;
}

function colorDrawer() {
  return `<section class="dock-panel" data-dock-panel="color" hidden>${drawerHeading("color", "Color")}
    <div class="fg-bg-row"><strong>FG <span id="fg-index">1</span></strong><strong>BG <span id="bg-index">0</span></strong><button id="swap-colors" class="icon-button" title="Swap foreground/background" aria-label="Swap foreground/background">${icon("swap")}</button></div>
    <div id="palette" class="palette-grid"></div>
    <p id="palette-policy-status" class="compact-status"></p>
    <div class="row"><select id="ramp-select" aria-label="Style profile ramp"></select><button id="shade-down">Shade -</button><button id="shade-up">Shade +</button></div>
    <div class="row"><button id="select-ramp-pixels">Select ramp</button><input id="color" type="color" value="#181c27" aria-label="Palette color" /><button id="set-color">Update</button><label class="toggle"><input id="lock-color" type="checkbox" /> Lock</label></div>
    <details><summary>Palette contract</summary><button id="fix-palette">Fix current palette</button><label id="color-budget-control">Opaque colors/frame <input id="color-budget" type="number" min="1" max="255" value="15" /></label></details>
    <details><summary>Map palette</summary><label>Map <input id="palette-map" type="number" min="1" max="54" value="13" /></label><label>Bank <select id="palette-bank"><option value="">All map banks</option><option>0</option><option>1</option><option>2</option><option>3</option></select></label><button id="new-map-palette">New draft with map palette</button><p>Creates a new blank draft; existing colors are never silently remapped.</p></details>
    <details><summary>Edit entries</summary><div class="row"><button id="palette-add">Add color</button><button id="palette-remove">Remove</button><button id="palette-left">Move left</button><button id="palette-right">Move right</button></div></details>
    <span id="color-label" class="sr-only">Index 1</span>
  </section>`;
}

function layersDrawer() {
  return `<section class="dock-panel" data-dock-panel="layers" hidden>${drawerHeading("layers", "Layers")}
    <div class="drawer-actions"><button id="add-layer">${icon("plus")} Add</button><button id="duplicate-layer">${icon("duplicate")} Duplicate</button><button id="delete-layer">${icon("delete")} Delete</button></div>
    <div id="layers" class="layers-list"></div>
    <p class="drawer-help">Drag rows to reorder. Roles preserve semantic authoring intent.</p>
  </section>`;
}

function animationDrawer() {
  return `<section class="dock-panel" data-dock-panel="animation" hidden>${drawerHeading("animation", "Animation")}
    <div class="drawer-actions"><button id="duplicate">Duplicate frame</button><button id="add-frame">Add frame</button><button id="delete-frame">Delete</button></div>
    <div class="drawer-actions"><button id="frame-left">Move left</button><button id="frame-right">Move right</button></div>
    <p id="animation-summary" class="compact-status">1 frame · timeline hidden</p>
    <details id="onion-controls"><summary>Onion skin</summary>
      <label class="toggle"><input id="onion" type="checkbox" /> Previous</label><label class="toggle"><input id="onion-next" type="checkbox" /> Next</label>
      <label>Range <input id="onion-range" type="number" min="1" max="8" value="2" /></label><label>Opacity <input id="onion-opacity" type="range" min="0.05" max="0.8" step="0.05" value="0.25" /></label>
      <div class="row"><label>Previous tint <input id="onion-prev-color" type="color" value="#68a8ff" /></label><label>Next tint <input id="onion-next-color" type="color" value="#ff7d8d" /></label></div>
    </details>
  </section>`;
}

function propertiesDrawer() {
  return `<section class="dock-panel" data-dock-panel="properties" hidden>${drawerHeading("properties", "Properties")}
    <div class="property-group"><h3>Canvas size</h3><div class="row"><label>W <input id="resize-w" type="number" min="1" max="512" /></label><label>H <input id="resize-h" type="number" min="1" max="512" /></label></div><select id="resize-fit" aria-label="Resize policy"><option value="preserve">Preserve / pad</option><option value="nearest">Nearest-neighbor scale</option></select><label class="toggle"><input id="resize-crop" type="checkbox" /> Allow crop</label><button id="resize">Resize</button></div>
    <div class="property-group"><h3>Anchor</h3><div class="row"><label>X <input id="anchor-x" type="number" /></label><label>Y <input id="anchor-y" type="number" /></label><button id="set-anchor">Set</button></div></div>
    <details><summary>Constraints</summary><div class="drawer-actions"><button id="protect">Protect selection</button><button id="scope">Scope to frame</button><button id="clear-constraints">Clear</button></div><p id="constraints"></p></details>
  </section>`;
}

function reviewDrawer() {
  return `<section class="dock-panel" data-dock-panel="review" hidden>${drawerHeading("review", "Review")}
    <div id="handoff-card" class="handoff-card" hidden><span class="eyebrow">Human review</span><strong id="handoff-card-goal">Review requested</strong><p id="handoff-card-needs"></p></div>
    <div class="property-group"><h3>Candidates</h3><select id="candidate-select" aria-label="Candidate branch"></select><div class="row"><input id="candidate-name" placeholder="variant-b" maxlength="40" /><button id="candidate-fork">Fork</button></div><div class="drawer-actions"><button id="candidate-promote">Promote</button><button id="candidate-delete">Delete</button><button id="candidate-compare">Compare</button><button id="candidate-transfer">Transfer selection</button></div><p id="candidate-status"></p><pre id="candidate-compare-status"></pre></div>
    <div class="property-group"><h3>Review views</h3><div class="drawer-actions"><button id="observe">Prepare view</button><button id="critique">Critique board</button><button id="animation-review">Animation review</button><button id="review">Review checkpoint</button></div></div>
    <details open><summary>References</summary><div id="references"><p>Import an image as a reference or editable source.</p></div></details>
    <details><summary>Handoff</summary><label>Current goal<textarea id="handoff-goal" rows="2"></textarea></label><label>Baseline checkpoint<select id="handoff-baseline"><option value="">None</option></select></label><label>Unresolved notes<textarea id="handoff-notes" rows="3" placeholder="One note per line"></textarea></label><label>Next action<textarea id="handoff-next" rows="2"></textarea></label><div class="drawer-actions"><button id="handoff-accept-selection">Accept selection</button><button id="save-handoff">Save handoff</button></div><p id="handoff-status"></p></details>
    <details><summary>Art direction</summary><label>Target asset<textarea id="direction-target" rows="2"></textarea></label><label>Intended change<textarea id="direction-intent" rows="2"></textarea></label><label>Preserve<textarea id="direction-preserve" rows="2"></textarea></label><label>Reference inspiration<textarea id="direction-referenceNotes" rows="2"></textarea></label><label>Visual acceptance<textarea id="direction-acceptance" rows="2"></textarea></label><button id="save-direction">Save direction</button></details>
    <details><summary>Advanced authoring</summary><label>Stage<select id="authoring-stage"><option value="silhouette">Silhouette</option><option value="major-masses">Major masses</option><option value="shading">Shading</option><option value="accents">Accents</option><option value="cleanup">Cleanup</option></select></label><label class="toggle"><input id="lock-authoring-stage" type="checkbox" /> Lock completed stage when advancing</label><p id="authoring-status"></p><details><summary>RDR Style Profile JSON</summary><textarea id="style-profile-json" rows="8" spellcheck="false">{}</textarea><button id="apply-style-profile">Apply profile</button></details></details>
  </section>`;
}

function outputDrawer() {
  return `<section class="dock-panel" data-dock-panel="output" hidden>${drawerHeading("output", "Output")}
    <div class="property-group validation-group"><div class="panel-heading"><h3>Validation</h3><button id="validate">Check</button></div><p id="validation">No validation run yet.</p></div>
    <div class="property-group"><h3>Native 1:1</h3><div class="navigator"><canvas id="native-preview"></canvas></div></div>
    <details><summary>Real map preview</summary><p>Uses the authoritative native xrick/WASM Live-map path.</p><label>Preview options<textarea id="preview-options" rows="4" spellcheck="false">{}</textarea></label><button id="production-preview">Preview draft in real map</button><p id="preview-capability"></p></details>
    <div class="property-group"><h3>Exports</h3><div id="artifacts"><p>Portable projects retain indexed cels and history provenance.</p></div><div class="drawer-actions"><button id="production-export">Production candidate</button><button id="report-export">Validation report</button></div></div>
  </section>`;
}

function dockDrawer() {
  return `<aside id="dock-drawer" class="dock-drawer" aria-live="polite" aria-label="Editor panel" hidden>${colorDrawer()}${layersDrawer()}${animationDrawer()}${propertiesDrawer()}${reviewDrawer()}${outputDrawer()}</aside>`;
}

function statusBar() {
  return `<footer class="status-bar">
    <span id="coordinates">X 0 · Y 0</span><span class="status-separator"></span><span id="selection-status">No selection</span><span class="status-separator"></span>
    <span id="frame-status">1 frame</span><span id="layer-status">Ink</span><span id="revision">Revision 0</span><span class="spacer"></span>
    <span id="connection" class="connection-status" data-state="checking"><i></i>Agent checking</span><span id="saved-status" role="status">New draft</span>
  </footer>`;
}

function observationPanel() {
  return `<section id="observation-panel" class="observation-panel" hidden><div class="observation-heading"><strong id="view-label">Agent observation</strong><button id="close-view" class="icon-button" title="Close observation" aria-label="Close observation">${icon("close")}</button></div><div id="art-observation"></div></section>`;
}

function newDialog() {
  return `<dialog id="new-dialog"><form id="new-form"><h1>Start with exact pixels.</h1><p>One image or a set of independent animation cels.</p><label>Name<input name="id" value="untitled" pattern="[a-zA-Z0-9_-]{1,80}" required /></label><div class="row"><label>Width<input name="width" type="number" min="1" max="512" value="24" required /></label><label>Height<input name="height" type="number" min="1" max="512" value="32" required /></label><label>Frames<input name="frameCount" type="number" min="1" max="128" value="1" required /></label></div><div class="row"><label>Ratio width<input name="ratioW" type="number" min="1" max="512" placeholder="optional" /></label><label>Ratio height<input name="ratioH" type="number" min="1" max="512" placeholder="optional" /></label></div><label>Background<select name="background"><option value="transparent">Transparent</option><option value="opaque">Opaque palette color 1</option></select></label><label>Art brief<textarea name="brief" rows="3" placeholder="Character, direction, silhouette, palette…"></textarea></label><div class="actions"><button type="button" data-close="new-dialog">Cancel</button><button type="submit" class="primary">Create document</button></div></form></dialog>`;
}

function importDialog() {
  return `<dialog id="import-dialog"><h1>Bring pixels into your draft.</h1><input id="file" type="file" accept="image/png,image/jpeg,image/webp,.json,.txt,.bin,.rom,.md" /><p id="file-info">Select an image, project, or game asset source for a registered plugin.</p><label>Use as<select id="import-role"><option value="reference">Immutable reference</option><option value="import-image">Editable image in current cel</option><option value="import-sheet">Sprite sheet</option><option value="asset-import">Game asset plugin</option><option value="open">Open .rdr-art.json project</option></select></label><label id="reference-role-control">Reference role<select id="reference-role"><option value="style">Style / visual language</option><option value="subject">Subject identity</option><option value="pose">Pose mechanics</option><option value="layout">Layout / composition</option><option value="environment">Environment context</option><option value="state">State / phase</option><option value="moodboard">AI mood board / inspiration</option></select></label><label>Game asset plugin<select id="asset-plugin"></select></label><p id="plugin-capabilities"></p><label>Plugin options<textarea id="plugin-options" rows="3">{}</textarea></label><label class="toggle"><input id="fixed-import" type="checkbox" checked /> Fix imported palette (new image / sheet)</label><div class="row"><label>Fit<select id="fit"><option value="preserve">Preserve pixels (1:1)</option><option value="contain">Contain</option><option value="cover">Cover / crop</option><option value="stretch">Stretch</option></select></label><label class="toggle"><input id="quantize" type="checkbox" /> Allow palette quantization</label></div><label class="toggle"><input id="import-new-image" type="checkbox" /> Import image as a new document</label><label class="toggle"><input id="source-palette" type="checkbox" /> Use exact source palette (new image or sheet)</label><details><summary>Sheet slicing / metadata</summary><p>Provide frame width/height and layout with occupied cell IDs and null blanks, or explicit rectangles.</p><textarea id="slice-json" rows="7">{"width":24,"height":32,"layout":{"columns":3,"marginX":0,"marginY":0,"gapX":0,"gapY":0,"cells":["frame-1","frame-2","frame-3","frame-4","frame-5","frame-6"]}}</textarea><button id="slice-preview">Preview slice boundaries</button><canvas id="slice-canvas"></canvas></details><div class="actions"><button data-close="import-dialog">Cancel</button><button id="do-import" class="primary">Import</button></div></dialog>`;
}

export function renderPixelArtEditorShell() {
  return `${appBar()}<main class="editor-shell">${toolRail()}${canvasWorkspace()}${dockRail()}${dockDrawer()}</main>${statusBar()}<div id="message" class="toast" role="status" aria-live="polite" hidden></div>${observationPanel()}${newDialog()}${importDialog()}`;
}

export function mountPixelArtEditorShell(root) {
  if (!root) throw new Error("Pixel Art Editor root is missing");
  root.innerHTML = renderPixelArtEditorShell();
  return root;
}

export {
  appBar as renderAppBar,
  toolRail as renderToolRail,
  toolContextBar as renderToolContextBar,
  canvasWorkspace as renderCanvasWorkspace,
  animationTray as renderAnimationTray,
  dockRail as renderDockRail,
  dockDrawer as renderDockDrawer,
  statusBar as renderStatusBar,
  observationPanel as renderObservationPanel,
};
