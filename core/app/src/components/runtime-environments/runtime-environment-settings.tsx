"use client";

import { Badge, Button, Card } from "../desktop-v72/primitives";
import { ProfileFields } from "./profile-fields";
import { engines, engineLabels, type Engine } from "./types";
import { useRuntimeSettings } from "./use-runtime-settings";

export function RuntimeEnvironmentSettings() {
  const state = useRuntimeSettings();
  const { selected, saved, drafts, saving } = state;
  const detection = state.detection[selected];
  const busy = state.busy[selected];
  const result = state.results[selected];
  return <Card className="runtime-environments" aria-busy={state.loading || saving}>
    <header className="section-heading"><strong>运行环境</strong>{saved ? <Badge>{engineLabels[saved.engine]} 正在使用</Badge> : null}</header>
    {state.loading ? <p role="status">正在读取运行环境…</p> : state.error || !drafts || !saved ? <div role="alert"><p>{state.error || "运行环境暂不可用。"}</p><Button onClick={() => void state.load()}>重新读取</Button></div> : <>
      <div className="runtime-default"><label>默认基座<select value={state.engine} disabled={saving} onChange={(event) => { state.setEngine(event.target.value as Engine); state.setSelected(event.target.value as Engine); }}><option value="codex">Codex（默认）</option><option value="claude-code">Claude Code</option></select></label><small>保存后用于当前隔离空间的下一次对话与新任务。</small></div>
      <div className="runtime-base-tabs" role="group" aria-label="配置基座">{engines.map((engine) => <Button key={engine} disabled={saving} aria-pressed={selected === engine} onClick={() => state.setSelected(engine)}>{engineLabels[engine]}{state.engine === engine ? " · 已选默认" : ""}</Button>)}</div>
      <div className="runtime-detection"><div className="runtime-detection-facts"><span>安装 <strong>{detection ? detection.installed ? "已安装" : "未安装" : "待检测"}</strong></span><span>版本 <strong>{detection?.version || "—"}</strong></span><span>账号 <strong>{detection ? ({ authenticated: "已登录", missing: "未登录", unknown: "未知" })[detection.authentication] : "待检测"}</strong></span></div><Button disabled={saving || Boolean(busy)} onClick={() => void state.run("detect")}>{busy === "detect" ? "检测中…" : "检测基座与模型"}</Button></div>
      {detection?.message ? <p className="runtime-hint" role="status">{detection.message}</p> : null}
      <ProfileFields key={selected} engine={selected} profile={drafts[selected]} detection={detection} disabled={saving} onChange={state.update} />
      <div className="runtime-actions runtime-footer"><Button disabled={saving || Boolean(busy)} onClick={() => void state.run("test")}>{busy === "test" ? "连接检测中…" : "检测连通性"}</Button><small>检测当前草稿，不保存设置。</small></div>
      {result ? <p className={`runtime-result ${result.ok ? "success" : "error"}`} role={result.ok ? "status" : "alert"}>{result.message}{result.ok && result.durationMs != null ? `（${result.durationMs} ms）` : ""}</p> : null}
      <div className="runtime-actions runtime-footer"><Badge tone={state.dirty ? "warning" : "success"}>{state.dirty ? "有未保存的更改" : "设置已保存"}</Badge><Button variant="primary" disabled={saving || !state.dirty || Object.values(state.busy).some(Boolean)} onClick={() => void state.save()}>{saving ? "保存中…" : "保存运行环境"}</Button></div>
      {state.feedback ? <p role="status" className="runtime-hint">{state.feedback}</p> : null}
    </>}
  </Card>;
}
