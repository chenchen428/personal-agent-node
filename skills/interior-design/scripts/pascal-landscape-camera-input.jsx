import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import {
  calculateForcedLandscapeOrbit,
  calculatePinchScale,
  resolveLandscapeCameraInput,
} from './pascal-landscape-gesture.mjs';

function isForcedLandscape() {
  return resolveLandscapeCameraInput(document.body.dataset.mobileLayout) === 'landscape-mapped';
}

function pointerDistance(points) {
  if (points.length < 2) return 0;
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

export function useLandscapeCameraInput({ controls, markUserCameraPose }) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const [forcedLandscape, setForcedLandscape] = useState(isForcedLandscape);

  useEffect(() => {
    const update = () => setForcedLandscape(isForcedLandscape());
    window.addEventListener('pascal-layout-change', update);
    update();
    return () => window.removeEventListener('pascal-layout-change', update);
  }, []);

  useEffect(() => {
    const api = controls.current;
    if (!forcedLandscape || !api || !canvas) return undefined;
    const pointers = new Map();
    const originalTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    document.body.dataset.cameraInput = 'landscape-mapped';

    const stopNativeGesture = (event) => {
      if (event.cancelable) event.preventDefault();
    };
    const pointerDown = (event) => {
      stopNativeGesture(event);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture?.(event.pointerId);
      markUserCameraPose();
    };
    const pointerMove = (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      stopNativeGesture(event);
      const before = [...pointers.values()];
      const current = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, current);
      if (pointers.size === 1) {
        const orbit = calculateForcedLandscapeOrbit({
          deltaX: current.x - previous.x,
          deltaY: current.y - previous.y,
          viewportHeight: canvas.offsetHeight,
          azimuthSpeed: api.azimuthRotateSpeed,
          polarSpeed: api.polarRotateSpeed,
        });
        void api.rotate(orbit.azimuth, orbit.polar, true);
        return;
      }
      const scale = calculatePinchScale(pointerDistance(before), pointerDistance([...pointers.values()]));
      if (scale === 1) return;
      if (camera.isOrthographicCamera) void api.zoomTo(camera.zoom * scale, true);
      else void api.dollyTo(api.distance / scale, true);
    };
    const pointerEnd = (event) => {
      pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const wheel = (event) => {
      stopNativeGesture(event);
      markUserCameraPose();
      const scale = Math.exp(-event.deltaY * 0.0015);
      if (camera.isOrthographicCamera) void api.zoomTo(camera.zoom * scale, true);
      else void api.dollyTo(api.distance / scale, true);
    };

    canvas.addEventListener('pointerdown', pointerDown, { passive: false });
    canvas.addEventListener('pointermove', pointerMove, { passive: false });
    canvas.addEventListener('pointerup', pointerEnd);
    canvas.addEventListener('pointercancel', pointerEnd);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      pointers.clear();
      canvas.style.touchAction = originalTouchAction;
      delete document.body.dataset.cameraInput;
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerEnd);
      canvas.removeEventListener('pointercancel', pointerEnd);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [camera, canvas, controls, forcedLandscape, markUserCameraPose]);

  return forcedLandscape;
}
