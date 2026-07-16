"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PageItem } from "./types";
import { Empty, Filters, Heading, PageThumbnail, Pager, relativeTime, useJson } from "./shared";

export function PagesPage() {
  const { value, loading } = useJson<{ pages: PageItem[] }>("/api/node/v1/client/pages");
  const [filter, setFilter] = useState("全部");
  const [query, setQuery] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const pageSize = 8;
  const pages = (value?.pages || []).filter((item) => {
    const matchesFilter = filter === "全部" || (filter === "公开" ? item.visibility === "public" : item.visibility === "private");
    return matchesFilter && (!query || `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase()));
  });
  const totalPages = Math.max(1, Math.ceil(pages.length / pageSize));
  const visiblePages = pages.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  useEffect(() => { setPageNumber(1); }, [filter, query]);
  return <main><Heading eyebrow="发布页" title="PA 发布的页面" copy="页面由 PA 在任务中创建；列表区分公开与私有，查看时进入完整页面。" /><div className="pa-toolbar"><Filters labels={["全部", "私有", "公开"]} selected={filter} onSelect={setFilter} /><input className="pa-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或来源" aria-label="搜索发布页" /></div><div className="page-cards">{visiblePages.map((page) => <article className="page-card" key={page.id}><div className="page-cover"><PageThumbnail page={page} /></div><div className="page-card-body"><span className={`pa-status${page.visibility === "private" ? " private" : ""}`}>{page.visibility === "public" ? "公开" : "私有"}</span><h2>{page.title}</h2><p>{page.summary}</p><div className="page-card-foot"><span>{relativeTime(page.updatedAt)} · PA</span><Link className="pa-button" href={`/app/pages/${encodeURIComponent(page.id)}`}>查看</Link></div></div></article>)}{!loading && !visiblePages.length ? <Empty text={query ? "没有找到相关发布页" : "还没有发布页"} /> : null}</div>{pages.length ? <Pager page={pageNumber} totalPages={totalPages} totalRows={pages.length} pageSize={pageSize} onPage={setPageNumber} /> : null}</main>;
}
