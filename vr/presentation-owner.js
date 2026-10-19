/** Exclusive scheduling for the existing canvas writer, never for native ticks.
 * The XR renderer calls presentXR() from its own animation loop. */
export class PresentationOwner {
  constructor({ present, request, cancel, shouldRun = () => true }) {
    this.present = present;
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
  enter() {
    if (this.xr) return false;
    this.xr = true;
    if (this.pending !== null) this.cancel(this.pending);
    this.pending = null;
    return true;
  }
  leave() {
    if (!this.xr) return;
    this.xr = false;
    if (this.pending === null) this.pending = this.request(this.pageFrame);
  }
  presentXR() { return this.xr ? this.present() : null; }
}
