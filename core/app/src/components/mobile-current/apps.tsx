"use client";

import { useRemote } from "./data";
import { InlineError, MobileListShell, SearchEmpty } from "./shell";
import type { PersonalApp } from "./types";

export function MobileApps() {
  const { value, loading, error } = useRemote<{ apps: PersonalApp[] }>("/api/system/apps");
  const apps = (value?.apps || []).filter((app) => app.compatible && app.route);
  return <MobileListShell section="apps" title="应用" note={`${apps.length} 个可用应用`}>
    <section className="mobile-app-directory">
      <header><span className="eyebrow">我的应用</span><h1>应用</h1><p>打开这台电脑上可通过手机使用的应用。</p></header>
      {error ? <InlineError message={error} /> : null}
      <div className="mobile-app-list">{apps.map((app, index) => <a className={`mobile-app-card${index === 0 ? " featured" : ""}`} href={app.mobileRoute || app.route} key={app.id}><span className={`mobile-app-icon${index % 3 === 1 ? " mint" : index % 3 === 2 ? " coral" : ""}`}>{app.name.slice(0, 1)}</span><div><strong>{app.name}</strong><p>{app.description || "由 PA 安装在这台电脑上的应用。"}</p><small>手机优先 · 支持电脑</small></div><i>打开</i></a>)}</div>
      {!loading && !apps.length ? <SearchEmpty title="还没有应用" hint="安装后的应用会显示在这里" /> : null}
    </section>
  </MobileListShell>;
}
