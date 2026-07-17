import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Search } from "lucide-react";

export function PageSurface({ children, className = "", width = "normal" }: { children: ReactNode; className?: string; width?: "normal" | "wide" | "flush" }) {
  return <main className={`page${width === "wide" ? " wide" : width === "flush" ? " flush" : ""}${className ? ` ${className}` : ""}`}>{children}</main>;
}

export function PageHeader({ title, description, eyebrow, actions }: { title: string; description?: string; eyebrow?: string; actions?: ReactNode }) {
  return <header className="page-header"><div className="page-title">{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="page-actions">{actions}</div> : null}</header>;
}

export function Button({ variant = "default", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger" }) {
  return <button className={`button${variant !== "default" ? ` ${variant}` : ""}${className ? ` ${className}` : ""}`} {...props} />;
}

export function Badge({ tone, children, className = "" }: { tone?: "success" | "warning" | "danger" | "info"; children: ReactNode; className?: string }) {
  return <span className={`badge${tone ? ` ${tone}` : ""}${className ? ` ${className}` : ""}`}>{children}</span>;
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLElement>) { return <section className={`card${className ? ` ${className}` : ""}`} {...props} />; }

export function SearchField(props: InputHTMLAttributes<HTMLInputElement>) {
  return <label className="search-field"><Search aria-hidden="true" /><input type="search" {...props} /></label>;
}

export function SegmentedControl({ value, options, onChange }: { value: string; options: { label: string; value: string }[]; onChange: (value: string) => void }) {
  return <div className="segmented" role="group">{options.map((option) => <button className={option.value === value ? "active" : ""} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)} key={option.value}>{option.label}</button>)}</div>;
}

export function DetailHeader({ title, meta, trailing }: { title: string; meta?: string; trailing?: ReactNode }) {
  return <header className="detail-head"><div><h1>{title}</h1>{meta ? <p>{meta}</p> : null}</div>{trailing}</header>;
}

export function KeyValueGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <div className="kv-grid">{items.map((item) => <div className="kv" key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>;
}

export function SettingRow({ title, description, control }: { title: string; description: string; control: ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div>{control}</div>;
}
