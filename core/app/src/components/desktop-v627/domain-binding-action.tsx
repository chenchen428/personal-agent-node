"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../desktop-v72/primitives";
import type { Connection, DomainVerification } from "./connection-types";
import { DomainBindingSop } from "./domain-binding-sop";
import { DomainUnbindDialog } from "./domain-unbind-dialog";
import { DomainEntryMenu } from "./domain-entry-menu";
import { CustomDomainSop } from "./custom-domain-sop";
import { errorMessage, fetchJson } from "./shared";
import { runSetupAction } from "@/lib/setup-action-client";
import { waitForConnectionResult } from "./domain-verification-polling";

const BINDING_TIMEOUT_MS = 3 * 60_000;

export function DomainBindingAction({ connection, refresh }: { connection: Connection; refresh: () => Promise<void> }) {
  const kind = connection.id as "mail" | "sites";
  const bound = connection.details?.platformDomainBound === true;
  const configured = bound || Boolean(kind === "mail" ? connection.details?.mailAddress : connection.details?.platformDomain);
  const initial = connection.details?.domainVerification || idleVerification(kind);
  const [verification, setVerification] = useState<DomainVerification>(initial);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(configured || initial.phase !== "idle");
  const [message, setMessage] = useState("");
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [entryMode, setEntryMode] = useState<"platform" | "custom">(connection.details?.bindingMode === "custom" ? "custom" : "platform");
  const attempt = useRef(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { attempt.current += 1; request.current?.abort(); }, []);
  useEffect(() => {
    if (!deadline) { setRemaining(0); return; }
    const update = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [deadline]);
  useEffect(() => { if (!busy) setVerification(connection.details?.domainVerification || idleVerification(kind)); }, [connection.details?.domainVerification, kind]);
  useEffect(() => {
    if (configured || entryMode === "custom") return;
    let active = true;
    let timer = 0;
    const read = async () => {
      try {
        const setup = await fetchJson<{ actions?: { managedCloud?: { state?: string; authorizationUrl?: string } } }>("/api/system/setup");
        if (!active) return;
        const state = setup.actions?.managedCloud?.state || "idle";
        if (!["failed", "cancelled"].includes(state)) timer = window.setTimeout(() => void read(), 1500);
      } catch { if (active) timer = window.setTimeout(() => void read(), 3000); }
    };
    void read();
    return () => { active = false; window.clearTimeout(timer); };
  }, [configured, entryMode, verification.phase]);

  if (entryMode === "custom" || connection.details?.bindingMode === "custom") {
    return <CustomDomainSop connection={connection} refresh={refresh} onExit={() => setEntryMode("platform")} />;
  }

  const startBinding = async () => {
    const currentAttempt = ++attempt.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const deadlineAt = Date.now() + BINDING_TIMEOUT_MS;
    setBusy(true); setExpanded(true); setMessage(""); setAuthorizationUrl(""); setDeadline(deadlineAt);
    setVerification(authorizingVerification(kind, new Date(deadlineAt).toISOString()));
    try {
      await runSetupAction("connectivity.managed-authorize");
      if (attempt.current !== currentAttempt) return;
      await waitForAssignedResource(connection.id, deadlineAt, setAuthorizationUrl, controller.signal, () => setMessage("状态暂时无法读取，正在重试…"));
      if (attempt.current !== currentAttempt) return;
      const started = await fetchJson<{ verification: DomainVerification }>(`/api/connections/${kind}/domain-binding`, { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ deadlineAt: new Date(deadlineAt).toISOString() }) });
      if (attempt.current !== currentAttempt) return;
      setVerification(started.verification);
      const result = await waitForConnectionResult({ signal: controller.signal, deadline: deadlineAt,
        probe: async (signal) => { const { verification } = await fetchJson<{ verification: DomainVerification }>(`/api/connections/${kind}/domain-binding`, { signal }); return { state: verification.phase === "verified" ? "completed" as const : verification.phase === "failed" ? "failed" as const : "pending" as const, verification }; },
        onResult: ({ verification }) => { setVerification(verification); setMessage(""); },
        onError: () => setMessage("验证状态暂时无法读取，正在重试…"),
        timeoutMessage: "暂未确认绑定结果，请刷新查看最新验证状态。",
      });
      const completed = result.verification;
      if (attempt.current !== currentAttempt) return;
      if (completed.phase !== "verified") throw new Error(completed.error?.message || "绑定验证未通过");
      setMessage(kind === "mail" ? "测试邮件已在本机收到，平台邮箱绑定成功。" : "公网发布内容验证一致，Site 域名绑定成功。");
      await refresh().catch(() => {});
    } catch (error) {
      if (attempt.current !== currentAttempt) return;
      setMessage(errorMessage(error));
      // Only the verification endpoint can declare a verification failure.
      await refresh().catch(() => {});
    } finally { if (attempt.current === currentAttempt) { setBusy(false); setDeadline(0); } }
  };

  const cancelBinding = async () => {
    const currentAttempt = ++attempt.current;
    request.current?.abort();
    setBusy(false); setDeadline(0); setAuthorizationUrl("");
    try { await runSetupAction("connectivity.managed-cancel"); }
    catch {}
    if (attempt.current !== currentAttempt) return;
    setVerification(idleVerification(kind)); setExpanded(false);
    setMessage("已取消本次绑定流程，原有连接与本机数据保持不变。");
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

  const label = busy ? configured ? "正在清空…" : `绑定验证中${remaining ? ` ${formatRemaining(remaining)}` : ""}` : configured ? "清空配置" : "配置";
  const button = configured
    ? <Button className="connection-compact-action" variant="danger" disabled={busy} onClick={() => setConfirmRemove(true)}>{busy ? <LoaderCircle className="connection-spinner" /> : null}{label}</Button>
    : <DomainEntryMenu disabled={busy} onPlatform={() => void startBinding()} onCustom={() => setEntryMode("custom")} />;
  const showSop = expanded || configured || verification.phase !== "idle";
  return <div className="connection-domain-flow"><div className="connection-domain-action">{button}{busy && !configured ? <Button className="connection-compact-action" onClick={() => void cancelBinding()}><X />取消绑定</Button> : null}{message ? <span role="status">{message}</span> : null}</div>{showSop ? <DomainBindingSop kind={kind} verification={verification} remainingSeconds={remaining} authorizationUrl={authorizationUrl} collapsed={!expanded} onToggle={() => setExpanded((value) => !value)} /> : null}{confirmRemove ? <DomainUnbindDialog busy={busy} onCancel={() => setConfirmRemove(false)} onConfirm={() => void removeBinding()} /> : null}</div>;
}

async function waitForAssignedResource(id: string, deadline: number, onAuthorizationUrl: (value: string) => void, signal: AbortSignal, onError: () => void) {
  const result = await waitForConnectionResult({ signal, deadline, onError,
    probe: async (signal) => {
      const [detail, setup] = await Promise.all([fetchJson<{ connection: Connection }>(`/api/connections/${id}/status`, { signal }), fetchJson<{ actions?: { managedCloud?: { state?: string; code?: string; authorizationUrl?: string } } }>("/api/system/setup", { signal })]);
      const assigned = id === "mail" ? detail.connection.details?.mailAddress : detail.connection.details?.platformDomain;
      const cloud = setup.actions?.managedCloud;
      return { state: assigned ? "completed" as const : cloud?.state === "failed" ? "failed" as const : "pending" as const, authorizationUrl: cloud?.authorizationUrl, message: cloud?.code ? `平台授权失败（${cloud.code}），请重新发起。` : "平台授权失败，请重新发起。" };
    },
    onResult: (result) => { if (result.authorizationUrl) onAuthorizationUrl(result.authorizationUrl); },
    timeoutMessage: "暂未确认平台授权或资源分配结果，请刷新查看最新状态。",
  });
  if (result.state === "failed") throw new Error(result.message);
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

function formatRemaining(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
