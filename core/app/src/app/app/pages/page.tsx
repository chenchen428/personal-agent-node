import { PagesDashboard } from "@/components/pages-dashboard";

export default function PagesPage() {
  return (
    <main className="page-frame page-frame-wide">
      <header className="page-hero">
        <p className="eyebrow">ONLINE PAGES</p>
        <h1>把结果变成真正的页面。</h1>
        <p>页面发布在你的 Node 上；同一份内容可分别检查 Web 与 Mobile 表现。</p>
      </header>
      <PagesDashboard />
    </main>
  );
}
