import React, { useEffect, useMemo, useRef } from 'react';
import { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useViewer } from '@pascal-app/viewer';
import { calculateOrthographicZoom } from './pascal-camera-framing.mjs';
import { useLandscapeCameraInput } from './pascal-landscape-camera-input.jsx';

export function ProjectCamera({ payload }) {
  const controls = useRef(null);
  const activeMode = useRef('perspective');
  const activeShot = useRef(payload.designQuality?.cameras?.[0]?.cameraId || null);
  const hasUserCameraPose = useRef(false);
  const settleTimers = useRef([]);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const viewport = useRef(size);
  const cameraMode = useViewer((state) => state.cameraMode);
  const frame = useMemo(() => {
    const points = Object.values(payload.scene?.nodes || {})
      .filter((node) => node.type === 'zone' && Array.isArray(node.polygon))
      .flatMap((node) => node.polygon);
    const minX = Math.min(...points.map((point) => point[0]), 0);
    const maxX = Math.max(...points.map((point) => point[0]), 8);
    const minZ = Math.min(...points.map((point) => point[1]), 0);
    const maxZ = Math.max(...points.map((point) => point[1]), 8);
    const width = Math.max(maxX - minX, 1);
    const depth = Math.max(maxZ - minZ, 1);
    return {
      centerX: (minX + maxX) / 2,
      centerZ: (minZ + maxZ) / 2,
      depth,
      span: Math.max(width, depth, 8),
      width,
    };
  }, [payload]);

  useEffect(() => {
    viewport.current = size;
  }, [size]);

  useEffect(() => {
    const clearSettleTimers = () => {
      settleTimers.current.forEach(window.clearTimeout);
      settleTimers.current = [];
    };
    const applyPose = async (mode = cameraMode) => {
      activeMode.current = mode;
      const api = controls.current;
      if (!api) return;
      const currentViewport = viewport.current;
      const aspect = currentViewport.height > 0
        ? currentViewport.width / currentViewport.height
        : 16 / 9;
      const narrowViewportScale = Math.max(1, 1.5 / aspect);
      const shot = payload.designQuality?.cameras?.find((entry) => entry.cameraId === activeShot.current);
      if (mode === 'orthographic') {
        const zoom = calculateOrthographicZoom({
          boundsWidth: frame.width,
          boundsDepth: frame.depth,
          viewportWidth: currentViewport.width,
          viewportHeight: currentViewport.height,
        });
        await api.setLookAt(
          frame.centerX,
          frame.span * 2.35 * narrowViewportScale,
          frame.centerZ + 0.001,
          frame.centerX,
          0,
          frame.centerZ,
          false,
        );
        await api.zoomTo(zoom, false);
      } else if (shot?.position && shot?.target) {
        if ('fov' in camera) {
          camera.fov = shot.fov || 50;
          camera.updateProjectionMatrix();
        }
        await api.setLookAt(...shot.position, ...shot.target, false);
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
    const reset = (event) => {
      const automatic = event?.detail?.automatic === true;
      if (automatic && hasUserCameraPose.current) return;
      if (!automatic) {
        hasUserCameraPose.current = false;
        clearSettleTimers();
      }
      void applyPose(activeMode.current);
    };
    const changeMode = (event) => {
      const mode = event.detail;
      if (mode === 'perspective' || mode === 'orthographic') {
        hasUserCameraPose.current = false;
        clearSettleTimers();
        void applyPose(mode);
      }
    };
    const changeShot = (event) => {
      if (!payload.designQuality?.cameras?.some((entry) => entry.cameraId === event.detail)) return;
      activeShot.current = event.detail;
      hasUserCameraPose.current = false;
      clearSettleTimers();
      void applyPose('perspective');
    };
    activeMode.current = cameraMode;
    void applyPose();
    settleTimers.current = [160, 520, 1_100, 1_900, 2_800]
      .map((delay) => window.setTimeout(
        () => reset({ detail: { automatic: true } }),
        delay,
      ));
    window.addEventListener('pascal-reset-camera', reset);
    window.addEventListener('pascal-camera-mode', changeMode);
    window.addEventListener('pascal-camera-shot', changeShot);
    return () => {
      clearSettleTimers();
      window.removeEventListener('pascal-reset-camera', reset);
      window.removeEventListener('pascal-camera-mode', changeMode);
      window.removeEventListener('pascal-camera-shot', changeShot);
    };
  }, [camera, cameraMode, frame, invalidate, payload]);

  const markUserCameraPose = React.useCallback(() => {
    hasUserCameraPose.current = true;
    settleTimers.current.forEach(window.clearTimeout);
    settleTimers.current = [];
  }, []);
  const forcedLandscape = useLandscapeCameraInput({ controls, markUserCameraPose });

  return <CameraControls
    camera={camera}
    dollyToCursor
    enabled={!forcedLandscape}
    key={cameraMode}
    makeDefault
    maxDistance={frame.span * 5}
    maxPolarAngle={Math.PI / 2 - 0.05}
    minDistance={Math.max(2, frame.span * 0.16)}
    onStart={markUserCameraPose}
    ref={controls}
  />;
}
