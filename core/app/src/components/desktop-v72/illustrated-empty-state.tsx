import type { ReactNode } from "react";

type IllustratedEmptyStateProps = {
  variant: "data" | "pages";
  title: string;
  description: string;
  className?: string;
  children?: ReactNode;
};

export function IllustratedEmptyState({ variant, title, description, className = "", children }: IllustratedEmptyStateProps) {
  return <div className={`illustrated-empty-state ${className}`.trim()} role="status">
    {variant === "data" ? <DataIllustration /> : <PagesIllustration />}
    <strong>{title}</strong>
    <p>{description}</p>
    {children}
  </div>;
}

function DataIllustration() {
  return <svg viewBox="0 0 196 132" aria-hidden="true">
    <rect className="empty-fill" x="25" y="18" width="146" height="96" rx="14" />
    <path className="empty-line" d="M25 46h146M64 46v68M123 46v68" />
    <path className="empty-line faint" d="M25 69h146M25 92h98" />
    <circle className="empty-accent" cx="43" cy="32" r="4" />
    <path className="empty-accent-line" d="M136 92h35v22h-35zM144 103h19M153.5 94v18" />
  </svg>;
}

function PagesIllustration() {
  return <svg viewBox="0 0 196 132" aria-hidden="true">
    <path className="empty-fill" d="M43 28a12 12 0 0 1 12-12h75l23 23v69a12 12 0 0 1-12 12H55a12 12 0 0 1-12-12z" />
    <path className="empty-line" d="M130 16v23h23M65 58h66M65 75h52M65 92h38" />
    <path className="empty-accent-line" d="m150 74 3.4 7.6L161 85l-7.6 3.4L150 96l-3.4-7.6L139 85l7.6-3.4z" />
  </svg>;
}
