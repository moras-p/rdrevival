const canvasCache = new WeakMap();

function screenRect(viewport, rect) {
  const origin = viewport.worldToScreen(rect.x, rect.y);
  return { x:origin.x, y:origin.y, width:rect.width * viewport.zoom, height:rect.height * viewport.zoom };
}

function visibleOnCanvas(viewport, rect) {
  const metrics = viewport.canvasMetrics();
  return rect.x + rect.width >= 0 && rect.y + rect.height >= 0 && rect.x <= metrics.cssWidth && rect.y <= metrics.cssHeight;
}

export function pixelBufferCanvas(buffer) {
  if (!buffer) return null;
  let canvas = canvasCache.get(buffer);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  const context = canvas.getContext('2d');
  context.putImageData(new ImageData(buffer.data, buffer.width, buffer.height), 0, 0);
  canvasCache.set(buffer, canvas);
  return canvas;
}

export function drawPixelBuffer(context, viewport, buffer, x, y) {
  if (!buffer) return false;
  const screen = screenRect(viewport, { x, y, width:buffer.width, height:buffer.height });
  if (!visibleOnCanvas(viewport, screen)) return false;
  context.imageSmoothingEnabled = false;
  context.drawImage(pixelBufferCanvas(buffer), Math.round(screen.x), Math.round(screen.y), Math.max(1, Math.round(screen.width)), Math.max(1, Math.round(screen.height)));
  return true;
}

export function drawWorldRect(context, viewport, rect, { fill = null, stroke = null, lineWidth = 1, dash = null } = {}) {
  const screen = screenRect(viewport, rect);
  if (!visibleOnCanvas(viewport, screen)) return false;
  if (dash) context.setLineDash(dash); else context.setLineDash([]);
  context.lineWidth = lineWidth;
  if (fill) { context.fillStyle = fill; context.fillRect(screen.x, screen.y, screen.width, screen.height); }
  if (stroke) { context.strokeStyle = stroke; context.strokeRect(Math.round(screen.x) + .5, Math.round(screen.y) + .5, Math.max(1, Math.round(screen.width)), Math.max(1, Math.round(screen.height))); }
  context.setLineDash([]);
  return true;
}

export function worldToScreen(viewport, point) { return viewport.worldToScreen(point.x, point.y); }
