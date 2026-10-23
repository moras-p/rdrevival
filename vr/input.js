import { mapGamepad } from '../rdx/src/runtime/input-router.js';
import { XRICK_CONTROL as C } from '../rdx/src/runtime/controls.js';

// WebXR xr-standard mapping: trigger 0, squeeze 1, touchpad 2 (a placeholder
// on Quest Touch), thumbstick press 3, A/X 4, B/Y 5.
const XR_DEVICE = 'xr:controller';
const held = (source, index) => !!source?.gamepad?.buttons?.[index]?.pressed;
const pair = source => {
  const axes = source?.gamepad?.axes || [];
  return axes.length >= 4 && (Math.abs(axes[2]) > 0.2 || Math.abs(axes[3]) > 0.2)
    ? [axes[2], axes[3]] : [axes[0] || 0, axes[1] || 0];
};

/** Samples both hands at the native pre-actor hook; select events write immediately. */
export class XRControllerInput {
  constructor(router, { onRoomAction = () => {}, onStatus = () => {}, onRecenter = () => {},
    onHelp = () => {}, onLights = () => {}, onTimeOfDay = () => {}, onTidy = () => {}, now = () => performance.now() } = {}) {
    this.router = router;
    this.onRoomAction = onRoomAction;
    this.onStatus = onStatus;
    this.onRecenter = onRecenter;
    this.onHelp = onHelp;
    this.onLights = onLights;
    this.onTimeOfDay = onTimeOfDay;
    this.onTidy = onTidy;
    this.roomButtons = {left:false,right:false};
    this.now = now;
    this.mode = 'game';
    this.session = null;
    this.pressed = new Set();
    this.eventTrigger = null;
    this.suppressTriggerUntilRelease = false;
    this.lastSqueezeAt = -Infinity;
    this.sources = [];
    this.left = this.right = null;
    this.bound = {
      sources: () => this.refresh(),
      selectstart: event => this.select(event, true),
      selectend: event => this.select(event, false),
      squeezestart: event => this.squeeze(event)
    };
  }
  attach(session) {
    this.detach();
    this.session = session;
    this.mode = 'game';
    for (const [name, listener] of Object.entries({
      inputsourceschange: this.bound.sources, selectstart: this.bound.selectstart,
      selectend: this.bound.selectend, squeezestart: this.bound.squeezestart
    })) session.addEventListener(name, listener);
    this.refresh();
    this.router.xrSampler = this;
    this.router.setOwner('game');
    this.router.handoff(XR_DEVICE);
  }
  refresh() {
    const previousLeft = this.left, previousRight = this.right;
    this.sources = [...(this.session?.inputSources || [])].filter(s => s.gamepad || s.targetRayMode === 'tracked-pointer');
    this.left = this.sources.find(s => s.handedness === 'left') || null;
    this.right = this.sources.find(s => s.handedness === 'right') || null;
    if (previousLeft !== this.left || previousRight !== this.right) {
      // A newly preferred hand is an input-owner transition too. Release the
      // old mask/event trigger before taking either new controller's input.
      this.pressed.clear();
      this.eventTrigger = null;
      this.suppressTriggerUntilRelease = held(this.right, 0);
      if (this.router.owner === 'game' && this.router.xrSampler === this)
        this.router.handoff(XR_DEVICE);
      else this.router.clear();
    }
    this.onStatus({ left: !!this.left, right: !!this.right, mode: this.mode,
      profiles: this.sources.map(s => `${s.handedness}:${s.profiles?.join(',') || 'unknown'}`) });
  }
  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'game') this.suppressTriggerUntilRelease =
      held(this.right, 0) || !!(this.right && this.pressed.has(this.right));
    this.mode = mode;
    this.pressed.clear();
    this.eventTrigger = null;
    this.roomButtons = {left:false,right:false};
    this.router.setOwner(mode === 'game' ? 'game' : 'interaction');
    if (mode === 'game') this.router.handoff(XR_DEVICE);
    this.onRoomAction(mode);
    this.onStatus({ left: !!this.left, right: !!this.right, mode });
  }
  select(event, pressed) {
    if (!this.session || !this.sources.includes(event.inputSource)) return;
    if (this.mode === 'room') {
      if (pressed) { this.setMode('game'); this.suppressTriggerUntilRelease = true; }
      return;
    }
    if (event.inputSource !== this.right && this.right) return;
    this.eventTrigger = pressed;
    if (!pressed) this.suppressTriggerUntilRelease = false;
    if (pressed) this.pressed.add(event.inputSource);
    else this.pressed.delete(event.inputSource);
    this.sample(this.now()); // synchronous native write; no extra RAF/input queue
  }
  squeeze(event) {
    if (event?.inputSource && !this.sources.includes(event.inputSource)) return;
    const now = this.now();
    if (now - this.lastSqueezeAt < 250) return;
    this.lastSqueezeAt = now;
    this.setMode(this.mode === 'game' ? 'room' : 'game');
  }
  sample(timestamp = this.now()) {
    if (!this.session) return;
    if (this.mode === 'room') {
      const now = {left: held(this.left, 3), right: held(this.right, 3),
        a: held(this.right, 4), b: held(this.right, 5), y: held(this.left, 5)};
      if (now.left && !this.roomButtons.left) this.onHelp();
      if (now.right && !this.roomButtons.right) this.onRecenter();
      if (now.a && !this.roomButtons.a) this.onLights();
      if (now.b && !this.roomButtons.b) this.onTimeOfDay();
      if (now.y && !this.roomButtons.y) this.onTidy();
      this.roomButtons = now;
      return;
    }
    const left = this.left || (!this.right ? this.sources[0] : null);
    const right = this.right || (!this.left ? this.sources[0] : null);
    if (!left && !right) { this.router.clear(); return; }
    const profile = this.router.profiles.get(XR_DEVICE) || 'one-button';
    const trigger = !this.suppressTriggerUntilRelease &&
      (this.eventTrigger === null ? held(right, 0) : this.eventTrigger);
    const buttons = Array.from({length: 16}, () => ({pressed: false}));
    // The GameInputRouter's existing CD32 chord semantics remain authoritative.
    if (profile === 'cd32') {
      buttons[0].pressed = held(right, 4); // A: jump
      buttons[1].pressed = held(right, 5); // B: dynamite
      buttons[2].pressed = held(left, 4); // X: stick
      buttons[3].pressed = trigger; // directional Fire
    } else buttons[0].pressed = trigger;
    const axes = pair(left);
    const mask = mapGamepad({connected:true, axes, buttons}, profile);
    this.router.write(XR_DEVICE, mask, timestamp);
    this.onStatus({left:!!this.left,right:!!this.right,mode:this.mode,mask});
  }
  suspend() { this.eventTrigger = null; this.pressed.clear(); this.setMode('room'); this.router.clear(); }
  detach() {
    if (this.session) {
      for (const [name, listener] of Object.entries({
        inputsourceschange: this.bound.sources, selectstart: this.bound.selectstart,
        selectend: this.bound.selectend, squeezestart: this.bound.squeezestart
      })) this.session.removeEventListener(name, listener);
    }
    this.session = null;
    this.sources = [];
    this.left = this.right = null;
    this.pressed.clear();
    this.eventTrigger = null;
    this.suppressTriggerUntilRelease = false;
    this.lastSqueezeAt = -Infinity;
    if (this.router.xrSampler === this) this.router.xrSampler = null;
    this.router.clear();
  }
}
