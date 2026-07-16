import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OverviewPage as DesktopOverview } from "@/components/desktop-v627/overview-page";

export default async function OverviewPage() {
  const requestHeaders = await headers();
  const userAgent = requestHeaders.get("user-agent") || "";
  const clientHintMobile = requestHeaders.get("sec-ch-ua-mobile") === "?1";
  if (clientHintMobile || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) redirect("/app/mobile");
  return <DesktopOverview />;
}
