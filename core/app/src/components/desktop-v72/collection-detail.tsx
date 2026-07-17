import type { ReactNode } from "react";
import { SearchField } from "./primitives";

export type CollectionItem = { id: string; title: string; summary: string; time?: string; leading?: ReactNode; tone?: "success" | "warning" | "danger" | "info" };

export function CollectionDetail({ title, items, selectedId, onSelect, detail, listLabel, toolbarContent, search }: { title: string; items: CollectionItem[]; selectedId: string; onSelect: (id: string) => void; detail: ReactNode; listLabel?: ReactNode; toolbarContent?: ReactNode; search?: { value: string; placeholder: string; onChange: (value: string) => void } }) {
  return <main className="page flush"><div className="split-view">
    <aside className="split-list"><div className="split-toolbar"><h1>{title}</h1>{search ? <SearchField value={search.value} placeholder={search.placeholder} onChange={(event) => search.onChange(event.target.value)} /> : toolbarContent}</div>{listLabel ? <div className="list-section-label">{listLabel}</div> : null}<div>{items.map((item) => <button className={`select-row${item.tone ? ` tone-${item.tone}` : ""}${item.id === selectedId ? " selected" : ""}`} type="button" onClick={() => onSelect(item.id)} key={item.id}>{item.leading}<span className="select-row-body"><span className="select-row-line"><strong>{item.title}</strong>{item.time ? <time>{item.time}</time> : null}</span><p>{item.summary}</p></span></button>)}</div></aside>
    <section className="split-detail">{detail}</section>
  </div></main>;
}
