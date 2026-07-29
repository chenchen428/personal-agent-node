import type { ReactNode } from "react";
import { SearchField } from "./primitives";

export type SettingsCollectionRow = {
  id: string;
  title: string;
  summary: string;
  time?: string;
  leading: ReactNode;
};

export function SettingsCollectionLayout({
  title,
  actions,
  rows,
  selectedId,
  onSelect,
  search,
  listLabel,
  detail,
}: {
  title: string;
  actions?: ReactNode;
  rows: SettingsCollectionRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  search: { value: string; placeholder: string; onChange: (value: string) => void };
  listLabel: string;
  detail: ReactNode;
}) {
  return <div className="settings-collection-page">
    <header className="settings-collection-header"><div><h1>{title}</h1>{actions}</div><SearchField value={search.value} onChange={(event) => search.onChange(event.target.value)} placeholder={search.placeholder} /></header>
    <div className="settings-collection-columns">
      <section className="settings-collection-list" aria-label={`${title}列表`}>
        <header><strong>{listLabel}</strong><span>{rows.length} 项</span></header>
        <div className="settings-collection-scroll">{rows.map((row) => <button className={row.id === selectedId ? "selected" : ""} type="button" aria-pressed={row.id === selectedId} onClick={() => onSelect(row.id)} key={row.id}>
          <span className="settings-collection-leading">{row.leading}</span>
          <span className="settings-collection-copy"><strong>{row.title}</strong><small>{row.summary}</small></span>
          {row.time ? <time>{row.time}</time> : null}
        </button>)}</div>
      </section>
      <article className="settings-collection-detail">{detail}</article>
    </div>
  </div>;
}
