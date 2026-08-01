import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

const SETTLE_DELAYS = [0, 80, 220, 520];

export function LandscapeViewportBridge() {
  const invalidate = useThree((state) => state.invalidate);
  const setSize = useThree((state) => state.setSize);

  useEffect(() => {
    const target = document.getElementById('scene');
    if (!target) return undefined;
    let animationFrame = 0;
    let settleTimers = [];

    const apply = () => {
      const forcedLandscape = document.body.dataset.mobileLayout === 'forced-landscape';
      const bounds = target.getBoundingClientRect();
      const width = forcedLandscape ? target.offsetWidth : bounds.width;
      const height = forcedLandscape ? target.offsetHeight : bounds.height;
      if (!(width > 0 && height > 0)) return;
      setSize(width, height, 0, 0);
      document.body.dataset.viewerViewport = forcedLandscape ? 'virtual-landscape' : 'native';
      invalidate();
    };

    const schedule = () => {
      window.cancelAnimationFrame(animationFrame);
      settleTimers.forEach(window.clearTimeout);
      animationFrame = window.requestAnimationFrame(apply);
      settleTimers = SETTLE_DELAYS.slice(1).map((delay) => window.setTimeout(apply, delay));
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    window.addEventListener('resize', schedule);
    window.addEventListener('pascal-layout-change', schedule);
    schedule();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      settleTimers.forEach(window.clearTimeout);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pascal-layout-change', schedule);
      delete document.body.dataset.viewerViewport;
    };
  }, [invalidate, setSize]);

  return null;
}
