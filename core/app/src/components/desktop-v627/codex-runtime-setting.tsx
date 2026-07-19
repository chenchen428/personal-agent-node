"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, SettingRow } from "../desktop-v72/primitives";
import { errorMessage, fetchJson, useJson } from "./shared";

type ModelOption = {
  id: string;
  label?: string;
  description?: string;
  efforts?: string[];
  defaultEffort?: string;
};

type CodexSettings = {
  model: string;
  reasoningEffort: string;
  effectiveModel: string;
  effectiveReasoningEffort: string;
  models: ModelOption[];
  defaultModel: { id: string; label?: string } | null;
  reasoningEfforts: string[];
  catalogAvailable: boolean;
};

const effortLabels: Record<string, string> = {
  none: "无",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
};

export function CodexRuntimeSetting() {
  const { value, loading, error, refresh } = useJson<CodexSettings>("/api/system/codex-settings");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!value) return;
    setModel(value.model);
    setReasoningEffort(value.reasoningEffort);
  }, [value]);

  const efforts = useMemo(() => {
    if (!value) return [];
    const effectiveModel = model || value.defaultModel?.id || "";
    return value.models.find((item) => item.id === effectiveModel)?.efforts || value.reasoningEfforts;
  }, [model, value]);

  useEffect(() => {
    if (reasoningEffort && efforts.length && !efforts.includes(reasoningEffort)) setReasoningEffort("");
  }, [efforts, reasoningEffort]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFeedback("");
    try {
      const saved = await fetchJson<CodexSettings>("/api/system/codex-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, reasoningEffort }),
      });
      setModel(saved.model);
      setReasoningEffort(saved.reasoningEffort);
      setFeedback("已保存，将从下一次 Codex 回合开始生效");
      await refresh();
    } catch (cause) {
      setFeedback(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const defaultLabel = value?.defaultModel
    ? `跟随 Codex 默认（${value.defaultModel.label || value.defaultModel.id}）`
    : "跟随 Codex 默认";
  const description = feedback || error || (loading && !value ? "正在读取本机 Codex 模型设置…" : value?.catalogAvailable === false ? "Codex 模型目录暂不可用；仍可保存当前选择，稍后可重新读取完整目录。" : "用于 Personal Agent 发起的 Codex 回合；保存后无需重启，正在执行的回合不受影响");

  return <SettingRow
    title="模型与推理强度"
    description={description}
    control={<form className="settings-codex-runtime" onSubmit={save} aria-busy={loading || saving}>
      <label className="sr-only" htmlFor="codex-runtime-model">Codex 模型</label>
      <select id="codex-runtime-model" className="settings-select" disabled={saving || !value} value={model} onChange={(event) => { setModel(event.target.value); setFeedback(""); }}>
        <option value="">{defaultLabel}</option>
        {value?.models.map((item) => <option key={item.id} value={item.id}>{item.label ? `${item.label} · ${item.id}` : item.id}</option>)}
      </select>
      <label className="sr-only" htmlFor="codex-runtime-effort">推理强度</label>
      <select id="codex-runtime-effort" className="settings-select" disabled={saving || !value} value={reasoningEffort} onChange={(event) => { setReasoningEffort(event.target.value); setFeedback(""); }}>
        <option value="">模型默认</option>
        {efforts.map((effort) => <option key={effort} value={effort}>{effortLabels[effort] || effort}</option>)}
      </select>
      {error && !value ? <Button type="button" onClick={() => void refresh()}>重新读取</Button> : null}
      <Button type="submit" variant="primary" disabled={saving || !value}>{saving ? "保存中…" : "保存当前设置"}</Button>
    </form>}
  />;
}
