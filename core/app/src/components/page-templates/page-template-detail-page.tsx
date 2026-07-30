"use client";

import { ArrowUpRight, Check, FileImage, Sparkles } from "lucide-react";
import { useState } from "react";
import { Badge, PageHeader, PageSurface } from "@/components/desktop-v72/primitives";
import { presentationFor, type PageTemplate } from "./catalog";
import { TemplateDevicePreview, type TemplatePreviewDevice } from "./template-device-preview";

export function PageTemplateDetailPage({ template }: { template: PageTemplate }) {
  const [device, setDevice] = useState<TemplatePreviewDevice>("web");
  const presentation = presentationFor(template);

  return <PageSurface className="page-template-detail" width="wide">
    <PageHeader
      title={template.name}
      description={template.summary}
      actions={<div className="template-detail-actions"><Badge tone="success">已内置</Badge><a className="button primary" href={`/template-pages/${template.id}`} rel="noreferrer" target="_blank">打开示例<ArrowUpRight aria-hidden="true" /></a></div>}
    />

    <TemplateDevicePreview artifactPath={template.exampleArtifact.pagePath} device={device} onChange={setDevice} presentation={presentation} />

    <section className="template-detail-overview" aria-label="模板说明">
      <article>
        <h2>{presentation.detailHeading}</h2>
        <p>{presentation.detailDescription}</p>
        <ul>{template.fixedFramework.slice(0, 6).map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
      </article>
      <aside>
        <div className="template-source-rule"><FileImage aria-hidden="true" /><span><strong>{presentation.principleTitle}</strong><small>{presentation.principleDescription}</small></span></div>
        <dl>
          <div><dt>关联技能</dt><dd>{template.skill}</dd></div>
          <div><dt>模板实现</dt><dd>v{template.implementation.version} · 受治理项目同源生成</dd></div>
          <div><dt>适配设备</dt><dd>Web · {template.mobileLandscape ? "移动横屏" : "移动端"}</dd></div>
          <div><dt>验收方式</dt><dd>确定性检查 · 用户视觉验收</dd></div>
        </dl>
        <div className="template-agent-freedom"><span><Sparkles aria-hidden="true" />Agent 可调整</span><p>{template.agentFreedom.slice(0, 3).join(" · ")}</p></div>
      </aside>
    </section>
  </PageSurface>;
}
