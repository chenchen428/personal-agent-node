const FULL_TURN = Math.PI * 2;

export function resolveLandscapeCameraInput(mobileLayout) {
  return mobileLayout === 'forced-landscape' ? 'landscape-mapped' : 'native';
}

export function mapForcedLandscapeDrag(deltaX, deltaY) {
  const x = Number(deltaY) || 0;
  const y = -(Number(deltaX) || 0);
  return {
    x: Object.is(x, -0) ? 0 : x,
    y: Object.is(y, -0) ? 0 : y,
  };
}

export function calculateForcedLandscapeOrbit({
  deltaX,
  deltaY,
  viewportHeight,
  azimuthSpeed = 1,
  polarSpeed = 1,
}) {
  const mapped = mapForcedLandscapeDrag(deltaX, deltaY);
  const safeHeight = Math.max(Number(viewportHeight) || 0, 1);
  return {
    azimuth: FULL_TURN * (Number(azimuthSpeed) || 0) * mapped.x / safeHeight,
    polar: FULL_TURN * (Number(polarSpeed) || 0) * mapped.y / safeHeight,
  };
}

export function calculatePinchScale(previousDistance, currentDistance) {
  const previous = Number(previousDistance) || 0;
  const current = Number(currentDistance) || 0;
  if (!(previous > 0 && current > 0)) return 1;
  return Math.min(1.35, Math.max(0.74, current / previous));
}
