"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Globe2, Mail, MessageCircle, SearchX, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LoadingState } from "../desktop-v72/loading-state";
import { Badge, DetailHeader, KeyValueGrid, SearchField } from "../desktop-v72/primitives";
import { useJson } from "./shared";
import { MarkdownContent } from "./markdown-content";
import { ConnectionActionRow } from "./connection-action-row";
import { ConnectionViewSwitch, type ConnectionView } from "./connection-view-switch";
import type { Connection } from "./connection-types";

const icons = { message: MessageCircle, sparkles: Sparkles, book: BookOpen, mail: Mail, globe: Globe2 } as const;
const effectiveStates = new Set(["connected", "ready", "available", "healthy"]);

export function ConnectionsPage() {
  const { value, loading, refresh } = useJson<{ connections: Connection[] }>("/api/connections");
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("connection");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [view, setView] = useState<ConnectionView>("all");
  const [selectedId, setSelectedId] = useState(requested || "");
  const initialLoading = loading && !value;
  const connections = value?.connections || [];
  const categories = [...new Set(connections.map((connection) => connection.category))];
  const effectiveCount = connections.filter(isEffectiveConnection).length;
  const filtered = useMemo(() => connections.filter((connection) => {
    const matchesView = view === "all" || isEffectiveConnection(connection);
    const matchesCategory = category === "全部" || connection.category === category;
    const text = `${connection.name}${connection.summary}${connection.description}${connection.capabilities.join("")}`.toLocaleLowerCase("zh-CN");
    return matchesView && matchesCategory && text.includes(query.trim().toLocaleLowerCase("zh-CN"));
  }), [category, connections, query, view]);
  useEffect(() => { setSelectedId(requested || ""); }, [requested]);
  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(refreshWhenVisible, 15_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);
  const activeId = filtered.some((item) => item.id === selectedId)
    ? selectedId
    : filtered.find((item) => item.id === requested)?.id || filtered[0]?.id || "";
  const selected = filtered.find((item) => item.id === activeId);
  const select = (id: string) => {
    setSelectedId(id);
    router.replace(`/app/connections?connection=${encodeURIComponent(id)}`, { scroll: false });
  };

  return <main className="page flush"><div className="split-view">
    <aside className="split-list" aria-busy={loading}><div className="split-toolbar connection-toolbar"><div className="split-toolbar-title"><h1>连接</h1><ConnectionViewSwitch value={view} effectiveCount={effectiveCount} loading={initialLoading} onChange={setView} /></div><SearchField value={query} disabled={initialLoading} onChange={(event) => setQuery(event.target.value)} placeholder="搜索连接或能力…" aria-label="搜索连接或能力" /><nav aria-label="连接分类"><button className={category === "全部" ? "active" : ""} disabled={initialLoading} onClick={() => setCategory("全部")} type="button">全部</button>{categories.map((item) => <button className={category === item ? "active" : ""} onClick={() => setCategory(item)} type="button" key={item}>{item}</button>)}</nav></div><div className="list-section-label">{initialLoading ? "正在加载连接…" : <>{view === "effective" ? "已生效" : category === "全部" ? "全部连接" : category} · {filtered.length}</>}</div>{initialLoading ? <LoadingState label="正在加载连接" compact /> : filtered.length ? filtered.map((connection) => <ConnectionRow connection={connection} selected={connection.id === activeId} onSelect={select} key={connection.id} />) : <div className="connection-list-empty"><SearchX /><strong>{view === "effective" ? "暂无已生效连接" : "没有匹配的连接"}</strong><span>{view === "effective" ? "切换到全部查看并完成连接配置" : "调整搜索词或切换分类"}</span></div>}</aside>
    <section className="split-detail" aria-busy={loading}>{initialLoading ? <LoadingState label="正在加载连接" /> : selected ? <ConnectionDetail connection={selected} refresh={refresh} key={selected.id} /> : <div className="empty-state">{view === "effective" ? "暂无已生效连接" : "没有匹配的连接"}</div>}</section>
  </div></main>;
}

function ConnectionRow({ connection, selected, onSelect }: { connection: Connection; selected: boolean; onSelect: (id: string) => void }) {
  const Icon = icons[connection.icon as keyof typeof icons] || Globe2;
  return <button className={`select-row tone-${connection.tone}${selected ? " selected" : ""}`} type="button" aria-pressed={selected} onClick={() => onSelect(connection.id)}><span className="row-icon"><Icon /></span><span className="select-row-body"><span className="select-row-line"><strong>{connection.name}</strong><time>{connection.statusLabel}</time></span><p>{connection.category} · {accessModeLabel(connection.accessMode)} · {connection.summary}</p></span></button>;
}

function ConnectionDetail({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  return <div className="detail-wrap connection-detail"><DetailHeader title={connection.name} trailing={<Badge tone={connection.tone}>{connection.statusLabel}</Badge>} /><ConnectionActionRow connection={connection} refresh={refresh} /><section className="detail-section"><h2>当前运行方式</h2><KeyValueGrid items={connection.runtime} /></section><section className="detail-section"><h2>连接说明</h2><article className="connection-skill-reference"><header><Sparkles /><div><span>操作 Skill · {connection.skill.name}</span><code>{connection.skill.reference}</code></div></header><MarkdownContent className="connection-skill-markdown" content={connection.skill.document} /></article></section></div>;
}

function accessModeLabel(mode: Connection["accessMode"]) {
  if (mode === "browser") return "浏览器连接";
  if (mode === "local") return "本地连接";
  return "账号连接";
}

function isEffectiveConnection(connection: Connection) {
  return effectiveStates.has(connection.state);
}
