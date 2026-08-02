import React, { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useViewer } from '@pascal-app/viewer';
import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace } from 'three';
import { resolveDeliveryDpr } from './pascal-render-budget.mjs';

export function DeliveryRenderBudget() {
  const [deviceDpr, setDeviceDpr] = useState(() => window.devicePixelRatio || 1);
  const currentDpr = useThree((state) => state.viewport.dpr);
  const setDpr = useThree((state) => state.setDpr);
  const size = useThree((state) => state.size);
  const renderer = useThree((state) => state.gl);
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
    const previous = {
      colorSpace: renderer.outputColorSpace,
      shadowEnabled: renderer.shadowMap.enabled,
      shadowType: renderer.shadowMap.type,
      toneMapping: renderer.toneMapping,
    };
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.shadowMap.needsUpdate = true;
    return () => {
      renderer.outputColorSpace = previous.colorSpace;
      renderer.toneMapping = previous.toneMapping;
      renderer.shadowMap.enabled = previous.shadowEnabled;
      renderer.shadowMap.type = previous.shadowType;
    };
  }, [renderer]);

  useEffect(() => {
    if (desiredDpr === null) return;
    document.body.dataset.renderDpr = desiredDpr.toFixed(2);
    document.body.dataset.renderResolution = `${Math.round(size.width * desiredDpr)}x${Math.round(size.height * desiredDpr)}`;
  }, [desiredDpr, size.height, size.width]);

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
