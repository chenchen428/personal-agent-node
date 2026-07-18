"use client";

import Link from "next/link";
import type { PageItem } from "./types";
import { Empty, useJson } from "./shared";

export function PageDetail({ pageId }: { pageId: string }) {
  const { value, loading } = useJson<{ pages: PageItem[] }>("/api/node/v1/client/pages");
  const page = value?.pages.find((item) => item.id === pageId);
  if (loading) return <Empty text="正在打开发布页" />;
  if (!page) return <Empty text="发布页不存在或已被移除" />;
  return <div className={`runtime-page runtime-page-full runtime-theme-${page.headerTheme}`}><header className="runtime-bar"><Link href="/app/pages">← 发布页</Link><code>{page.url}</code><div className="runtime-page-actions">{page.visibility === "public" && page.shareUrl ? <button type="button" onClick={() => void navigator.clipboard.writeText(page.shareUrl)}>分享</button> : <span className="pa-status private">{page.visibility === "private" ? "私有" : "仅本机"}</span>}</div></header><iframe src={page.url} title={page.title} scrolling="yes" /></div>;
}
