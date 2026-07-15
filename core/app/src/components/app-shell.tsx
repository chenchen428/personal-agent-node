"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { BookOpen, Boxes, LayoutGrid, Mail, MessageCircle, MoreHorizontal, Radio, Settings, Sparkles, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavigationItem = { label: string; href: string; icon: ComponentType<{ className?: string }> };

const navigation: NavigationItem[] = [
  { label: "对话", href: "/app/chat", icon: MessageCircle },
  { label: "邮件", href: "/app/mail", icon: Mail },
  { label: "页面", href: "/app/pages", icon: LayoutGrid },
  { label: "渠道", href: "/app/channels", icon: Radio },
  { label: "数据", href: "/app/data", icon: Boxes },
  { label: "技能", href: "/app/skills", icon: Sparkles },
  { label: "插件", href: "/app/plugins", icon: BookOpen },
];

const mobilePrimary = navigation.slice(0, 4);
const mobileMore = navigation.slice(4);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="app-shell">
      <header className="top-nav">
        <Link className="brand" href="/app"><span className="radial-mark" aria-hidden="true">✣</span><span>Personal Agent</span></Link>
        <nav className="desktop-nav" aria-label="主导航">
          {navigation.map(({ label, href }) => <Link aria-current={isActive(href) ? "page" : undefined} href={href} key={href}>{label}</Link>)}
        </nav>
        <Link className={cn(buttonVariants({ variant: isActive("/app/setup") ? "default" : "outline", size: "icon" }), "nav-settings")} href="/app/setup" aria-label="本机设置" title="本机设置"><Settings className="size-4" /></Link>
      </header>

      <div className="app-content">{children}</div>

      {moreOpen ? <div className="mobile-more-backdrop" role="presentation" onClick={() => setMoreOpen(false)}>
        <section className="mobile-more-panel" role="dialog" aria-modal="true" aria-label="更多导航" onClick={(event) => event.stopPropagation()}>
          <header><strong>更多</strong><button type="button" aria-label="关闭更多导航" title="关闭" onClick={() => setMoreOpen(false)}><X className="size-5" /></button></header>
          <nav>{mobileMore.map(({ label, href, icon: Icon }) => <Link aria-current={isActive(href) ? "page" : undefined} href={href} key={href} onClick={() => setMoreOpen(false)}><Icon className="size-5" /><span>{label}</span></Link>)}</nav>
          <Link className="mobile-setup-link" href="/app/setup" onClick={() => setMoreOpen(false)}><Settings className="size-5" /><span>本机设置</span></Link>
        </section>
      </div> : null}

      <nav className="mobile-nav" aria-label="移动端主导航">
        {mobilePrimary.map(({ label, href, icon: Icon }) => <Link aria-current={isActive(href) ? "page" : undefined} href={href} key={href}><Icon className="size-5" /><span>{label}</span></Link>)}
        <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((current) => !current)}><MoreHorizontal className="size-5" /><span>更多</span></button>
      </nav>
    </div>
  );
}
