"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataMetadata, DataObject, DataResult } from "./types";
import { Heading, Pager, columnName, fetchJson, formatCell } from "./shared";

export function DataPage() {
  const [objects, setObjects] = useState<DataObject[]>([]); const [metadata, setMetadata] = useState<DataMetadata[]>([]); const [objectName, setObjectName] = useState(""); const [result, setResult] = useState<DataResult | null>(null);
  const [sort, setSort] = useState<{ column: string; direction: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [menuColumn, setMenuColumn] = useState("");
  const [filterDraft, setFilterDraft] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedCell, setSelectedCell] = useState<{ address: string; field: string; value: string }>({ address: "A1", field: "记录编号", value: "选择单元格后在这里查看完整内容" });
  useEffect(() => { void fetchJson<{ objects: DataObject[]; metadata: DataMetadata[] }>("/api/app/data/schema").then((data) => { setObjects(data.objects || []); setMetadata(data.metadata || []); setObjectName(data.objects?.[0]?.name || ""); }); }, []);
  useEffect(() => {
    if (!objectName) return;
    void fetchJson<DataResult>("/api/app/data/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        object: objectName,
        filters: Object.entries(filters).filter(([, value]) => value).map(([field, value]) => ({ field, operator: "contains", value })),
        sort: sort ? [{ field: sort.column, direction: sort.direction }] : [],
        page: { number: pageNumber, size: 50 },
      }),
    }).then(setResult);
  }, [filters, objectName, pageNumber, sort]);
  const display = (field: string) => metadata.find((item) => item.objectName === objectName && item.fieldName === field)?.displayName || field;
  const objectMeta = metadata.find((item) => item.objectName === objectName && !item.fieldName);
  const rows = result?.rows || [];
  const openColumnMenu = (column: string) => { setMenuColumn(column); setFilterDraft(filters[column] || ""); };
  const changeObject = (name: string) => { setObjectName(name); setFilters({}); setSort(null); setPageNumber(1); setMenuColumn(""); };
  const selectCell = (rowIndex: number, columnIndex: number, column: string, value: unknown) => setSelectedCell({ address: `${columnName(columnIndex + 1)}${(pageNumber - 1) * 50 + rowIndex + 1}`, field: display(column), value: formatCell(value) });
  const totalRows = result?.page.totalRows || 0;
  const firstRow = totalRows ? (pageNumber - 1) * 50 + 1 : 0;
  const lastRow = Math.min(pageNumber * 50, totalRows);
  return <main><Heading eyebrow="数据" title="PA 使用的数据" copy="PA 用这些工作表整理收到的资料、任务结果和发布记录。" action={<div className="sheet-stats"><div><span>管理</span><strong>PA 托管</strong></div><div><span>工作表</span><strong>{objects.length}</strong></div><div><span>权限</span><strong>只读</strong></div></div>} />
    <div className="sheet"><header className="sheet-ribbon"><div className="sheet-name"><strong>{objectMeta?.displayName || objectName || "数据"}</strong><span>{objectMeta?.description || "本机工作区数据"}</span></div><span className="sheet-count">{result ? `${rows.length} / ${totalRows} 行` : "正在读取"}</span></header><div className="sheet-formula"><b>{selectedCell.address}</b><i>fx</i><span><code>{selectedCell.field}</code>　{selectedCell.value}</span></div><div className="sheet-scroll" role="region" aria-label="可横向滚动的数据表" tabIndex={0}><table className="sheet-table"><thead><tr><th className="rownum">#</th>{(result?.columns || []).map((column) => <th key={column}><button className={`sheet-column-button${filters[column] ? " is-filtered" : ""}`} type="button" aria-expanded={menuColumn === column} onClick={() => openColumnMenu(column)}><span>{display(column)}</span><i>{sort?.column === column ? sort.direction === "asc" ? "↑" : "↓" : "⌄"}</i></button></th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td className="rownum">{firstRow + index}</td>{(result?.columns || []).map((column, columnIndex) => <td className={selectedCell.address === `${columnName(columnIndex + 1)}${firstRow + index}` ? "selected" : ""} title={formatCell(row[column])} onClick={() => selectCell(index, columnIndex, column, row[column])} key={column}>{formatCell(row[column])}</td>)}</tr>)}{result && !rows.length ? <tr><td className="sheet-empty" colSpan={(result.columns?.length || 0) + 1}>当前筛选没有结果</td></tr> : null}</tbody></table></div><div className="sheet-column-menu" hidden={!menuColumn}><header><strong>{menuColumn ? display(menuColumn) : "列"}</strong><button type="button" aria-label="关闭列菜单" onClick={() => setMenuColumn("")}>×</button></header><button type="button" onClick={() => { setSort({ column: menuColumn, direction: "asc" }); setPageNumber(1); setMenuColumn(""); }}>↑ 升序排列</button><button type="button" onClick={() => { setSort({ column: menuColumn, direction: "desc" }); setPageNumber(1); setMenuColumn(""); }}>↓ 降序排列</button><label><span>筛选这一列</span><input type="search" placeholder="输入要查找的内容" value={filterDraft} onChange={(event) => setFilterDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setMenuColumn(""); if (event.key === "Enter") { setFilters((current) => ({ ...current, [menuColumn]: filterDraft.trim() })); setPageNumber(1); setMenuColumn(""); } }} /></label><footer><button type="button" onClick={() => { setFilters((current) => { const next = { ...current }; delete next[menuColumn]; return next; }); setFilterDraft(""); setPageNumber(1); setMenuColumn(""); }}>清除筛选</button><button type="button" className="primary" onClick={() => { setFilters((current) => ({ ...current, [menuColumn]: filterDraft.trim() })); setPageNumber(1); setMenuColumn(""); }}>应用</button></footer></div><footer className="sheet-bottom"><div className="sheet-tabs" role="tablist" aria-label="切换工作表">{objects.slice(0, 4).map((item) => <button className={item.name === objectName ? "active" : ""} type="button" role="tab" aria-selected={item.name === objectName} onClick={() => changeObject(item.name)} key={item.name}>{metadata.find((entry) => entry.objectName === item.name && !entry.fieldName)?.displayName || item.name}</button>)}{objects.length > 4 ? <span className="sheet-more-count">另有 {objects.length - 4} 个工作表</span> : null}</div><Pager page={pageNumber} totalPages={result?.page.totalPages || 1} totalRows={totalRows} pageSize={50} onPage={setPageNumber} compact /></footer></div>
  </main>;
}
