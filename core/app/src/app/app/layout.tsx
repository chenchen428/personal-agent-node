import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { isMobileRequest } from "@/lib/request-device";

export default async function ProductLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell initialMobileHint={isMobileRequest(await headers())}>{children}</AppShell>;
}
