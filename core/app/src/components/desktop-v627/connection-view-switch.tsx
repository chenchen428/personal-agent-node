"use client";

import { CircleCheck, ListFilter } from "lucide-react";

export type ConnectionView = "all" | "effective";

export function ConnectionViewSwitch({ value, effectiveCount, loading = false, onChange }: { value: ConnectionView; effectiveCount: number; loading?: boolean; onChange: (view: ConnectionView) => void }) {
  return <div className="task-view-navigation connection-view-navigation" role="group" aria-label="连接视图">
    <button className={value === "all" ? "active" : ""} type="button" disabled={loading} aria-pressed={value === "all"} onClick={() => onChange("all")}><ListFilter /><span>全部</span></button>
    <button className={value === "effective" ? "active" : ""} type="button" disabled={loading} aria-pressed={value === "effective"} onClick={() => onChange("effective")}><CircleCheck /><span>已生效</span><small>{loading ? "…" : effectiveCount}</small></button>
  </div>;
}
