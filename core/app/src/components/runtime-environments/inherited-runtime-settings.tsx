"use client";

import React from "react";
import { engineLabels, effortLabels, type RuntimeSettings } from "./types";

export function InheritedRuntimeSettings({ settings, onRefresh }: { settings: RuntimeSettings; onRefresh: () => void }) {
  const profile = settings.profiles[settings.engine];
  const source = settings.sourceSpace?.displayName || "主工作区";
  return <section className="runtime-environments" aria-labelledby="inherited-runtime-title">
    <header className="runtime-section-header"><div><h2 id="inherited-runtime-title">运行环境</h2><p>由主工作区统一管理，当前空间自动应用。</p></div><span className="runtime-active-summary">只读 · 已继承</span></header>
    <div className="runtime-inherited-note" role="status"><strong>配置来源：{source}</strong><p>模型和运行环境只能在主工作区修改。主配置更新后，当前空间的新对话与新任务会自动使用最新配置。</p></div>
    <section className="runtime-inherited-profile" aria-label="当前应用的运行配置"><h3>{engineLabels[settings.engine]}</h3><dl>
      <div><dt>使用方式</dt><dd>{profile.mode === "account" ? "主工作区账号" : "自定义模型服务"}</dd></div>
      <div><dt>模型</dt><dd>{profile.model || "账号默认模型"}</dd></div>
      <div><dt>推理强度</dt><dd>{profile.reasoningEffort ? effortLabels[profile.reasoningEffort] || profile.reasoningEffort : "默认"}</dd></div>
      {profile.mode === "custom" ? <><div><dt>服务地址</dt><dd>{profile.baseUrl || "未设置"}</dd></div><div><dt>访问凭据</dt><dd>{profile.credentialConfigured ? "由主工作区提供" : "主工作区尚未配置"}</dd></div></> : null}
    </dl></section>
    <footer className="runtime-save-bar"><p>如需调整，请切换到主工作区的“运行设置”。</p><button type="button" className="button" onClick={onRefresh}>重新读取</button></footer>
  </section>;
}
