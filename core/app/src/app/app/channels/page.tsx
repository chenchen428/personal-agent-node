import { ChannelsDashboard } from "@/components/channels-dashboard";

export default function ChannelsPage() {
  return (
    <main className="page-frame">
      <header className="page-hero">
        <p className="eyebrow">MULTI-CHANNEL</p>
        <h1>一个 Agent，多个入口。</h1>
        <p>Web 是默认入口；微信、小红书和后续插件渠道都遵循同一状态与能力契约。</p>
      </header>
      <ChannelsDashboard />
    </main>
  );
}
