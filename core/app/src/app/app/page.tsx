import { headers } from "next/headers";
import { OverviewPage as DesktopOverview } from "@/components/desktop-v627/overview-page";
import { MobileActivity } from "@/components/mobile-current/activity";
import { isMobileRequest } from "@/lib/request-device";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  if (isMobileRequest(await headers())) return <MobileActivity />;
  return <DesktopOverview />;
}
