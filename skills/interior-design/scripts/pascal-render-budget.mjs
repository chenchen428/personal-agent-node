export const DELIVERY_DPR_CAP = 2;
export const DELIVERY_DPR_FLOOR = 1;
export const DELIVERY_BASE_SUPERSAMPLE = 1.25;
export const DELIVERY_MAX_RENDER_EDGE = 4_096;
export const DELIVERY_PIXEL_BUDGET = 8_400_000;

export function resolveDeliveryDpr({ width, height, deviceDpr = 1 }) {
  const safeDeviceDpr = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const cssPixels = safeWidth * safeHeight;
  if (cssPixels === 0) return null;
  const budgetDpr = Math.sqrt(DELIVERY_PIXEL_BUDGET / cssPixels);
  const edgeDpr = Math.min(
    DELIVERY_MAX_RENDER_EDGE / safeWidth,
    DELIVERY_MAX_RENDER_EDGE / safeHeight,
  );
  const hardLimit = Math.min(DELIVERY_DPR_CAP, budgetDpr, edgeDpr);
  const requested = Math.max(safeDeviceDpr, DELIVERY_BASE_SUPERSAMPLE);
  const resolved = Math.min(requested, hardLimit);
  const boundedFloor = Math.min(DELIVERY_DPR_FLOOR, hardLimit);
  return Math.max(boundedFloor, Math.floor(resolved * 100) / 100);
}
