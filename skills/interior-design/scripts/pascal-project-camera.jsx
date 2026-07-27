import React, { useEffect, useMemo, useRef } from 'react';
import { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useViewer } from '@pascal-app/viewer';
import { Sphere, Vector3 } from 'three';

export function ProjectCamera({ payload }) {
  const controls = useRef(null);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
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
      sphere: new Sphere(
        new Vector3((minX + maxX) / 2, 1.45, (minZ + maxZ) / 2),
        Math.hypot(maxX - minX, maxZ - minZ, 3) * 0.52,
      ),
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      span: Math.max(maxX - minX, maxZ - minZ, 8),
    };
  }, [payload]);

  useEffect(() => {
    const applyPose = async (mode = cameraMode) => {
      const api = controls.current;
      if (!api) return;
      if (mode === 'orthographic') {
        await api.setLookAt(frame.centerX, frame.span * 1.6, frame.centerZ + 0.001, frame.centerX, 0, frame.centerZ, false);
      } else {
        await api.setLookAt(
          frame.centerX + frame.span * 0.92,
          frame.span * 1.16,
          frame.centerZ + frame.span * 0.92,
          frame.centerX,
          0.72,
          frame.centerZ,
          false,
        );
      }
      await api.fitToSphere(frame.sphere, false);
      invalidate();
    };
    const reset = () => { void applyPose('perspective'); };
    void applyPose();
    window.addEventListener('pascal-reset-camera', reset);
    return () => window.removeEventListener('pascal-reset-camera', reset);
  }, [cameraMode, frame, invalidate]);

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
