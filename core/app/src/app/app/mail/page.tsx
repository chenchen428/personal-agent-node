import { MailDashboard } from "@/components/mail-dashboard";

export default function MailPage() {
  return <main className="page-frame page-frame-wide">
    <header className="page-hero compact">
      <p className="eyebrow">LOCAL MAIL</p>
      <h1>邮件留在自己的 Workspace。</h1>
      <p>先用 EML 验证本机归档，再按需连接你管理的邮件入口。Node 不捆绑公网 SMTP 服务。</p>
    </header>
    <MailDashboard />
  </main>;
}
