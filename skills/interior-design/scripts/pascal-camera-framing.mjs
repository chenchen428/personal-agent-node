export const ORTHOGRAPHIC_VIEWPORT_FILL = 0.7;

export function calculateOrthographicZoom({
  boundsWidth,
  boundsDepth,
  viewportWidth,
  viewportHeight,
  fill = ORTHOGRAPHIC_VIEWPORT_FILL,
}) {
  const safeWidth = Math.max(Number(boundsWidth) || 0, 1);
  const safeDepth = Math.max(Number(boundsDepth) || 0, 1);
  const safeViewportWidth = Math.max(Number(viewportWidth) || 0, 1);
  const safeViewportHeight = Math.max(Number(viewportHeight) || 0, 1);
  const safeFill = Math.min(0.9, Math.max(0.3, Number(fill) || ORTHOGRAPHIC_VIEWPORT_FILL));
  return Math.min(
    (safeViewportWidth * safeFill) / safeWidth,
    (safeViewportHeight * safeFill) / safeDepth,
  );
}
