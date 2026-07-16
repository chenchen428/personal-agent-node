"use client";

import Link from "next/link";
import type { Overview } from "./types";
import { Empty, Heading, SectionHeading, Metric, desktopActivityHref, formatDuration, formatTime, statusLabel, useJson } from "./shared";

export function OverviewPage() {
  const { value, loading, error } = useJson<Overview>("/api/node/v1/client/overview");
  return <main>
    <Heading eyebrow="PA 桌面端" title="下午好，本机用户" copy="查看这台电脑上的个人智能体、完成初始化和管理连接。" action={<span className={error ? "pa-status warning" : "pa-status"}>{loading ? "正在连接" : error ? "部分不可用" : "运行正常"}</span>} />
    <section className="pa-callout"><div><h2>你的 PA 已经可以工作</h2><p>本机服务和智能体使用同一份工作区数据。连接常用渠道后，也可以从手机发出指令。</p></div><Link className="pa-button primary" href="/app/setup">继续初始化</Link></section>
    <SectionHeading title="运行状态" note="异常时才需要处理" />
    <div className="pa-grid">
      <Metric title="智能体服务" value={loading ? "读取中" : "运行中"} copy={value ? `已连续运行 ${formatDuration(value.machine.uptimeSeconds)}` : "正在连接本机服务"} />
      <Metric title="手机访问" value={value?.machine.mobileAccess === "available" ? "已连接" : "待连接"} copy={value?.machine.mobileAddress || "安全入口正在准备"} />
      <Metric title="渠道" value={value ? `${value.counts.connectedChannels} 个` : "—"} copy={value ? `${value.counts.mail} 封邮件 · ${value.counts.pages} 个发布页` : "正在汇总"} />
    </div>
    <SectionHeading title="最近系统事件" note="固定展示最近 5 条" />
    <div className="desktop-events">{(value?.recent || []).slice(0, 5).map((item) => <Link className="desktop-event" href={desktopActivityHref(item)} key={item.id}><time>{formatTime(item.updatedAt)}</time><div><strong>{item.title}</strong><small>{item.summary}</small></div><span>{statusLabel(item.status)}</span></Link>)}{!loading && !value?.recent?.length ? <Empty text="还没有最近事件" /> : null}</div>
  </main>;
}
