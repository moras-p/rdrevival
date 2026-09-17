import { contextForTool, DOCKS, TOOL_META, toolFamilyFor } from "./model.js";
import { icon } from "./icons.js";

export class PixelArtEditorUI {
  constructor(root) {
    this.root = root;
    this.activeTool = "pencil";
    this.activeDock = null;
    this.animationExpanded = false;
    this.toolChange = null;
    this.toastTimer = null;
  }

  byId(id) {
    return this.root.ownerDocument.getElementById(id);
  }

  bind({ onToolChange } = {}) {
    this.toolChange = onToolChange ?? null;
    this.root.querySelectorAll("[data-tool-primary]").forEach((button) => {
      button.addEventListener("click", () => this.activateTool(button.dataset.tool));
    });
    this.root.querySelectorAll("[data-tool-choice]").forEach((button) => {
      button.addEventListener("click", () => this.activateTool(button.dataset.toolChoice));
    });
    this.root.querySelectorAll("[data-dock-button]").forEach((button) => {
      button.addEventListener("click", () => this.toggleDock(button.dataset.dockButton));
    });
    this.root.querySelectorAll("[data-close-dock]").forEach((button) => {
      button.addEventListener("click", () => this.closeDock(button.dataset.closeDock));
    });
    this.byId("animation-expand")?.addEventListener("click", () => this.setAnimationExpanded(!this.animationExpanded));
    this.#bindMirrors();
    for (const id of ["onion", "onion-next"]) this.byId(id)?.addEventListener("change", () => this.#syncOnionQuick());
    this.#syncOnionQuick();
    this.activateTool(this.activeTool, { emit: false });
  }

  #bindMirrors() {
    this.root.querySelectorAll("[data-sync-input]").forEach((mirror) => {
      const source = this.byId(mirror.dataset.syncInput);
      if (!source) return;
      const copyFromSource = () => {
        if (source.type === "checkbox") mirror.checked = source.checked;
        else mirror.value = source.value;
      };
      const copyToSource = () => {
        if (source.type === "checkbox") source.checked = mirror.checked;
        else source.value = mirror.value;
        source.dispatchEvent(new Event("input", { bubbles: true }));
        source.dispatchEvent(new Event("change", { bubbles: true }));
      };
      source.addEventListener("input", copyFromSource);
      source.addEventListener("change", copyFromSource);
      mirror.addEventListener("input", copyToSource);
      mirror.addEventListener("change", copyToSource);
      copyFromSource();
    });
    this.root.querySelectorAll("[data-sync-select]").forEach((mirror) => {
      const source = this.byId(mirror.dataset.syncSelect);
      if (!source) return;
      const copyFromSource = () => { mirror.value = source.value; };
      const copyToSource = () => {
        source.value = mirror.value;
        source.dispatchEvent(new Event("change", { bubbles: true }));
      };
      source.addEventListener("change", copyFromSource);
      mirror.addEventListener("change", copyToSource);
      copyFromSource();
    });
  }

  #syncOnionQuick() {
    const quick = this.byId("onion-quick");
    if (quick) quick.hidden = !(this.byId("onion")?.checked || this.byId("onion-next")?.checked);
  }

  activateTool(tool, { emit = true } = {}) {
    const meta = TOOL_META[tool];
    if (!meta) return;
    this.activeTool = tool;
    const family = toolFamilyFor(tool);
    const primary = this.root.querySelector(`[data-tool-primary="${family.id}"]`);
    if (primary) {
      primary.dataset.tool = tool;
      primary.title = `${meta.label} (${meta.shortcut})`;
      primary.setAttribute("aria-label", primary.title);
      const iconHost = primary.querySelector(".tool-primary-icon");
      if (iconHost) iconHost.innerHTML = icon(meta.icon, { size: 18 });
    }
    this.root.querySelectorAll("[data-tool-primary]").forEach((button) => button.classList.toggle("active", button.dataset.toolPrimary === family.id));
    this.root.querySelectorAll("[data-tool-choice]").forEach((button) => button.classList.toggle("active", button.dataset.toolChoice === tool));
    this.root.querySelectorAll("[data-context]").forEach((group) => { group.hidden = group.dataset.context !== contextForTool(tool); });
    const title = this.byId("context-title"), hint = this.byId("context-hint");
    if (title) title.textContent = meta.label;
    if (hint) hint.textContent = meta.shortcut;
    this.root.dataset.activeTool = tool;
    this.root.dataset.toolFamily = family.id;
    if (emit && this.toolChange) this.toolChange(tool);
  }

  toggleDock(dock) {
    if (this.activeDock === dock) this.closeDock(dock);
    else this.openDock(dock);
  }

  openDock(dock) {
    if (!DOCKS.some((entry) => entry.id === dock)) return;
    this.activeDock = dock;
    const drawer = this.byId("dock-drawer");
    drawer.hidden = false;
    drawer.dataset.openDock = dock;
    this.root.querySelectorAll("[data-dock-panel]").forEach((panel) => { panel.hidden = panel.dataset.dockPanel !== dock; });
    this.root.querySelectorAll("[data-dock-button]").forEach((button) => {
      const active = button.dataset.dockButton === dock;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    this.root.closest("body")?.classList.add("dock-open");
  }

  closeDock(dock = this.activeDock) {
    if (dock && this.activeDock && dock !== this.activeDock) return;
    this.activeDock = null;
    const drawer = this.byId("dock-drawer");
    drawer.hidden = true;
    delete drawer.dataset.openDock;
    this.root.querySelectorAll("[data-dock-panel]").forEach((panel) => { panel.hidden = true; });
    this.root.querySelectorAll("[data-dock-button]").forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    });
    this.root.closest("body")?.classList.remove("dock-open");
  }

  setAnimationExpanded(expanded) {
    this.animationExpanded = !!expanded;
    const content = this.byId("animation-expanded"), tray = this.byId("animation-tray"), button = this.byId("animation-expand");
    if (content) content.hidden = !this.animationExpanded;
    if (tray) tray.classList.toggle("expanded", this.animationExpanded);
    if (button) {
      button.innerHTML = icon(this.animationExpanded ? "collapse" : "expand");
      button.title = this.animationExpanded ? "Collapse animation workspace" : "Expand animation workspace";
      button.setAttribute("aria-label", button.title);
    }
  }

  updateDocument({ document, selectedFrame, selectedLayer, selection, activeCandidate }) {
    const frameCount = document.frames.length;
    const frameIndex = Math.max(0, document.frames.findIndex((frame) => frame.id === selectedFrame));
    const layer = document.layers.find((entry) => entry.id === selectedLayer);
    const tray = this.byId("animation-tray"), animationBadge = this.byId("animation-badge"), animationSummary = this.byId("animation-summary");
    if (tray) tray.hidden = frameCount <= 1;
    if (animationBadge) {
      animationBadge.hidden = frameCount <= 1;
      animationBadge.textContent = frameCount > 1 ? String(frameCount) : "";
    }
    if (animationSummary) animationSummary.textContent = frameCount > 1 ? `${frameCount} frames · filmstrip visible` : "1 frame · timeline hidden";
    const frameStatus = this.byId("frame-status"), layerStatus = this.byId("layer-status");
    if (frameStatus) frameStatus.textContent = frameCount === 1 ? "1 frame" : `Frame ${frameIndex + 1}/${frameCount}`;
    if (layerStatus) layerStatus.textContent = layer?.name ?? selectedLayer;
    const hasSelection = Array.isArray(selection) && selection.length === 4;
    const selectionContext = this.byId("selection-context"), selectionDimensions = this.byId("selection-dimensions"), selectionContextSize = this.byId("selection-context-size");
    const sizeText = hasSelection ? `${selection[2]}×${selection[3]}` : "No selection";
    if (selectionContext) selectionContext.hidden = !hasSelection;
    if (selectionDimensions) selectionDimensions.textContent = sizeText;
    if (selectionContextSize) selectionContextSize.textContent = hasSelection ? sizeText : "0×0";
    const reviewBadge = this.byId("review-badge"), handoffCard = this.byId("handoff-card"), handoffGoal = this.byId("handoff-card-goal"), handoffNeeds = this.byId("handoff-card-needs");
    const unresolved = document.handoff?.unresolvedNotes ?? [];
    const reviewRequested = !!document.handoff?.goal || unresolved.length > 0;
    if (reviewBadge) {
      reviewBadge.hidden = !reviewRequested;
      reviewBadge.textContent = reviewRequested ? String(Math.max(1, unresolved.length)) : "";
    }
    if (handoffCard) handoffCard.hidden = !reviewRequested;
    if (handoffGoal) handoffGoal.textContent = document.handoff?.goal || "Human review requested";
    if (handoffNeeds) handoffNeeds.textContent = unresolved.length ? `Needs attention: ${unresolved.join(" · ")}` : `Candidate ${activeCandidate ?? "primary"} is ready for review.`;
    const historyRevision = this.byId("history-revision");
    if (historyRevision) historyRevision.textContent = `rev ${document.revision}`;
    const contextFg = this.byId("context-fg-index"), fg = this.byId("fg-index");
    if (contextFg && fg) contextFg.textContent = fg.textContent;
  }

  updateHistoryLabel(checkpoint) {
    const label = this.byId("history-label");
    if (label) label.textContent = checkpoint || "History";
  }

  setConnection(connected, detail = "") {
    const connection = this.byId("connection");
    if (!connection) return;
    connection.dataset.state = connected ? "connected" : "offline";
    connection.innerHTML = `<i></i>${connected ? "Agent connected" : "Agent offline"}`;
    connection.title = detail;
  }

  showToast(text, { error = false, persistent = false } = {}) {
    const toast = this.byId("message");
    if (!toast) return;
    clearTimeout(this.toastTimer);
    toast.textContent = text;
    toast.classList.toggle("error", error);
    toast.hidden = false;
    if (!persistent && !error) this.toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
  }
}
