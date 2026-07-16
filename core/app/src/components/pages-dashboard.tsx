"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUpRight, ChevronRight, FileText, Monitor, Plus, RefreshCw, Smartphone, Upload } from "lucide-react";

type PageAsset = { fileName: string; bytes: number; updatedAt: string; publicPath: string; url: string; durable?: boolean };
type PreviewMode = "web" | "mobile";

function publicUrl(asset: PageAsset) { return `/public${asset.publicPath.startsWith("/") ? asset.publicPath : `/${asset.publicPath}`}`; }
function formatBytes(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`; }
function formatDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date) : ""; }

export function PagesDashboard() {
  const [assets, setAssets] = useState<PageAsset[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("mobile");
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
      setSelectedPath((current) => payload.assets?.some((asset) => asset.publicPath === current) ? current : payload.assets?.[0]?.publicPath || "");
      setMessage("");
    } catch { setMessage("Online Pages 服务暂时不可用。"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const selected = useMemo(() => assets.find((asset) => asset.publicPath === selectedPath) || null, [assets, selectedPath]);

  const publish = async () => {
    if (!file) return;
    setPublishing(true);
    setMessage("");
    try {
      const response = await fetch("/api/publications/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, folder: "console", content: await file.text(), encoding: "utf8", mimeType: file.type || "text/html" }) });
      const payload = await response.json() as { ok?: boolean; asset?: PageAsset; error?: string };
      if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
      setFile(null);
      setSelectedPath(payload.asset?.publicPath || "");
      setMessage("页面已发布，并保留在你的 Workspace 中。");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "页面发布失败"); }
    finally { setPublishing(false); }
  };

  return <section className="pages-library">
    <div className="pages-library-bar">
      <div><span className="toolbar-kicker">YOUR NODE</span><strong>{loading ? "正在读取" : `${assets.length} 个已发布页面`}</strong></div>
      <Button variant="outline" size="icon" type="button" aria-label="刷新页面列表" title="刷新" disabled={loading} onClick={() => void refresh()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
    </div>

    {message ? <p className="inline-message pages-library-message">{message}</p> : null}

    <div className="pages-library-layout">
      <aside className="pages-catalog" aria-label="已发布页面">
        <header><div><FileText className="size-4" /><strong>全部页面</strong></div><span>{assets.length}</span></header>
        <div className="pages-catalog-list">
          {assets.map((asset, index) => <button className={asset.publicPath === selectedPath ? "is-selected" : ""} type="button" onClick={() => setSelectedPath(asset.publicPath)} key={asset.publicPath}>
            <span className="pages-catalog-index">{String(index + 1).padStart(2, "0")}</span>
            <span><strong>{asset.fileName}</strong><small>{formatDate(asset.updatedAt)} · {formatBytes(asset.bytes)}</small><code>{asset.publicPath}</code></span>
            <ChevronRight className="size-4" />
          </button>)}
          {!loading && !assets.length ? <div className="pages-catalog-empty"><FileText className="size-6" /><strong>还没有页面</strong><span>已发布内容会在这里逐一列出。</span></div> : null}
        </div>
      </aside>

      <article className="page-reading-stage">
        <header>
          <div><span className="toolbar-kicker">READING VIEW</span><strong>{selected?.fileName || "选择一个页面"}</strong></div>
          <div className="page-reading-actions">
            <Tabs value={previewMode} onValueChange={(value) => setPreviewMode(value as PreviewMode)}><TabsList aria-label="预览尺寸"><TabsTrigger value="mobile"><Smartphone className="size-3.5" />手机</TabsTrigger><TabsTrigger value="web"><Monitor className="size-3.5" />桌面</TabsTrigger></TabsList></Tabs>
            {selected ? <a href={publicUrl(selected)} target="_blank" rel="noreferrer" aria-label="打开页面" title="打开页面"><ArrowUpRight className="size-4" /></a> : null}
          </div>
        </header>
        <div className={`page-reading-canvas preview-${previewMode}`}>
          {selected ? <iframe src={publicUrl(selected)} sandbox="allow-scripts" referrerPolicy="no-referrer" title={`${selected.fileName} ${previewMode} preview`} /> : <div className="page-reading-empty"><span className="radial-mark">✣</span><p>从左侧选择一个页面开始阅读。</p></div>}
        </div>
      </article>
    </div>

    <details className="page-publisher">
      <summary><span><Plus className="size-4" />发布新页面</span><small>桌面管理功能</small></summary>
      <div><label className="file-picker"><input type="file" accept=".html,.htm,text/html" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] || null)} /><span>{file ? file.name : "选择 HTML 页面"}</span></label><Button type="button" onClick={() => void publish()} disabled={!file || publishing}><Upload className="size-3.5" />{publishing ? "发布中" : "发布页面"}</Button></div>
    </details>
  </section>;
}
