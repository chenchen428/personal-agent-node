"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Clipboard, Code2, ExternalLink, FileCheck2, Folder, RefreshCw, Search, Shield, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Category = { id: string; label: string; description: string };
type Skill = {
  name: string; description: string; directory: string; category: string; maturity: string;
  risks: string[]; security: Record<string, unknown>; origin: Record<string, unknown>;
  cli: string[]; examples: string[]; caseRequired: boolean; related: string[];
};

const categoryLabels: Record<string, string> = {
  "research-knowledge": "研究与知识", "writing-content": "写作与内容",
  "visual-media": "视觉与媒体", "publishing-automation": "发布与自动化",
};
const riskLabels: Record<string, string> = {
  "network-read": "读取网络", "local-write": "写入本机", "browser-session": "浏览器会话",
  "external-generation": "外部生成", credentials: "凭据", "external-write": "外部写入",
};
const securityLabels: Record<string, string> = {
  network: "网络", dataClass: "数据级别", outboundData: "出站数据", externalWrite: "外部写入",
  requiresAuthorization: "需要授权", requiresFinalConfirmation: "最终确认", untrustedContent: "不可信内容防护",
};

export function SkillsDashboard() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<Skill | null>(null);
  const [copied, setCopied] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/skills", { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; categories?: Category[]; skills?: Skill[]; error?: string };
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      setCategories(payload.categories || []); setSkills(payload.skills || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "技能目录暂时不可用"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.documentElement.classList.add("skill-sheet-open");
    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => { document.documentElement.classList.remove("skill-sheet-open"); window.removeEventListener("keydown", onKeyDown); };
  }, [selected]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (category !== "all" && skill.category !== category) return false;
      if (!keyword) return true;
      return [skill.name, skill.description, skill.category, ...skill.cli, ...skill.risks].join(" ").toLowerCase().includes(keyword);
    });
  }, [category, query, skills]);

  const grouped = useMemo(() => categories.map((item) => ({ ...item, skills: filtered.filter((skill) => skill.category === item.id) })).filter((item) => item.skills.length), [categories, filtered]);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value); setCopied(value); window.setTimeout(() => setCopied(""), 1500);
  }

  return (
    <section className="skills-console" aria-busy={loading}>
      <div className="skills-toolbar">
        <label><Search className="size-4" /><Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、用途、命令或风险" /></label>
        <div className="skill-category-filter" aria-label="技能分类">
          <button type="button" className={category === "all" ? "is-active" : ""} onClick={() => setCategory("all")}>全部 <span>{skills.length}</span></button>
          {categories.map((item) => <button type="button" className={category === item.id ? "is-active" : ""} onClick={() => setCategory(item.id)} key={item.id}>{categoryLabels[item.id] || item.label} <span>{skills.filter((skill) => skill.category === item.id).length}</span></button>)}
        </div>
        <Button variant="outline" size="icon" aria-label="刷新技能目录" title="刷新" onClick={() => void load()} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></Button>
      </div>

      <div className="skills-summary"><div><Sparkles className="size-4" /><strong>{loading ? "正在读取目录" : `${filtered.length} 个技能`}</strong><span>来源于当前 Node Harness</span></div><Badge variant={error ? "error" : "ready"}><i className="semantic-dot" />{error ? "目录异常" : "只读目录"}</Badge></div>
      {error ? <div className="surface-notice notice-error"><AlertTriangle className="size-4" /><span>{error}</span><Button variant="outline" size="sm" onClick={() => void load()}>重新读取</Button></div> : null}

      <div className="skill-groups-next">
        {grouped.map((group) => <section className="skill-group-next" key={group.id}><header><div><span>{categoryLabels[group.id] || group.label}</span><small>{group.description}</small></div><b>{group.skills.length}</b></header><div>{group.skills.map((skill) => <button type="button" className="skill-row-next" onClick={() => setSelected(skill)} key={skill.name}><span className="skill-monogram">{initials(skill.name)}</span><span className="skill-copy"><strong>{skill.name}</strong><small>{skill.description}</small></span><span className="skill-meta"><Badge>{skill.maturity || "unknown"}</Badge>{skill.risks.length ? <span><Shield className="size-3.5" />{skill.risks.length}</span> : <span><Check className="size-3.5" />低风险</span>}</span><ChevronRight className="size-4" /></button>)}</div></section>)}
        {!loading && !error && grouped.length === 0 ? <div className="skills-empty"><Search className="size-5" /><strong>没有匹配的技能</strong><span>调整搜索词或切换分类</span><Button variant="outline" size="sm" onClick={() => { setQuery(""); setCategory("all"); }}>清除筛选</Button></div> : null}
      </div>

      {selected ? <div className="skill-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}><aside className="skill-sheet" role="dialog" aria-modal="true" aria-labelledby="skill-sheet-title"><header><span className="skill-monogram">{initials(selected.name)}</span><div><small>{categoryLabels[selected.category] || selected.category}</small><h2 id="skill-sheet-title">{selected.name}</h2></div><Button ref={closeRef} variant="outline" size="icon" aria-label="关闭技能详情" onClick={() => setSelected(null)}><X className="size-4" /></Button></header><div className="skill-sheet-body">
        <p className="skill-description">{selected.description}</p>
        <dl className="skill-facts"><div><dt>成熟度</dt><dd><Badge>{selected.maturity || "unknown"}</Badge></dd></div><div><dt>目录</dt><dd><code>{selected.directory}</code></dd></div><div><dt>来源</dt><dd>{originText(selected.origin)}</dd></div><div><dt>用例</dt><dd>{selected.caseRequired ? `${selected.examples.length} 个验收用例` : "不要求"}</dd></div></dl>
        <section><h3><Shield className="size-4" />风险与安全边界</h3>{selected.risks.length ? <div className="skill-risk-list">{selected.risks.map((risk) => <Badge variant={risk === "external-write" || risk === "credentials" ? "warning" : "neutral"} key={risk}>{riskLabels[risk] || risk}</Badge>)}</div> : <p className="skill-muted">未声明额外风险。</p>}<div className="security-grid">{Object.entries(selected.security).map(([key, value]) => <div key={key}><span>{securityLabels[key] || key}</span><strong>{formatSecurity(value)}</strong></div>)}</div></section>
        <section><h3><Code2 className="size-4" />命令入口</h3>{selected.cli.length ? <div className="skill-command-list">{selected.cli.map((command) => <div key={command}><code>{command}</code><Button variant="ghost" size="icon" aria-label={`复制 ${command}`} onClick={() => void copy(command)}>{copied === command ? <Check className="size-4" /> : <Clipboard className="size-4" />}</Button></div>)}</div> : <p className="skill-muted">该技能没有独立 CLI，通过 Agent 调用。</p>}</section>
        {selected.related.length ? <section><h3><Sparkles className="size-4" />关联技能</h3><div className="related-skills">{selected.related.map((name) => <button type="button" key={name} onClick={() => { const next = skills.find((skill) => skill.name === name); if (next) setSelected(next); }}>{name}<ChevronRight className="size-3.5" /></button>)}</div></section> : null}
        {typeof selected.origin.repository === "string" ? <a className="skill-origin-link" href={selected.origin.repository} target="_blank" rel="noreferrer">查看来源仓库<ExternalLink className="size-3.5" /></a> : null}
        {selected.examples.length ? <details className="skill-cases"><summary><FileCheck2 className="size-4" />验收用例</summary>{selected.examples.map((example) => <code key={example}>{example}</code>)}</details> : null}
      </div></aside></div> : null}
    </section>
  );
}

function initials(value: string) { return value.split("-").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function originText(origin: Record<string, unknown>) { return [origin.kind, origin.license].filter(Boolean).join(" · ") || "Node Harness"; }
function formatSecurity(value: unknown) { if (typeof value === "boolean") return value ? "是" : "否"; return String(value ?? "-"); }
