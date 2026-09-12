"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { profileChanged, profilePayload, profileValidation } from "./draft";
import { engines, type ConnectionResult, type Detection, type DraftProfile, type Engine, type RuntimeSettings } from "./types";

const endpoint = "/api/system/agent-runtime";
async function request<T>(path = "", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint + path, {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    headers: { "x-personal-agent-surface": "desktop", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : payload.error?.message || `请求失败（${response.status}）`);
  return payload.data ?? payload.result ?? payload;
}

export function useRuntimeSettings() {
  const [saved, setSaved] = useState<RuntimeSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<Engine, DraftProfile> | null>(null);
  const [engine, setEngine] = useState<Engine>("codex");
  const [selected, setSelected] = useState<Engine>("codex");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [detection, setDetection] = useState<Partial<Record<Engine, Detection>>>({});
  const [results, setResults] = useState<Partial<Record<Engine, ConnectionResult>>>({});
  const [busy, setBusy] = useState<Partial<Record<Engine, "detect" | "test">>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const generation = useRef<Record<Engine, number>>({ codex: 0, "claude-code": 0 });
  const mounted = useRef(true);
  const load = useCallback(async () => {
    controllers.current.get("load")?.abort();
    const controller = new AbortController();
    controllers.current.set("load", controller);
    setLoading(true); setError("");
    try {
      const value = await request<RuntimeSettings>("", undefined, controller.signal);
      if (controller.signal.aborted) return;
      setSaved(value); setDrafts(value.profiles); setEngine(value.engine); setSelected(value.engine);
      setFeedback(""); setDetection({}); setResults({});
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取失败，请重试。"); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void load();
    const pending = controllers.current;
    return () => { mounted.current = false; pending.forEach((controller) => controller.abort()); };
  }, [load]);
  const dirty = Boolean(saved && drafts && (engine !== saved.engine || engines.some((id) => profileChanged(drafts[id], saved.profiles[id]))));
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const update = (patch: Partial<DraftProfile>) => {
    generation.current[selected] += 1;
    controllers.current.get(selected)?.abort();
    setBusy((value) => ({ ...value, [selected]: undefined }));
    setResults((value) => ({ ...value, [selected]: undefined }));
    setDrafts((value) => value ? { ...value, [selected]: { ...value[selected], ...patch } } : value);
    setFeedback("");
  };
  const run = async (kind: "detect" | "test") => {
    if (!drafts || !saved) return;
    const target = selected;
    const validation = kind === "test" ? profileValidation(target, drafts[target], saved.profiles[target]) : "";
    if (validation) { setResults((value) => ({ ...value, [target]: { ok: false, engine: target, message: validation } })); return; }
    controllers.current.get(target)?.abort();
    const controller = new AbortController(); controllers.current.set(target, controller);
    const current = ++generation.current[target];
    setBusy((value) => ({ ...value, [target]: kind }));
    setResults((value) => ({ ...value, [target]: undefined }));
    try {
      const result = await request<Detection | ConnectionResult>(`/${kind}`, { engine: target, profile: profilePayload(drafts[target]) }, controller.signal);
      if (controller.signal.aborted || current !== generation.current[target]) return;
      if (kind === "detect") setDetection((value) => ({ ...value, [target]: result as Detection }));
      else setResults((value) => ({ ...value, [target]: result as ConnectionResult }));
    } catch (cause) {
      if (!controller.signal.aborted) setResults((value) => ({ ...value, [target]: { ok: false, engine: target, message: cause instanceof Error ? cause.message : "检测失败，请重试。" } }));
    } finally { if (!controller.signal.aborted && current === generation.current[target]) setBusy((value) => ({ ...value, [target]: undefined })); }
  };
  const save = async () => {
    if (!saved || !drafts || !dirty) return;
    const profiles: Partial<Record<Engine, ReturnType<typeof profilePayload>>> = {};
    for (const id of engines) {
      if (!profileChanged(drafts[id], saved.profiles[id])) continue;
      profiles[id] = profilePayload(drafts[id]);
    }
    setSaving(true); setFeedback("");
    try {
      const value = await request<RuntimeSettings>("", { revision: saved.revision, engine, profiles });
      if (!mounted.current) return;
      setSaved(value); setDrafts(value.profiles); setFeedback("已保存，下次对话与新任务将使用所选基座。正在执行的任务保持原配置。");
    } catch (cause) { if (mounted.current) setFeedback(cause instanceof Error ? cause.message : "保存失败，请重试。"); }
    finally { if (mounted.current) setSaving(false); }
  };
  const reset = () => {
    if (!saved || saving) return;
    for (const id of engines) { generation.current[id] += 1; controllers.current.get(id)?.abort(); }
    setDrafts(saved.profiles); setEngine(saved.engine); setBusy({}); setResults({}); setDetection({}); setFeedback("");
    setResetVersion((value) => value + 1);
  };
  return { saved, drafts, engine, setEngine, selected, setSelected, loading, saving, error, feedback, detection, results, busy, dirty, update, run, save, load, reset, resetVersion };
}
