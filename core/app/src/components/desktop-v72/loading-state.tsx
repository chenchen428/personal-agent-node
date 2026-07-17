"use client";

import { LoaderCircle } from "lucide-react";

export function LoadingState({ label = "正在加载本机数据", compact = false }: { label?: string; compact?: boolean }) {
  return <div className={`desktop-loading-state${compact ? " compact" : ""}`} role="status" aria-live="polite">
    <LoaderCircle className="v72-spin" aria-hidden="true" />
    <strong>{label}</strong>
    <span>内容准备好后会自动显示</span>
  </div>;
}
