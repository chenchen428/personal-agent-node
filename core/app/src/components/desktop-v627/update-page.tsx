"use client";

import { Check, Download, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { errorMessage, useJson } from "./shared";
import { Badge, Button, Card, KeyValueGrid, PageHeader, PageSurface } from "../desktop-v72/primitives";

type Operation = { id: string; digest: string; inputSummary?: string };
type Job = { id: string; kind: "apply" | "rollback"; status: string; active?: boolean; targetVersion?: string; targetReleaseId?: string; operationId: string; operationDigest: string; updatedAt?: string };
type UpdateView = { current: { version: string; releaseId: string }; channel: string; checkedAt: string | null; available?: { version: string; asset?: { size?: number } } | null; updateAvailable: boolean; job?: Job | null };
type Plan = { job: Job; operation: Operation };

export function UpdatePage() {
  const authorization = useJson<{ mode: "bypass" | "confirm" }>("/api/system/authorization");
  const bypass = authorization.value?.mode !== "confirm";
  const [view, setView] = useState<UpdateView | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("后台会定期检查，不影响离线使用。");
  const load = useCallback(async () => { const response = await fetch("/api/system/update", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message || "无法读取更新状态"); setView(payload); }, []);
  useEffect(() => { void load().catch((cause) => setMessage(errorMessage(cause))); }, [load]);
  useEffect(() => { if (!view?.job?.active) return; const timer = window.setInterval(() => void load().catch(() => {}), 2000); return () => window.clearInterval(timer); }, [load, view?.job?.active]);
  const post = async (action: string, body: object = {}) => { const response = await fetch("/api/system/update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message || "更新操作失败"); return payload; };
  const applyPlan = async (candidate: Plan) => { setBusy("apply"); try { await post("approve", { jobId: candidate.job.id, operationId: candidate.operation.id, digest: candidate.operation.digest }); await post("apply", { jobId: candidate.job.id, operationId: candidate.operation.id, digest: candidate.operation.digest }); setPlan(null); setMessage("安装已交给桌面客户端，完成后会自动重启…"); await load(); } catch (cause) { setMessage(errorMessage(cause)); setBusy(""); } };
  const prepare = async () => { setBusy("plan"); try { const payload = await post("plan"); const candidate = { job: payload.job, operation: payload.operation }; if (bypass) await applyPlan(candidate); else { setPlan(candidate); setMessage("请核对更新计划并在本机确认"); } } catch (cause) { setMessage(errorMessage(cause)); setBusy(""); } finally { if (!bypass) setBusy(""); } };
  const continueExisting = () => { const job = view?.job; if (!job || job.status !== "planned" || job.kind !== "apply") return; const candidate = { job, operation: { id: job.operationId, digest: job.operationDigest, inputSummary: `安装 Personal Agent ${job.targetVersion || job.targetReleaseId}，客户端将自动重启` } }; if (bypass) void applyPlan(candidate); else setPlan(candidate); };
  const check = async () => { setBusy("check"); setMessage("正在检查发布通道…"); try { const payload = await post("check"); setView(payload); setMessage(payload.updateAvailable ? `发现 ${payload.available.version}` : "当前已是最新版本"); } catch (cause) { setMessage(errorMessage(cause)); } finally { setBusy(""); } };
  const job = view?.job;
  const target = view?.available?.version || view?.current.version || "读取中";
  return <PageSurface><PageHeader eyebrow="客户端与 Core" title="软件更新" description="桌面客户端、主 Agent 和本机 Core 始终作为同一个版本更新。" actions={<Button onClick={() => void check()} disabled={Boolean(busy)}><RefreshCw />{busy === "check" ? "检查中…" : "检查更新"}</Button>} /><Card className="card-pad"><div className="release-summary"><span className="brand-mark release-mark">PA</span><div><Badge tone={view?.updateAvailable ? "warning" : "success"}>{view?.updateAvailable ? "发现新版本" : "当前版本"}</Badge><h2>Personal Agent {target}</h2><p>当前版本 {view?.current.version || "读取中"} · {view?.channel === "beta" ? "Beta 通道" : "稳定通道"} · {formatBytes(view?.available?.asset?.size)}</p></div>{view?.updateAvailable ? <Button variant="primary" disabled={Boolean(busy) || Boolean(job?.active && job.status !== "planned")} onClick={job?.status === "planned" ? continueExisting : () => void prepare()}><Download />{job?.status === "planned" ? bypass ? "继续更新" : "核对更新计划" : job?.active ? jobLabel(job.status) : "准备更新"}</Button> : <Badge tone="success"><Check />已是最新版本</Badge>}</div><KeyValueGrid items={[{ label: "包含", value: "桌面端、Agent 托管能力和本机 Core" }, { label: "预计中断", value: "安装后自动重启" }, { label: "用户数据", value: "Workspace、邮件、技能不会被覆盖" }, { label: "授权模式", value: bypass ? "无需授权，点击后直接执行" : "操作前确认" }]} /></Card>
    {plan ? <section className="update-plan-dialog" role="dialog" aria-modal="true"><div><span className="eyebrow">本机确认</span><h2>安装 {plan.job.targetVersion} 并重启？</h2><p>{plan.operation.inputSummary}</p></div><div className="page-actions"><Button onClick={() => setPlan(null)} disabled={Boolean(busy)}>取消</Button><Button variant="primary" onClick={() => void applyPlan(plan)} disabled={Boolean(busy)}>{busy === "apply" ? "正在交接…" : "确认并继续"}</Button></div></section> : null}
    <div className="content-grid"><Card className="card-pad"><div className="card-title"><div><span className="eyebrow">主 Agent 托管</span><h2>也可以直接告诉 PA</h2></div><ShieldCheck /></div><p className="release-copy">说“检查并更新客户端”。PA 会按照当前授权模式准备更新、下载、重启并验证结果。</p><div className="notice">当前授权模式：{bypass ? "无需授权" : "操作前确认"}</div></Card><Card className="card-pad"><div className="card-title"><div><span className="eyebrow">最近结果</span><h2>{job ? `${job.targetVersion || job.targetReleaseId || "更新"} · ${jobLabel(job.status)}` : `${view?.current.version || "当前版本"} 正在运行`}</h2></div><Check color="var(--pa-success)" /></div><p className="release-copy">{job?.updatedAt ? formatTime(job.updatedAt) : "客户端、Core 版本和连接均由本机验证。"}</p></Card></div><p className="update-message" role="status">{message}</p>
  </PageSurface>;
}

function formatBytes(value?: number) { if (!value) return "大小待确认"; return `${(value / 1024 / 1024).toFixed(value > 100 * 1024 * 1024 ? 0 : 1)} MB`; }
function formatTime(value?: string | null) { if (!value) return "尚未检查"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "未知" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
function jobLabel(status: string) { return ({ planned: "等待确认", approved: "已批准", downloading: "正在下载", verified: "校验完成", handoff: "准备重启", activating: "正在安装", restarting: "正在重启", verifying: "正在验证", succeeded: "更新成功", rolled_back: "已自动恢复", failed: "更新失败" } as Record<string,string>)[status] || status; }
