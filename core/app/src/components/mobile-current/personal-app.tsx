"use client";

import { useRemote } from "./data";
import { InlineError, MobileListShell, SearchEmpty } from "./shell";
import type { PersonalApp } from "./types";

export function MobilePersonalApp({ appId }: { appId: string }) {
  const { value, loading, error } = useRemote<{ apps: PersonalApp[] }>("/api/system/apps");
  const app = (value?.apps || []).find((item) => item.id === appId && item.compatible);

  return <MobileListShell
    section="apps"
    activeAppId={appId}
    title={app?.name || "应用"}
    note="手机访问已连接"
    screenClassName="mobile-app-screen"
  >
    {error ? <InlineError message={error} /> : null}
    {!error && loading ? <div className="mobile-app-loading" aria-live="polite">正在打开应用…</div> : null}
    {!error && !loading && !app ? <SearchEmpty title="应用不可用" hint="它可能已被移除或与当前版本不兼容" /> : null}
    {app ? <MobileAppFrame app={app} /> : null}
  </MobileListShell>;
}

function MobileAppFrame({ app }: { app: PersonalApp }) {
  const assetRoute = app.assetRoute || `/apps/${encodeURIComponent(app.id)}/`;
  const separator = assetRoute.includes("?") ? "&" : "?";
  return <section className="mobile-personal-app-host" aria-label={app.name}>
    <iframe src={`${assetRoute}${separator}embedded=1&surface=mobile`} title={app.name} />
  </section>;
}
