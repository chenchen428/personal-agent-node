"use client";

import { Brain, CalendarDays, Clock3, Flame, Inbox, LoaderCircle, MousePointerClick, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useJson, formatDateTime } from "./shared";
import { Badge } from "../desktop-v72/primitives";
import { SettingsLayout } from "../desktop-v72/settings-layout";
import { SettingsCollectionLayout } from "../desktop-v72/settings-collection-layout";

type MemoryStatus = "active" | "forgotten";
type Memory = {
  id: string; content: string; status: MemoryStatus; hitCount: number; heat: number;
  lastHitAt: string; forgetAt: string; revision: number; createdAt: string; updatedAt: string;
};
type MemoryResponse = {
  items: Memory[]; counts: { active: number; forgotten: number };
  space: { id: string; slug: string; displayName: string };
};

export function MemoryPage() {
  const [status, setStatus] = useState<MemoryStatus>("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const url = useMemo(() => `/api/memories?status=${status}&query=${encodeURIComponent(query)}&limit=200`, [query, status]);
  const { value, loading, error, refresh } = useJson<MemoryResponse>(url);
  const items = value?.items || [];
  const activeId = items.some((item) => item.id === selectedId) ? selectedId : items[0]?.id || "";
  const selected = items.find((item) => item.id === activeId);
  const spaceName = value?.space.displayName || "当前空间";

  useEffect(() => {
    if (!selectedId || !items.some((item) => item.id === selectedId)) setSelectedId(items[0]?.id || "");
  }, [items, selectedId]);

  return <SettingsLayout active="memory"><SettingsCollectionLayout
    title="记忆"
    actions={<nav className="memory-status-tabs" aria-label="记忆状态"><button className={status === "active" ? "active" : ""} type="button" onClick={() => setStatus("active")}>生效 <span>{value?.counts.active || 0}</span></button><button className={status === "forgotten" ? "active" : ""} type="button" onClick={() => setStatus("forgotten")}>遗忘 <span>{value?.counts.forgotten || 0}</span></button></nav>}
    rows={items.map((memory) => ({
      id: memory.id,
      title: memoryHeadline(memory.content),
      summary: `${memory.status === "active" ? "生效" : "遗忘"} · 命中 ${memory.hitCount} 次 · ${memory.lastHitAt ? `最后命中 ${relativeMemoryTime(memory.lastHitAt)}` : "尚未命中"}`,
      time: memory.status === "active" ? `热度 ${memory.heat}` : formatShortDate(memory.forgetAt),
      leading: memory.status === "active" ? <Flame /> : <Brain />,
    }))}
    selectedId={activeId}
    onSelect={setSelectedId}
    search={{ value: query, placeholder: "搜索记忆内容…", onChange: setQuery }}
    listLabel={`${spaceName} · ${status === "active" ? "按热度排序" : "按遗忘时间排序"}`}
    detail={loading && !value ? <MemoryState icon={<LoaderCircle className="spin" />} title="正在读取当前空间的记忆" copy="记忆数据仅来自当前空间。" />
      : error ? <MemoryState icon={<TriangleAlert />} title="暂时无法读取记忆" copy={error} action={<button type="button" onClick={() => void refresh()}>重试</button>} />
        : selected ? <MemoryDetail memory={selected} spaceName={spaceName} />
          : <MemoryState icon={<Inbox />} title={query ? "没有匹配的记忆" : "当前状态下没有记忆"} copy={query ? "调整搜索词后再试。" : "Agent 形成的记忆会显示在这里。"} />}
  /></SettingsLayout>;
}

function MemoryDetail({ memory, spaceName }: { memory: Memory; spaceName: string }) {
  const active = memory.status === "active";
  return <div className="memory-detail">
    <header><div><h2>记忆详情</h2><p>{spaceName} · 更新于 {formatDateTime(memory.updatedAt)}</p></div><Badge tone={active ? "success" : undefined}>{active ? "生效" : "遗忘"}</Badge></header>
    <section className="memory-content"><p>{memory.content}</p></section>
    <section><h3>记忆状态</h3><div className="memory-metrics">
      <Metric icon={<Flame />} label="当前热度" value={String(memory.heat)} />
      <Metric icon={<MousePointerClick />} label="命中次数" value={`${memory.hitCount} 次`} />
      <Metric icon={<Clock3 />} label="最后命中" value={memory.lastHitAt ? formatDateTime(memory.lastHitAt) : "尚未命中"} />
      <Metric icon={<CalendarDays />} label={active ? "预计遗忘" : "遗忘时间"} value={formatDateTime(memory.forgetAt)} />
    </div></section>
    <section><h3>时间</h3><dl><div><dt>创建</dt><dd>{formatDateTime(memory.createdAt)}</dd></div><div><dt>更新</dt><dd>{formatDateTime(memory.updatedAt)}</dd></div></dl></section>
  </div>;
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div>{icon}<span><small>{label}</small><strong>{value}</strong></span></div>;
}

function MemoryState({ icon, title, copy, action }: { icon: ReactNode; title: string; copy: string; action?: ReactNode }) {
  return <div className="memory-empty">{icon}<strong>{title}</strong><span>{copy}</span>{action}</div>;
}

function memoryHeadline(content: string) { return [...content].length > 25 ? `${[...content].slice(0, 25).join("")}…` : content; }
function formatShortDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date) : ""; }
function relativeMemoryTime(value: string) { const date = new Date(value); const elapsed = Date.now() - date.getTime(); if (!Number.isFinite(elapsed)) return "未知"; if (elapsed < 60_000) return "刚刚"; if (elapsed < 86_400_000) return `${Math.max(1, Math.floor(elapsed / 3_600_000))} 小时前`; return `${Math.max(1, Math.floor(elapsed / 86_400_000))} 天前`; }
