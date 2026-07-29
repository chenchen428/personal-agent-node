"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, CircleHelp, Layers3, Plus, X } from "lucide-react";
import { fetchJson } from "@/lib/client-json";
import { buildSpaceNavigationUrl, waitForSpaceRuntime } from "@/lib/space-navigation";

type Space = {
  id: string;
  slug: string;
  displayName: string;
  kind: "personal" | "user";
  state: string;
  desiredState: "running" | "stopped";
  localUrl: string;
  managedHost: string | null;
};

type SpacesResponse = { currentSpaceId: string | null; spaces: Space[] };

export function SpaceSwitcher() {
  const [localDesktop, setLocalDesktop] = useState(false);
  const [snapshot, setSnapshot] = useState<SpacesResponse>({ currentSpaceId: null, spaces: [] });
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [switchingSpaceId, setSwitchingSpaceId] = useState("");
  const [switchError, setSwitchError] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoopbackHostname(window.location.hostname)) return;
    setLocalDesktop(true);
    let active = true;
    fetchJson<SpacesResponse>("/api/system/spaces", { headers: { "x-personal-agent-surface": "desktop" } })
      .then((value) => { if (active) setSnapshot(value); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const current = snapshot.spaces.find((space) => space.id === snapshot.currentSpaceId) || snapshot.spaces[0];
  const options = snapshot.spaces;
  if (!localDesktop) return null;
  const switchTo = async (space: Space) => {
    if (space.id === snapshot.currentSpaceId) return setOpen(false);
    setSwitchingSpaceId(space.id);
    setSwitchError("");
    try {
      const ready = await waitForSpaceRuntime(space);
      window.location.assign(buildSpaceNavigationUrl(ready, window.location.href));
    } catch (cause) {
      setSwitchError(cause instanceof Error ? cause.message : "隔离空间暂时无法启动，请重试");
      setSwitchingSpaceId("");
    }
  };

  return <div className="space-switcher" ref={root}>
    <div className="space-switcher-label">
      <span>隔离空间</span>
      <span className="space-help" tabIndex={0} aria-label="什么是隔离空间">
        <CircleHelp aria-hidden="true" />
        <span role="tooltip">当工作、家庭或协作场景需要彼此保密时使用隔离空间。每个空间拥有独立的对话、任务、Agent 工作区、邮件、数据、发布页、连接、应用与 Token 统计；切换空间不会把内容带到另一个空间。</span>
      </span>
    </div>
    <button className="space-switcher-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Layers3 aria-hidden="true" />
      <strong>{current?.displayName || "个人隔离空间"}</strong>
      <ChevronDown aria-hidden="true" />
    </button>
    {open ? <div className="space-switcher-menu">
      <div className="space-switcher-list" role="listbox" aria-label="切换隔离空间">
        {options.length === 0 ? <div className="space-switcher-empty" role="status"><strong>隔离空间不存在</strong><small>请新建一个隔离空间</small></div> : options.map((space) => {
          const selected = space.id === current?.id;
          return <button className="space-switcher-option" type="button" role="option" aria-selected={selected} aria-busy={switchingSpaceId === space.id} disabled={Boolean(switchingSpaceId)} onClick={() => void switchTo(space)} key={space.id}>
            <span className="space-option-mark">{space.kind === "personal" ? "个" : space.displayName.slice(0, 1)}</span>
            <span className="space-option-copy"><strong>{space.displayName}</strong><small>{switchingSpaceId === space.id ? "正在启动并切换…" : space.managedHost || `本机 · ${space.slug}`}</small></span>
            {selected ? <Check aria-hidden="true" /> : null}
          </button>;
        })}
        {switchError ? <p className="space-switcher-error" role="alert">{switchError}</p> : null}
      </div>
      <button className="space-switcher-create" type="button" onClick={() => { setOpen(false); setCreating(true); }}><Plus aria-hidden="true" />新建隔离空间</button>
    </div> : null}
    {creating ? <CreateSpaceDialog onClose={() => setCreating(false)} onCreated={(space) => {
      setSnapshot((value) => ({ ...value, spaces: [...value.spaces, space] }));
      setCreating(false);
      setOpen(true);
    }} /> : null}
  </div>;
}

function CreateSpaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (space: Space) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await fetchJson<{ space: Space }>("/api/system/spaces", {
        method: "POST",
        headers: { "content-type": "application/json", "x-personal-agent-surface": "desktop" },
        body: JSON.stringify({ action: "create", displayName, slug }),
      });
      onCreated(result.space);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };
  return <div className="space-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <form className="space-dialog" aria-modal="true" role="dialog" aria-labelledby="create-space-title" onSubmit={submit}>
      <header><div><h2 id="create-space-title">新建隔离空间</h2><p>创建后会自动准备独立的 Agent 工作区和全部数据目录。</p></div><button type="button" aria-label="关闭" onClick={onClose}><X /></button></header>
      <label>名称<input autoFocus value={displayName} maxLength={30} placeholder="例如：内容工作室" onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label>空间标识<input value={slug} minLength={3} maxLength={28} pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" placeholder="例如：content-studio" onChange={(event) => setSlug(event.target.value.toLowerCase())} /><small>3–28 位小写字母、数字或单连字符，不能包含 --。</small></label>
      {error ? <p className="space-dialog-error" role="alert">{error}</p> : null}
      <footer><button type="button" onClick={onClose}>取消</button><button className="primary" type="submit" disabled={busy || !displayName.trim() || !slug.trim()}>{busy ? "创建中…" : "创建"}</button></footer>
    </form>
  </div>;
}

function isLoopbackHostname(hostname: string) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname.toLowerCase());
}
