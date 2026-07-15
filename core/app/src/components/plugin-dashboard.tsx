"use client";

import { useEffect, useState } from "react";

type Plugin = { id: string; version: string; name: string; description?: string; state: "enabled" | "disabled"; permissions: string[] };

export function PluginDashboard() {
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  useEffect(() => { fetch("/api/plugins", { cache: "no-store" }).then((response) => response.json()).then((value) => setPlugins(value.plugins || [])).catch(() => setPlugins([])); }, []);
  if (plugins === null) return <section className="empty-product-surface"><span className="radial-mark" aria-hidden="true">✣</span><p>正在读取 Workspace 插件注册表…</p></section>;
  if (plugins.length === 0) return <section className="empty-product-surface"><span className="radial-mark" aria-hidden="true">✣</span><p>尚未安装插件。Core 已准备好 Plugin API v1，插件内容将保存在 Workspace。</p></section>;
  return <section className="connector-grid" aria-label="Installed plugins">{plugins.map((plugin, index) => <article className="connector-tile" key={plugin.id}><span>{String(index + 1).padStart(2, "0")}</span><h2>{plugin.name}</h2><p>{plugin.description || plugin.id} · {plugin.version} · {plugin.state === "enabled" ? "已启用" : "已停用"}</p><small>{plugin.permissions.join(" · ") || "默认无权限"}</small></article>)}</section>;
}
