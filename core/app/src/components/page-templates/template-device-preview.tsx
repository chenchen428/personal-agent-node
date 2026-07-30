"use client";

import { Monitor, Smartphone } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PageTemplatePresentation } from "./catalog";
import { TemplateArtifactPreview } from "./template-artifact-preview";

export type TemplatePreviewDevice = "web" | "mobile";

export function TemplateDevicePreview({
  artifactPath,
  device,
  onChange,
  presentation,
}: {
  artifactPath: string;
  device: TemplatePreviewDevice;
  onChange: (device: TemplatePreviewDevice) => void;
  presentation: PageTemplatePresentation;
}) {
  const mobile = device === "mobile";

  return <section className={`template-device-preview is-${device}`} id="template-preview" aria-label={`${mobile ? "移动端" : "Web"}模板预览`}>
    <header>
      <div><span>{mobile ? presentation.mobileEyebrow : presentation.webEyebrow}</span><strong>{mobile ? presentation.mobileLabel : presentation.webLabel}</strong></div>
      <Tabs value={device} onValueChange={(value) => onChange(value as TemplatePreviewDevice)}>
        <TabsList className="template-device-switch" aria-label="切换模板预览设备">
          <TabsTrigger value="web"><Monitor aria-hidden="true" />Web</TabsTrigger>
          <TabsTrigger value="mobile"><Smartphone aria-hidden="true" />移动端</TabsTrigger>
        </TabsList>
      </Tabs>
    </header>
    <div className="template-device-stage">
      <div className="template-device-frame">
        <TemplateArtifactPreview artifactPath={artifactPath} device={device} title={presentation.previewTitle} />
      </div>
    </div>
  </section>;
}
