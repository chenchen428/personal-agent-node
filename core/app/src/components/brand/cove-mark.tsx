import React from "react";

/** Original Cove artwork shared by the desktop and mobile product surfaces. */
export function CoveMark({ className = "", title }: { className?: string; title?: string }) {
  return <svg className={`cove-mark ${className}`} viewBox="0 0 64 64" fill="none" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
    <path d="M51 15C43 6 27 6 17 14C6 23 6 39 15 49C24 59 40 58 51 48L41 37C36 42 29 43 24 39C19 35 20 28 25 24C30 20 37 21 41 26L51 15Z" fill="currentColor" />
    <path d="M46 29L56 24L53 35L46 29Z" fill="currentColor" />
  </svg>;
}
