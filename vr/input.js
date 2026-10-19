import { mapGamepad } from '../rdx/src/runtime/input-router.js';
import { XRICK_CONTROL as C } from '../rdx/src/runtime/controls.js';

// The native C pre-actor hook calls router.pollGamepads(), which calls this
// adapter. Never sample a controller through an additional XR->input RAF queue.
export class XRControllerInput {
  constructor(router, { onRoomAction = () => {}, now = () => performance.now() } = {}) {
    this.router = router;
    this.onRoomAction = onRoomAction;
    this.now = now;
    this.mode = 'game';
    this.session = null;
    this.pressed = new Set();
    this.sources = [];
    this.source = null;
    this.bound = {
      sources: () => this.refresh(),
      selectstart: event => this.select(event, true),
      selectend: event => this.select(event, false),
      squeezestart: () => this.squeeze()
    };
  }
  attach(session) {
    this.detach();
    this.session = session;
    this.mode = 'game';
    for (const [name, listener] of Object.entries({
      inputsourceschange: this.bound.sources,
      selectstart: this.bound.selectstart,
      selectend: this.bound.selectend,
      squeezestart: this.bound.squeezestart
    })) session.addEventListener(name, listener);
    this.refresh();
    this.router.xrSampler = this;
    this.router.setOwner('game');
    this.router.handoff(this.id(this.source));
  }
  id(source) { return source ? `xr:${source.handedness || 'none'}` : 'xr:controller'; }
  refresh() {
    this.sources = [...(this.session?.inputSources || [])].filter(s => s.gamepad || s.targetRayMode === 'tracked-pointer');
    const preferred = this.sources.find(s => s.handedness === 'right') || this.sources[0] || null;
    if (this.source && this.source !== preferred) {
      // A better-preferred controller arriving is an ownership change just as
      // much as a disconnected controller. Release its held inputs first.
      this.pressed.clear();
      if (preferred && this.router.owner === 'game') this.router.handoff(this.id(preferred));
      else this.router.clear();
    }
    this.source = preferred;
  }
  select(event, pressed) {
    if (!this.session || (event.inputSource !== this.source && this.source)) return;
    if (this.mode !== 'game') {
      if (pressed) { this.mode = 'game'; this.router.setOwner('game'); this.router.handoff(this.id(this.source)); this.onRoomAction('game'); }
      return;
    }
    if (pressed) this.pressed.add(event.inputSource);
    else this.pressed.delete(event.inputSource);
    // Event-driven Fire is written *here*, synchronously. Thumbstick and
    // trigger polling still run at the native actor-consumption boundary.
    this.sample(this.now());
  }
  squeeze() {
    if (this.mode === 'game') {
      this.mode = 'interaction';
      this.router.setOwner('interaction');
      this.pressed.clear();
      this.onRoomAction('interaction');
    } else {
      this.mode = 'game';
      this.router.setOwner('game');
      this.router.handoff(this.id(this.source));
      this.onRoomAction('game');
    }
  }
  sample(timestamp = this.now()) {
    if (this.mode !== 'game' || !this.session || !this.source) return;
    const pad = this.source.gamepad;
    // XR thumbstick is frequently axes[2]/[3]; trackpads use [0]/[1].
    // Prefer the active pair rather than mistaking a dormant trackpad for input.
    let axes = pad?.axes || [];
    if (axes.length >= 4 && (Math.abs(axes[2]) > 0.25 || Math.abs(axes[3]) > 0.25))
      axes = [axes[2], axes[3]];
    const profile = this.router.profiles.get(this.id(this.source)) || 'one-button';
    const mask = mapGamepad({ connected: true, axes, buttons: pad?.buttons || [] }, profile) |
      (this.pressed.has(this.source) && profile !== 'cd32' ? C.FIRE : 0);
    this.router.write(this.id(this.source), mask, timestamp);
  }
  detach() {
    if (this.session) {
      for (const [name, listener] of Object.entries({
        inputsourceschange: this.bound.sources,
        selectstart: this.bound.selectstart,
        selectend: this.bound.selectend,
        squeezestart: this.bound.squeezestart
      })) this.session.removeEventListener(name, listener);
    }
    this.session = null;
    this.sources = [];
    this.source = null;
    this.pressed.clear();
    if (this.router.xrSampler === this) this.router.xrSampler = null;
    this.router.clear();
  }
}
