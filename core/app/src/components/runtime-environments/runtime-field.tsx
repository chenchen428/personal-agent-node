import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function RuntimeField({ title, hint, htmlFor, children }: {
  title: string; hint?: string; htmlFor?: string; children: ReactNode;
}) {
  return <div className="runtime-form-row">
    <div className="runtime-field-copy">
      {htmlFor ? <label htmlFor={htmlFor}>{title}</label> : <strong>{title}</strong>}
      {hint ? <p>{hint}</p> : null}
    </div>
    <div className="runtime-field-control">{children}</div>
  </div>;
}

export function RuntimeSelect({ id, value, onChange, options, disabled }: {
  id: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return <Select value={value || "__default__"} onValueChange={(next) => onChange(next === "__default__" ? "" : next)} disabled={disabled}>
    <SelectTrigger id={id} className="runtime-select"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem key={option.value || "__default__"} value={option.value || "__default__"}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
