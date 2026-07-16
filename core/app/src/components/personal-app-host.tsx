"use client";

import { useEffect, useState } from "react";

type PersonalApp = {
  id: string;
  name: string;
  route: string;
  desktopRoute?: string;
  assetRoute?: string;
  compatible: boolean;
};

export function PersonalAppHost({ appId }: { appId: string }) {
  const [app, setApp] = useState<PersonalApp | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/system/apps", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("catalog unavailable")))
      .then((value) => {
        if (!active) return;
        const match = (value.apps || []).find((item: PersonalApp) => item.id === appId && item.compatible);
        setApp(match || null);
        setState(match ? "ready" : "missing");
      })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [appId]);

  if (state === "loading") return <div className="personal-app-state"><strong>正在打开应用</strong><p>正在连接本机应用内容。</p></div>;
  if (state === "error") return <div className="personal-app-state"><strong>暂时无法读取应用</strong><p>本机服务仍在运行，可以稍后重试。</p></div>;
  if (!app) return <div className="personal-app-state"><strong>应用不可用</strong><p>它可能已被移除或与当前版本不兼容。</p></div>;

  const assetRoute = app.assetRoute || `/apps/${encodeURIComponent(app.id)}/`;
  const separator = assetRoute.includes("?") ? "&" : "?";
  return <section className="personal-app-host" aria-label={app.name}>
    <iframe
      src={`${assetRoute}${separator}embedded=1&surface=desktop`}
      title={app.name}
      onLoad={(event) => applyHostedLayout(event.currentTarget)}
    />
  </section>;
}

function applyHostedLayout(frame: HTMLIFrameElement) {
  const document = frame.contentDocument;
  if (!document?.querySelector("#shell > .sidebar")) return;
  document.documentElement.classList.add("personal-agent-hosted");
  if (document.getElementById("personal-agent-host-style")) return;
  const style = document.createElement("style");
  style.id = "personal-agent-host-style";
  style.textContent = `
    html.personal-agent-hosted,html.personal-agent-hosted body{height:100%;min-height:0;overflow:hidden}
    html.personal-agent-hosted #shell{height:100%;min-height:0;display:block}
    html.personal-agent-hosted #shell>.sidebar,
    html.personal-agent-hosted #shell>.main>.topbar,
    html.personal-agent-hosted #shell>.drawer-backdrop{display:none!important}
    html.personal-agent-hosted #shell>.main{height:100%;overflow-y:auto;overscroll-behavior:contain}
    html.personal-agent-hosted #shell>.main>.page{width:min(1120px,calc(100% - 72px));min-height:100%;margin:0 auto;padding:44px 0 64px}
  `;
  document.head.append(style);
}
