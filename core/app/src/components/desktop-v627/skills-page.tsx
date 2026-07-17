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
  const categories = value?.categories || [];
  const skills = value?.skills || [];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedName, setSelectedName] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return skills.filter((skill) => (category === "all" || skill.category === category)
      && (!normalized || `${skill.name} ${skill.description}`.toLocaleLowerCase("zh-CN").includes(normalized)));
  }, [category, query, skills]);
  const selected = filtered.find((skill) => skill.name === selectedName) || filtered[0];

  return <SettingsLayout active="skills"><div className="settings-inner settings-skills">
    <PageHeader eyebrow={`本机能力 · ${skills.length} 项`} title="技能" description="查看 PA 当前可用的能力，以及执行时需要注意的影响。" actions={<SearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能或用途…" />} />
    <nav className="skill-filter-bar" aria-label="技能分类">
      <button className={category === "all" ? "active" : ""} type="button" onClick={() => setCategory("all")}>全部 <span>{skills.length}</span></button>
      {categories.map((item) => <button className={category === item.id ? "active" : ""} type="button" onClick={() => setCategory(item.id)} key={item.id}>{item.label}<span>{skills.filter((skill) => skill.category === item.id).length}</span></button>)}
    </nav>
    {loading && !value ? <LoadingState label="正在读取技能目录" /> : <div className="skill-library-layout">
      <section className="skill-library-list" aria-label="技能目录">
        <header><strong>{category === "all" ? "全部技能" : categories.find((item) => item.id === category)?.label}</strong><span>{loading ? "读取中" : `${filtered.length} 项`}</span></header>
        {filtered.map((skill) => <button className={selected?.name === skill.name ? "selected" : ""} key={skill.name} onClick={() => setSelectedName(skill.name)} type="button"><span className="skill-library-icon"><Sparkles /></span><span><strong>{skill.name}</strong><small>{skill.description}</small></span><i aria-hidden="true">›</i></button>)}
        {!loading && !filtered.length ? <div className="skill-library-empty"><SearchX /><strong>没有匹配的技能</strong><span>调整搜索词或切换分类</span></div> : null}
      </section>
      {selected ? <SkillDetail skill={selected} category={categories.find((item) => item.id === selected.category)?.label || selected.category} /> : <aside className="skill-inspector empty">{loading ? "正在读取技能…" : "选择一项技能查看详情"}</aside>}
    </div>}
  </div></SettingsLayout>;
}

function SkillDetail({ skill, category }: { skill: Skill; category: string }) {
  const requiresConfirmation = Boolean(skill.risks?.length);
  return <aside className="skill-inspector">
    <div className="skill-inspector-mark"><Sparkles /></div>
    <span>{category}</span><h2>{skill.name}</h2><p>{skill.description}</p>
    <section><h3>执行影响</h3><div className="skill-impact-list"><Badge>本机技能</Badge>{requiresConfirmation ? <Badge tone="warning">操作前确认</Badge> : <Badge tone="success">可直接使用</Badge>}</div></section>
    <div className="skill-use-note"><ShieldCheck /><div><strong>在主对话中使用</strong><p>直接说明目标，PA 会选择合适的技能。涉及外部写入或高风险操作时会先请求确认。</p></div></div>
  </aside>;
}
