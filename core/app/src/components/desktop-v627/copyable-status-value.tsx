"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyableStatusValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function copy() {
    const succeeded = await copyText(value);
    if (!succeeded) return;
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1_500);
  }

  return <button
    className="v72-copy-status-value"
    type="button"
    title={value}
    aria-label={copied ? `已复制${label}：${value}` : `复制${label}：${value}`}
    onClick={() => void copy()}
  >
    <strong>{value}</strong>
    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
  </button>;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { return document.execCommand("copy"); }
    catch { return false; }
    finally { area.remove(); }
  }
}
