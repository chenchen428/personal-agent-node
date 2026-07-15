import { SetupDashboard } from "@/components/setup-dashboard";

export default function SetupPage() {
  return (
    <main className="page-frame">
      <header className="page-hero">
        <p className="eyebrow">SETUP CENTER</p>
        <h1>先让本机可用，再选择远方。</h1>
        <p>安装、Codex、域名和邮箱是四组独立事实。没有选择的能力不会显示成故障。</p>
      </header>
      <SetupDashboard />
    </main>
  );
}
