"use client";

import { useCallback, useEffect, useState } from "react";

type SetupState = "ready" | "checking" | "action-required" | "blocked" | "not-selected";
type SetupCheck = { id: string; group: string; state: SetupState; summary: string };
type SetupSnapshot = { readiness: Record<string, SetupState>; checks: SetupCheck[] };

const groups = [
  { key: "installation", readiness: "console", index: "01", title: "本机安装" },
  { key: "agent", readiness: "agent", index: "02", title: "Codex Agent" },
  { key: "connectivity", readiness: "remote", index: "03", title: "公网连接" },
  { key: "mail", readiness: "mail", index: "04", title: "Agent 邮箱" },
];

const labels: Record<SetupState, string> = {
  ready: "可用", checking: "检查中", "action-required": "需要处理", blocked: "被前置项阻塞", "not-selected": "尚未选择",
};

export function SetupDashboard() {
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/system/setup", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setSnapshot(await response.json() as SetupSnapshot);
    } catch {
      setError("控制服务尚未就绪，请先启动 Personal Agent 后重试。");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section className="setup-grid" aria-label="Setup readiness" aria-live="polite">
      {groups.map((group) => {
        const state = loading ? "checking" : snapshot?.readiness[group.readiness] || "action-required";
        const checks = snapshot?.checks.filter((check) => check.group === group.key) || [];
        return (
          <article className="setup-group" key={group.key}>
            <header><span>{group.index}</span><div><h2>{group.title}</h2><small>{labels[state]}</small></div><i className={state === "checking" ? "pulse" : `state-${state}`} /></header>
            <ul>{checks.length ? checks.map((check) => <li key={check.id}><span>{check.summary}</span><em>{labels[check.state]}</em></li>) : <li><span>{error || "正在读取本机状态"}</span><em>{labels[state]}</em></li>}</ul>
            <button className="button button-secondary" type="button" onClick={() => void refresh()} disabled={loading}>重新检测</button>
          </article>
        );
      })}
    </section>
  );
}
