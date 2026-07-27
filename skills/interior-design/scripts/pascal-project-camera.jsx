import React, { useEffect, useMemo, useRef } from 'react';
import { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useViewer } from '@pascal-app/viewer';

export function ProjectCamera({ payload }) {
  const controls = useRef(null);
  const activeMode = useRef('perspective');
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const cameraMode = useViewer((state) => state.cameraMode);
  const frame = useMemo(() => {
    const points = Object.values(payload.scene?.nodes || {})
      .filter((node) => node.type === 'zone' && Array.isArray(node.polygon))
      .flatMap((node) => node.polygon);
    const minX = Math.min(...points.map((point) => point[0]), 0);
    const maxX = Math.max(...points.map((point) => point[0]), 8);
    const minZ = Math.min(...points.map((point) => point[1]), 0);
    const maxZ = Math.max(...points.map((point) => point[1]), 8);
    return {
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      span: Math.max(maxX - minX, maxZ - minZ, 8),
    };
  }, [payload]);

  useEffect(() => {
    const applyPose = async (mode = cameraMode) => {
      activeMode.current = mode;
      const api = controls.current;
      if (!api) return;
      const aspect = size.height > 0 ? size.width / size.height : 16 / 9;
      const narrowViewportScale = Math.max(1, 1.5 / aspect);
      if (mode === 'orthographic') {
        await api.setLookAt(
          frame.centerX,
          frame.span * 2.35 * narrowViewportScale,
          frame.centerZ + 0.001,
          frame.centerX,
          0,
          frame.centerZ,
          false,
        );
      } else {
        await api.setLookAt(
          frame.centerX + frame.span * 1.12 * narrowViewportScale,
          frame.span * 0.71 * narrowViewportScale,
          frame.centerZ + frame.span * 1.12 * narrowViewportScale,
          frame.centerX,
          1.15,
          frame.centerZ,
          false,
        );
      }
      invalidate();
    };
    const reset = () => { void applyPose(activeMode.current); };
    const changeMode = (event) => {
      const mode = event.detail;
      if (mode === 'perspective' || mode === 'orthographic') void applyPose(mode);
    };
    activeMode.current = cameraMode;
    void applyPose();
    const settleTimers = [160, 520, 1_100, 1_900, 2_800]
      .map((delay) => window.setTimeout(reset, delay));
    window.addEventListener('pascal-reset-camera', reset);
    window.addEventListener('pascal-camera-mode', changeMode);
    return () => {
      settleTimers.forEach(window.clearTimeout);
      window.removeEventListener('pascal-reset-camera', reset);
      window.removeEventListener('pascal-camera-mode', changeMode);
    };
  }, [cameraMode, frame, invalidate, size.height, size.width]);

  return <CameraControls
    camera={camera}
    dollyToCursor
    key={cameraMode}
    makeDefault
    maxDistance={frame.span * 5}
    minDistance={Math.max(2, frame.span * 0.16)}
    ref={controls}
  />;
}
