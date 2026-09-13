"use client";

import { ClientSessionBoundary } from "./desktop-cache/client-session-boundary";
import { DesktopPageCache, DesktopRefreshControl, navigateDesktopMenu } from "./desktop-cache/desktop-page-cache";
import { CoveMark } from "./brand/cove-mark";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { desktopNavigation, desktopNavigationGroups, desktopUtilityNavigation } from "@/components/navigation";
import { SpaceSwitcher } from "@/components/space-switcher";
import { UpdateNavItem } from "@/components/update-nav-item";
import { fetchJson } from "@/lib/client-json";
import { ManagedConnectionsBootstrap } from "@/components/managed-connections-bootstrap";
import { MobileAppShell } from "@/components/mobile-current/shell";
import { DesktopHeaderBreadcrumb } from "@/components/desktop-header-breadcrumb";

export function AppShell({ children, initialMobileHint = false }: { children: ReactNode; initialMobileHint?: boolean }) {
  const pathname = usePathname();
  const mobile = pathname.startsWith("/app/mobile") || (initialMobileHint && pathname === "/app");

  useCloseProtection(mobile);
  if (mobile) return <ClientSessionBoundary><MobileAppShell>{children}</MobileAppShell></ClientSessionBoundary>;
  return <ClientSessionBoundary desktop><ManagedConnectionsBootstrap enabled /><DesktopShell pathname={pathname}>{children}</DesktopShell></ClientSessionBoundary>;
}

function DesktopShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [machineName, setMachineName] = useState("本机在线");
  const active = (href: string) => href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const current = active("/app/update") ? "软件更新"
      : active("/app/statistics/token-usage") ? "Token 统计"
        : active("/app/skills") ? "技能"
          : active("/app/settings") ? "空间设置"
            : desktopNavigation.find((item) => active(item.href))?.label || "Cove";

  useEffect(() => {
    let mounted = true;
    fetchJson<{ machine?: { name?: string; id?: string } }>("/api/node/v1/client/overview")
      .then((value) => { if (mounted) setMachineName(value.machine?.name || value.machine?.id || "本机在线"); })
      .catch(() => undefined);
    return () => { mounted = false; };
  }, []);

  return <div className={`desktop-v72 app-frame app-frame-embedded${collapsed ? " is-sidebar-collapsed" : ""}`} onClickCapture={navigateDesktopMenu}>
    <aside className={`v72-sidebar sidebar${collapsed ? " collapsed" : ""}`} aria-label="桌面端导航">
      <header className="v72-sidebar-head sidebar-head">
        <Link className="v72-brand sidebar-brand" href="/app"><span className="v72-mark brand-mark"><CoveMark title="Cove" /></span><span className="v72-brand-copy"><strong>Cove</strong><small>本机工作区</small></span></Link>
        <button className="icon-button sidebar-collapse" type="button" aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"} title={collapsed ? "展开侧边栏" : "收起侧边栏"} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</button>
      </header>
      <div className="v72-sidebar-scroll sidebar-scroll">
        {desktopNavigationGroups.map((group) => <section className="v72-nav-group nav-group" key={group.label}>
          <span className="v72-nav-label nav-label">{group.label}</span>
          <nav>{group.items.map(({ label, href, icon: Icon }) => <Link className={`v72-nav-link nav-link${active(href) ? " active" : ""}`} aria-current={active(href) ? "page" : undefined} href={href} title={collapsed ? label : undefined} key={href}><Icon /><span>{label}</span></Link>)}</nav>
        </section>)}
      </div>
      <div className="v72-sidebar-bottom sidebar-bottom">
        <nav><UpdateNavItem active={active("/app/update")} />{desktopUtilityNavigation.map(({ label, href, icon: Icon }) => { const itemActive = href === "/app/settings" ? active(href) || active("/app/skills") : active(href); return <Link className={`v72-nav-link nav-link${itemActive ? " active" : ""}`} aria-current={itemActive ? "page" : undefined} href={href} title={collapsed ? label : undefined} key={href}><Icon /><span>{label}</span></Link>; })}</nav>
        <div className="v72-runtime-chip runtime-chip" title="当前隔离空间运行正常"><i className="status-dot success" /><span><strong>Cove 运行正常</strong><small>当前隔离空间独立运行</small></span></div>
      </div>
    </aside>
    <main className="v72-main-shell main-shell shell-card">
      <header className="v72-topbar topbar"><div className="topbar-start"><SpaceSwitcher /></div><DesktopHeaderBreadcrumb pathname={pathname} currentLabel={current} /><div className="v72-machine machine-state topbar-end"><DesktopRefreshControl /><i className="status-dot success" /><span>{machineName}</span></div></header>
      <div className="v72-page-scroll page-scroll"><DesktopPageCache pathname={pathname}>{children}</DesktopPageCache></div>
    </main>
  </div>;
}

function useCloseProtection(mobile: boolean) {
  useEffect(() => {
    if (mobile) return;
    let active = true;
    let runningWork = false;
    const closeAwareWindow = window as typeof window & { __personalAgentCloseHandlerReady?: boolean };
    const refresh = () => fetchJson<{ sessions?: Array<{ status?: string }> }>("/api/chat/sessions?limit=50")
      .then((value) => { if (active) runningWork = (value.sessions || []).some((session) => ["start", "running"].includes(String(session.status || ""))); })
      .catch(() => { runningWork = false; });
    const confirmRunningWork = () => {
      if (!runningWork || window.confirm("仍有工作正在进行。关闭客户端会停止当前工作、邮件接收和手机入口，确定要关闭吗？")) window.location.href = "/__personal-agent/close";
    };
    closeAwareWindow.__personalAgentCloseHandlerReady = true;
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("personal-agent-close-requested", confirmRunningWork);
    return () => { active = false; window.clearInterval(timer); delete closeAwareWindow.__personalAgentCloseHandlerReady; window.removeEventListener("personal-agent-close-requested", confirmRunningWork); };
  }, [mobile]);
}
