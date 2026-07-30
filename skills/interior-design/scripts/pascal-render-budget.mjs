export const DELIVERY_DPR_CAP = 1.25;
export const DELIVERY_DPR_FLOOR = 0.01;
export const DELIVERY_MAX_RENDER_EDGE = 2_048;
export const DELIVERY_PIXEL_BUDGET = 1_400_000;

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
  const resolved = Math.min(safeDeviceDpr, DELIVERY_DPR_CAP, budgetDpr, edgeDpr);
  return Math.max(DELIVERY_DPR_FLOOR, Math.floor(resolved * 100) / 100);
}
