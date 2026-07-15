import { DataDashboard } from "@/components/data-dashboard";

export default function DataPage() {
  return (
    <main className="page-frame page-frame-wide data-page">
      <header className="product-page-heading">
        <div><p className="eyebrow">WORKSPACE DATA</p><h1>数据留在本机，也保持可理解。</h1></div>
        <p>浏览结构、查询记录、执行受保护 SQL，并在改动前留下可恢复快照。</p>
      </header>
      <DataDashboard />
    </main>
  );
}
