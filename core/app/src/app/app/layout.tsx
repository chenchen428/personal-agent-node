import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function ProductLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
