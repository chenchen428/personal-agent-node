import React, { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

const MOBILE_LABEL_LIMIT = 7;
const DESKTOP_LABEL_LIMIT = 10;
const LABEL_GAP = 5;

function polygonArea(polygon) {
  return Math.abs(polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

function overlaps(a, b) {
  return a.left < b.right + LABEL_GAP
    && a.right + LABEL_GAP > b.left
    && a.top < b.bottom + LABEL_GAP
    && a.bottom + LABEL_GAP > b.top;
}

export function SceneLabels({ payload }) {
  const animationFrame = useRef(0);
  const elements = useRef(new Map());
  const labels = useMemo(() => Object.values(payload.scene?.nodes || {})
    .filter((node) => node.type === 'zone' && Array.isArray(node.polygon) && node.polygon.length >= 3)
    .map((node, index) => ({
      area: polygonArea(node.polygon),
      dark: [1, 4, 7, 8, 12].includes(index),
      id: node.id,
      name: node.name,
      position: [
        node.polygon.reduce((sum, point) => sum + point[0], 0) / node.polygon.length,
        1.35,
        node.polygon.reduce((sum, point) => sum + point[1], 0) / node.polygon.length,
      ],
    }))
    .sort((left, right) => right.area - left.area), [payload]);

  const layout = () => {
    const mobile = document.body.dataset.mobileLayout === 'forced-landscape'
      || document.body.dataset.mobileLayout === 'landscape';
    const appBounds = document.getElementById('app')?.getBoundingClientRect();
    const placed = [];
    labels.forEach((label) => {
      const element = elements.current.get(label.id);
      if (!element) return;
      if (!appBounds) {
        delete element.dataset.collided;
        return;
      }
      const bounds = element.getBoundingClientRect();
      const outside = bounds.left < appBounds.left + LABEL_GAP
        || bounds.right > appBounds.right - LABEL_GAP
        || bounds.top < appBounds.top + LABEL_GAP
        || bounds.bottom > appBounds.bottom - LABEL_GAP;
      const blocked = outside
        || placed.length >= (mobile ? MOBILE_LABEL_LIMIT : DESKTOP_LABEL_LIMIT)
        || placed.some((entry) => overlaps(bounds, entry));
      if (blocked) element.dataset.collided = 'true';
      else {
        delete element.dataset.collided;
        placed.push(bounds);
      }
    });
    document.body.dataset.labelLayout = 'decluttered';
  };

  const scheduleLayout = () => {
    window.cancelAnimationFrame(animationFrame.current);
    animationFrame.current = window.requestAnimationFrame(layout);
  };

  useFrame(scheduleLayout);
  useEffect(() => {
    window.addEventListener('resize', scheduleLayout);
    window.addEventListener('pascal-layout-change', scheduleLayout);
    scheduleLayout();
    return () => {
      window.cancelAnimationFrame(animationFrame.current);
      window.removeEventListener('resize', scheduleLayout);
      window.removeEventListener('pascal-layout-change', scheduleLayout);
      delete document.body.dataset.labelLayout;
    };
  }, [labels]);

  return labels.map((label) => <Html
    center
    className={`pascal-room-label${label.dark ? ' is-dark' : ''}`}
    key={label.id}
    position={label.position}
  >
    <span ref={(element) => {
      if (element) elements.current.set(label.id, element);
      else elements.current.delete(label.id);
    }}>{label.name}</span>
  </Html>);
}
