"use client";

import React from "react";
import { startupSurface } from "../../lib/client-scope";
import { Layers3, LoaderCircle } from "lucide-react";
import { SpaceContentSkeleton } from "../space-transition";
import { CoveMark } from "../brand/cove-mark";

/** Only fixed product copy belongs here; never render private cached page children. */
export function SafeClientStartup({ pathname, failed, onRetry, preparing = false, desktop = false }: { pathname: string; failed: boolean; onRetry: () => void; preparing?: boolean; desktop?: boolean }) {
  const surface = startupSurface(pathname);
  return <main className={`cove-safe-startup${desktop ? " desktop-v72 cove-startup-frame" : " cove-startup-mobile"}`} data-cove-safe-startup>
    {desktop ? <aside className="v72-sidebar" aria-label="Cove 工作区">
      <header className="v72-sidebar-head"><div className="v72-brand"><span className="v72-mark"><CoveMark title="Cove" /></span><span className="v72-brand-copy"><strong>Cove</strong><small>本机工作区</small></span></div></header>
      <div className="cove-startup-nav-skeleton" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((row) => <span key={row} />)}</div>
    </aside> : null}
    <div className="cove-startup-main">
      {desktop ? <div className="v72-topbar" aria-hidden="true"><span className="cove-startup-space-label"><Layers3 />Cove 工作区</span></div> : null}
      <section className="cove-startup-body">
        <div className="cove-transition-content">
          <header className="cove-transition-heading">
            <span className="cove-transition-symbol"><Layers3 aria-hidden="true" /></span>
            <p>{surface.eyebrow}</p><h1>{surface.title}</h1>
            <p role={failed ? "alert" : "status"} className="cove-transition-status">
              {!failed ? <LoaderCircle className="cove-transition-spinner" aria-hidden="true" /> : null}
              {failed ? "暂时无法连接工作区，请重试或查看连接设置。" : preparing ? "正在准备工作区，即将完成…" : "正在安全连接工作区…"}
            </p>
          </header>
          {!failed ? <SpaceContentSkeleton /> : null}
          {surface.setup ? <ol className="cove-startup-steps"><li>确认本机环境</li><li>设置 Agent 运行方式</li><li>完成一次真实对话</li></ol> : null}
          {failed ? <div className="cove-transition-actions"><button className="primary" type="button" onClick={onRetry}>重新连接</button></div> : null}
          <nav className="cove-startup-recovery" aria-label="本机恢复入口"><a href="/app/setup">初始化检查</a><a href="/app/runtime">运行设置</a><a href="/app/settings">空间设置</a></nav>
        </div>
      </section>
    </div>
  </main>;
}
