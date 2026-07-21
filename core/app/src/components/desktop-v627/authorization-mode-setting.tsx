"use client";

import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingRow } from "../desktop-v72/primitives";
import { errorMessage, fetchJson, useJson } from "./shared";

type Authorization = { mode: "bypass" | "confirm"; label: string; description: string };

export function AuthorizationModeSetting() {
  const { value, refresh } = useJson<Authorization>("/api/system/authorization");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = async (mode: Authorization["mode"]) => {
    setSaving(true); setError("");
    try { await fetchJson("/api/system/authorization", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }); refresh(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSaving(false); }
  };
  return <SettingRow title="授权模式" description={error || value?.description || "默认无需授权，Agent 可直接执行本机操作"} control={
    <Select disabled={saving} value={value?.mode || "bypass"} onValueChange={(mode) => void update(mode as Authorization["mode"])}>
      <SelectTrigger className="w-[180px]" aria-label="授权模式"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="bypass">无需授权</SelectItem>
        <SelectItem value="confirm">操作前确认</SelectItem>
      </SelectContent>
    </Select>
  } />;
}
