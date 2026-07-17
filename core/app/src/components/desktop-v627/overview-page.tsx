"use client";

import Link from "next/link";
import { Bot, FileText, Mail, Radio } from "lucide-react";
import type { SetupCheck } from "@/lib/setup-tasks";
import type { Overview } from "./types";
import { desktopActivityHref, formatDuration, formatTime, statusLabel, useJson } from "./shared";
import { buildRequiredSetupSteps, RequiredSetupGuide } from "./required-setup-guide";

export function OverviewPage() {
  const { value, loading, error } = useJson<Overview>("/api/node/v1/client/overview");
  const setup = useJson<{ checks: SetupCheck[] }>("/api/system/setup");
  const counts = value?.counts;
  const steps = buildRequiredSetupSteps(setup.value?.checks || []);
  const remaining = setup.loading ? null : steps.filter((step) => !step.ready).length;
  const ready = remaining === 0;
  return <main className="v72-page">
    <header className="v72-page-header"><div><h1>{ready ? "Personal Agent 已就绪" : "Personal Agent 正在准备"}</h1><p>{ready ? "查看最新动态、待处理内容和本机连接状态。" : "先完成必要设置，再把目标放心交给主 Agent。"}</p></div><span className={`v72-badge ${error || setup.error || !ready ? "warning" : "success"}`}><i />{loading || setup.loading ? "正在连接" : error || setup.error ? "部分不可用" : ready ? "全部正常" : `还差 ${remaining} 项`}</span></header>
    {!setup.loading && remaining ? <RequiredSetupGuide steps={steps} /> : null}
    <section className="v72-stat-grid">
      <Stat icon={Bot} label="进行中的任务" value={counts ? String(counts.runningWork ?? counts.work) : "—"} detail="主 Agent 当前正在推进的任务" />
      <Stat icon={Mail} label="收到的邮件" value={counts ? String(counts.mail) : "—"} detail="邮件正文和附件保存在本机" />
      <Stat icon={FileText} label="最近发布" value={counts ? String(counts.pages) : "—"} detail="由 PA 创建并管理的发布页" />
      <Stat icon={Radio} label="渠道连接" value={counts ? String(counts.connectedChannels) : "—"} detail="已连接到这台电脑的渠道" />
    </section>
    <section className="v72-content-grid">
      <div className="v72-card v72-section-list"><header><strong>最近动态</strong><span>由主 Agent 整理</span></header>{(value?.recent || []).slice(0, 5).map((item) => <Link className={`v72-plain-row activity-${item.kind}`} href={desktopActivityHref(item)} key={item.id}><span className="v72-row-icon">{activityIcon(item.kind)}</span><span><strong>{item.title}</strong><small>{activityLabel(item.kind)} · {item.summary || statusLabel(item.status)}</small></span><time>{formatTime(item.updatedAt)}</time></Link>)}{!loading && !value?.recent.length ? <div className="v72-empty">还没有最近动态</div> : null}</div>
      <aside className="v72-status-panel"><span>本机运行</span><h2>PA 已运行 {value ? formatDuration(value.machine.uptimeSeconds) : "—"}</h2><p>关闭客户端将停止本机服务；进行中的工作会先请求确认。</p><div><StatusLine label="主 Agent" value={error ? "需要检查" : "就绪"} /><StatusLine label="本机 Core" value="运行中" /><StatusLine label="公网域名访问" value={value?.machine.mobileAccess === "available" ? "已连接" : "待连接"} /><StatusLine label="公网地址" value={value?.machine.mobileAddress || "尚未启用"} href={externalAddress(value?.machine.mobileAddress)} /></div></aside>
    </section>
  </main>;
}

function Stat({ icon: Icon, label, value, detail }: { icon: typeof Bot; label: string; value: string; detail: string }) {
  return <article className="v72-card v72-stat"><header><span>{label}</span><Icon /></header><strong>{value}</strong><p>{detail}</p></article>;
}

function StatusLine({ label, value, href }: { label: string; value: string; href?: string }) { return <div className="v72-status-line"><span>{label}</span>{href ? <a href={href} target="_blank" rel="noreferrer" title={value}>{value}</a> : <strong>{value}</strong>}</div>; }

function externalAddress(value?: string) { return value && /^https?:\/\//i.test(value) ? value : undefined; }

function activityIcon(kind: string) { if (kind.includes("mail")) return <Mail />; if (kind.includes("page")) return <FileText />; if (kind.includes("channel")) return <Radio />; return <Bot />; }
function activityLabel(kind: string) { return ({ work: "任务", mail: "邮件", page: "发布页", data: "数据", automation: "自动化", note: "动态" } as Record<string, string>)[kind] || "动态"; }
