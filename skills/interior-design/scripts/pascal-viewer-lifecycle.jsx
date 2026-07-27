import React, { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

function fallbackElement() {
  return document.getElementById('fallback');
}

function loadingElement() {
  return document.getElementById('viewer-loading');
}

function updateStatus(text) {
  const status = document.querySelector('[data-viewer-status] span');
  if (status) status.textContent = text;
}

export function markViewerReady() {
  document.body.dataset.viewerState = 'ready';
  const loading = loadingElement();
  const fallback = fallbackElement();
  if (loading) loading.hidden = true;
  if (fallback) fallback.hidden = true;
  updateStatus('完成态模型 · 手动查看');
}

export function showViewerFallback() {
  document.body.dataset.viewerState = 'fallback';
  const loading = loadingElement();
  const fallback = fallbackElement();
  if (loading) loading.hidden = true;
  if (fallback) fallback.hidden = false;
  updateStatus('3D 暂不可用 · 查看模型图');
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
