import { SetupDashboard } from "@/components/setup-dashboard";

export default function SetupPage() {
  return (
    <main className="page-frame">
      <header className="grid gap-4 border-b border-[var(--hairline)] py-8 md:grid-cols-[minmax(0,1fr)_360px] md:items-end md:gap-12">
        <div>
          <p className="eyebrow mb-3">SETUP CENTER</p>
          <h1 className="m-0 text-4xl leading-none sm:text-5xl">把这台电脑准备好。</h1>
        </div>
        <p className="m-0 text-sm leading-6 text-[var(--muted)]">先完成本机和 Codex，再用一次统一引导验证公网域名与 Agent 邮箱；本地邮件和渠道可以稍后配置。</p>
      </header>
      <SetupDashboard />
    </main>
  );
}
