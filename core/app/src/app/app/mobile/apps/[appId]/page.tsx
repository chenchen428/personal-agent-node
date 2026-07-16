import { MobilePersonalApp } from "@/components/mobile-current/personal-app";

export default async function MobilePersonalAppPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  return <MobilePersonalApp appId={decodeURIComponent(appId)} />;
}
