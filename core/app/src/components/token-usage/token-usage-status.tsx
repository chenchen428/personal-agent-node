import { Inbox, LoaderCircle, TriangleAlert } from "lucide-react";

export function TokenUsageStatus({ state, detail }: { state: "loading" | "empty" | "error"; detail?: string }) {
  const content = state === "loading"
    ? { title: "正在读取 Token 统计", detail: "正在汇总本机 Agent 的会话用量。", icon: LoaderCircle }
    : state === "empty"
      ? { title: "还没有 Token 用量", detail: "完成一次主 Agent 对话后，这里会显示统计。", icon: Inbox }
      : { title: "暂时无法读取统计", detail: detail || "请检查本机 Agent 状态后再刷新页面。", icon: TriangleAlert };
  const Icon = content.icon;
  return <div className={`token-usage-status ${state}`} role={state === "error" ? "alert" : "status"}><Icon aria-hidden="true" /><strong>{content.title}</strong><span>{content.detail}</span></div>;
}
