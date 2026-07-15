import { notFound } from "next/navigation";

const sections: Record<string, { eyebrow: string; title: string; description: string }> = {
  chat: { eyebrow: "CODEX CONVERSATION", title: "和你的 Agent 继续工作。", description: "真实 Codex runtime、同一会话、全部记录留在 Workspace。" },
  mail: { eyebrow: "LOCAL MAIL", title: "邮件进入 Workspace，不进入云端。", description: "投递、附件、自动化与恢复证据彼此独立。" },
  data: { eyebrow: "AGENT DATA", title: "把结构交给 Agent，把所有权留给你。", description: "SQLite 数据、动态 schema 与本机审计。" },
  skills: { eyebrow: "HARNESS", title: "技能就在 Workspace 里。", description: "可读、可改、可测试，并通过统一 registry 被 Codex 发现。" },
  channels: { eyebrow: "OPTIONAL CHANNELS", title: "渠道是入口，不是前提。", description: "Web 永远先可用，微信与托管平台按需启用。" },
  update: { eyebrow: "IMMUTABLE RELEASES", title: "升级 Core，不覆盖 Workspace。", description: "current / previous 原子切换，随时回到上一版。" },
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const content = sections[section];
  if (!content) notFound();
  return (
    <main className="page-frame">
      <header className="page-hero">
        <p className="eyebrow">{content.eyebrow}</p>
        <h1>{content.title}</h1>
        <p>{content.description}</p>
      </header>
      <section className="empty-product-surface">
        <span className="radial-mark" aria-hidden="true">✣</span>
        <p>该能力正在迁移到统一 Next.js 界面，现有 API 与数据契约保持不变。</p>
      </section>
    </main>
  );
}
