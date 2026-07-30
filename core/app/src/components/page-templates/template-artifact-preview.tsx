"use client";

import { useEffect, useState } from "react";
import { TemplatePreviewLoading } from "./template-preview-loading";
import type { TemplatePreviewDevice } from "./template-device-preview";

export function TemplateArtifactPreview({
  artifactPath,
  device,
  title,
}: {
  artifactPath: string;
  device: TemplatePreviewDevice;
  title: string;
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
      title={`${title}${device === "mobile" ? "移动横屏" : "Web"}预览`}
    />
  </>;
}
