"use client";

import Link from "next/link";
import { ArrowUpRight, LayoutTemplate, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { PageItem } from "./types";
import { relativeTime, useJson } from "./shared";
import { Badge, PageHeader, PageSurface, SearchField, SegmentedControl } from "../desktop-v72/primitives";
import { IllustratedEmptyState } from "../desktop-v72/illustrated-empty-state";
import { LoadingState } from "../desktop-v72/loading-state";
import { PagePreview } from "./page-preview";

export function PagesPage() {
  const { value, loading } = useJson<{ pages: PageItem[] }>("/api/node/v1/client/pages");
  const [visibility, setVisibility] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pages = useMemo(() => (value?.pages || []).filter((page) =>
    (!query || `${page.title}${page.summary}`.toLowerCase().includes(query.toLowerCase()))
    && (visibility === "all" || page.visibility === visibility)
  ), [query, value?.pages, visibility]);

  return <PageSurface><PageHeader title="发布页" description="PA 交付的完整网页。列表展示发布时生成并保存的缩略图，打开后可查看完整页面。" actions={<>
    {searchOpen ? <SearchField autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索发布页…" aria-label="搜索发布页" /> : <button className="icon-button" type="button" aria-label="搜索" onClick={() => setSearchOpen(true)}><Search size={16} /></button>}
    <SegmentedControl value={visibility} onChange={setVisibility} options={[{ label: "全部", value: "all" }, { label: "私有", value: "private" }, { label: "公开", value: "public" }]} />
    <Link className="pages-template-entry" href="/app/pages/templates"><LayoutTemplate aria-hidden="true" />查看模板</Link>
  </>} />
    {loading && !value ? <LoadingState label="正在读取发布页" /> : <section className="gallery">{pages.map((page) => <a className="card gallery-card" href={page.url} target="_blank" rel="noreferrer" aria-label={`在默认浏览器中打开${page.title}`} key={page.id}><PagePreview page={page} /><div className="gallery-copy"><h2>{page.title}</h2><p>{page.summary}</p><div className="gallery-meta"><Badge tone={page.visibility === "public" ? "info" : undefined}>{page.visibility === "public" ? "公开" : "私有"}</Badge><span className="row-trailing">{relativeTime(page.updatedAt)} <ArrowUpRight size={12} style={{ display: "inline" }} /></span></div></div></a>)}</section>}
    {!loading && !pages.length ? <IllustratedEmptyState className="empty-state" variant="pages" title={query ? "没有找到相关发布页" : "还没有发布页"} description={query ? "换个关键词，或切换可见范围后再试。" : "与 Agent 对话完成页面后，会在这里显示并打开页面。"} /> : null}
  </PageSurface>;
}
