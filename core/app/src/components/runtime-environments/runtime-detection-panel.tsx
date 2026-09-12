import { CircleCheck, CircleHelp, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Detection } from "./types";

export function RuntimeDetectionPanel({ detection, busy, disabled, onDetect }: {
  detection?: Detection; busy: boolean; disabled: boolean; onDetect: () => void;
}) {
  return <section className="runtime-detection-panel" aria-label="基座检测结果">
    <div className="runtime-detection-line">
      <div className="runtime-detection-title">
        {detection?.installed ? <CircleCheck className="runtime-success" aria-hidden="true" /> : <CircleHelp aria-hidden="true" />}<strong>本机环境</strong>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onDetect}>
        {busy ? <LoaderCircle className="runtime-spinning" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}{busy ? "检测中…" : "检测基座"}
      </Button>
    </div>
    <dl className="runtime-facts">
      <div><dt>安装</dt><dd>{detection ? detection.installed ? "已安装" : "未安装" : "待检测"}</dd></div>
      <div><dt>版本</dt><dd>{detection?.version || "—"}</dd></div>
      <div><dt>账号</dt><dd>{detection ? ({ authenticated: "已登录", missing: "未登录", unknown: "未确认" })[detection.authentication] : "待检测"}</dd></div>
    </dl>
    {detection?.message ? <p className="runtime-hint" role="status">{detection.message}</p> : null}
  </section>;
}
