"use client";

import { Minus, Plus, RotateCcw } from "lucide-react";
import { useRef, useState, type PointerEvent, type WheelEvent } from "react";

type PlanVersion = "original" | "revision";
type Viewport = { zoom: number; x: number; y: number };
type Gesture = { distance: number; center: [number, number]; viewport: Viewport };

export function InteriorTemplatePlan() {
  const [version, setVersion] = useState<PlanVersion>("original");
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, [number, number]>());
  const gesture = useRef<Gesture | null>(null);
  const clamp = (value: number) => Math.max(.7, Math.min(2.3, Number(value.toFixed(2))));
  const zoom = (next: number) => setViewport((current) => ({ ...current, zoom: clamp(next), x: next === 1 ? 0 : current.x, y: next === 1 ? 0 : current.y }));
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = createGesture(pointers.current, viewport);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    const points = [...pointers.current.values()];
    const current = gesture.current;
    if (points.length > 1) {
      const center = midpoint(points[0], points[1]);
      setViewport({ zoom: clamp(current.viewport.zoom * distance(points[0], points[1]) / current.distance), x: current.viewport.x + center[0] - current.center[0], y: current.viewport.y + center[1] - current.center[1] });
    } else {
      setViewport({ ...current.viewport, x: current.viewport.x + points[0][0] - current.center[0], y: current.viewport.y + points[0][1] - current.center[1] });
    }
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    gesture.current = createGesture(pointers.current, viewport);
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => { event.preventDefault(); zoom(viewport.zoom + (event.deltaY > 0 ? -.12 : .12)); };

  return <figure className="interior-source-plan">
    <div className="interior-source-viewport" onPointerCancel={end} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onWheel={wheel}>
      <div className="interior-source-transform" style={{ transform: `translate3d(${viewport.x}px,${viewport.y}px,0) scale(${viewport.zoom})` }}>
        <img alt={version === "original" ? "脱敏后的原始户型图" : "基于原图的户型调整标注"} draggable={false} src="/assets/templates/interior-design-source-plan-redacted-v2.png" />
        {version === "revision" ? <div className="interior-plan-revisions"><span className="revision-room" /><i className="revision-wall revision-wall-left" /><i className="revision-wall revision-wall-bottom" /><span className="revision-label"><i>01</i><b>拆除餐厅右侧卧室</b><small>卧室并入公共区形成大客厅 · 待结构复核</small></span><span className="revision-wall-dimension"><i /><b>墙厚约 220mm</b></span></div> : null}
      </div>
    </div>
    <div className="interior-plan-toolbox">
      <div><button aria-pressed={version === "original"} onClick={() => setVersion("original")} type="button">原始图</button><button aria-pressed={version === "revision"} onClick={() => setVersion("revision")} type="button">调整标注</button></div>
      <div><button aria-label="缩小户型图" onClick={() => zoom(viewport.zoom - .15)} type="button"><Minus /></button><output>{Math.round(viewport.zoom * 100)}%</output><button aria-label="放大户型图" onClick={() => zoom(viewport.zoom + .15)} type="button"><Plus /></button><button aria-label="复位户型图" onClick={() => setViewport({ zoom: 1, x: 0, y: 0 })} type="button"><RotateCcw /></button></div>
    </div>
  </figure>;
}

function createGesture(pointers: Map<number, [number, number]>, viewport: Viewport): Gesture | null {
  const points = [...pointers.values()];
  return points.length ? { center: points.length > 1 ? midpoint(points[0], points[1]) : points[0], distance: points.length > 1 ? distance(points[0], points[1]) : 1, viewport } : null;
}
function midpoint(a: [number, number], b: [number, number]): [number, number] { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
function distance(a: [number, number], b: [number, number]) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
