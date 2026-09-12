"use client";

import React from "react";
import { startupSurface } from "../../lib/client-scope";

/** Only fixed product copy belongs here; never render private cached page children. */
export function SafeClientStartup({ pathname, failed, onRetry }: { pathname: string; failed: boolean; onRetry: () => void }) {
  const surface = startupSurface(pathname);
  return <main className="cove-first-load" data-cove-safe-startup aria-busy={!failed}>
    <header><p>{surface.eyebrow}</p><h1>{surface.title}</h1>
      <p role="status">{failed ? "暂时无法连接本机控制服务，请重试或查看初始化入口。" : "正在连接本机控制服务…"}</p>
    </header>
    {surface.setup ? <ol><li>确认本机环境</li><li>设置 Agent 运行方式</li><li>完成一次真实对话</li></ol> : null}
    <nav aria-label="本机恢复入口" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBlock: 20 }}>
      <a href="/app/setup">初始化检查</a><a href="/app/runtime">运行设置</a><a href="/app/settings">空间设置</a>
    </nav>
    {failed ? <button className="primary" type="button" onClick={onRetry}>重新连接</button> : null}
  </main>;
}
