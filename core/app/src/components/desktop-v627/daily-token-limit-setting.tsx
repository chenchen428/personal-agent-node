"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, SettingRow } from "../desktop-v72/primitives";
import { errorMessage, fetchJson, useJson } from "./shared";

type TokenLimit = {
  dailyLimitMillions: number;
  dailyLimitTokens: number;
  usedTokens: number;
  enabled: boolean;
  unit: "M";
  resetTimezone: "Asia/Shanghai";
};

export function DailyTokenLimitSetting() {
  const { value, refresh } = useJson<TokenLimit>("/api/system/token-limit");
  const [input, setInput] = useState("0");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (value) setInput(String(value.dailyLimitMillions));
  }, [value]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const dailyLimitMillions = Number(input);
    if (!input.trim() || !Number.isFinite(dailyLimitMillions) || dailyLimitMillions < 0 || dailyLimitMillions > 1_000_000) {
      setFeedback("请输入 0 到 1,000,000 之间的数值");
      return;
    }
    setSaving(true);
    setFeedback("");
    try {
      const saved = await fetchJson<TokenLimit>("/api/system/token-limit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dailyLimitMillions }),
      });
      setInput(String(saved.dailyLimitMillions));
      setFeedback(saved.enabled ? "每日限额已保存" : "已取消每日限额");
      await refresh();
    } catch (cause) {
      setFeedback(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const description = feedback || (value
    ? `0 表示不限额；今日已使用 ${formatMillions(value.usedTokens / 1_000_000)} M，按 Asia/Shanghai 自然日重置`
    : "0 表示不限额；按 Asia/Shanghai 自然日重置");

  return <SettingRow
    title="每日 Token 限额"
    description={description}
    control={<form className="settings-token-limit" onSubmit={save}>
      <label className="sr-only" htmlFor="daily-token-limit">每日 Token 限额（M）</label>
      <input
        id="daily-token-limit"
        type="number"
        min="0"
        max="1000000"
        step="0.001"
        inputMode="decimal"
        required
        value={input}
        disabled={saving}
        onChange={(event) => { setInput(event.target.value); setFeedback(""); }}
      />
      <span aria-hidden="true">M</span>
      <Button type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
    </form>}
  />;
}

function formatMillions(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value);
}
