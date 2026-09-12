"use client";

import { useState } from "react";
import { Button } from "../desktop-v72/primitives";
import { CredentialDialog } from "./credential-dialog";
import { effortLabels, engineLabels, type Detection, type DraftProfile, type Engine } from "./types";

export function ProfileFields({ engine, profile, detection, disabled, onChange }: {
  engine: Engine; profile: DraftProfile; detection?: Detection; disabled: boolean; onChange: (patch: Partial<DraftProfile>) => void;
}) {
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const models = detection?.models || [];
  const customModel = manual || Boolean(profile.model && !models.some((model) => model.id === profile.model));
  const effectiveModel = profile.model || detection?.defaultModel?.id;
  const efforts = models.find((model) => model.id === effectiveModel)?.reasoningEfforts || detection?.reasoningEfforts || (engine === "codex" ? ["none", "minimal", "low", "medium", "high", "xhigh"] : ["low", "medium", "high", "max"]);
  return <fieldset className="runtime-fields" disabled={disabled}>
    <label>模型来源<select value={profile.mode} onChange={(event) => onChange({ mode: event.target.value as DraftProfile["mode"] })}><option value="account">使用 {engineLabels[engine]} 账号</option><option value="custom">自定义模型服务</option></select></label>
    <label>模型<select value={customModel ? "__custom__" : profile.model} onChange={(event) => {
      setManual(event.target.value === "__custom__");
      if (event.target.value !== "__custom__") onChange({ model: event.target.value, reasoningEffort: "" });
    }}><option value="">跟随基座默认{detection?.defaultModel ? `（${detection.defaultModel.label || detection.defaultModel.id}）` : ""}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.label || model.id}</option>)}<option value="__custom__">输入模型 ID…</option></select></label>
    {customModel || profile.mode === "custom" ? <label>模型 ID<input value={profile.model} autoComplete="off" spellCheck={false} placeholder="输入服务支持的模型 ID" onChange={(event) => onChange({ model: event.target.value, reasoningEffort: "" })} /></label> : null}
    <label>推理强度<select value={profile.reasoningEffort} onChange={(event) => onChange({ reasoningEffort: event.target.value })}><option value="">模型默认</option>{efforts.map((effort) => <option key={effort} value={effort}>{effortLabels[effort] || effort}</option>)}</select></label>
    {profile.mode === "custom" ? <>
      <label className="runtime-field-wide">Base URL<input type="url" value={profile.baseUrl} autoComplete="off" spellCheck={false} placeholder={engine === "codex" ? "https://api.example.com/v1" : "https://api.example.com"} onChange={(event) => onChange({ baseUrl: event.target.value })} /><small>{engine === "codex" ? "使用兼容 OpenAI Responses API 的服务地址。" : "使用兼容 Anthropic Messages API 的服务地址。"}</small></label>
      <label>授权方式<select value={profile.authType} onChange={(event) => onChange({ authType: event.target.value as DraftProfile["authType"] })}><option value="api-key">{engine === "codex" ? "API Key（Bearer）" : "API Key"}</option><option value="bearer">授权令牌（Bearer）</option></select></label>
      <div className="runtime-credential"><strong>API Key / 授权 Token</strong><span>{profile.clearCredential ? "保存后清除" : profile.credential ? "已输入新凭据，待保存" : profile.credentialConfigured ? "已配置，未修改时保留" : "尚未配置"}</span><div className="runtime-actions"><Button type="button" onClick={() => setCredentialOpen(true)}>{profile.credentialConfigured || profile.credential ? "更换" : "设置"}</Button>{profile.clearCredential ? <Button type="button" onClick={() => onChange({ clearCredential: false })}>撤销清除</Button> : profile.credentialConfigured || profile.credential ? <Button type="button" onClick={() => onChange({ credential: "", clearCredential: true })}>清除</Button> : null}</div></div>
    </> : null}
    {credentialOpen ? <CredentialDialog onClose={() => setCredentialOpen(false)} onApply={(credential) => { onChange({ credential, clearCredential: false }); setCredentialOpen(false); }} /> : null}
  </fieldset>;
}
