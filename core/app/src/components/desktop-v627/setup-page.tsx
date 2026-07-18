"use client";

import Link from "next/link";
import { ArrowRight, Check, FolderOpen, Link2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { SetupCheck, SetupState } from "@/lib/setup-tasks";
import { Button, Card, PageHeader, PageSurface } from "../desktop-v72/primitives";

type Snapshot = { checks: SetupCheck[] };
type Step = { title: string; description: string; groups: string[]; href: string; action: string };
const definitions: Step[] = [
  { title: "确认本机环境", description: "Node Runtime 和桌面客户端已经就绪", groups: ["installation"], href: "/app/settings", action: "查看设置" },
  { title: "让主 Agent 可以工作", description: "Codex、工作区与真实对话链路均可用", groups: ["agent"], href: "/app/conversations", action: "打开对话" },
];

export function SetupPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { const response = await fetch("/api/system/setup", { cache: "no-store" }); if (!response.ok) throw new Error(); setSnapshot(await response.json()); } catch { setError("暂时无法读取初始化状态。"); } finally { setLoading(false); } }, []);
  useEffect(() => {
    void load();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);
  const stateFor = (groups: string[]): SetupState => { const checks = (snapshot?.checks || []).filter((check) => groups.includes(check.group) && check.id !== "installation.console-auth" && (check.requirement === "required-for-console" || check.requirement === "required-for-agent")); if (!checks.length) return "checking"; return checks.every((check) => check.state === "ready") ? "ready" : checks.some((check) => check.state === "blocked") ? "blocked" : "action-required"; };
  const complete = definitions.filter((step) => stateFor(step.groups) === "ready").length;
  return <PageSurface><PageHeader eyebrow="首次设置" title="完成 Personal Agent 初始化" description={loading ? "正在检查这台电脑。" : complete === definitions.length ? "必要设置已经完成，可以开始把目标交给主 Agent。" : `剩余 ${definitions.length - complete} 步。完成后即可让主 Agent 持续接收目标并在后台工作。`} actions={<Button onClick={() => void load()} disabled={loading}><RefreshCw />{loading ? "检查中…" : "重新检查"}</Button>} />
    <div className="setup-grid"><Card className="step-list">{definitions.map((step, index) => { const state = stateFor(step.groups); const done = state === "ready"; return <div className="step" key={step.title}><span className={`step-number${done ? " done" : ""}`}>{done ? <Check /> : index + 1}</span><span><strong>{step.title}</strong><p>{step.description}</p></span>{done ? <span className="badge success">已完成</span> : <Link className="button primary" href={step.href}>{step.action}</Link>}</div>; })}</Card>
      <div className="setup-aside"><Card className="setup-connection-panel"><span className="setup-connection-icon"><Link2 /></span><span className="setup-connection-copy"><small>可选能力</small><strong>连接与平台域名</strong><p>管理微信、Notion、小红书和移动端公网入口</p></span><Link className="setup-connection-action" href="/app/connections">管理<ArrowRight /></Link></Card><Card className="card-pad"><div className="card-title"><div><span className="eyebrow">个人工作区</span><h2>本机目录</h2></div><FolderOpen /></div><p style={{ color: "var(--pa-muted)", fontSize: 11 }}>工作区内容不会进入安装包，也不会因为客户端升级而被覆盖。</p><code>~/.personal-agent/workspace</code></Card>{error ? <div className="notice" role="status">{error}</div> : null}</div>
    </div>
  </PageSurface>;
}
