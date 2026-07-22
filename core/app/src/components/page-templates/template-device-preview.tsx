import { Monitor, Smartphone } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InteriorTemplatePreview } from "./interior-template-preview";

export type TemplatePreviewDevice = "web" | "mobile";

export function TemplateDevicePreview({ device, onChange }: { device: TemplatePreviewDevice; onChange: (device: TemplatePreviewDevice) => void }) {
  const mobile = device === "mobile";

  return <section className={`template-device-preview is-${device}`} id="template-preview" aria-label={`${mobile ? "移动端" : "Web"}模板预览`}>
    <header>
      <div><span>{mobile ? "MOBILE LIVE PREVIEW" : "COVER MATCH · LIVE 3D"}</span><strong>{mobile ? "移动端 · 横屏 3D" : "Web · 与列表同源的交互模型"}</strong></div>
      <Tabs value={device} onValueChange={(value) => onChange(value as TemplatePreviewDevice)}>
        <TabsList className="template-device-switch" aria-label="切换模板预览设备">
          <TabsTrigger value="web"><Monitor aria-hidden="true" />Web</TabsTrigger>
          <TabsTrigger value="mobile"><Smartphone aria-hidden="true" />移动端</TabsTrigger>
        </TabsList>
      </Tabs>
    </header>
    <div className="template-device-stage">
      <div className="template-device-frame"><InteriorTemplatePreview device={device} /></div>
    </div>
  </section>;
}
