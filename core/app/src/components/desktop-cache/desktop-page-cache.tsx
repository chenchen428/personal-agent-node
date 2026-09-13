"use client";

import { Activity, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cacheStatusForRoute, CACHE_STATUS_EVENT, clientResourceCache, refreshVisiblePage } from "@/lib/client-resource-cache";
import { desktopPages, isCachedDesktopPath } from "./page-catalog";
import { PageRecoveryBoundary } from "./recovery-panel";
import "./desktop-cache.css";

export function navigateDesktopMenu(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
  if (!link || link.target || link.hasAttribute("download")) return;
  const target = new URL(link.href, window.location.href);
  if (target.origin !== window.location.origin || !isCachedDesktopPath(target.pathname)) return;
  event.preventDefault();
  if (target.href === window.location.href) return;
  window.history.pushState(null, "", target.pathname + target.search + target.hash);
}

export function DesktopPageCache({ pathname, children }: { pathname: string; children: ReactNode }) {
  const cached = isCachedDesktopPath(pathname);
  return <div className="cove-desktop-pages">
    {Object.keys(desktopPages).map((key) => <Activity key={key} mode={key === pathname ? "visible" : "hidden"}>
      <CachedPage path={key} />
    </Activity>)}
    {!cached ? <div className="cove-cached-page">{children}</div> : null}
  </div>;
}

function CachedPage({ path }: { path: string }) {
  const [revision, setRevision] = useState(0);
  const Page = desktopPages[path];
  const scroller = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = position.current; }, []);
  return <div ref={scroller} className="cove-cached-page" onScroll={(event) => { position.current = event.currentTarget.scrollTop; }}>
    <PageRecoveryBoundary key={revision} onRetry={() => { clientResourceCache.forgetRoute(path); setRevision((value) => value + 1); }}>
      <Page />
    </PageRecoveryBoundary>
  </div>;
}

export function DesktopRefreshControl() {
  const path = usePathname();
  const [state, setState] = useState({ refreshing: false, stale: false, offline: false });
  useEffect(() => {
    const update = () => setState({ ...cacheStatusForRoute(path), offline: !navigator.onLine });
    update(); window.addEventListener(CACHE_STATUS_EVENT, update); window.addEventListener("offline", update); window.addEventListener("online", update);
    return () => { window.removeEventListener(CACHE_STATUS_EVENT, update); window.removeEventListener("offline", update); window.removeEventListener("online", update); };
  }, [path]);
  return <div className="cove-refresh-control">
    {state.offline || state.stale ? <span role="status">{state.offline ? "离线 · 显示上次内容" : "部分内容待更新"}</span> : null}
    <button className="icon-button" type="button" onClick={refreshVisiblePage} aria-label="刷新当前页面" title="刷新当前页面" aria-busy={state.refreshing}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></svg>
    </button>
  </div>;
}
