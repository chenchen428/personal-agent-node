"use client";

import { useState } from "react";
import { KeyRound, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CredentialDialog } from "./credential-dialog";
import { RuntimeField, RuntimeSelect } from "./runtime-field";
import { effortLabels, engineLabels, type Detection, type DraftProfile, type Engine } from "./types";

export function ProfileFields({ engine, profile, detection, disabled, onChange }: {
  engine: Engine; profile: DraftProfile; detection?: Detection; disabled: boolean; onChange: (patch: Partial<DraftProfile>) => void;
}) {
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const models = detection?.models || [];
  const customModel = manual || Boolean(profile.model && !models.some((model) => model.id === profile.model));
  const effectiveModel = profile.model || detection?.defaultModel?.id;
  const efforts = models.find((model) => model.id === effectiveModel)?.reasoningEfforts || detection?.reasoningEfforts
    || (engine === "codex" ? ["none", "minimal", "low", "medium", "high", "xhigh"] : ["low", "medium", "high", "max"]);
  const defaultLabel = detection?.defaultModel ? `基座默认（${detection.defaultModel.label || detection.defaultModel.id}）` : "跟随基座默认";
  const credentialStatus = profile.clearCredential ? "保存后清除" : profile.credential ? "新凭据待保存" : profile.credentialConfigured ? "已配置" : "尚未配置";

  return <fieldset className="runtime-profile-fields" disabled={disabled}>
    <legend className="sr-only">{engineLabels[engine]} 模型与授权配置</legend>
    <RuntimeField title="模型来源" hint="为此基座选择授权方式。">
      <div className="runtime-source-options" role="group" aria-label="模型来源">
        <Button type="button" variant="outline" size="sm" aria-pressed={profile.mode === "account"} onClick={() => onChange({ mode: "account" })}><UserRound aria-hidden="true" />基座账号</Button>
        <Button type="button" variant="outline" size="sm" aria-pressed={profile.mode === "custom"} onClick={() => onChange({ mode: "custom" })}><KeyRound aria-hidden="true" />自定义服务</Button>
      </div>
    </RuntimeField>
    {profile.mode === "account" ? <RuntimeField title="模型" htmlFor="runtime-model" hint="使用已登录账号可用的模型。">
      <RuntimeSelect id="runtime-model" value={customModel ? "__custom__" : profile.model} disabled={disabled}
        options={[{ value: "", label: defaultLabel }, ...models.map((model) => ({ value: model.id, label: model.label || model.id })), { value: "__custom__", label: "输入模型 ID…" }]}
        onChange={(value) => { setManual(value === "__custom__"); if (value !== "__custom__") onChange({ model: value, reasoningEffort: "" }); }} />
    </RuntimeField> : null}
    {customModel || profile.mode === "custom" ? <RuntimeField title="模型 ID" htmlFor="runtime-model-id" hint="填写服务实际支持的模型名称。">
      <Input id="runtime-model-id" value={profile.model} autoComplete="off" spellCheck={false} placeholder="例如服务提供的模型 ID" onChange={(event) => onChange({ model: event.target.value, reasoningEffort: "" })} />
    </RuntimeField> : null}
    <RuntimeField title="推理强度" htmlFor="runtime-effort" hint="留为默认即可使用模型推荐值。">
      <RuntimeSelect id="runtime-effort" value={profile.reasoningEffort} disabled={disabled} onChange={(reasoningEffort) => onChange({ reasoningEffort })}
        options={[{ value: "", label: "模型默认" }, ...efforts.map((effort) => ({ value: effort, label: effortLabels[effort] || effort }))]} />
    </RuntimeField>
    {profile.mode === "custom" ? <>
      <RuntimeField title="Base URL" htmlFor="runtime-base-url" hint={engine === "codex" ? "兼容 OpenAI Responses API 的服务地址。" : "兼容 Anthropic Messages API 的服务地址。"}>
        <Input id="runtime-base-url" type="url" value={profile.baseUrl} autoComplete="off" spellCheck={false}
          placeholder={engine === "codex" ? "https://api.example.com/v1" : "https://api.example.com"} onChange={(event) => onChange({ baseUrl: event.target.value })} />
      </RuntimeField>
      <RuntimeField title="授权方式" htmlFor="runtime-auth-type">
        <RuntimeSelect id="runtime-auth-type" value={profile.authType} disabled={disabled} onChange={(authType) => onChange({ authType: authType as DraftProfile["authType"] })}
          options={[{ value: "api-key", label: engine === "codex" ? "API Key（Bearer）" : "API Key" }, { value: "bearer", label: "授权令牌（Bearer）" }]} />
      </RuntimeField>
      <RuntimeField title="API Key / 授权 Token" hint="已有凭据不会显示；未修改时保留。">
        <div className="runtime-secret-control">
          <span className={profile.clearCredential ? "runtime-warning" : ""}><KeyRound aria-hidden="true" />{credentialStatus}</span>
          <div className="runtime-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => setCredentialOpen(true)}>{profile.credentialConfigured || profile.credential ? "更换" : "设置凭据"}</Button>
            {profile.clearCredential ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ clearCredential: false })}>撤销清除</Button>
              : profile.credentialConfigured || profile.credential ? <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ credential: "", clearCredential: true })}>清除</Button> : null}
          </div>
        </div>
      </RuntimeField>
    </> : null}
    {credentialOpen ? <CredentialDialog onClose={() => setCredentialOpen(false)} onApply={(credential) => { onChange({ credential, clearCredential: false }); setCredentialOpen(false); }} /> : null}
  </fieldset>;
}
