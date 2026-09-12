"use client";

import { ArrowRight, Bot, Check, CheckCircle2, CircleAlert, LoaderCircle, PlugZap, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProfileFields } from "./profile-fields";
import { RuntimeDetectionPanel } from "./runtime-detection-panel";
import { engines, engineLabels } from "./types";
import { profileChanged } from "./draft";
import { useRuntimeSettings } from "./use-runtime-settings";

export function RuntimeEnvironmentSettings() {
  const state = useRuntimeSettings();
  const { selected, saved, drafts, saving } = state;
  const busy = state.busy[selected];
  const anyBusy = Object.values(state.busy).some(Boolean);
  const result = state.results[selected];
  return <section className="runtime-environments" aria-busy={state.loading || saving} aria-labelledby="runtime-environments-title">
    <header className="runtime-section-header">
      <div><h2 id="runtime-environments-title">运行环境</h2><p>当前隔离空间的模型、授权与执行基座。</p></div>
      {saved ? <span className="runtime-active-summary"><span className="runtime-status-dot" />当前默认 <strong>{engineLabels[saved.engine]}</strong></span> : null}
    </header>
    {state.loading ? <div className="runtime-loading" role="status"><LoaderCircle className="runtime-spinning" aria-hidden="true" />正在读取运行环境…</div>
      : state.error || !drafts || !saved ? <div className="runtime-loading" role="alert"><CircleAlert aria-hidden="true" /><p>{state.error || "运行环境暂不可用。"}</p><Button variant="outline" size="sm" onClick={() => void state.load()}>重新读取</Button></div>
        : <>
          <div className="runtime-workbench">
            <nav className="runtime-base-list" aria-label="配置基座">
              {engines.map((engine) => {
                const Icon = engine === "codex" ? TerminalSquare : Bot;
                return <button key={engine} type="button" className="runtime-base-option" disabled={saving} aria-pressed={selected === engine} onClick={() => state.setSelected(engine)}>
                  <Icon aria-hidden="true" />
                  <span><strong>{engineLabels[engine]}</strong><small>{saved.engine === engine ? "当前默认" : state.engine === engine ? "保存后设为默认" : "独立配置"}</small></span>
                  {profileChanged(drafts[engine], saved.profiles[engine]) ? <span className="runtime-unsaved-dot" aria-label="有未保存配置" /> : selected === engine ? <ArrowRight aria-hidden="true" /> : null}
                </button>;
              })}
            </nav>
            <div className="runtime-editor" aria-label={`${engineLabels[selected]} 配置`}>
              <header className="runtime-editor-header">
                <div><h3>{engineLabels[selected]}</h3><p>{state.engine === selected ? saved.engine === selected ? "用于下一次对话与新任务" : "保存后将作为默认基座" : "可单独配置，不影响当前默认基座"}</p></div>
                <Button variant="outline" size="sm" disabled={saving || state.engine === selected} onClick={() => state.setEngine(selected)}>
                  {state.engine === selected ? <Check aria-hidden="true" /> : null}{state.engine === selected ? saved.engine === selected ? "当前默认" : "已选为默认" : "设为默认"}
                </Button>
              </header>
              <RuntimeDetectionPanel detection={state.detection[selected]} busy={busy === "detect"} disabled={saving || Boolean(busy)} onDetect={() => void state.run("detect")} />
              <ProfileFields key={`${selected}:${state.resetVersion}`} engine={selected} profile={drafts[selected]} detection={state.detection[selected]} disabled={saving} onChange={state.update} />
              <section className="runtime-connection-test" aria-label="模型连接验证">
                <div className="runtime-test-heading"><div><strong>连接验证</strong><p>检测当前草稿，不保存设置。</p></div>
                  <Button variant="outline" size="sm" disabled={saving || Boolean(busy)} onClick={() => void state.run("test")}>
                    {busy === "test" ? <LoaderCircle className="runtime-spinning" aria-hidden="true" /> : <PlugZap aria-hidden="true" />}{busy === "test" ? "检测中…" : "检测连通性"}
                  </Button>
                </div>
                {result ? <div className={`runtime-result ${result.ok ? "success" : "error"}`} role={result.ok ? "status" : "alert"}>
                  {result.ok ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}<span>{result.message}{result.ok && result.durationMs != null ? `（${result.durationMs} ms）` : ""}</span>
                </div> : null}
              </section>
            </div>
          </div>
          <footer className="runtime-save-bar">
            <div className="runtime-save-status"><Badge variant={state.dirty ? "warning" : "neutral"}>{state.dirty ? "有未保存的更改" : "配置已保存"}</Badge>
              <small>{state.engine !== saved.engine ? `保存后默认使用 ${engineLabels[state.engine]}` : "保存后从下一次对话与新任务生效"}</small>
            </div>
            <div className="runtime-actions"><Button variant="ghost" size="sm" disabled={saving || !state.dirty} onClick={state.reset}>放弃更改</Button>
              <Button size="sm" disabled={saving || !state.dirty || anyBusy} onClick={() => void state.save()}>{saving ? <LoaderCircle className="runtime-spinning" aria-hidden="true" /> : null}{saving ? "保存中…" : "保存运行环境"}</Button>
            </div>
          </footer>
          {state.feedback ? <p role="status" className="runtime-save-feedback">{state.feedback}</p> : null}
        </>}
  </section>;
}
