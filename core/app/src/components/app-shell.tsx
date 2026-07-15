import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  ["对话", "/app/chat"], ["邮件", "/app/mail"], ["页面", "/app/pages"],
  ["渠道", "/app/channels"], ["数据", "/app/data"], ["技能", "/app/skills"],
  ["插件", "/app/plugins"],
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="top-nav">
        <Link className="brand" href="/app"><span className="radial-mark" aria-hidden="true">✣</span><span>Personal Agent</span></Link>
        <nav aria-label="主导航">{navigation.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</nav>
        <Link className={cn(buttonVariants(), "nav-cta")} href="/app/setup">本机设置</Link>
      </header>
      {children}
      <footer className="footer">
        <div className="brand on-dark"><span className="radial-mark" aria-hidden="true">✣</span><span>Personal Agent</span></div>
        <p>Core 可以替换，Workspace 始终属于你。</p>
        <span>Local-first · Open Harness · User-owned data</span>
      </footer>
    </div>
  );
}
