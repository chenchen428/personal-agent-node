"use client";

import Link from "next/link";
import { useState } from "react";
import { copyText, coverKind, formatDateTime, relativeTime, useDebounced, useRememberedQuery, useRemote, useSourcePage } from "./data";
import { OrderedPageGrid } from "./page-masonry";
import { BackIcon, InlineError, LoadSentinel, MobileListShell, SearchEmpty, SearchStatus } from "./shell";
import { MobileContentSkeleton } from "./skeletons";
import type { FilterOption, MobilePageResult, PageItem } from "./types";

export function MobilePages({ pageId = "" }: { pageId?: string }) {
  const from = useSourcePage("pages");
  const [query, setQuery] = useRememberedQuery("pages");
  const deferredQuery = useDebounced(query, 260);
  const [filter, setFilter] = useState("all");
  const catalog = useRemote<MobilePageResult>("/api/mobile/pages?limit=200");
  const result = useRemote<MobilePageResult>(`/api/mobile/pages?limit=200&query=${encodeURIComponent(deferredQuery)}&visibility=${encodeURIComponent(filter)}`);
  const allPages = catalog.value?.items || [];
  const page = allPages.find((item) => item.id === pageId);
  const filtered = result.value?.items || [];
  const loading = catalog.loading || result.loading;
  const error = catalog.error || result.error;

  if (pageId) {
    return <PageReader page={page} loading={catalog.loading} error={catalog.error} returnHref={from === "activity" ? "/app/mobile" : "/app/mobile/pages"} returnLabel={from === "activity" ? "最近动态" : "发布页"} />;
  }

  const options: FilterOption[] = [
    { value: "all", label: "全部", count: result.value?.counts.all || 0 },
    { value: "private", label: "私有", count: result.value?.counts.private || 0 },
    { value: "public", label: "公开", count: result.value?.counts.public || 0 },
  ];
  const note = filter === "all"
    ? `${options[1].count} 个私有 · ${options[2].count} 个公开`
    : `${options.find((item) => item.value === filter)?.count || 0} 个${filter === "private" ? "私有" : "公开"}页面`;
  const selectedFilter = options.find((option) => option.value === filter) || options[0];
  const hasConditions = Boolean(query) || filter !== "all";
  const conditionSummary = [query ? `“${query}”` : "", filter !== "all" ? selectedFilter.label : ""].filter(Boolean).join(" · ");
  const initialLoading = loading && !filtered.length;

  return <MobileListShell section="pages" title="发布页" note={note} query={query} setQuery={setQuery} searchLabel="搜索发布页" searchPlaceholder="搜索发布页" filter={{ label: "筛选发布范围", description: "选择要查看的页面范围", value: filter, setValue: setFilter, options }}>
    <div className="page-list-page">
      {error ? <InlineError message={error} /> : null}
      {hasConditions ? <SearchStatus count={filtered.length} summary={conditionSummary} onClear={() => { setQuery(""); setFilter("all"); }} /> : null}
      {!loading && !filtered.length ? <SearchEmpty title={hasConditions ? "没有找到相关页面" : "还没有发布页"} hint={hasConditions ? "调整搜索词或发布范围后再试" : "PA 发布页面后会显示在这里"} /> : null}
      {initialLoading ? <MobileContentSkeleton kind="pages" /> : <OrderedPageGrid layoutKey={filtered.map((item) => item.id).join("|")}>{filtered.map((item, index) => <PageCard page={item} index={index} key={item.id} />)}</OrderedPageGrid>}
      {loading && !initialLoading ? <LoadSentinel loading canLoad={false} exhausted={false} onLoad={() => undefined} /> : null}
    </div>
  </MobileListShell>;
}

function PageCard({ page, index }: { page: PageItem; index: number }) {
  const cover = coverKind(page, index);
  return <Link className="online-page-card" href={`/app/mobile/pages/${encodeURIComponent(page.id)}`}>
    <div className={`online-page-cover cover-${cover}${page.mobileThumbnailUrl ? " has-mobile-thumbnail" : ""}`}><PageShot page={page} kind={cover} /></div>
    <div className="online-page-body"><div className="online-page-meta"><span className={`visibility${page.visibility === "private" ? " private" : ""}`}>{page.visibility === "private" ? "私有" : "公开"}</span><time dateTime={page.updatedAt} title={formatDateTime(page.updatedAt)}>{relativeTime(page.updatedAt)}</time></div><h2>{page.title}</h2><p>{page.summary}</p><span className="online-page-source">PA</span></div>
  </Link>;
}

function PageShot({ page, kind }: { page: PageItem; kind: string }) {
  const thumbnailUrl = page.mobileThumbnailUrl || page.thumbnailUrl;
  if (thumbnailUrl) return <img src={thumbnailUrl} alt={page.mobileThumbnailAlt || page.thumbnailAlt || `${page.title} 页面预览`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  if (kind === "finance") return <div className="page-shot page-shot-finance"><span>PERSONAL AGENT · PAGE</span><strong>{page.title}</strong><div className="shot-metrics"><i><b>本机</b>数据</i><i><b>{page.visibility === "private" ? "私有" : "公开"}</b>范围</i></div><div className="shot-heatmap">{Array.from({ length: 28 }, (_, index) => <i className={`heat-${index % 5}`} key={index} />)}</div></div>;
  if (kind === "weekend") return <div className="page-shot page-shot-weekend"><span>PERSONAL AGENT · PAGE</span><strong>{page.title}</strong><div className="shot-list"><i>01 已整理</i><i>02 可随时查看</i><i>03 保存在你的空间</i></div></div>;
  if (kind === "journal") return <div className="page-shot page-shot-journal"><span>PERSONAL AGENT · PAGE</span><strong>{page.title}</strong><div className="shot-photo"><i /><i /><i /></div></div>;
  if (kind === "camp") return <div className="page-shot page-shot-camp"><span>PERSONAL AGENT · PAGE</span><strong>{page.title}</strong><div className="shot-checks"><i>✓ 内容已整理</i><i>✓ 随时可查看</i><i>● 后续可更新</i></div></div>;
  return <div className="page-shot page-shot-travel"><span>PERSONAL AGENT · PAGE</span><strong>{page.title}</strong><p>{page.summary}</p><div><i>范围<br /><b>{page.visibility === "private" ? "只对你开放" : "可公开访问"}</b></i><i>更新<br /><b>{relativeTime(page.updatedAt)}</b></i></div></div>;
}

function PageReader({ page, loading, error, returnHref, returnLabel }: { page?: PageItem; loading: boolean; error: string; returnHref: string; returnLabel: string }) {
  const [toast, setToast] = useState("");
  const share = async () => {
    if (!page?.shareUrl) return;
    const copied = await copyText(page.shareUrl);
    setToast(copied ? "已复制分享链接" : "复制失败，请稍后重试");
    window.setTimeout(() => setToast(""), 1800);
  };
  return <div className="mobile-current"><div className="mobile-stage"><div className={`phone page-reader-phone theme-${page?.headerTheme || "light"}`}>
    <main className="page-reader-screen">
      <div className="page-reader-bar"><Link href={returnHref} aria-label={`返回${returnLabel}`}><BackIcon /></Link><strong>{page?.title || "发布页"}</strong><div className="page-reader-actions">{page ? page.visibility === "public" && page.shareUrl ? <button type="button" onClick={() => void share()}>分享</button> : <span>{page.visibility === "private" ? "私有" : "仅本机"}</span> : null}</div></div>
      {error ? <InlineError message={error} /> : null}
      {page?.url ? <iframe src={page.url} title={page.title} /> : loading ? <MobileContentSkeleton kind="page" /> : <SearchEmpty title="无法打开页面" hint="当前页面没有可访问地址" />}
    </main>
    <div className={`page-share-toast${toast ? " is-visible" : ""}`} role="status" aria-live="polite" hidden={!toast}>{toast}</div>
  </div></div></div>;
}
