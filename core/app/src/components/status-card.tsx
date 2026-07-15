import type { ReactNode } from "react";

export function StatusCard({ index, title, state, tone, children }: { index: string; title: string; state: string; tone: "dark" | "cream" | "coral"; children: ReactNode }) {
  return <article className={`status-card ${tone}`}><header><span>{index}</span><span>{state}</span></header><h3>{title}</h3><p>{children}</p><div className="card-rule" /></article>;
}
