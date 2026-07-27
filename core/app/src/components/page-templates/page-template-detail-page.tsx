"use client";

import { ArrowUpRight, Check, FileImage, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge, PageHeader, PageSurface } from "@/components/desktop-v72/primitives";
import type { PageTemplate } from "./catalog";
import { TemplateDevicePreview, type TemplatePreviewDevice } from "./template-device-preview";

export function PageTemplateDetailPage({ template }: { template: PageTemplate }) {
  const [device, setDevice] = useState<TemplatePreviewDevice>("web");

  return <PageSurface className="page-template-detail" width="wide">
    <PageHeader
      title={template.name}
      description={template.summary}
      actions={<div className="template-detail-actions"><Badge tone="success">已内置</Badge><a className="button primary" href={`/template-pages/${template.id}`} rel="noreferrer" target="_blank">打开示例<ArrowUpRight aria-hidden="true" /></a></div>}
    />

    <TemplateDevicePreview device={device} onChange={setDevice} />

    <section className="template-detail-overview" aria-label="模板说明">
      <article>
        <h2>从装修证据到可追溯的 Pascal 专业概念模型</h2>
        <p>把脱敏户型依据、需求优先级、A/B 方案、真实门窗开洞、多层构件、质量审计和专业核验边界放进同一份离线交付，并保留每次 revision 的调整依据。</p>
        <ul>{template.fixedFramework.slice(0, 6).map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
      </article>
      <aside>
        <div className="template-source-rule"><FileImage aria-hidden="true" /><span><strong>证据、模型与审计并列查看</strong><small>原始图、调整标注、Pascal 设计模型、用户需求和质量边界保持在同一份交付里。</small></span></div>
        <dl>
          <div><dt>关联技能</dt><dd>{template.skill}</dd></div>
          <div><dt>模板实现</dt><dd>v{template.implementation.version} · 同源生成</dd></div>
          <div><dt>适配设备</dt><dd>Web · 移动横屏</dd></div>
          <div><dt>验收方式</dt><dd>确定性检查 · 用户视觉验收</dd></div>
        </dl>
        <div className="template-agent-freedom"><span><Sparkles aria-hidden="true" />Agent 可调整</span><p>{template.agentFreedom.slice(0, 3).join(" · ")}</p></div>
      </aside>
    </section>
  </PageSurface>;
}
