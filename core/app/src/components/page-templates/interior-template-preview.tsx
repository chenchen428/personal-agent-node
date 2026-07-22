"use client";

import { Check, ChevronDown, ClipboardList, FileImage, Minus, Plus, RotateCcw, Tags } from "lucide-react";
import { useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InteriorTemplateCanvas } from "./interior-template-canvas";
import type { InteriorView } from "./interior-template-scene";

type Presentation = "model" | "plan" | "requirements";
type Level = "level-1" | "level-2";
type PlanVersion = "original" | "revision";
type Viewport = { zoom: number; x: number; y: number };
type Gesture = { distance: number; center: [number, number]; viewport: Viewport };

export function InteriorTemplatePreview({ device }: { device: "web" | "mobile" }) {
  const [presentation, setPresentation] = useState<Presentation>("model");
  const [view, setView] = useState<InteriorView>("iso");
  const [labels, setLabels] = useState(true);
  const [level, setLevel] = useState<Level>("level-1");
  const [resetKey, setResetKey] = useState(0);
  const reset = () => { setView("iso"); setResetKey((value) => value + 1); };
  return <section className={`interior-template-preview device-${device}`} aria-label="装修设计交付页实时预览">
    <div className="interior-template-shell">
      <header className="interior-template-header"><span className="interior-template-brand"><span className="interior-template-mark">PA</span><b>Pages</b></span><div><small>PERSONAL AGENT · SU CONCEPT</small><strong>C 户型 · 现代温润</strong><em>135.08 m² · 原四房改三房 · 大客厅方案</em></div><span className="interior-template-status"><i />完成态模型 · 手动查看</span></header>
      <div className={`interior-template-stage is-${presentation}`}>
        {presentation === "model" ? <><InteriorTemplateCanvas labels={labels} level={level} resetKey={resetKey} view={view} /><ModelLabels level={level} visible={labels} /><div className="interior-view-toolbar" role="group" aria-label="SU 设计稿查看工具"><LevelMenu level={level} onLevelChange={(next) => { setLevel(next); reset(); }} /><button className={view === "iso" ? "active" : ""} type="button" onClick={() => setView("iso")}>3D</button><button className={view === "top" ? "active" : ""} type="button" onClick={() => setView("top")}>平面</button><button className={labels ? "active" : ""} aria-label={labels ? "隐藏细节标注" : "显示细节标注"} type="button" onClick={() => setLabels((value) => !value)}><Tags aria-hidden="true" /></button><button aria-label="复位 SU 设计稿" type="button" onClick={reset}><RotateCcw aria-hidden="true" /></button></div></> : presentation === "plan" ? <FloorPlan /> : <Requirements />}
        <nav className="interior-presentation-switch" aria-label="方案资料切换"><button aria-pressed={presentation === "model"} onClick={() => setPresentation("model")} type="button">SU 设计稿</button><button aria-pressed={presentation === "plan"} onClick={() => setPresentation("plan")} type="button"><FileImage aria-hidden="true" />户型图</button><button aria-pressed={presentation === "requirements"} onClick={() => setPresentation("requirements")} type="button"><ClipboardList aria-hidden="true" />用户需求</button></nav>
      </div>
      <footer className="interior-template-footer"><span>Personal Agent Pages</span></footer>
    </div>
  </section>;
}

function LevelMenu({ level, onLevelChange }: { level: Level; onLevelChange: (level: Level) => void }) {
  const label = level === "level-1" ? "1 层" : "2 层";
  return <DropdownMenu><DropdownMenuTrigger asChild><button className="interior-level-trigger" type="button">{label}<ChevronDown aria-hidden="true" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" sideOffset={8} className="interior-level-menu" aria-label="切换 SU 设计稿楼层"><DropdownMenuItem onSelect={() => onLevelChange("level-1")}><span>1 层 · 大客厅</span>{level === "level-1" ? <Check aria-hidden="true" /> : null}</DropdownMenuItem><DropdownMenuItem onSelect={() => onLevelChange("level-2")}><span>2 层 · 局部书房</span>{level === "level-2" ? <Check aria-hidden="true" /> : null}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

function ModelLabels({ level, visible }: { level: Level; visible: boolean }) {
  if (!visible) return null;
  if (level === "level-2") return <div className="interior-model-labels" aria-label="二层方案细节标注"><span className="label-loft">二层 · 局部书房</span><span className="label-living">挑空保留区</span></div>;
  return <div className="interior-model-labels" aria-label="一层方案细节标注"><span className="label-entry">入户门</span><span className="label-living">大客厅 · 6 米挑高</span><span className="label-balcony">南向落地窗</span></div>;
}

function FloorPlan() {
  const [version, setVersion] = useState<PlanVersion>("original");
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, [number, number]>());
  const gesture = useRef<Gesture | null>(null);
  const clamp = (value: number) => Math.max(.7, Math.min(2.3, Number(value.toFixed(2))));
  const zoom = (next: number) => setViewport((current) => ({ ...current, zoom: clamp(next), x: next === 1 ? 0 : current.x, y: next === 1 ? 0 : current.y }));
  const begin = (event: PointerEvent<HTMLDivElement>) => { pointers.current.set(event.pointerId, [event.clientX, event.clientY]); event.currentTarget.setPointerCapture(event.pointerId); gesture.current = createGesture(pointers.current, viewport); };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
    const points = [...pointers.current.values()], current = gesture.current;
    if (points.length > 1) { const center = midpoint(points[0], points[1]); setViewport({ zoom: clamp(current.viewport.zoom * distance(points[0], points[1]) / current.distance), x: current.viewport.x + center[0] - current.center[0], y: current.viewport.y + center[1] - current.center[1] }); }
    else setViewport({ ...current.viewport, x: current.viewport.x + points[0][0] - current.center[0], y: current.viewport.y + points[0][1] - current.center[1] });
  };
  const end = (event: PointerEvent<HTMLDivElement>) => { pointers.current.delete(event.pointerId); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); gesture.current = createGesture(pointers.current, viewport); };
  const wheel = (event: WheelEvent<HTMLDivElement>) => { event.preventDefault(); zoom(viewport.zoom + (event.deltaY > 0 ? -.12 : .12)); };
  return <figure className="interior-source-plan"><div className="interior-source-viewport" onPointerCancel={end} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onWheel={wheel}><div className="interior-source-transform" style={{ transform: `translate3d(${viewport.x}px,${viewport.y}px,0) scale(${viewport.zoom})` }}><img alt={version === "original" ? "脱敏后的原始户型图" : "基于原图的户型调整标注"} draggable={false} src="/assets/templates/interior-design-source-plan-redacted-v2.png" />{version === "revision" ? <div className="interior-plan-revisions"><span className="revision-room" /><i className="revision-wall revision-wall-left" /><i className="revision-wall revision-wall-bottom" /><span className="revision-label"><i>01</i><b>拆除餐厅右侧卧室</b><small>卧室并入公共区形成大客厅 · 待结构复核</small></span><span className="revision-wall-dimension"><i /><b>墙厚约 220mm</b></span></div> : null}</div></div><div className="interior-plan-toolbox"><div><button aria-pressed={version === "original"} onClick={() => setVersion("original")} type="button">原始图</button><button aria-pressed={version === "revision"} onClick={() => setVersion("revision")} type="button">调整标注</button></div><div><button aria-label="缩小户型图" onClick={() => zoom(viewport.zoom - .15)} type="button"><Minus /></button><output>{Math.round(viewport.zoom * 100)}%</output><button aria-label="放大户型图" onClick={() => zoom(viewport.zoom + .15)} type="button"><Plus /></button><button aria-label="复位户型图" onClick={() => setViewport({ zoom: 1, x: 0, y: 0 })} type="button"><RotateCcw /></button></div></div></figure>;
}

function Requirements() {
  const groups = [{ title: "空间结构", items: ["拆除餐厅右侧、生活阳台下方卧室的非承重隔墙", "该卧室并入公共区形成大客厅", "客厅保留 6 米挑高，二层仅设置局部书房", "墙厚约 220mm，实施前复核结构条件"] }, { title: "生活习惯", items: ["满足六人就餐与多人会客", "生活阳台保留洗烘与家政收纳", "书房兼顾日常办公和临时客房"] }, { title: "设计偏好", items: ["现代温润，减少高饱和装饰", "南向阳台保持通透，强化落地窗", "SU 设计稿标清门窗、柜体与空间关系"] }];
  return <section className="interior-requirements-view"><header><div><span>AGENT REQUIREMENT DIGEST</span><h2>用户需求核心点</h2></div><strong>R8 · 2026.07.21</strong></header><p>拆除餐厅右侧、生活阳台下方的卧室并入公共区形成大客厅；保留左下角靠凸窗卧室；中部客厅按 6 米挑高设计，二层只占用局部面积形成小书房并保留主要挑空。</p><div className="interior-requirement-groups">{groups.map((group) => <section key={group.title}><h3>{group.title}</h3><ul>{group.items.map((item) => <li key={item}>✓ {item}</li>)}</ul></section>)}</div><aside className="interior-requirement-history"><b>迭代脉络</b><span><strong>R8</strong>新增 6 米挑高与局部二层书房</span><span><strong>R7</strong>纠正拆除对象为餐厅右侧卧室</span></aside></section>;
}

function createGesture(pointers: Map<number, [number, number]>, viewport: Viewport): Gesture | null { const points = [...pointers.values()]; return points.length ? { center: points.length > 1 ? midpoint(points[0], points[1]) : points[0], distance: points.length > 1 ? distance(points[0], points[1]) : 1, viewport } : null; }
function midpoint(a: [number, number], b: [number, number]): [number, number] { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
function distance(a: [number, number], b: [number, number]) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
