const finite = value => Number.isFinite(Number(value));

export function beginViewportBackgroundClick(event, viewport) {
  return Object.freeze({
    pointerId:Number(event?.pointerId),
    clientX:finite(event?.clientX) ? Number(event.clientX) : 0,
    clientY:finite(event?.clientY) ? Number(event.clientY) : 0,
    scrollLeft:finite(viewport?.scrollLeft) ? Number(viewport.scrollLeft) : 0,
    scrollTop:finite(viewport?.scrollTop) ? Number(viewport.scrollTop) : 0
  });
}

export function isGenuineViewportBackgroundClick(start, event, viewport, { threshold = 3 } = {}) {
  if (!start || Number(event?.pointerId) !== Number(start.pointerId)) return false;
  const dx=Math.abs((finite(event?.clientX) ? Number(event.clientX) : start.clientX) - start.clientX);
  const dy=Math.abs((finite(event?.clientY) ? Number(event.clientY) : start.clientY) - start.clientY);
  const scrollLeft=finite(viewport?.scrollLeft) ? Number(viewport.scrollLeft) : 0;
  const scrollTop=finite(viewport?.scrollTop) ? Number(viewport.scrollTop) : 0;
  return dx < threshold && dy < threshold && scrollLeft === start.scrollLeft && scrollTop === start.scrollTop;
}
