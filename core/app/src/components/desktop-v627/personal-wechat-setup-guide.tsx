"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { PersonalWechatSetup } from "./connection-types";

const QIANXUN_REPOSITORY_URL = "https://github.com/daenmax/pc-wechat-hook-http-api/";

export function PersonalWechatSetupGuide({ setup, error, errorTitle = "上次检测未通过" }: { setup: PersonalWechatSetup | null; error?: string; errorTitle?: string }) {
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
      <span><strong id="personal-wechat-setup-title">先完成千寻接入</strong><small>免费开源版已经包含本连接器所需的 HTTP API、联系人、群和消息事件能力。</small></span>
      <a href={setup?.qianxunRepositoryUrl || QIANXUN_REPOSITORY_URL} target="_blank" rel="noreferrer">打开千寻免费版仓库 <ExternalLink /></a>
    </header>
    {error ? <div className="personal-wechat-setup-error" role="status"><strong>{errorTitle}</strong><span>{error}</span></div> : null}
    <ol>
      <li><strong>安装并启动</strong><span>按仓库说明安装其支持的 PC 微信版本，从“千寻框架”目录获取客户端，启动后添加微信并完成登录。</span></li>
      <li><strong>开启 HTTP API</strong><span>在千寻中启用 HTTP API，服务地址保持为 <code>{setup?.qianxunBaseUrl || "http://127.0.0.1:8055"}</code>。</span></li>
      <li><strong>配置消息回调</strong><span>把下面的完整地址填入千寻的 HTTP API / 事件回调配置；Personal Agent 只接受来自本机的回调。</span></li>
    </ol>
    <div className="personal-wechat-callback-field">
      <span><small>消息回调地址</small><code>{callbackUrl || "正在读取本机回调地址…"}</code></span>
      <button type="button" onClick={() => void copyCallback()} disabled={!callbackUrl} aria-label="复制个人微信消息回调地址">{copied ? <Check /> : <Copy />}{copied ? "已复制" : "复制"}</button>
    </div>
    <p>保存千寻配置并确认微信在线后，再点击“检测千寻并配置”。Personal Agent 不会下载、启动或更新千寻和微信。</p>
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
