import { SkillsDashboard } from "@/components/skills-dashboard";

export default function SkillsPage() {
  return (
    <main className="page-frame skills-page">
      <header className="product-page-heading">
        <div><p className="eyebrow">NODE HARNESS</p><h1>知道 Agent 会什么，也知道边界在哪。</h1></div>
        <p>技能随 Node Harness 交付，目录、风险、权限与用例均可检查。</p>
      </header>
      <SkillsDashboard />
    </main>
  );
}
