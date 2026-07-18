"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../desktop-v72/primitives";
import type { Connection, DomainVerification } from "./connection-types";
import { DomainBindingSop } from "./domain-binding-sop";
import { DomainUnbindDialog } from "./domain-unbind-dialog";
import { errorMessage, fetchJson } from "./shared";

const BINDING_TIMEOUT_MS = 3 * 60_000;

export function DomainBindingAction({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const kind = connection.id as "mail" | "sites";
  const bound = connection.details?.platformDomainBound === true;
  const initial = connection.details?.domainVerification || idleVerification(kind);
  const [verification, setVerification] = useState<DomainVerification>(initial);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(bound || initial.phase !== "idle");
  const [message, setMessage] = useState("");
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (!deadline) { setRemaining(0); return; }
    const update = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [deadline]);
  useEffect(() => { if (!busy) setVerification(connection.details?.domainVerification || idleVerification(kind)); }, [busy, connection.details?.domainVerification, kind]);

  const startBinding = async () => {
    const deadlineAt = Date.now() + BINDING_TIMEOUT_MS;
    setBusy(true); setExpanded(true); setMessage(""); setDeadline(deadlineAt);
    setVerification(authorizingVerification(kind, new Date(deadlineAt).toISOString()));
    try {
      await runSetupAction("connectivity.managed-authorize");
      await waitForAssignedResource(connection.id, deadlineAt);
      const started = await fetchJson<{ verification: DomainVerification }>(`/api/connections/${kind}/domain-binding`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deadlineAt: new Date(deadlineAt).toISOString() }) });
      setVerification(started.verification);
      const completed = await waitForVerification(kind, deadlineAt, setVerification);
      if (completed.phase !== "verified") throw new Error(completed.error?.message || "绑定验证未通过");
      setMessage(kind === "mail" ? "测试邮件已在本机收到，平台邮箱绑定成功。" : "公网发布内容验证一致，Site 域名绑定成功。");
      await refresh();
    } catch (error) {
      setMessage(errorMessage(error));
      setVerification((current) => current.phase === "failed" ? current : { ...current, phase: "failed", error: { code: "BINDING_FAILED", message: errorMessage(error) }, steps: current.steps.map((step) => step.status === "active" ? { ...step, status: "failed" } : step) });
    } finally { setBusy(false); setDeadline(0); }
  };

  const removeBinding = async () => {
    setBusy(true); setMessage("");
    try {
      await runSetupAction("connectivity.managed-disconnect");
      await fetchJson("/api/connections/domain-binding", { method: "DELETE" });
      setVerification(idleVerification(kind)); setExpanded(false); setConfirmRemove(false);
      setMessage("平台域名绑定已移除，本机数据和本机能力仍然保留。");
      await refresh();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const label = busy ? bound ? "正在移除…" : `绑定验证中${remaining ? ` ${formatRemaining(remaining)}` : ""}` : bound ? "移除域名绑定" : "使用平台域名";
  const button = <Button className="connection-compact-action" variant="primary" disabled={busy} onClick={() => bound ? setConfirmRemove(true) : void startBinding()}>{busy ? <LoaderCircle className="connection-spinner" /> : null}{label}</Button>;
  const showSop = expanded || bound || verification.phase !== "idle";
  return <div className="connection-domain-flow"><div className="connection-domain-action">{button}{message ? <span role="status">{message}</span> : null}</div>{showSop ? <DomainBindingSop kind={kind} verification={verification} remainingSeconds={remaining} collapsed={!expanded} onToggle={() => setExpanded((value) => !value)} /> : null}{confirmRemove ? <DomainUnbindDialog busy={busy} onCancel={() => setConfirmRemove(false)} onConfirm={() => void removeBinding()} /> : null}</div>;
}

async function waitForAssignedResource(id: string, deadline: number) {
  while (Date.now() < deadline) {
    const [detail, setup] = await Promise.all([fetchJson<{ connection: Connection }>(`/api/connections/${id}/status`), fetchJson<{ actions?: { managedCloud?: { state?: string; code?: string } } }>("/api/system/setup")]);
    const assigned = id === "mail" ? detail.connection.details?.mailAddress : detail.connection.details?.platformDomain;
    if (assigned) return;
    const cloud = setup.actions?.managedCloud;
    if (cloud?.state === "failed") throw new Error(cloud.code ? `平台授权失败（${cloud.code}），请重新发起。` : "平台授权失败，请重新发起。");
    await pause(1500);
  }
  throw new Error("绑定流程已超过 3 分钟，平台授权或资源分配尚未完成。");
}

async function waitForVerification(kind: "mail" | "sites", deadline: number, update: (value: DomainVerification) => void) {
  while (Date.now() < deadline) {
    const result = await fetchJson<{ verification: DomainVerification }>(`/api/connections/${kind}/domain-binding`);
    update(result.verification);
    if (["verified", "failed"].includes(result.verification.phase)) return result.verification;
    await pause(1800);
  }
  throw new Error("绑定验证已超过 3 分钟，最终状态不会写入。");
}

function authorizingVerification(kind: "mail" | "sites", deadlineAt: string): DomainVerification {
  const value = idleVerification(kind);
  value.phase = "authorizing"; value.startedAt = new Date().toISOString(); value.deadlineAt = deadlineAt;
  value.steps[0].status = "active";
  return value;
}

function idleVerification(kind: "mail" | "sites"): DomainVerification {
  const labels = kind === "mail" ? ["确认平台授权", "分配收件地址", "发送验证邮件", "等待本机收件", "提交绑定状态"] : ["确认平台授权", "分配域名与穿透", "发布验证 Page", "请求公网链接", "提交绑定状态"];
  return { kind, phase: "idle", resource: "", startedAt: null, deadlineAt: null, updatedAt: null, error: null, evidence: null, steps: labels.map((label, index) => ({ id: String(index), label, status: "pending" })) };
}

function pause(milliseconds: number) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
function formatRemaining(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

async function runSetupAction(actionId: string) {
  type Operation = { id: string; digest: string };
  const post = (phase: string, body: object) => fetchJson<{ operation: Operation }>(`/api/system/setup/actions/${actionId}/${phase}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const planned = (await post("plan", {})).operation;
  await post("approve", { operationId: planned.id, digest: planned.digest, approved: true });
  await post("execute", { operationId: planned.id, digest: planned.digest, input: {} });
}
