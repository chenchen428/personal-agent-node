"use client";

import { RefreshCw, SearchX, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Skill, SkillCategory } from "./types";
import { useJson } from "./shared";
import { Badge } from "../desktop-v72/primitives";
import { SettingsLayout } from "../desktop-v72/settings-layout";
import { SettingsCollectionLayout } from "../desktop-v72/settings-collection-layout";

type SkillsResponse = {
  categories: SkillCategory[];
  skills: Skill[];
  space?: { id: string; slug: string; displayName: string };
};

export function SkillsPage() {
  const { value, loading, error, refresh } = useJson<SkillsResponse>("/api/skills");
  const authorization = useJson<{ mode: "bypass" | "confirm" }>("/api/system/authorization");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [source, setSource] = useState<"all" | "builtin" | "user">("all");
  const categories = value?.categories || [];
  const skills = value?.skills || [];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return skills.filter((skill) => (source === "all" || skill.source.kind === source) && (!normalized || `${skill.name} ${skill.description}`.toLocaleLowerCase("zh-CN").includes(normalized)));
  }, [query, skills, source]);
  const activeName = filtered.some((skill) => skill.id === selectedId) ? selectedId : filtered[0]?.id || "";
  const selected = filtered.find((skill) => skill.id === activeName);
  const spaceName = value?.space?.displayName || "当前空间";

  useEffect(() => {
    if (!selectedId || !filtered.some((skill) => skill.id === selectedId)) setSelectedId(filtered[0]?.id || "");
  }, [filtered, selectedId]);

  return <SettingsLayout active="skills"><SettingsCollectionLayout
    title="技能"
    actions={<><div className="segmented" role="group" aria-label="技能来源">{(["all", "builtin", "user"] as const).map((kind) => <button type="button" key={kind} className={source === kind ? "active" : ""} aria-pressed={source === kind} onClick={() => setSource(kind)}>{kind === "all" ? "全部" : sourceLabel(kind)}</button>)}</div><button className="icon-button" type="button" aria-label="重新读取技能目录" title="重新读取技能目录" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "spin" : ""} /></button></>}
    rows={filtered.map((skill) => ({
      id: skill.id,
      title: skill.name,
      summary: `${sourceLabel(skill.source.kind)} · ${skill.description}`,
      leading: <Sparkles />,
    }))}
    selectedId={activeName}
    onSelect={setSelectedId}
    search={{ value: query, placeholder: "搜索技能…", onChange: setQuery }}
    listLabel={source === "all" ? "全部技能" : sourceLabel(source)}
    detail={loading && !value ? <SkillState title="正在读取技能" copy="" />
      : error ? <SkillState title="暂时无法读取技能" copy={error} />
        : selected ? <SkillDetail skill={selected} category={categoryLabel(categories, selected.category)} spaceName={spaceName} bypass={authorization.value?.mode !== "confirm"} />
          : <SkillState title="没有匹配的技能" copy="调整搜索词后再试。" />}
  /></SettingsLayout>;
}

function SkillDetail({ skill, category, spaceName, bypass }: { skill: Skill; category: string; spaceName: string; bypass: boolean }) {
  const impactful = Boolean(skill.risks?.length);
  return <div className="skill-readonly-detail">
    <header><div><span>{category}</span><h2>{skill.name}</h2><p>{sourceLabel(skill.source.kind)} · {skill.source.kind === "user" ? spaceName : "Cove"}</p></div><Badge tone={skill.status === "available" ? "success" : "warning"}>{skill.status === "available" ? "可使用" : "已保留"}</Badge></header>
    <section className="skill-detail-lead"><span><Sparkles /></span><p>{skill.description}</p></section>
    {skill.notice ? <p role="status">{skill.notice}</p> : null}
    <section><h3>执行影响</h3><div className="skill-impact-list"><Badge>{sourceLabel(skill.source.kind)}</Badge>{impactful ? <Badge tone="warning">可能产生写入</Badge> : null}<Badge tone={bypass ? "success" : "warning"}>{bypass ? "可直接使用" : "操作前确认"}</Badge></div></section>
    <section><h3>使用方式</h3><div className="skill-readonly-note"><ShieldCheck /><div><strong>在主对话中使用</strong><p>直接说明目标，Cove 会在{spaceName}中选择合适的技能。涉及外部写入或高风险操作时会遵循当前授权模式。</p></div></div></section>
  </div>;
}

function SkillState({ title, copy }: { title: string; copy: string }) {
  return <div className="memory-empty"><SearchX /><strong>{title}</strong>{copy ? <span>{copy}</span> : null}</div>;
}

function categoryLabel(categories: SkillCategory[], id: string) {
  return categories.find((category) => category.id === id)?.label || id;
}

function sourceLabel(kind: "builtin" | "user") { return kind === "builtin" ? "内置技能" : "我的技能"; }
