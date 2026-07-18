"use client";

import { Children, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computeOrderedMasonryLayout, type MasonryPosition } from "./page-masonry-layout";

type MasonryState = { positions: MasonryPosition[]; columnWidth: number; height: number };

export function OrderedPageGrid({ children, layoutKey }: { children: ReactNode; layoutKey: string }) {
  const items = useMemo(() => Children.toArray(children), [children]);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const [layout, setLayout] = useState<MasonryState>({ positions: [], columnWidth: 0, height: 0 });

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container || !items.length) {
      setLayout((current) => current.positions.length ? { positions: [], columnWidth: 0, height: 0 } : current);
      return;
    }
    const columnGap = 12;
    const columnWidth = Math.max(0, (container.clientWidth - columnGap) / 2);
    const elements = Array.from(container.children) as HTMLElement[];
    elements.forEach((element) => { element.style.width = `${columnWidth}px`; });
    const heights = elements.map((element) => element.offsetHeight);
    const next = computeOrderedMasonryLayout(heights, columnWidth, columnGap);
    setLayout((current) => layoutsMatch(current, next, columnWidth)
      ? current
      : { positions: next.positions, columnWidth, height: next.height });
  }, [items.length, layoutKey]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(container);
    Array.from(container.children).forEach((element) => observer.observe(element));
    void document.fonts?.ready.then(scheduleMeasure);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [measure]);

  const ready = layout.positions.length === items.length;
  return <div
    className={`mobile-page-grid mobile-list-start${ready ? " is-ready" : ""}`}
    ref={containerRef}
    style={{ height: ready && items.length ? layout.height + 24 : 0 }}
  >
    {items.map((item, index) => <div
      className="mobile-page-grid-item"
      style={ready ? {
        width: layout.columnWidth,
        transform: `translate3d(${layout.positions[index].x}px, ${layout.positions[index].y + 12}px, 0)`,
      } : undefined}
      key={(item as { key?: string }).key || index}
    >{item}</div>)}
  </div>;
}

function layoutsMatch(current: MasonryState, next: { positions: MasonryPosition[]; height: number }, columnWidth: number) {
  if (current.columnWidth !== columnWidth || current.height !== next.height || current.positions.length !== next.positions.length) return false;
  return current.positions.every((position, index) => position.x === next.positions[index].x && position.y === next.positions[index].y);
}
