const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export class ViewportModel {
  constructor({ centerX = 0, centerY = 0, zoom = 1, minZoom = 0.25, maxZoom = 8 } = {}) {
    this.minZoom = Math.max(0.01, finite(minZoom, 0.25));
    this.maxZoom = Math.max(this.minZoom, finite(maxZoom, 8));
    this.centerX = finite(centerX);
    this.centerY = finite(centerY);
    this.zoom = clamp(finite(zoom, 1), this.minZoom, this.maxZoom);
    this.cssWidth = 1;
    this.cssHeight = 1;
    this.devicePixelRatio = 1;
  }

  resize({ cssWidth, cssHeight, devicePixelRatio = 1 }) {
    this.cssWidth = Math.max(1, finite(cssWidth, 1));
    this.cssHeight = Math.max(1, finite(cssHeight, 1));
    this.devicePixelRatio = Math.max(1, finite(devicePixelRatio, 1));
    return this.canvasMetrics();
  }

  canvasMetrics() {
    return Object.freeze({
      cssWidth: this.cssWidth,
      cssHeight: this.cssHeight,
      devicePixelRatio: this.devicePixelRatio,
      backingWidth: Math.max(1, Math.round(this.cssWidth * this.devicePixelRatio)),
      backingHeight: Math.max(1, Math.round(this.cssHeight * this.devicePixelRatio))
    });
  }

  snapshot() {
    return Object.freeze({ centerX: this.centerX, centerY: this.centerY, zoom: this.zoom });
  }

  worldToScreen(x, y) {
    return Object.freeze({
      x: (finite(x) - this.centerX) * this.zoom + this.cssWidth / 2,
      y: (finite(y) - this.centerY) * this.zoom + this.cssHeight / 2
    });
  }

  screenToWorld(x, y) {
    return Object.freeze({
      x: this.centerX + (finite(x) - this.cssWidth / 2) / this.zoom,
      y: this.centerY + (finite(y) - this.cssHeight / 2) / this.zoom
    });
  }

  setZoom(value, { anchorX = this.cssWidth / 2, anchorY = this.cssHeight / 2 } = {}) {
    const before = this.screenToWorld(anchorX, anchorY);
    this.zoom = clamp(finite(value, this.zoom), this.minZoom, this.maxZoom);
    this.centerX = before.x - (finite(anchorX) - this.cssWidth / 2) / this.zoom;
    this.centerY = before.y - (finite(anchorY) - this.cssHeight / 2) / this.zoom;
    return this.snapshot();
  }

  panScreen(deltaX, deltaY) {
    this.centerX -= finite(deltaX) / this.zoom;
    this.centerY -= finite(deltaY) / this.zoom;
    return this.snapshot();
  }

  centerOn(x, y) {
    this.centerX = finite(x, this.centerX);
    this.centerY = finite(y, this.centerY);
    return this.snapshot();
  }

  frame(bounds, { padding = 24 } = {}) {
    const width = Math.max(1, finite(bounds?.width, 1));
    const height = Math.max(1, finite(bounds?.height, 1));
    this.centerX = finite(bounds?.x) + width / 2;
    this.centerY = finite(bounds?.y) + height / 2;
    const usableWidth = Math.max(1, this.cssWidth - Math.max(0, finite(padding)) * 2);
    const usableHeight = Math.max(1, this.cssHeight - Math.max(0, finite(padding)) * 2);
    this.zoom = clamp(Math.min(usableWidth / width, usableHeight / height), this.minZoom, this.maxZoom);
    return this.snapshot();
  }
}
