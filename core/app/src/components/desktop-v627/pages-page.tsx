"use client";

import { ArrowUpRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { PageItem } from "./types";
import { relativeTime, useJson } from "./shared";
import { Badge, PageHeader, PageSurface, SearchField, SegmentedControl } from "../desktop-v72/primitives";
import { IllustratedEmptyState } from "../desktop-v72/illustrated-empty-state";

function Preview({ page, index }: { page: PageItem; index: number }) {
  return <div className={`gallery-preview${page.headerTheme === "dark" ? " dark" : ""}`}><div className="preview-sheet"><span>PERSONAL AGENT · PAGE</span><h3>{page.title}</h3><div className="preview-bars">{[34,46,28,51,42,60,48].map((height, item) => <i key={item} style={{ height: height + (index % 3) * 2 }} />)}</div></div></div>;
}

export function PagesPage() {
  const { value, loading } = useJson<{ pages: PageItem[] }>("/api/node/v1/client/pages");
  const [visibility, setVisibility] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pages = useMemo(() => (value?.pages || []).filter((page) => (!query || `${page.title}${page.summary}`.toLowerCase().includes(query.toLowerCase())) && (visibility === "all" || page.visibility === visibility)), [query, value?.pages, visibility]);
  return <PageSurface><PageHeader title="发布页" description="PA 交付的完整网页。列表封面只用于识别，打开后显示发布页自己的内容。" actions={<>{searchOpen ? <SearchField autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索发布页…" aria-label="搜索发布页" /> : <button className="icon-button" type="button" aria-label="搜索" onClick={() => setSearchOpen(true)}><Search size={16} /></button>}<SegmentedControl value={visibility} onChange={setVisibility} options={[{ label: "全部", value: "all" }, { label: "私有", value: "private" }, { label: "公开", value: "public" }]} /></>} />
    <section className="gallery">{pages.map((page, index) => <a className="card gallery-card" href={page.url || page.shareUrl} target="_blank" rel="noreferrer" aria-label={`在默认浏览器中打开${page.title}`} key={page.id}><Preview page={page} index={index} /><div className="gallery-copy"><h2>{page.title}</h2><p>{page.summary}</p><div className="gallery-meta"><Badge tone={page.visibility === "public" ? "info" : undefined}>{page.visibility === "public" ? "公开" : "私有"}</Badge><span className="row-trailing">{relativeTime(page.updatedAt)} <ArrowUpRight size={12} style={{ display: "inline" }} /></span></div></div></a>)}</section>
    {!loading && !pages.length ? <IllustratedEmptyState className="empty-state" variant="pages" title={query ? "没有找到相关发布页" : "还没有发布页"} description={query ? "换个关键词，或切换可见范围后再试。" : "主 Agent 发布网页后，会在这里生成封面和打开入口。"} /> : null}
  </PageSurface>;
}
