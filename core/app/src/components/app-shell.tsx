"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AppWindow, Menu, X } from "lucide-react";
import { desktopNavigation, mobileNavigation } from "@/components/navigation";

type PersonalApp = { id: string; name: string; route: string; desktopRoute?: string; mobileRoute?: string; assetRoute?: string; compatible: boolean };

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [apps, setApps] = useState<PersonalApp[]>([]);
  const mobile = pathname.startsWith("/app/mobile");

  useEffect(() => {
    let active = true;
    fetch("/api/system/apps", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("catalog unavailable")))
      .then((value) => { if (active) setApps((value.apps || []).filter((app: PersonalApp) => app.compatible && app.route)); })
      .catch(() => { if (active) setApps([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  useEffect(() => {
    if (mobile) return;
    let active = true;
    let runningWork = false;
    const closeAwareWindow = window as typeof window & { __personalAgentCloseHandlerReady?: boolean };
    const refresh = () => {
      fetch("/api/chat/sessions?limit=50", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("sessions unavailable")))
        .then((value) => {
          if (active) runningWork = (value.sessions || []).some((session: { status?: string }) => ["start", "running"].includes(String(session.status || "")));
        })
        .catch(() => { runningWork = false; });
    };
    const confirmRunningWork = () => {
      if (!runningWork || window.confirm("仍有工作正在进行。关闭客户端会停止当前工作、邮件接收和手机入口，确定要关闭吗？")) {
        window.location.href = "/__personal-agent/close";
      }
    };
    closeAwareWindow.__personalAgentCloseHandlerReady = true;
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("personal-agent-close-requested", confirmRunningWork);
    return () => {
      active = false;
      window.clearInterval(timer);
      delete closeAwareWindow.__personalAgentCloseHandlerReady;
      window.removeEventListener("personal-agent-close-requested", confirmRunningWork);
    };
  }, [mobile]);

  if (mobile) return children;
  return <DesktopShell pathname={pathname} drawerOpen={drawerOpen} setDrawerOpen={setDrawerOpen} apps={apps}>{children}</DesktopShell>;
}

function DesktopShell({ pathname, drawerOpen, setDrawerOpen, apps, children }: ShellProps) {
  const active = (href: string) => href === "/app" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const appActive = (app: PersonalApp) => active(app.desktopRoute || app.route);
  const currentApp = apps.find(appActive);
  const current = active("/app/settings") ? "系统设置" : currentApp?.name || desktopNavigation.find((item) => active(item.href))?.label || (active("/app/apps") ? "应用" : "PA 桌面端");
  return <div className={`pa-app desktop-shell${drawerOpen ? " is-drawer-open" : ""}`}>
    <aside className="pa-sidebar" aria-label="桌面端导航">
      <Link className="pa-brand" href="/app"><span className="pa-mark">PA</span><div><strong>PA 桌面端</strong><small>本机控制台</small></div></Link>
      <nav className="pa-nav">
        <span className="pa-nav-label">工作区</span>
        {desktopNavigation.map(({ label, href, symbol }) => <Link aria-current={active(href) ? "page" : undefined} href={href} key={href}><span className="pa-nav-icon">{symbol}</span><span>{label}</span></Link>)}
        <span className="pa-nav-label">我的应用</span>
        <Link aria-current={pathname === "/app/apps" ? "page" : undefined} href="/app/apps"><span className="pa-nav-icon">◫</span><span>全部应用</span></Link>
        {apps.slice(0, 3).map((app) => <Link aria-current={appActive(app) ? "page" : undefined} href={app.desktopRoute || app.route} key={app.id}><span className="pa-nav-icon">{app.name.slice(0, 1)}</span><span>{app.name}</span></Link>)}
      </nav>
      <div className="pa-sidebar-utility">
        <Link aria-current={active("/app/settings") ? "page" : undefined} href="/app/settings"><span className="pa-nav-icon">⚙</span><span>系统设置</span></Link>
      </div>
      <div className="pa-sidebar-note"><div className="desktop-status"><i /><strong>PA 运行正常</strong></div><p>关闭客户端将停止本机服务与手机入口；有进行中的工作时会先确认。</p></div>
    </aside>
    <div className="pa-main">
      <header className="pa-topbar">
        <button className="v622-menu" type="button" aria-label="打开菜单" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu /></button>
        <span className="pa-breadcrumb">PA 桌面端 / {current}</span>
        <div className="pa-user"><b>本机</b><span>无需登录</span></div>
      </header>
      <div className="pa-page">{children}</div>
    </div>
    <button className="v622-backdrop" type="button" aria-label="关闭菜单" onClick={() => setDrawerOpen(false)} />
    <button className="v622-close" type="button" aria-label="关闭菜单" onClick={() => setDrawerOpen(false)}><X /></button>
  </div>;
}

function MobileShell({ pathname, drawerOpen, setDrawerOpen, apps, children }: ShellProps) {
  const active = (href: string) => href === "/app/mobile" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const current = mobileNavigation.find((item) => active(item.href))?.label || "Personal Agent";
  return <div className={`v622-mobile${drawerOpen ? " is-menu-open" : ""}`}>
    <header className="v622-mobile-bar"><button type="button" aria-label="打开菜单" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><Menu /></button><strong>{current}</strong><span aria-hidden="true">PA</span></header>
    <div className="v622-mobile-body">{children}</div>
    <button className="v622-mobile-backdrop" type="button" aria-label="关闭菜单" onClick={() => setDrawerOpen(false)} />
    <aside className="v622-mobile-drawer" aria-label="移动端导航">
      <header><strong>Personal Agent</strong><button type="button" aria-label="关闭菜单" onClick={() => setDrawerOpen(false)}><X /></button></header>
      <div className="v622-mobile-user"><span>PA</span><div><strong>本机 Personal Agent</strong><small>安全连接到你的电脑</small></div></div>
      <nav>
        <span>内容</span>
        {mobileNavigation.map(({ label, href, icon: Icon }) => <Link aria-current={active(href) ? "page" : undefined} href={href} key={href}><Icon /><strong>{label}</strong><small>›</small></Link>)}
        <span>我的应用</span>
        {apps.slice(0, 3).map((app) => <a href={app.mobileRoute || app.route} key={app.id}><AppWindow /><strong>{app.name}</strong><small>›</small></a>)}
      </nav>
      <footer><strong>● 本机在线</strong><span>移动端仅提供安全的只读访问</span></footer>
    </aside>
  </div>;
}

type ShellProps = {
  pathname: string;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  apps: PersonalApp[];
  children: ReactNode;
};
