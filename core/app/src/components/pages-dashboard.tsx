"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, Monitor, RefreshCw, Smartphone, Upload } from "lucide-react";

type PageAsset = { fileName: string; bytes: number; updatedAt: string; publicPath: string; url: string; durable?: boolean };
type PreviewMode = "web" | "mobile";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

export function PagesDashboard() {
  const [assets, setAssets] = useState<PageAsset[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("web");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/publications", { cache: "no-store" });
      const payload = await response.json() as { ok?: boolean; assets?: PageAsset[] };
      if (!response.ok || payload.ok === false) throw new Error();
      setAssets(payload.assets || []);
      setSelectedPath((current) => current || payload.assets?.[0]?.publicPath || "");
      setMessage("");
    } catch {
      setMessage("Online Pages 服务暂时不可用。");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const selected = useMemo(() => assets.find((asset) => asset.publicPath === selectedPath) || null, [assets, selectedPath]);
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] || null);
  const publish = async () => {
    if (!file) return;
    setPublishing(true);
    setMessage("");
    try {
      const content = await file.text();
      const response = await fetch("/api/publications/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, folder: "console", content, encoding: "utf8", mimeType: file.type || "text/html" }),
      });
      const payload = await response.json() as { ok?: boolean; asset?: PageAsset; error?: string };
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      setFile(null);
      setSelectedPath(payload.asset?.publicPath || "");
      setMessage("页面已发布，并保留在你的 Workspace 中。");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "页面发布失败");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section className="pages-workspace">
      <div className="pages-rail">
        <div className="workspace-toolbar pages-toolbar">
          <div><span className="toolbar-kicker">PUBLISHED</span><strong>{loading ? "读取中" : `${assets.length} 个页面`}</strong></div>
          <Button variant="outline" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-3.5" />刷新</Button>
        </div>
        <div className="page-import">
          <label className="file-picker"><input type="file" accept=".html,.htm,text/html" onChange={chooseFile} /><span>{file ? file.name : "选择 HTML 页面"}</span></label>
          <Button type="button" onClick={() => void publish()} disabled={!file || publishing}><Upload className="size-3.5" />{publishing ? "发布中" : "发布页面"}</Button>
          <small>建议页面自身包含 viewport，并分别设计 Web 与 Mobile 布局。</small>
        </div>
        {message ? <p className="inline-message">{message}</p> : null}
        <div className="page-list">
          {assets.map((asset) => <button className={asset.publicPath === selectedPath ? "selected" : ""} type="button" onClick={() => setSelectedPath(asset.publicPath)} key={asset.publicPath}><span>{asset.fileName}</span><small>{formatBytes(asset.bytes)} · {new Date(asset.updatedAt).toLocaleDateString("zh-CN")}</small></button>)}
          {!loading && !assets.length ? <div className="empty-list">还没有页面。你可以从 HTML 文件开始，或让 Agent 为你生成。</div> : null}
        </div>
      </div>
      <Card className="preview-stage">
        <header>
          <div><span className="toolbar-kicker">LIVE PREVIEW</span><strong>{selected?.fileName || "选择一个页面"}</strong></div>
          <Tabs value={previewMode} onValueChange={(value) => setPreviewMode(value as PreviewMode)}><TabsList aria-label="预览尺寸"><TabsTrigger value="web"><Monitor className="size-3.5" />Web</TabsTrigger><TabsTrigger value="mobile"><Smartphone className="size-3.5" />Mobile</TabsTrigger></TabsList></Tabs>
        </header>
        <div className={`preview-canvas preview-${previewMode}`}>
          {selected ? <iframe src={selected.url} sandbox="allow-scripts" referrerPolicy="no-referrer" title={`${selected.fileName} ${previewMode} preview`} /> : <div className="preview-empty"><span className="radial-mark">✣</span><p>发布后可在同一处检查桌面与手机布局。</p></div>}
        </div>
        {selected ? <a className="open-page-link" href={selected.url} target="_blank" rel="noreferrer">在新窗口打开 <ExternalLink className="inline size-3.5" /></a> : null}
      </Card>
    </section>
  );
}
