"use client";

import { useEffect, useState } from "react";
import { TemplatePreviewLoading } from "./template-preview-loading";
import type { TemplatePreviewDevice } from "./template-device-preview";

export function TemplateArtifactPreview({
  artifactPath,
  device,
}: {
  artifactPath: string;
  device: TemplatePreviewDevice;
}) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => setLoaded(false), [artifactPath, device]);

  return <>
    {!loaded && <TemplatePreviewLoading />}
    <iframe
      key={`${artifactPath}:${device}`}
      className="template-artifact-frame"
      onLoad={() => setLoaded(true)}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts allow-same-origin"
      src={artifactPath}
      title={`Pascal v2 装修设计交付页${device === "mobile" ? "移动横屏" : "Web"}预览`}
    />
  </>;
}
