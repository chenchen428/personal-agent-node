"use client";

import { AlertTriangle, CloudOff, LockKeyhole, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/desktop-v72/primitives";

export function AgentsLoadState({ error = "", onRetry }: { error?: string; onRetry?: () => void }) {
  const kind = classifyError(error);
  const copy = {
    empty: ["还没有专业成员", "当前空间没有已注册的专业 Agent。"],
    error: ["暂时无法读取 Agent 团队", "本机服务返回了无法处理的结果。"],
    offline: ["本机 Agent 服务未连接", "服务恢复后会自动使用当前空间的 Agent 配置。"],
    permission: ["无法查看当前空间的 Agent 团队", "请回到有权访问的空间后重试。"],
  }[kind];
  const Icon = kind === "permission" ? LockKeyhole : kind === "offline" ? CloudOff : kind === "empty" ? Users : AlertTriangle;

  return <div className="agents-load-state" role={error ? "alert" : "status"}>
    <Icon aria-hidden="true" />
    <strong>{copy[0]}</strong>
    <p>{copy[1]}</p>
    {onRetry ? <Button type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />重试</Button> : null}
  </div>;
}
function classifyError(error: string): "empty" | "error" | "offline" | "permission" {
  if (!error) return "empty";
  if (/403|permission|forbidden|无权|权限/i.test(error)) return "permission";
  if (/503|unavailable|fetch|network|连接|离线/i.test(error)) return "offline";
  return "error";
}
