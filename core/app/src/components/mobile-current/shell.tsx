"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Blocks, Info, Layers3, ListTodo, Menu, Newspaper, PanelsTopLeft, X } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { safeHost, useRememberedScroll, useRemote } from "./data";
import type { FilterOption, MobileSection, Overview, PersonalApp } from "./types";

type ShellFilter = {
  label: string;
  description: string;
  value: string;
  setValue: (value: string) => void;
  options: FilterOption[];
};

export function MobileListShell({ section, activeAppId, title, note, children, query, setQuery, searchLabel, searchPlaceholder, filter, screenClassName }: {
  section: MobileSection;
  activeAppId?: string;
  title: string;
  note: string;
  children: ReactNode;
  query?: string;
  setQuery?: (value: string) => void;
  searchLabel?: string;
  searchPlaceholder?: string;
  filter?: ShellFilter;
  screenClassName?: string;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(Boolean(query));
  const [searchDraft, setSearchDraft] = useState(query || "");
  const composingSearch = useRef(false);
  const pathname = usePathname();
  const overview = useRemote<Overview>("/api/node/v1/client/overview");
  const apps = useRemote<{ apps: PersonalApp[] }>("/api/system/apps");

  useRememberedScroll(section);
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEffect(() => { if (!composingSearch.current) setSearchDraft(query || ""); }, [query]);

  return <div className="mobile-current"><div className="mobile-stage"><div className={`phone${drawerOpen ? " menu-open" : ""}`} id="mobile-phone">
    <MobileHeader
      title={title}
      note={note}
      drawerOpen={drawerOpen}
      openDrawer={() => setDrawerOpen(true)}
      searchOpen={searchOpen}
      openSearch={setQuery ? () => { setSearchDraft(query || ""); setSearchOpen(true); } : undefined}
      searchLabel={searchLabel}
      hasActiveConditions={Boolean(query) || Boolean(filter && filter.value !== "all")}
    />
    {setQuery ? <SearchPanel
      open={searchOpen}
      label={searchLabel}
      placeholder={searchPlaceholder}
      value={searchDraft}
      composing={composingSearch}
      onChange={(value) => { setSearchDraft(value); if (!composingSearch.current) setQuery(value); }}
      onCommit={(value) => { setSearchDraft(value); setQuery(value); }}
      onDone={() => setSearchOpen(false)}
      filter={filter}
    /> : null}
    <main className={`mobile-screen${screenClassName ? ` ${screenClassName}` : ""}`} data-mobile-scroll>{children}</main>
    {drawerOpen ? <MobileDrawer
      section={section}
      activeAppId={activeAppId}
      close={() => setDrawerOpen(false)}
      overview={overview.value}
      apps={(apps.value?.apps || []).filter((app) => app.compatible && app.route)}
    /> : null}
  </div></div></div>;
}

function MobileHeader({ title, note, drawerOpen, openDrawer, searchOpen, openSearch, searchLabel, hasActiveConditions }: {
  title: string;
  note: string;
  drawerOpen: boolean;
  openDrawer: () => void;
  searchOpen: boolean;
  openSearch?: () => void;
  searchLabel?: string;
  hasActiveConditions: boolean;
}) {
  return <header className="mobile-header" data-primary-header hidden={searchOpen}>
    <button className="mobile-menu-enhanced" type="button" id="menu-open" aria-label="打开侧边菜单" aria-expanded={drawerOpen} onClick={openDrawer}><Menu aria-hidden="true" /></button>
    <div className="mobile-title"><strong>{title}</strong><span>{note}</span></div>
    <div className="mobile-header-actions">
      {openSearch ? <button className={hasActiveConditions ? "has-active-conditions" : ""} data-list-search-open type="button" aria-label={searchLabel} aria-expanded={searchOpen} onClick={openSearch}><SearchIcon /></button> : null}
    </div>
  </header>;
}

function SearchPanel({ open, label, placeholder, value, composing, onChange, onCommit, onDone, filter }: {
  open: boolean;
  label?: string;
  placeholder?: string;
  value: string;
  composing: MutableRefObject<boolean>;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onDone: () => void;
  filter?: ShellFilter;
}) {
  return <section className={`list-search-panel${filter ? " has-inline-filter" : ""}`} aria-label={label} hidden={!open}>
    <div className="list-search-row">
      <label><SearchIcon /><input
        value={value}
        type="search"
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="search"
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(event) => { composing.current = false; onCommit(event.currentTarget.value); }}
        onChange={(event) => onChange(event.target.value)}
      /></label>
      <button type="button" onClick={onDone}>完成</button>
    </div>
    {filter ? <div className="list-search-filters" role="group" aria-label={filter.label}>
      {filter.options.map((option) => <button
        className={option.value === filter.value ? "is-active" : ""}
        type="button"
        aria-pressed={option.value === filter.value}
        onClick={() => filter.setValue(option.value)}
        key={option.value}
      ><span>{option.label}</span><small>{option.count}</small></button>)}
    </div> : null}
  </section>;
}

function MobileDrawer({ section, activeAppId, close, overview, apps }: { section: MobileSection; activeAppId?: string; close: () => void; overview: Overview | null; apps: PersonalApp[] }) {
  const address = overview?.machine.mobileAddress ? safeHost(overview.machine.mobileAddress) : "安全连接到你的电脑";
  const counts: Record<string, number | string> = { activity: "", pages: overview?.counts.pages ?? "", workers: overview?.counts.work ?? "" };
  return <>
    <button className="mobile-drawer-backdrop" type="button" aria-label="关闭侧边菜单" onClick={close} />
    <aside className="mobile-drawer" aria-label="移动端侧边菜单">
      <div className="drawer-head"><strong>PA · 个人智能体</strong><button type="button" aria-label="关闭侧边菜单" onClick={close}><X aria-hidden="true" /></button></div>
      <div className="drawer-user"><span className="drawer-avatar">PA</span><div><strong>你的 PA</strong><span>{address}</span></div></div>
      <MobileSpaceContext space={overview?.space} />
      <nav className="drawer-nav">
        <span className="drawer-nav-label">工作区</span>
        <Link href="/app/mobile" prefetch onClick={close} aria-current={section === "activity" ? "page" : undefined}><Activity className="mobile-nav-icon" aria-hidden="true" /><span>最近动态</span><small /></Link>
        <Link href="/app/mobile/workers" prefetch onClick={close} aria-current={section === "workers" ? "page" : undefined}><ListTodo className="mobile-nav-icon" aria-hidden="true" /><span>任务</span><small>{counts.workers}</small></Link>
        <Link href="/app/mobile/pages" prefetch onClick={close} aria-current={section === "pages" ? "page" : undefined}><PanelsTopLeft className="mobile-nav-icon" aria-hidden="true" /><span>发布页</span><small>{counts.pages}</small></Link>
        <span className="drawer-nav-label">自定义应用</span>
        <Link href="/app/mobile/apps" prefetch onClick={close} aria-current={section === "apps" && !activeAppId ? "page" : undefined}><Blocks className="mobile-nav-icon" aria-hidden="true" /><span>全部应用</span><small>{apps.length || ""}</small></Link>
        {apps.slice(0, 1).map((app) => <Link href={app.mobileRoute || app.route} prefetch onClick={close} aria-current={activeAppId === app.id ? "page" : undefined} key={app.id}><Newspaper className="mobile-nav-icon" aria-hidden="true" /><span>{app.name}</span><small /></Link>)}
        <span className="drawer-nav-label">系统</span>
        <Link href="/app/mobile/about" prefetch onClick={close} aria-current={section === "about" ? "page" : undefined}><Info className="mobile-nav-icon" aria-hidden="true" /><span>关于</span><small /></Link>
      </nav>
      <div className="drawer-foot mobile-drawer-runtime"><i className="mobile-runtime-dot" /><div><strong>PA 正常运行</strong><span>{overview?.counts.work || 0} 项任务 · 最近发布 {overview?.counts.pages || 0} 个页面</span></div></div>
    </aside>
  </>;
}

function MobileSpaceContext({ space }: { space?: Overview["space"] }) {
  if (!space) return null;
  return <section className="mobile-space-selector" aria-label="当前隔离空间">
    <div className="mobile-space-current"><Layers3 aria-hidden="true" /><span><small>当前隔离空间</small><strong>{space.displayName}</strong></span></div>
  </section>;
}

export function DetailShell({ returnHref, returnLabel, trailing, children }: { returnHref: string; returnLabel: string; trailing?: string; children: ReactNode }) {
  return <div className="mobile-current"><div className="mobile-stage"><div className="phone content-detail-phone"><main className="content-detail-screen"><div className="content-detail-bar"><Link href={returnHref}>‹ {returnLabel}</Link><span>{trailing}</span></div><div className="content-detail-scroll">{children}</div></main></div></div></div>;
}

export function SearchIcon() { return <svg className="mobile-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>; }
export function BackIcon() { return <svg className="mobile-ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>; }
export function SearchStatus({ count, summary, onClear }: { count: number; summary: string; onClear: () => void }) { return <div className="list-search-status" aria-live="polite"><div><strong>{count} 条结果</strong><span>{summary}</span></div><button type="button" onClick={onClear}>清除</button></div>; }
export function SearchEmpty({ title, hint }: { title: string; hint: string }) { return <div className="list-search-empty"><svg className="list-search-empty-illustration" viewBox="0 0 132 104" aria-hidden="true"><rect x="15" y="19" width="75" height="59" rx="11" /><path d="M29 37h37M29 49h27M29 61h19" /><circle cx="91" cy="67" r="20" /><path d="m105 82 12 12" /><path className="list-search-empty-spark" d="M102 19v10M97 24h10" /></svg><strong>{title}</strong><span>{hint}</span></div>; }
export function InlineError({ message }: { message: string }) { return <p className="mobile-inline-error" role="alert">{message}</p>; }

export function LoadSentinel({ loading, canLoad, exhausted, onLoad }: { loading: boolean; canLoad: boolean; exhausted: boolean; onLoad: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!canLoad || loading || !ref.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoad();
    }, { rootMargin: "0px 0px 120px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [canLoad, loading, onLoad]);
  if (!loading && !canLoad && !exhausted) return null;
  return <div className={`mobile-load-sentinel ${loading ? "is-loading" : exhausted ? "is-end" : ""}`} ref={ref}><span className="mobile-load-spinner" aria-hidden="true" /><strong>{loading ? "正在加载" : exhausted ? "没有更多内容了" : ""}</strong></div>;
}
