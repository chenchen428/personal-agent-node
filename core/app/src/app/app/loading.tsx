import { headers } from "next/headers";
import { MobileContentSkeleton } from "@/components/mobile-current/skeletons";
import { LoadingState } from "@/components/desktop-v72/loading-state";
import { isMobileRequest } from "@/lib/request-device";

export default async function RouteLoading() {
  if (isMobileRequest(await headers())) return <MobileRouteLoading />;
  return <main className="page"><LoadingState label="正在打开页面" /></main>;
}

export function MobileRouteLoading() {
  return <div className="mobile-current"><div className="mobile-stage"><div className="phone">
    <header className="mobile-header"><div className="mobile-title"><strong>Personal Agent</strong><span>正在打开</span></div></header>
    <main className="mobile-screen"><MobileContentSkeleton kind="activity" /></main>
  </div></div></div>;
}
