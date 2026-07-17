"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, Search, SlidersHorizontal, X } from "lucide-react";
import { Button, SearchField } from "../desktop-v72/primitives";
import { DataColumnPanel, DataVisibilityPanel } from "./data-column-panel";
import { DataTable } from "./data-table";
import type { DataMetadata, DataObject, DataResult } from "./types";
import { errorMessage, fetchJson, formatCell } from "./shared";

type DataSchema = { objects: DataObject[]; metadata: DataMetadata[]; initialResult: DataResult | null };

export function DataPage() {
  const [objects, setObjects] = useState<DataObject[]>([]);
  const [metadata, setMetadata] = useState<DataMetadata[]>([]);
  const [objectName, setObjectName] = useState("");
  const [result, setResult] = useState<DataResult | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [sort, setSort] = useState<{ column: string; direction: "asc" | "desc" }>();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [activeColumn, setActiveColumn] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visible, setVisible] = useState<string[]>([]);
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");
  const loadedSignature = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<DataSchema>("/api/app/data/schema?counts=0&preview=1", { signal: controller.signal }).then((data) => {
      const firstObject = data.objects?.[0]?.name || "";
      setObjects(data.objects || []);
      setMetadata(data.metadata || []);
      setObjectName(firstObject);
      setResult(data.initialResult || null);
      setVisible(data.initialResult?.columns || []);
      loadedSignature.current = data.initialResult ? querySignature(firstObject, {}, undefined, 1) : "";
      setError("");
      setInitialized(true);
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(errorMessage(cause));
      setInitialized(true);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!initialized) return;
    if (!objectName) { setLoading(false); setResult(null); return; }
    const signature = querySignature(objectName, filters, sort, pageNumber);
    if (loadedSignature.current === signature) { loadedSignature.current = ""; return; }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetchJson<DataResult>("/api/app/data/query", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ object: objectName, filters: Object.entries(filters).filter(([, value]) => value).map(([field, value]) => ({ field, operator: "contains", value })), sort: sort ? [{ field: sort.column, direction: sort.direction }] : [], page: { number: pageNumber, size: 50 } }) }).then((data) => { setResult(data); setVisible((current) => current.length ? current.filter((column) => data.columns.includes(column)) : data.columns); }).catch((cause) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(errorMessage(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, initialized, objectName, pageNumber, sort]);

  const display = (field: string) => metadata.find((item) => item.objectName === objectName && item.fieldName === field)?.displayName || field;
  const sheet = metadata.find((item) => item.objectName === objectName && !item.fieldName);
  const visibleColumns = useMemo(() => (result?.columns || []).filter((column) => visible.includes(column)), [result?.columns, visible]);
  const visibleRows = useMemo(() => {
    const normalized = query.trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
    if (!normalized) return result?.rows || [];
    return (result?.rows || []).filter((row) => visibleColumns.some((column) => formatCell(row[column]).normalize("NFKC").toLocaleLowerCase("zh-CN").includes(normalized)));
  }, [query, result?.rows, visibleColumns]);
  const hasActiveFilter = Boolean(query.trim() || Object.values(filters).some(Boolean));
  const emptyState = error
    ? { title: "暂时无法读取数据", description: error }
    : !objectName
    ? { title: "还没有数据表", description: "主 Agent 创建结构化数据后，工作表和记录会出现在这里。" }
    : hasActiveFilter
      ? { title: "没有匹配的数据", description: "清除查找或调整筛选条件后再试。" }
      : { title: "这个工作表还是空的", description: "主 Agent 写入数据后，记录会按列显示在这里。" };
  const changeSheet = (name: string) => { setObjectName(name); setResult(null); setQuery(""); setSearching(false); setFilters({}); setSort(undefined); setActiveColumn(""); setColumnsOpen(false); setVisible([]); setPageNumber(1); };
  const applyColumn = (column: string, filter: string, direction?: "asc" | "desc") => { setFilters((current) => ({ ...current, [column]: filter })); setSort(direction ? { column, direction } : undefined); setActiveColumn(""); setPageNumber(1); };
  const clearColumn = (column: string) => { setFilters((current) => { const next = { ...current }; delete next[column]; return next; }); if (sort?.column === column) setSort(undefined); setActiveColumn(""); setPageNumber(1); };

  return <main className="page flush data-shell">
    <div className="data-toolbar"><div className="data-title"><strong>{sheet?.displayName || objectName || "数据"}</strong><span>{error || sheet?.description || (loading ? "正在读取本机工作区" : query ? `当前页找到 ${visibleRows.length} 条` : `当前工作表 · ${result?.page.totalRows || 0} 条`)}</span></div><div className="page-actions">
      {searching ? <div className="data-search"><SearchField autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查找当前工作表…" /><button className="icon-button" type="button" onClick={() => { setQuery(""); setSearching(false); }} aria-label="关闭查找"><X /></button></div> : <Button onClick={() => setSearching(true)}><Search />查找</Button>}
      <Button aria-pressed={Boolean(activeColumn)} onClick={() => { setColumnsOpen(false); setActiveColumn(activeColumn || visibleColumns[0] || result?.columns[0] || ""); }}><Filter />筛选{Object.values(filters).filter(Boolean).length ? ` ${Object.values(filters).filter(Boolean).length}` : ""}</Button>
      <Button aria-pressed={columnsOpen} onClick={() => { setActiveColumn(""); setColumnsOpen((open) => !open); }}><SlidersHorizontal />列 {visibleColumns.length}/{result?.columns.length || 0}</Button>
    </div>{activeColumn ? <DataColumnPanel column={activeColumn} columns={result?.columns || []} label={display(activeColumn)} filter={filters[activeColumn] || ""} sort={sort} onApply={applyColumn} onClear={clearColumn} onClose={() => setActiveColumn("")} onColumnChange={setActiveColumn} /> : null}{columnsOpen ? <DataVisibilityPanel columns={result?.columns || []} visible={visible} display={display} onChange={setVisible} onClose={() => setColumnsOpen(false)} /> : null}</div>
    <DataTable columns={visibleColumns} rows={visibleRows} display={display} sort={sort} filtered={filters} start={(pageNumber - 1) * 50} loading={loading} emptyState={emptyState} onColumnAction={(column) => { setColumnsOpen(false); setActiveColumn(column); }} />
    <footer className="sheet-tabs"><div role="tablist" aria-label="切换工作表">{objects.map((item) => <button className={item.name === objectName ? "active" : ""} type="button" role="tab" aria-selected={item.name === objectName} onClick={() => changeSheet(item.name)} key={item.name}>{metadata.find((entry) => entry.objectName === item.name && !entry.fieldName)?.displayName || item.name}</button>)}</div><div className="data-pager"><span>{result ? `${Math.min((pageNumber - 1) * 50 + 1, result.page.totalRows)}–${Math.min(pageNumber * 50, result.page.totalRows)} / ${result.page.totalRows}` : "0–0 / 0"}</span><button type="button" aria-label="上一页" disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => Math.max(1, page - 1))}>‹</button><b>{pageNumber} / {result?.page.totalPages || 1}</b><button type="button" aria-label="下一页" disabled={pageNumber >= (result?.page.totalPages || 1)} onClick={() => setPageNumber((page) => page + 1)}>›</button></div></footer>
  </main>;
}

function querySignature(objectName: string, filters: Record<string, string>, sort: { column: string; direction: "asc" | "desc" } | undefined, pageNumber: number) {
  return JSON.stringify({ objectName, filters, sort, pageNumber });
}
