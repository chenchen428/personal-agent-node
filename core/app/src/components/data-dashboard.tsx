"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, ChevronRight, Code2, Copy, Database, LoaderCircle, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Scalar = string | number | boolean | null | { type: "blob"; size: number };
type DataObject = { name: string; type: "table" | "view"; sql: string; columnCount: number; rowCount: number | null };
type DataColumn = { cid: number; name: string; type: string; notNull: boolean; defaultValue: Scalar; primaryKeyPosition: number; hidden: number };
type ObjectDetail = DataObject & { columns: DataColumn[]; indexes: Array<{ name: string; unique: boolean; origin: string; partial: boolean }>; foreignKeys: Array<{ from: string; table: string; to: string; onUpdate: string; onDelete: string }> };
type QueryResult = { object: ObjectDetail; columns: string[]; rows: Array<Record<string, Scalar>>; page: { number: number; size: number; totalRows: number; totalPages: number } };
type DataStatus = { databasePath: string; sizeBytes: number; schemaVersion: number; objects: DataObject[]; snapshotCount: number };
type Snapshot = { id: string; reason?: string; sizeBytes: number; createdAt: string; managed?: unknown };
type Operation = { id: string; kind?: string; status?: string; createdAt?: string; snapshotId?: string | null; affectedRows?: number };
type Sort = { field: string; direction: "asc" | "desc" } | null;

const destructiveSql = /\b(?:DROP\s+(?:TABLE|VIEW|INDEX|TRIGGER)|ALTER\s+TABLE|DELETE\s+FROM|VACUUM)\b/i;
const readOnlySql = /^(?:SELECT|WITH\b[\s\S]*?\bSELECT|EXPLAIN\s+(?:QUERY\s+PLAN\s+)?SELECT|PRAGMA\s+)/i;

export function DataDashboard() {
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [objects, setObjects] = useState<DataObject[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [objectSearch, setObjectSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<Sort>(null);
  const [tab, setTab] = useState("rows");
  const [sql, setSql] = useState("SELECT name, type\nFROM sqlite_schema\nWHERE name NOT LIKE 'sqlite_%'\nORDER BY name;");
  const [sqlResult, setSqlResult] = useState<unknown>(null);
  const [sqlRunning, setSqlRunning] = useState(false);
  const [confirmSql, setConfirmSql] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState("");
  const [restoreId, setRestoreId] = useState("");
  const [notice, setNotice] = useState("");

  const requestJson = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { cache: "no-store", ...init });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string | { message?: string } } & T;
    if (!response.ok || payload.ok === false) {
      const message = typeof payload.error === "string" ? payload.error : payload.error?.message;
      throw new Error(message || `HTTP ${response.status}`);
    }
    return payload;
  }, []);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statusPayload, schemaPayload, snapshotPayload] = await Promise.all([
        requestJson<{ status: DataStatus; operations?: Operation[] }>("/api/app/data/status"),
        requestJson<{ objects: DataObject[] }>("/api/app/data/schema"),
        requestJson<{ snapshots: Snapshot[] }>("/api/app/data/snapshots"),
      ]);
      setStatus(statusPayload.status);
      setOperations(statusPayload.operations || []);
      setObjects(schemaPayload.objects || []);
      setSnapshots(snapshotPayload.snapshots || []);
      setSelected((current) => schemaPayload.objects.some((item) => item.name === current) ? current : schemaPayload.objects[0]?.name || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "数据服务暂时不可用");
    } finally {
      setLoading(false);
    }
  }, [requestJson]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    if (!selected) { setDetail(null); setResult(null); return; }
    let active = true;
    requestJson<{ object: ObjectDetail }>(`/api/app/data/objects/${encodeURIComponent(selected)}`)
      .then((payload) => { if (active) setDetail(payload.object); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "无法读取对象结构"); });
    return () => { active = false; };
  }, [requestJson, selected]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setQuerying(true);
      requestJson<{ result: QueryResult }>("/api/app/data/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: selected, search, page: { number: page, size: pageSize }, sort: sort ? [sort] : [] }),
      }).then((payload) => { if (active) setResult(payload.result); })
        .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "查询失败"); })
        .finally(() => { if (active) setQuerying(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [page, pageSize, requestJson, search, selected, sort]);

  const filteredObjects = useMemo(() => {
    const keyword = objectSearch.trim().toLowerCase();
    return keyword ? objects.filter((item) => item.name.toLowerCase().includes(keyword)) : objects;
  }, [objectSearch, objects]);

  function selectObject(name: string) {
    setSelected(name); setPage(1); setSearch(""); setSort(null); setError("");
  }

  function changeSort(field: string) {
    setPage(1);
    setSort((current) => current?.field === field ? { field, direction: current.direction === "asc" ? "desc" : "asc" } : { field, direction: "asc" });
  }

  async function executeSql(approved = false) {
    const statement = sql.trim();
    if (!statement) return;
    if (!approved && !readOnlySql.test(statement)) { setConfirmSql(true); return; }
    setConfirmSql(false); setSqlRunning(true); setError(""); setNotice("");
    try {
      const payload = await requestJson<{ result: unknown }>("/api/app/data/sql", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: statement, actor: "local-console" }),
      });
      setSqlResult(payload.result);
      setNotice(readOnlySql.test(statement) ? "查询完成" : "写入已完成，操作记录已更新");
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SQL 执行失败");
    } finally { setSqlRunning(false); }
  }

  async function createSnapshot() {
    setSnapshotBusy("create"); setError(""); setNotice("");
    try {
      const payload = await requestJson<{ snapshot: Snapshot }>("/api/app/data/snapshots", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "local-console" }),
      });
      setNotice(`快照 ${payload.snapshot.id} 已创建`);
      await loadOverview();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建快照失败"); }
    finally { setSnapshotBusy(""); }
  }

  async function restoreSnapshot(id: string) {
    setSnapshotBusy(id); setError(""); setNotice("");
    try {
      const payload = await requestJson<{ result: { rollbackSnapshotId?: string } }>(`/api/app/data/snapshots/${encodeURIComponent(id)}/restore`, { method: "POST" });
      setNotice(`已恢复 ${id}${payload.result.rollbackSnapshotId ? `，回滚快照为 ${payload.result.rollbackSnapshotId}` : ""}`);
      setRestoreId(""); await loadOverview();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "恢复快照失败"); }
    finally { setSnapshotBusy(""); }
  }

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value); setNotice("已复制到剪贴板");
  }

  return (
    <section className="data-console" aria-busy={loading}>
      <div className="data-status-strip" aria-live="polite">
        <div><Database className="size-4" /><span>数据库</span><strong>{loading ? "读取中" : error && !status ? "不可用" : "可用"}</strong></div>
        <div><Table2 className="size-4" /><span>对象</span><strong>{objects.length}</strong></div>
        <div><ShieldCheck className="size-4" /><span>快照</span><strong>{snapshots.length}</strong></div>
        <div><Database className="size-4" /><span>大小</span><strong>{formatBytes(status?.sizeBytes || 0)}</strong></div>
        <Button variant="outline" size="icon" aria-label="刷新数据状态" title="刷新" onClick={() => void loadOverview()} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></Button>
      </div>

      {error ? <div className="surface-notice notice-error"><AlertTriangle className="size-4" /><span>{error}</span><button type="button" onClick={() => setError("")}>关闭</button></div> : null}
      {notice ? <div className="surface-notice notice-success"><CheckCircle2 className="size-4" /><span>{notice}</span><button type="button" onClick={() => setNotice("")}>关闭</button></div> : null}

      <label className="data-mobile-object"><span>数据对象</span><select value={selected} onChange={(event) => selectObject(event.target.value)}>{objects.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>

      <div className="data-workbench">
        <aside className="data-object-rail" aria-label="数据对象">
          <header><div><span className="toolbar-kicker">OBJECTS</span><strong>{objects.length} 个表与视图</strong></div></header>
          <label className="rail-search"><Search className="size-4" /><input value={objectSearch} onChange={(event) => setObjectSearch(event.target.value)} type="search" placeholder="搜索对象" /></label>
          <div className="data-object-list">
            {filteredObjects.map((item) => <button type="button" className={selected === item.name ? "is-active" : ""} onClick={() => selectObject(item.name)} key={item.name}><span className="data-object-icon">{item.type === "view" ? "V" : "T"}</span><span><strong>{item.name}</strong><small>{item.rowCount === null ? "行数未知" : `${item.rowCount.toLocaleString()} 行`} · {item.columnCount} 列</small></span><ChevronRight className="size-4" /></button>)}
            {!loading && filteredObjects.length === 0 ? <p>没有匹配的数据对象</p> : null}
          </div>
        </aside>

        <div className="data-main">
          {!selected ? <EmptyData /> : <Tabs value={tab} onValueChange={setTab}>
            <div className="data-main-header">
              <div><span className="toolbar-kicker">{detail?.type || "OBJECT"}</span><strong>{selected}</strong></div>
              <TabsList aria-label="数据视图">
                <TabsTrigger value="rows"><Table2 className="size-3.5" />数据</TabsTrigger>
                <TabsTrigger value="schema"><Database className="size-3.5" />结构</TabsTrigger>
                <TabsTrigger value="sql"><Code2 className="size-3.5" />SQL</TabsTrigger>
                <TabsTrigger value="snapshots"><ShieldCheck className="size-3.5" />快照</TabsTrigger>
                <TabsTrigger value="activity"><RefreshCw className="size-3.5" />操作</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="rows" className="data-tab-panel">
              <div className="data-query-toolbar">
                <label><Search className="size-4" /><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索当前对象" /></label>
                <label className="data-page-size"><span>每页</span><select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select></label>
              </div>
              <div className="data-table-wrap">
                <table><thead><tr>{(result?.columns || detail?.columns.map((column) => column.name) || []).map((column) => <th key={column}><button type="button" onClick={() => changeSort(column)}>{column}{sort?.field === column ? sort.direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}</button></th>)}</tr></thead>
                  <tbody>{querying && !result ? <tr><td colSpan={detail?.columns.length || 1}><div className="data-loading"><LoaderCircle className="size-4 animate-spin" />正在查询</div></td></tr> : result?.rows.map((row, rowIndex) => <tr key={rowIndex}>{result.columns.map((column) => <td key={column}>{renderValue(row[column])}</td>)}</tr>)}</tbody>
                </table>
                {!querying && result?.rows.length === 0 ? <div className="data-empty-rows"><Table2 className="size-5" /><strong>没有记录</strong><span>{search ? "清除搜索或调整条件" : "该对象目前为空"}</span></div> : null}
              </div>
              {result ? <footer className="data-pagination"><span>共 {result.page.totalRows.toLocaleString()} 行 · 第 {result.page.number}/{result.page.totalPages} 页</span><div><Button variant="outline" size="icon" aria-label="上一页" onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={querying || result.page.number <= 1}><ArrowLeft className="size-4" /></Button><Button variant="outline" size="icon" aria-label="下一页" onClick={() => setPage((current) => Math.min(current + 1, result.page.totalPages))} disabled={querying || result.page.number >= result.page.totalPages}><ArrowRight className="size-4" /></Button></div></footer> : null}
            </TabsContent>

            <TabsContent value="schema" className="data-tab-panel schema-panel">
              <section><header><h2>字段</h2><Badge>{detail?.columns.length || 0} 列</Badge></header><div className="schema-table-wrap"><table><thead><tr><th>字段</th><th>类型</th><th>约束</th><th>默认值</th></tr></thead><tbody>{detail?.columns.map((column) => <tr key={column.cid}><td><strong>{column.name}</strong></td><td><code>{column.type || "ANY"}</code></td><td>{[column.primaryKeyPosition ? "主键" : "", column.notNull ? "非空" : "", column.hidden ? "隐藏" : ""].filter(Boolean).join(" · ") || "-"}</td><td>{renderValue(column.defaultValue)}</td></tr>)}</tbody></table></div></section>
              <section className="schema-secondary"><div><h2>索引</h2>{detail?.indexes.length ? detail.indexes.map((index) => <p key={index.name}><code>{index.name}</code><span>{index.unique ? "唯一" : "普通"} · {index.origin}</span></p>) : <p>没有索引</p>}</div><div><h2>外键</h2>{detail?.foreignKeys.length ? detail.foreignKeys.map((key, index) => <p key={`${key.from}-${index}`}><code>{key.from} → {key.table}.{key.to}</code><span>{key.onUpdate} / {key.onDelete}</span></p>) : <p>没有外键</p>}</div></section>
              {detail?.sql ? <details className="schema-sql"><summary>查看建表 SQL</summary><div><Button variant="ghost" size="icon" aria-label="复制建表 SQL" onClick={() => void copyText(detail.sql)}><Copy className="size-4" /></Button><pre><code>{detail.sql}</code></pre></div></details> : null}
            </TabsContent>

            <TabsContent value="sql" className="data-tab-panel sql-panel">
              <div className="sql-editor-heading"><div><span className="toolbar-kicker">LOCAL SQLITE</span><strong>Workspace 数据库</strong></div><Button onClick={() => void executeSql()} disabled={sqlRunning || !sql.trim()}>{sqlRunning ? <LoaderCircle className="size-4 animate-spin" /> : <Code2 className="size-4" />}{sqlRunning ? "执行中" : "执行"}</Button></div>
              <textarea aria-label="SQL 编辑器" spellCheck={false} value={sql} onChange={(event) => { setSql(event.target.value); setConfirmSql(false); }} />
              <p className="sql-boundary"><ShieldCheck className="size-4" />只读查询可直接执行；写入会要求确认。ATTACH、扩展加载和事务控制由数据服务阻止。</p>
              {confirmSql ? <div className={`sql-confirm ${destructiveSql.test(sql) ? "is-danger" : ""}`}><AlertTriangle className="size-5" /><div><strong>{destructiveSql.test(sql) ? "这是破坏性 SQL" : "确认写入 Workspace 数据库"}</strong><p>{destructiveSql.test(sql) ? "执行前系统会自动创建快照，但本次操作仍会改变当前数据。" : "本次语句会改变本机数据库，不会上传数据。"}</p><div><Button variant="outline" size="sm" onClick={() => setConfirmSql(false)}>取消</Button><Button size="sm" onClick={() => void executeSql(true)}>确认执行</Button></div></div></div> : null}
              {sqlResult !== null ? <section className="sql-result"><header><strong>执行结果</strong><Button variant="ghost" size="icon" aria-label="复制执行结果" onClick={() => void copyText(JSON.stringify(sqlResult, null, 2))}><Copy className="size-4" /></Button></header><pre><code>{JSON.stringify(sqlResult, null, 2)}</code></pre></section> : null}
            </TabsContent>

            <TabsContent value="snapshots" className="data-tab-panel snapshot-panel">
              <header><div><span className="toolbar-kicker">RECOVERY</span><strong>{snapshots.length} 个本机快照</strong></div><Button onClick={() => void createSnapshot()} disabled={Boolean(snapshotBusy)}>{snapshotBusy === "create" ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}创建快照</Button></header>
              <div className="snapshot-list">{snapshots.map((snapshot) => <article key={snapshot.id}><div className="snapshot-icon"><ShieldCheck className="size-4" /></div><div><strong>{snapshot.id}</strong><span>{formatDate(snapshot.createdAt)} · {formatBytes(snapshot.sizeBytes)}{snapshot.reason ? ` · ${snapshot.reason}` : ""}</span></div><Button variant="outline" size="sm" onClick={() => setRestoreId(snapshot.id)} disabled={Boolean(snapshotBusy)}><RotateCcw className="size-3.5" />恢复</Button>{restoreId === snapshot.id ? <div className="snapshot-confirm"><AlertTriangle className="size-4" /><p>恢复会覆盖当前数据库，并先创建一个回滚快照。</p><Button variant="outline" size="sm" onClick={() => setRestoreId("")}>取消</Button><Button size="sm" onClick={() => void restoreSnapshot(snapshot.id)} disabled={snapshotBusy === snapshot.id}>{snapshotBusy === snapshot.id ? <LoaderCircle className="size-3.5 animate-spin" /> : null}确认恢复</Button></div> : null}</article>)}{!snapshots.length ? <div className="data-empty-rows"><ShieldCheck className="size-5" /><strong>还没有快照</strong><span>在重要数据改动前创建一个恢复点</span></div> : null}</div>
            </TabsContent>

            <TabsContent value="activity" className="data-tab-panel activity-panel">
              <div className="activity-list">{operations.map((operation) => <article key={operation.id}><span className={`operation-state ${operation.status === "failed" ? "is-error" : ""}`} /><div><strong>{operation.kind || "operation"}</strong><code>{operation.id}</code></div><div><Badge variant={operation.status === "failed" ? "error" : "ready"}>{operation.status || "完成"}</Badge><time>{formatDate(operation.createdAt || "")}</time></div></article>)}{!operations.length ? <div className="data-empty-rows"><RefreshCw className="size-5" /><strong>暂无操作记录</strong><span>查询与写入结果会在这里留下审计信息</span></div> : null}</div>
            </TabsContent>
          </Tabs>}
        </div>
      </div>
    </section>
  );
}

function EmptyData() {
  return <div className="data-empty-workspace"><Database className="size-6" /><h2>Workspace 数据库还没有对象</h2><p>Agent 创建结构化数据后，表和视图会在这里出现。</p></div>;
}

function renderValue(value: Scalar | undefined) {
  if (value === null || value === undefined) return <span className="data-null">NULL</span>;
  if (typeof value === "object" && value.type === "blob") return <span className="data-blob">BLOB · {formatBytes(value.size)}</span>;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDate(value: string) {
  if (!value) return "时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
