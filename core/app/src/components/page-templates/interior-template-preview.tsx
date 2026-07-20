"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { interiorRooms } from "./interior-template-model";
import { InteriorTemplateCanvas } from "./interior-template-canvas";
import type { InteriorView } from "./interior-template-scene";

export function InteriorTemplatePreview({ device }: { device: "web" | "mobile" }) {
  const [view, setView] = useState<InteriorView>("iso");
  const [roomId, setRoomId] = useState("");
  const reset = () => { setRoomId(""); setView("iso"); };
  return <section className={`interior-template-preview device-${device}`} aria-label="装修设计交付页实时预览">
    <div className="interior-template-shell">
      <header className="interior-template-header">
        <span className="interior-template-mark">PA</span>
        <div><strong>C 户型 · 现代温润</strong><small>135.08 m² · 概念方案</small></div>
        <div className="interior-mobile-room"><span>当前空间</span><Select value={roomId || "all"} onValueChange={(value) => setRoomId(value === "all" ? "" : value)}><SelectTrigger aria-label="进入空间查看细节"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">整体方案 · 完整户型</SelectItem>{interiorRooms.map((room) => <SelectItem value={room.id} key={room.id}>{room.name} · {room.note}</SelectItem>)}</SelectContent></Select></div>
        <span className="interior-template-status"><i />完成态模型 · 手动查看</span>
      </header>
      <div className="interior-template-stage">
        <nav className="interior-room-browser" aria-label="浏览空间">
          <span>浏览空间</span>
          <Button className={!roomId ? "active" : ""} variant="ghost" size="sm" aria-current={!roomId ? "page" : undefined} onClick={() => setRoomId("")}><b>00</b><strong>整体方案</strong><small>完整户型</small></Button>
          {interiorRooms.map((room, index) => <Button className={roomId === room.id ? "active" : ""} variant="ghost" size="sm" aria-current={roomId === room.id ? "page" : undefined} onClick={() => setRoomId(room.id)} key={room.id}><b>{String(index + 1).padStart(2, "0")}</b><strong>{room.name}</strong><small>{room.note}</small></Button>)}
        </nav>
        <div className="interior-template-viewport"><InteriorTemplateCanvas view={view} roomId={roomId} /><span className="interior-gesture-hint">拖动旋转 · 滚轮或双指缩放 · 右键平移</span></div>
        <div className="interior-view-toolbar" role="group" aria-label="切换查看视角">
          <button className={view === "iso" ? "active" : ""} type="button" onClick={() => setView("iso")}>3D 鸟瞰</button>
          <button className={view === "top" ? "active" : ""} type="button" onClick={() => setView("top")}>平面</button>
          <button className={view === "walk" ? "active" : ""} type="button" onClick={() => setView("walk")}>室内</button>
          <button type="button" aria-label="重置为完整户型的 3D 鸟瞰" title="重置" onClick={reset}><RotateCcw aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  </section>;
}
