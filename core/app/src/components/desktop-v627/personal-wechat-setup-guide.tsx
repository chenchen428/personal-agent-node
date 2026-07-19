"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { PersonalWechatSetup } from "./connection-types";

const QIANXUN_PRO_DOCS_URL = "https://daenmax.github.io/qxpro-doc/doc/start/";

export function PersonalWechatSetupGuide({ setup, servicePort, onServicePortChange, portDisabled = false, error, errorTitle = "上次检测未通过" }: { setup: PersonalWechatSetup | null; servicePort: string; onServicePortChange: (value: string) => void; portDisabled?: boolean; error?: string; errorTitle?: string }) {
  const [copied, setCopied] = useState(false);
  const callbackUrl = setup?.callbackUrl || "";

  const copyCallback = async () => {
    if (!callbackUrl) return;
    const copiedSuccessfully = await copyText(callbackUrl);
    setCopied(copiedSuccessfully);
    if (copiedSuccessfully) window.setTimeout(() => setCopied(false), 1800);
  };

  return <section className="personal-wechat-setup-guide" aria-labelledby="personal-wechat-setup-title">
    <header>
      <span><strong id="personal-wechat-setup-title">先完成千寻 Pro 接入</strong><small>按千寻 Pro 官方文档安装、试用或授权，并启用 HTTP API 与消息事件回调。</small></span>
      <a href={setup?.qianxunDocsUrl || QIANXUN_PRO_DOCS_URL} target="_blank" rel="noreferrer">打开千寻 Pro 接入文档 <ExternalLink /></a>
    </header>
    {error ? <div className="personal-wechat-setup-error" role="status"><strong>{errorTitle}</strong><span>{error}</span></div> : null}
    <ol>
      <li><strong>安装并授权</strong><span>按官方快速入门安装千寻 Pro 与受支持的 PC 微信版本，申请试用或购买授权后添加微信并完成登录。</span></li>
      <li><strong>确认服务端口</strong><span>填写千寻 Pro 为当前微信启用的 HTTP 服务端口；检测地址为 <code>http://127.0.0.1:{servicePort || "端口"}/wechat/httpapi</code>。<label className="personal-wechat-port-field"><span>千寻服务端口</span><input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={5} value={servicePort} disabled={portDisabled} aria-label="千寻服务端口" aria-describedby="personal-wechat-port-hint" onChange={(event) => onServicePortChange(event.target.value.replace(/\D/g, ""))} /><small id="personal-wechat-port-hint">默认 8055，可按千寻 Pro 中的实际配置修改</small></label></span></li>
      <li><strong>配置消息回调</strong><span>把下面的完整地址填入千寻 Pro 的 HTTP 事件回调配置；Personal Agent 只接受来自本机的回调。</span></li>
    </ol>
    <div className="personal-wechat-callback-field">
      <span><small>消息回调地址</small><code>{callbackUrl || "正在读取本机回调地址…"}</code></span>
      <button type="button" onClick={() => void copyCallback()} disabled={!callbackUrl} aria-label="复制个人微信消息回调地址">{copied ? <Check /> : <Copy />}{copied ? "已复制" : "复制"}</button>
    </div>
    <p>保存千寻 Pro 配置并确认微信在线、授权有效后，再点击“检测千寻并配置”。检测成功时会保存上面的端口；Personal Agent 不会下载、启动或更新千寻 Pro 和微信。</p>
  </section>;
}

async function copyText(value: string) {
  try { await navigator.clipboard.writeText(value); return true; }
  catch {
    const area = document.createElement("textarea");
    area.value = value; area.style.position = "fixed"; area.style.opacity = "0";
    document.body.appendChild(area); area.select();
    try { return document.execCommand("copy"); }
    finally { area.remove(); }
  }
}
