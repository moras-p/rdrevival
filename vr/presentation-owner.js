/** Handoff of the native clock and canvas writer to immersive XR.
 * Desktop preview only takes canvas ownership; it keeps ordinary native RAF. */
export class PresentationOwner {
  constructor({ present, request, cancel, shouldRun = () => true,
    enterImmersive = () => {}, leaveImmersive = () => {}, nativeXRFrame = () => {} }) {
    this.present = present;
    this.enterImmersive = enterImmersive;
    this.leaveImmersive = leaveImmersive;
    this.nativeXRFrame = nativeXRFrame;
    this.immersive = false;
    this.request = request;
    this.cancel = cancel;
    this.shouldRun = shouldRun;
    this.xr = false;
    this.pending = null;
  }
  pageFrame = () => {
    this.pending = null;
    if (this.xr || !this.shouldRun()) return;
    this.present();
    if (!this.xr && this.shouldRun()) this.pending = this.request(this.pageFrame);
  };
  enter({ immersive = false } = {}) {
    if (this.xr) return false;
    if (immersive) this.enterImmersive();
    this.immersive = immersive;
    this.xr = true;
    if (this.pending !== null) this.cancel(this.pending);
    this.pending = null;
    return true;
  }
  leave() {
    if (!this.xr) return;
    if (this.immersive) this.leaveImmersive();
    this.immersive = false;
    this.xr = false;
    if (this.pending === null) this.pending = this.request(this.pageFrame);
  }
  presentXR() {
    if (!this.xr) return null;
    if (this.immersive) this.nativeXRFrame();
    return this.present();
  }
}
