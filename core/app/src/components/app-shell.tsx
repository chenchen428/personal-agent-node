import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  ["对话", "/app/chat"], ["邮件", "/app/mail"], ["文件", "/app/files"],
  ["数据", "/app/data"], ["技能", "/app/skills"], ["渠道", "/app/channels"],
  ["插件", "/app/plugins"],
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="top-nav">
        <Link className="brand" href="/app"><span className="radial-mark" aria-hidden="true">✣</span><span>Personal Agent</span></Link>
        <nav aria-label="主导航">{navigation.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</nav>
        <Link className="button button-primary nav-cta" href="/app/setup">本机设置</Link>
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
