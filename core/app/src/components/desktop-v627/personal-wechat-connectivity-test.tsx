"use client";

import { CheckCircle2, Copy, LoaderCircle, MessageSquareReply, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../desktop-v72/primitives";
import type { PersonalWechatConnectivityTest } from "./connection-types";
import { errorMessage, fetchJson } from "./shared";

type Busy = "loading" | "starting" | "planning" | "replying" | "";

export function PersonalWechatConnectivityTestCard({ enabled, onStateChange }: { enabled: boolean; onStateChange: (state: PersonalWechatConnectivityTest) => void }) {
  const [test, setTest] = useState<PersonalWechatConnectivityTest | null>(null);
  const [busy, setBusy] = useState<Busy>("loading");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const apply = (next: PersonalWechatConnectivityTest) => { setTest(next); onStateChange(next); };
  const load = async (quiet = false) => {
    if (!quiet) setBusy("loading");
    try { const result = await fetchJson<{ test: PersonalWechatConnectivityTest }>("/api/connections/wechat-personal/connectivity-test"); apply(result.test); setError(""); }
    catch (cause) { if (!quiet) setError(errorMessage(cause)); }
    finally { if (!quiet) setBusy(""); }
  };

  useEffect(() => { if (enabled) void load(); }, [enabled]);
  useEffect(() => {
    if (!enabled || test?.phase !== "waiting_message") return;
    const timer = window.setInterval(() => void load(true), 1_500);
    return () => window.clearInterval(timer);
  }, [enabled, test?.phase]);

  const start = async () => run("starting", async () => (await fetchJson<{ test: PersonalWechatConnectivityTest }>("/api/connections/wechat-personal/connectivity-test/start", { method: "POST" })).test);
  const planReply = async () => run("planning", async () => (await fetchJson<{ state: PersonalWechatConnectivityTest }>("/api/connections/wechat-personal/connectivity-test/reply-plan", { method: "POST" })).state);
  const sendReply = async () => {
    if (!test?.operation) return;
    await run("replying", async () => (await fetchJson<{ test: PersonalWechatConnectivityTest }>("/api/connections/wechat-personal/connectivity-test/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId: test.operation?.id, digest: test.operation?.digest }) })).test);
  };
  const run = async (nextBusy: Busy, action: () => Promise<PersonalWechatConnectivityTest>) => {
    setBusy(nextBusy); setError("");
    try { apply(await action()); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(""); }
  };
  const copy = async () => {
    if (!test?.testText) return;
    try { await navigator.clipboard.writeText(test.testText); setCopied(true); window.setTimeout(() => setCopied(false), 1_800); }
    catch { setError("复制失败，请手动选择测试文字。"); }
  };

  if (!enabled) return null;
  const phase = test?.phase || "idle";
  return <section className="personal-wechat-connectivity-test" aria-labelledby="personal-wechat-connectivity-title">
    <header><span><MessageSquareReply /><span><strong id="personal-wechat-connectivity-title">收发连通测试</strong><small>回调收到且测试回复成功后，个人微信才算连接完成。</small></span></span><em>{phaseLabel(phase)}</em></header>
    {error || test?.error ? <p className="personal-wechat-connectivity-error" role="status">{error || test?.error}</p> : null}
    {busy === "loading" ? <div className="personal-wechat-connectivity-loading"><LoaderCircle className="connection-spinner" />正在读取测试状态</div> : null}
    {busy !== "loading" && ["idle", "expired", "failed"].includes(phase) ? <div className="personal-wechat-connectivity-start"><p>点击开始后，把生成的唯一文字通过微信“文件传输助手”发给自己。测试 10 分钟内有效。</p><Button type="button" onClick={() => void start()} disabled={Boolean(busy)}>{busy === "starting" ? <LoaderCircle className="connection-spinner" /> : <Send />}{busy === "starting" ? "正在开始" : phase === "idle" ? "开始收发测试" : "重新开始测试"}</Button></div> : null}
    {test?.testText && ["waiting_message", "message_received", "reply_planned"].includes(phase) ? <div className="personal-wechat-connectivity-instruction"><span><small>请在微信文件传输助手中发送</small><code>{test.testText}</code></span><button type="button" onClick={() => void copy()}>{copied ? <CheckCircle2 /> : <Copy />}{copied ? "已复制" : "复制"}</button></div> : null}
    {phase === "waiting_message" ? <p className="personal-wechat-connectivity-wait"><LoaderCircle className="connection-spinner" />等待本机收到这条消息的回调；普通的自发消息不会触发 Agent。</p> : null}
    {phase === "message_received" ? <div className="personal-wechat-connectivity-confirm"><p><CheckCircle2 />消息回调已收到并保存。下一步准备一条固定测试回复，不会让 Agent 自由生成内容。</p><Button type="button" onClick={() => void planReply()} disabled={Boolean(busy)}>{busy === "planning" ? "正在准备" : "准备测试回复"}</Button></div> : null}
    {phase === "reply_planned" ? <div className="personal-wechat-connectivity-confirm"><p><MessageSquareReply />即将通过千寻 Pro 向文件传输助手发送：<strong>{test?.replyText}</strong></p><Button variant="primary" type="button" onClick={() => void sendReply()} disabled={Boolean(busy) || !test?.operation}>{busy === "replying" ? "正在发送" : "确认发送测试回复"}</Button></div> : null}
    {phase === "complete" ? <div className="personal-wechat-connectivity-complete"><CheckCircle2 /><span><strong>收发测试均已通过</strong><small>消息回调可达，千寻 Pro 测试回复也已发送成功。</small></span></div> : null}
  </section>;
}

function phaseLabel(phase: PersonalWechatConnectivityTest["phase"] | "idle") {
  return ({ idle: "待测试", waiting_message: "等待消息", message_received: "回调已收到", reply_planned: "待确认回复", complete: "测试通过", expired: "已过期", failed: "测试失败" })[phase];
}
