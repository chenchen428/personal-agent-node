import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

function fallbackElement() {
  return document.getElementById('fallback');
}

export function markViewerReady() {
  document.body.dataset.viewerState = 'ready';
  const fallback = fallbackElement();
  if (fallback) fallback.hidden = true;
}

export function showViewerFallback() {
  document.body.dataset.viewerState = 'fallback';
  const fallback = fallbackElement();
  if (fallback) fallback.hidden = false;
}

export function ViewerLifecycle() {
  const validFrames = useRef(0);
  const readyScheduled = useRef(false);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const warmup = () => invalidate();
    const timers = [0, 40, 120, 260, 520, 900, 1500].map((delay) => setTimeout(warmup, delay));
    window.addEventListener('pascal-viewer-warmup', warmup);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('pascal-viewer-warmup', warmup);
    };
  }, [invalidate]);

  useFrame(() => {
    if (readyScheduled.current) return;
    const canvas = document.querySelector('#scene canvas');
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
    validFrames.current += 1;
    if (validFrames.current < 2) return;
    readyScheduled.current = true;
    requestAnimationFrame(() => {
      if (canvas.width > 0 && canvas.height > 0) markViewerReady();
    });
  });
  return null;
}
