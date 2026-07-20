import { calculateBounds } from './scene-geometry.mjs';

export function startProjectionFallback(canvas, model) {
  const context = canvas.getContext('2d');
  let angle = -0.72, zoom = 1, focus = '', mode = 'overall', dragging = false, lastX = 0;
  const bounds = model.project.bounds || calculateBounds(model.rooms);
  const visible = (item) => mode === 'lower' ? (item.levelId || 'lower') === 'lower' : mode === 'upper' ? item.levelId === 'upper' : true;
  const render = () => {
    const ratio = Math.min(devicePixelRatio, 2), width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#f5f4ef'; context.fillRect(0, 0, width, height);
    const room = model.rooms.find((entry) => entry.id === focus), fit = room ? calculateBounds([room]) : bounds;
    const span = Math.max(fit.maxX - fit.minX, fit.maxZ - fit.minZ, 2), scale = Math.min(width, height) / span * 0.54 * zoom;
    const cx = (fit.maxX + fit.minX) / 2, cz = (fit.maxZ + fit.minZ) / 2;
    const project = ([x, z], y = 0) => { const dx = x - cx, dz = z - cz, rx = dx * Math.cos(angle) - dz * Math.sin(angle), rz = dx * Math.sin(angle) + dz * Math.cos(angle); return [width / 2 + rx * scale, height / 2 + (rz * 0.42 - y * 0.72) * scale]; };
    for (const entry of model.rooms.filter(visible)) {
      const points = entry.polygon.map((point) => project(point, entry.elevation || 0)); context.beginPath(); points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y)); context.closePath();
      context.fillStyle = model.materials.find((material) => material.id === entry.material)?.color || '#c9a77b'; context.fill(); context.lineWidth = 2; context.strokeStyle = '#f3f1eb'; context.stroke();
    }
    for (const wall of model.walls.filter(visible)) {
      if (mode === 'section' && wall.sectionHidden) continue;
      const base = wall.elevation || 0, a = project(wall.from, base + wall.height * 0.7), b = project(wall.to, base + wall.height * 0.7);
      context.beginPath(); context.moveTo(...a); context.lineTo(...b); context.lineWidth = Math.max(3, wall.thickness * scale); context.strokeStyle = '#f3f1eb'; context.stroke();
    }
  };
  new ResizeObserver(render).observe(canvas);
  canvas.addEventListener('pointerdown', (event) => { dragging = true; lastX = event.clientX; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => { if (!dragging) return; angle += (event.clientX - lastX) * 0.012; lastX = event.clientX; render(); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); zoom = Math.max(0.65, Math.min(2.2, zoom - event.deltaY * 0.001)); render(); }, { passive: false });
  render();
  return { update(view, roomId, displayMode) { focus = roomId; mode = displayMode; if (view === 'top') angle = 0; else if (view === 'walk') angle = -1.25; render(); }, setLighting() {} };
}
