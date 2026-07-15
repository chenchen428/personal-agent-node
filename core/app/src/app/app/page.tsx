import Link from "next/link";
import { ArchitecturePanel } from "@/components/architecture-panel";
import { StatusCard } from "@/components/status-card";

export default function OverviewPage() {
  return (
    <main>
      <section className="hero-band">
        <div className="hero-copy reveal reveal-one">
          <p className="eyebrow"><span className="status-dot" /> LOCAL-FIRST · READY</p>
          <h1>你的 Agent，住在自己的工作空间里。</h1>
          <p className="hero-lead">Core 负责可靠运行，Workspace 保存你的 Harness、文件与记忆。升级产品，不搬走生活。</p>
          <div className="button-row">
            <Link className="button button-primary" href="/app/chat">开始对话</Link>
            <Link className="button button-secondary" href="/app/setup">检查本机</Link>
          </div>
        </div>
        <div className="reveal reveal-two"><ArchitecturePanel /></div>
      </section>

      <section className="content-band">
        <div className="section-heading">
          <p className="eyebrow">ONE HOME · TWO OWNERS</p>
          <h2>清楚的边界，比更多的模块重要。</h2>
        </div>
        <div className="feature-grid">
          <StatusCard index="01" title="Core" state="产品拥有" tone="dark">不可变运行时、Next.js 应用、Codex 编排、安装器与回滚。</StatusCard>
          <StatusCard index="02" title="Workspace" state="你拥有" tone="cream">Harness、技能、插件、文件、数据库、邮件与全部私有数据。</StatusCard>
          <StatusCard index="03" title="Plugins" state="按权限扩展" tone="coral">版本化 manifest、能力声明和独立数据目录，不修改 Core。</StatusCard>
        </div>
      </section>
    </main>
  );
}
