import { PluginDashboard } from "@/components/plugin-dashboard";

const contributions = ["页面插槽", "Agent 工具", "后台任务", "渠道适配器", "定时任务"];

export default function PluginsPage() {
  return (
    <main className="page-frame">
      <header className="page-hero compact">
        <p className="eyebrow">PLUGIN STUDIO</p>
        <h1>扩展能力，不改写 Core。</h1>
        <p>插件安装在 Workspace，先声明权限与兼容版本，再获得有限的产品插槽。</p>
      </header>
      <section className="dark-stage">
        <div>
          <span className="badge badge-coral">API v1</span>
          <h2>personal-agent.plugin.json</h2>
          <p>每个插件都有可审计的 manifest、独立数据目录和明确生命周期。</p>
        </div>
        <pre aria-label="Plugin manifest example"><code>{`{
  "apiVersion": "personal-agent/v1",
  "id": "example.notes",
  "version": "1.0.0",
  "permissions": ["workspace.files:read"],
  "contributes": { "navigation": [], "tools": [] }
}`}</code></pre>
      </section>
      <section className="connector-grid" aria-label="Plugin contribution points">
        {contributions.map((item, index) => <article className="connector-tile" key={item}><span>0{index + 1}</span><h2>{item}</h2><p>通过类型化契约注册，默认无权限。</p></article>)}
      </section>
      <PluginDashboard />
    </main>
  );
}
