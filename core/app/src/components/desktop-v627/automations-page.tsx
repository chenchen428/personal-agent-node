"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock3, PackageCheck } from "lucide-react";
import { Badge, DetailHeader, KeyValueGrid } from "../desktop-v72/primitives";
import { CollectionDetail } from "../desktop-v72/collection-detail";
import type { AutomationData } from "./types";
import { relativeTime, statusLabel, useJson } from "./shared";

export function AutomationsPage() {
  const { value, loading } = useJson<AutomationData>("/api/node/v1/client/automations");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const rules = value?.rules || [];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return rules.filter((item) => !normalized || `${item.name} ${item.description} ${item.eventType}`.toLocaleLowerCase("zh-CN").includes(normalized));
  }, [query, rules]);
  const selected = rules.find((item) => item.id === selectedId) || filtered[0] || rules[0];

  useEffect(() => {
    if (!selectedId && rules[0]) setSelectedId(rules[0].id);
  }, [rules, selectedId]);

  return <CollectionDetail
    title="自动化"
    items={filtered.map((item) => ({
      id: item.id,
      title: item.name,
      summary: `${item.eventType} · ${item.description}`,
      time: item.enabled ? "运行中" : "已暂停",
      tone: item.enabled ? "success" : "warning",
      leading: <span className="row-icon"><CalendarClock /></span>,
    }))}
    selectedId={selected?.id || ""}
    onSelect={setSelectedId}
    listLabel={loading ? "正在读取" : `Agent 托管 · ${filtered.length} 项`}
    search={{ value: query, placeholder: "搜索自动化…", onChange: setQuery }}
    detail={selected ? <AutomationDetail rule={selected} /> : <div className="empty-state">还没有自动化定义</div>}
  />;
}

function AutomationDetail({ rule }: { rule: AutomationData["rules"][number] }) {
  const run = rule.recentRuns[0];
  return <div className="detail-wrap automation-detail-next">
    <DetailHeader title={rule.name} meta={rule.description} trailing={<Badge tone={rule.enabled ? "success" : "warning"}>{rule.enabled ? "运行中" : "已暂停"}</Badge>} />
    <section className="detail-section"><h2>执行规则</h2><KeyValueGrid items={[
      { label: "触发方式", value: rule.eventType },
      { label: "规则版本", value: `v${rule.version}` },
      { label: "最近更新", value: relativeTime(rule.updatedAt) },
      { label: "管理方式", value: "主 Agent 托管" },
    ]} /></section>
    <section className="detail-section"><h2>最近运行</h2>{run ? <div className="automation-run-next"><span className="row-icon"><PackageCheck /></span><div><strong>{statusLabel(run.status)}</strong><small>{relativeTime(run.createdAt)} · {run.matched ? "已触发" : "未满足条件"}</small><p>{run.reason || (run.matched ? "已完成本次处理并交付结果。" : "本次检查未满足触发条件。")}</p></div></div> : <p className="automation-empty-run">还没有运行记录</p>}</section>
    <div className="notice"><Clock3 />自动化由主 Agent 创建和维护，桌面端只读展示。</div>
  </div>;
}
