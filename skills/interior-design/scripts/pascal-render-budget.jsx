import React, { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useViewer } from '@pascal-app/viewer';
import { resolveDeliveryDpr } from './pascal-render-budget.mjs';

export function DeliveryRenderBudget() {
  const [deviceDpr, setDeviceDpr] = useState(() => window.devicePixelRatio || 1);
  const currentDpr = useThree((state) => state.viewport.dpr);
  const setDpr = useThree((state) => state.setDpr);
  const size = useThree((state) => state.size);
  const desiredDpr = resolveDeliveryDpr({
    width: size.width,
    height: size.height,
    deviceDpr,
  });

  useEffect(() => {
    const updateDeviceDpr = () => setDeviceDpr(window.devicePixelRatio || 1);
    window.addEventListener('resize', updateDeviceDpr);
    return () => window.removeEventListener('resize', updateDeviceDpr);
  }, []);

  useEffect(() => {
    if (desiredDpr !== null && Math.abs(currentDpr - desiredDpr) > 0.001) {
      setDpr(desiredDpr);
    }
  }, [currentDpr, desiredDpr, setDpr]);

  useEffect(() => {
    const target = document.getElementById('scene');
    if (!target) return undefined;
    let intersectsViewport = true;
    const updateRenderState = () => {
      const presentation = target.closest('[data-presentation-panel]');
      const presentationVisible = !presentation || !presentation.hidden;
      useViewer.getState().setRenderPaused(
        document.visibilityState !== 'visible' || !intersectsViewport || !presentationVisible,
      );
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersectsViewport = Boolean(entry?.isIntersecting);
      updateRenderState();
    });
    observer.observe(target);
    document.addEventListener('visibilitychange', updateRenderState);
    window.addEventListener('pascal-viewer-visibility', updateRenderState);
    updateRenderState();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', updateRenderState);
      window.removeEventListener('pascal-viewer-visibility', updateRenderState);
      useViewer.getState().setRenderPaused(false);
    };
  }, []);

  return null;
}
