"use client";

import type { RuntimeData } from "./types";
import { Heading, Setting, formatDuration, useJson } from "./shared";

export function RuntimePage() {
  const { value, loading } = useJson<RuntimeData>("/api/node/v1/client/runtime");
  return <main><Heading eyebrow="运行周期" title="运行与生命周期" copy="关闭窗口、任务运行和异常恢复时，客户端与本机服务保持一致。" action={<span className="pa-status">{loading ? "读取中" : value?.state === "running" ? "服务运行中" : "状态未知"}</span>} /><div className="runtime-layout"><section className="setting-list lifecycle-settings"><Setting title="打开客户端时启动 PA" copy="本机服务启动完成后，客户端才显示可用。" /><Setting title="关闭客户端时停止服务" copy="停止前会检查运行中的工作；有任务时先要求确认。" /><Setting title="异常时自动恢复" copy="优先恢复当前版本，失败时回退到上一版本。" /></section><aside className="runtime-status"><span className="pa-eyebrow">当前运行</span><h2>PA 已运行 {value ? formatDuration(value.uptimeSeconds) : "—"}</h2><dl><div><dt>客户端关闭时停止</dt><dd>{value?.shellStopsService ? "是" : "检测中"}</dd></div><div><dt>当前版本</dt><dd>{value?.version || "读取中"}</dd></div></dl><button className="pa-button danger" type="button" onClick={() => { if (window.confirm("确定停止 PA 服务并关闭客户端吗？")) window.location.href = "/__personal-agent/close"; }}>停止 PA 服务</button><p>停止后，邮件接收和手机访问也会暂时不可用。</p></aside></div></main>;
}
