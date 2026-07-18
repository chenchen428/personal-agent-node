"use client";

import { SearchX, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import type { Skill, SkillCategory } from "./types";
import { useJson } from "./shared";
import { Badge, PageHeader, SearchField } from "../desktop-v72/primitives";
import { SettingsLayout } from "../desktop-v72/settings-layout";
import { LoadingState } from "../desktop-v72/loading-state";

export function SkillsPage() {
  const { value, loading } = useJson<{ categories: SkillCategory[]; skills: Skill[] }>("/api/skills");
  const authorization = useJson<{ mode: "bypass" | "confirm" }>("/api/system/authorization");
  const categories = value?.categories || [];
  const skills = value?.skills || [];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedName, setSelectedName] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return skills.filter((skill) => (category === "all" || skill.category === category) && (!normalized || `${skill.name} ${skill.description}`.toLocaleLowerCase("zh-CN").includes(normalized)));
  }, [category, query, skills]);
  const selected = filtered.find((skill) => skill.name === selectedName) || filtered[0];
  return <SettingsLayout active="skills"><div className="settings-inner settings-skills">
    <PageHeader eyebrow={`本机能力 · ${skills.length} 项`} title="技能" description="查看 PA 当前可用的能力，以及执行时需要注意的影响。" actions={<SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能或用途…" />} />
    <nav className="skill-filter-bar" aria-label="技能分类"><button className={category === "all" ? "active" : ""} type="button" onClick={() => setCategory("all")}>全部 <span>{skills.length}</span></button>{categories.map((item) => <button className={category === item.id ? "active" : ""} type="button" onClick={() => setCategory(item.id)} key={item.id}>{item.label}<span>{skills.filter((skill) => skill.category === item.id).length}</span></button>)}</nav>
    {loading && !value ? <LoadingState label="正在读取技能目录" /> : <div className="skill-library-layout"><section className="skill-library-list" aria-label="技能目录"><header><strong>{category === "all" ? "全部技能" : categories.find((item) => item.id === category)?.label}</strong><span>{loading ? "读取中" : `${filtered.length} 项`}</span></header>{filtered.map((skill) => <button className={selected?.name === skill.name ? "selected" : ""} key={skill.name} onClick={() => setSelectedName(skill.name)} type="button"><span className="skill-library-icon"><Sparkles /></span><span><strong>{skill.name}</strong><small>{skill.description}</small></span><i aria-hidden="true">›</i></button>)}{!loading && !filtered.length ? <div className="skill-library-empty"><SearchX /><strong>没有匹配的技能</strong><span>调整搜索词或切换分类</span></div> : null}</section>{selected ? <SkillDetail skill={selected} category={categories.find((item) => item.id === selected.category)?.label || selected.category} bypass={authorization.value?.mode !== "confirm"} /> : <aside className="skill-inspector empty">选择一项技能查看详情</aside>}</div>}
  </div></SettingsLayout>;
}

function SkillDetail({ skill, category, bypass }: { skill: Skill; category: string; bypass: boolean }) {
  const impactful = Boolean(skill.risks?.length);
  return <aside className="skill-inspector"><div className="skill-inspector-mark"><Sparkles /></div><span>{category}</span><h2>{skill.name}</h2><p>{skill.description}</p><section><h3>执行影响</h3><div className="skill-impact-list"><Badge>本机技能</Badge>{impactful ? <Badge tone="warning">可能产生写入</Badge> : null}<Badge tone={bypass ? "success" : "warning"}>{bypass ? "无需确认" : "操作前确认"}</Badge></div></section><div className="skill-use-note"><ShieldCheck /><div><strong>在主对话中使用</strong><p>{bypass ? "当前为无需授权模式，PA 会直接执行；外部平台自身的登录或授权仍按连接要求完成。" : "当前为操作前确认模式，PA 会在需要授权的操作前请求你的确认。"}</p></div></div></aside>;
}
