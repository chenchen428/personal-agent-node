import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OverviewPage as DesktopOverview } from "@/components/desktop-v627/overview-page";
import { isMobileRequest } from "@/lib/request-device";

export default async function OverviewPage() {
  if (isMobileRequest(await headers())) redirect("/app/mobile");
  return <DesktopOverview />;
}
