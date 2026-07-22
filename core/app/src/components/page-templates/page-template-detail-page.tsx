"use client";

import { ArrowDownRight, Check, FileImage, Sparkles } from "lucide-react";
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
      actions={<div className="template-detail-actions"><Badge tone="success">已内置</Badge><a className="button primary" href="#template-preview">打开示例<ArrowDownRight aria-hidden="true" /></a></div>}
    />

    <TemplateDevicePreview device={device} onChange={setDevice} />

    <section className="template-detail-overview" aria-label="模板说明">
      <article>
        <h2>从户型图到 SketchUp 式完整家装鸟瞰</h2>
        <p>先归纳用户持续迭代的需求与原始户型图，再使用墙体、门窗、定制柜、家具与软装组件构建 SketchUp 式整屋模型，并保留户型调整依据。</p>
        <ul>{template.fixedFramework.slice(0, 6).map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
      </article>
      <aside>
        <div className="template-source-rule"><FileImage aria-hidden="true" /><span><strong>户型图与方案并列查看</strong><small>原始图、调整标注、SU 设计稿和用户需求保持在同一份交付里。</small></span></div>
        <dl>
          <div><dt>关联技能</dt><dd>{template.skill}</dd></div>
          <div><dt>适配设备</dt><dd>Web · 移动横屏</dd></div>
          <div><dt>交互方式</dt><dd>桌面精细控制 · 移动触控查看</dd></div>
        </dl>
        <div className="template-agent-freedom"><span><Sparkles aria-hidden="true" />Agent 可调整</span><p>{template.agentFreedom.slice(0, 3).join(" · ")}</p></div>
      </aside>
    </section>
  </PageSurface>;
}
