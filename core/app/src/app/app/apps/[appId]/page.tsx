import { PersonalAppHost } from "@/components/personal-app-host";

export default async function PersonalAppPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  return <PersonalAppHost appId={decodeURIComponent(appId)} />;
}
