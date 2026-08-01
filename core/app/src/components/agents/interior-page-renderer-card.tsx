import { ArrowRight, CheckCircle2, ExternalLink, Eye, FileJson2, LockKeyhole, RefreshCcw } from "lucide-react";

const steps = ["提交受治理数据", "确定性渲染与检查", "Agent 查看五个视图", "修改数据并重渲染", "提交用户验收"];

export function InteriorPageRendererCard() {
  return <section className="interior-renderer-card" aria-labelledby="interior-renderer-title">
    <header><div><small>GOVERNED CAPABILITY · V1</small><h3 id="interior-renderer-title">装修设计 Page 渲染</h3><p>装修 Agent 只交项目数据，标准能力负责生成设计册与独立 3D Page。</p></div><span><CheckCircle2 aria-hidden="true" />当前产物已生成</span></header>
    <div className="interior-renderer-contract">
      <article><FileJson2 aria-hidden="true" /><small>INPUT</small><strong>interior-page-request / v1</strong><p>不接受任意 HTML、CSS 或 JavaScript。</p></article><ArrowRight aria-hidden="true" />
      <article><LockKeyhole aria-hidden="true" /><small>RENDERER</small><strong>render-interior-pages · v1</strong><p>固定布局、3D、移动横屏、校验与升级。</p></article><ArrowRight aria-hidden="true" />
      <article><Eye aria-hidden="true" /><small>OUTPUT</small><strong>interior-page-bundle / v1</strong><p>设计册承接说明，3D 只保留模型查看。</p></article>
    </div>
    <ol>{steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong></li>)}</ol>
    <div className="interior-renderer-review"><RefreshCcw aria-hidden="true" /><div><strong>Agent 自查看闭环</strong><p>设计册桌面/移动、3D 桌面、移动竖屏侧转和真横屏必须全部查看；问题只回到数据层。</p></div></div>
    <div className="interior-renderer-links"><a href="/assets/agents/interior-designer/featured/index.html" target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />查看生成设计册</a><a href="/assets/agents/interior-designer/featured/3d/index.html" target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />查看独立 3D Page</a></div>
  </section>;
}
