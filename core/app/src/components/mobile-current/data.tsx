"use client";

import { useCallback, useEffect, useState } from "react";
import type { PageItem, PlanStep, Session, Skill } from "./types";

export function useRemote<T>(url: string) {
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    setLoading(true);
    void fetchJson<T>(url)
      .then((result) => { setValue(result); setError(""); })
      .catch((cause) => setError(errorMessage(cause)))
      .finally(() => setLoading(false));
  }, [url]);
  useEffect(() => { refresh(); }, [refresh]);
  return { value, loading, error, refresh };
}

export function useRememberedQuery(key: string): [string, (value: string) => void] {
  const storageKey = `pa.${key}.query`;
  const [query, setQueryState] = useState("");
  useEffect(() => {
    try { setQueryState(window.sessionStorage.getItem(storageKey) || ""); } catch { /* unavailable */ }
  }, [storageKey]);
  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    try {
      if (value) window.sessionStorage.setItem(storageKey, value);
      else window.sessionStorage.removeItem(storageKey);
    } catch { /* unavailable */ }
  }, [storageKey]);
  return [query, setQuery];
}

export function useRememberedScroll(key: string) {
  useEffect(() => {
    const element = document.querySelector<HTMLElement>("[data-mobile-scroll]");
    if (!element) return;
    const storageKey = `pa.${key}.scroll`;
    try {
      const value = Number(window.sessionStorage.getItem(storageKey));
      if (Number.isFinite(value)) window.requestAnimationFrame(() => { element.scrollTop = value; });
    } catch { /* unavailable */ }
    const save = () => {
      try { window.sessionStorage.setItem(storageKey, String(element.scrollTop)); } catch { /* unavailable */ }
    };
    window.addEventListener("pagehide", save);
    return () => { save(); window.removeEventListener("pagehide", save); };
  }, [key]);
}

export function useClock(interval: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [interval]);
  return now;
}

export function useDebounced(value: string, delay: number) {
  const [deferred, setDeferred] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDeferred(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return deferred;
}

export function useSourcePage(fallback: "pages" | "workers") {
  const [source, setSource] = useState<"activity" | "pages" | "workers">(fallback);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("from") === "activity") setSource("activity");
  }, []);
  return source;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(response.status === 404
      ? "当前客户端缺少所需的本机接口，请重新启动客户端"
      : `本机服务返回了无法读取的内容（${response.status} · ${contentType || "未知类型"}）`);
  }
  const record = payload as { ok?: boolean; data?: T; result?: T; error?: string | { message?: string } };
  if (!response.ok || record.ok === false) {
    throw new Error(typeof record.error === "string" ? record.error : record.error?.message || `请求失败（${response.status}）`);
  }
  return (record.data ?? record.result ?? payload) as T;
}

export function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : "暂时无法读取本机内容"; }
export function isRunning(status = "") { return ["start", "running"].includes(status); }
export function statusLabel(status = "") { return ({ start: "启动中", running: "进行中", idle: "等待继续", paused: "已暂停", done: "已完成", archived: "已归档", failed: "未完成" } as Record<string, string>)[status] || status || "已记录"; }
export function activityKind(kind: string) { return ({ work: { label: "任务", icon: "↻" }, mail: { label: "邮件", icon: "@" }, page: { label: "发布页", icon: "▧" }, data: { label: "数据", icon: "▦" } } as Record<string, { label: string; icon: string }>)[kind] || { label: "动态", icon: "◈" }; }
export function relativeTime(value?: string) { const date = new Date(value || ""); if (!Number.isFinite(date.getTime())) return "刚刚"; const elapsed = Date.now() - date.getTime(); if (elapsed < 60_000) return "刚刚"; if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前`; if (elapsed < 86_400_000) return `${Math.max(1, Math.floor(elapsed / 3_600_000))} 小时前`; if (elapsed < 172_800_000) return "昨天"; return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date); }
export function relativeTaskTime(value?: string) { const date = new Date(value || ""); if (!Number.isFinite(date.getTime())) return "刚刚"; const elapsed = Date.now() - date.getTime(); if (elapsed < 60_000) return "刚刚"; if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`; if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`; if (elapsed < 172_800_000) return `昨天 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}`; if (elapsed < 604_800_000) return new Intl.DateTimeFormat("zh-CN", { weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); return new Intl.DateTimeFormat("zh-CN", { year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
export function elapsedSeconds(session: Session, running: boolean) { const start = new Date(session.createdAt || session.updatedAt || "").getTime(); const end = running ? Date.now() : new Date(session.updatedAt || session.createdAt || "").getTime(); return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : 0; }
export function formatTaskDuration(seconds: number, running: boolean) { const prefix = running ? "已运行" : "耗时"; if (seconds < 60) return `${prefix}不到 1 分钟`; if (seconds < 3600) return `${prefix} ${Math.floor(seconds / 60)} 分钟`; if (seconds < 86400) return `${prefix} ${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分钟`; return `${prefix} ${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时`; }
export function formatDetailedElapsed(seconds: number) { const total = Math.max(0, Math.floor(seconds)); const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const rest = total % 60; if (hours) return `${hours}小时 ${minutes}分钟`; if (minutes) return `${minutes}分${rest}秒`; return `${rest}秒`; }
export function formatCompactDuration(seconds: number) { if (seconds >= 86400) return `${Math.floor(seconds / 86400)} 天 ${Math.floor((seconds % 86400) / 3600)} 小时`; if (seconds >= 3600) return `${Math.floor(seconds / 3600)} 小时`; return `${Math.max(1, Math.floor(seconds / 60))} 分钟`; }
export function formatDateTime(value?: string) { const date = new Date(value || ""); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : ""; }
export function formatBytes(bytes: number) { if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`; if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`; return `${bytes} B`; }
export function fileType(name: string) { return name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"; }
export function firstCharacter(name: string) { return name.trim().charAt(0).toUpperCase() || "你"; }
export function safeHost(value: string) { try { return new URL(value).host; } catch { return value; } }
export function coverKind(page: PageItem, index: number) { const text = `${page.id} ${page.title}`.toLowerCase(); if (/账|finance|ledger|data/.test(text)) return "finance"; if (/活动|weekend/.test(text)) return "weekend"; if (/手记|照片|journal/.test(text)) return "journal"; if (/清单|camp|list/.test(text)) return "camp"; return ["travel", "finance", "weekend", "journal", "camp"][index % 5]; }
export function latestPlan(session: Session): PlanStep[] { const fromMessages = (session.messages || []).filter((message) => message.metadata?.eventType === "turn/plan/updated" && message.metadata.plan?.length).at(-1)?.metadata?.plan; const fromEvents = (session.events || []).filter((event) => event.payload?.metadata?.eventType === "turn/plan/updated" && event.payload.metadata.plan?.length).at(-1)?.payload?.metadata?.plan; return fromMessages || fromEvents || []; }
export function richText(content: string) { const lines = content.trim().split(/\r?\n/); const list = lines.filter((line) => /^[-*] /.test(line)); if (list.length === lines.filter(Boolean).length && list.length) return <ul>{list.map((line, index) => <li key={index}>{line.replace(/^[-*] /, "")}</li>)}</ul>; return paragraphs(content); }
export function paragraphs(content: string) { return content.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph.split("\n").map((line, lineIndex) => <span key={lineIndex}>{line}{lineIndex < paragraph.split("\n").length - 1 ? <br /> : null}</span>)}</p>); }
export function groupSkills(skills: Skill[]) { const definitions = [
  { name: "调研与知识", test: /research|knowledge|调研|知识/ }, { name: "写作与内容", test: /content|document|写作|内容/ }, { name: "视觉与媒体", test: /visual|media|ppt|card|image|视觉|媒体/ }, { name: "旅行与地点", test: /travel|map|旅行|地点/ }, { name: "产品与界面", test: /front|ui|ux|design|产品|界面/ },
]; const key = (skill: Skill) => skill.id || skill.name; const assigned = new Set<string>(); const groups = definitions.map((definition) => ({ name: definition.name, skills: skills.filter((skill) => { const match = definition.test.test(`${skill.id || ""} ${skill.name}`); if (match) assigned.add(key(skill)); return match; }) })).filter((group) => group.skills.length); const remaining = skills.filter((skill) => !assigned.has(key(skill))); if (remaining.length) groups.push({ name: "发布与自动化", skills: remaining }); return groups; }
export async function copyText(value: string) { try { await navigator.clipboard.writeText(value); return true; } catch { const area = document.createElement("textarea"); area.value = value; area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select(); let copied = false; try { copied = document.execCommand("copy"); } finally { area.remove(); } return copied; } }
