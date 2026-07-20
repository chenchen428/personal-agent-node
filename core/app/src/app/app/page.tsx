import { headers } from "next/headers";
import { OverviewPage as DesktopOverview } from "@/components/desktop-v627/overview-page";
import { MobileActivity } from "@/components/mobile-current/activity";
import { detectRequestSurface } from "@/lib/request-surface";

export default async function OverviewPage() {
  const requestHeaders = await headers();
  if (detectRequestSurface(requestHeaders) === "mobile") return <MobileActivity />;
  return <DesktopOverview />;
}
