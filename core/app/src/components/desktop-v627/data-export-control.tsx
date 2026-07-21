"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage, fetchJson } from "./shared";

type ExportJob = { id: string; state: "running" | "completed" | "failed"; progress: number; path?: string; revealUrl?: string; error?: string };

export function DataExportControl({ onFeedback }: { onFeedback: (message: string) => void }) {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const revealed = useRef("");
  useEffect(() => {
    if (!job || job.state !== "running") return;
    const timer = window.setTimeout(() => {
      void fetchJson<{ export: ExportJob }>(`/api/system/data-export?id=${encodeURIComponent(job.id)}`).then((payload) => setJob(payload.export)).catch((cause) => onFeedback(errorMessage(cause)));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [job, onFeedback]);
  useEffect(() => {
    if (job?.state === "completed" && job.revealUrl && revealed.current !== job.id) {
      revealed.current = job.id;
      onFeedback(`数据已导出：${job.path}`);
      window.location.href = job.revealUrl;
    } else if (job?.state === "failed") onFeedback(job.error || "数据导出失败");
  }, [job, onFeedback]);
  const start = async () => {
    setBusy(true);
    try { const payload = await fetchJson<{ export: ExportJob }>("/api/system/data-export", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); setJob(payload.export); onFeedback("正在导出邮件、发布页、历史规划与 SQLite 数据库…"); }
    catch (cause) { onFeedback(errorMessage(cause)); }
    finally { setBusy(false); }
  };
  if (job?.state === "running") return <div className="data-export-progress" role="status"><progress max="100" value={job.progress} /><span>{job.progress}%</span></div>;
  if (job?.state === "completed") return <div className="data-export-complete"><Button variant="outline" onClick={() => { if (job.revealUrl) window.location.href = job.revealUrl; }}>在文件夹中显示</Button><small title={job.path}>{job.path}</small></div>;
  return <Button variant="outline" disabled={busy} onClick={() => void start()}>{busy ? "准备中…" : "导出数据"}</Button>;
}
