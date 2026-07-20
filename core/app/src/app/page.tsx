import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isMobileRequest } from "@/lib/request-device";

export default async function Home() {
  redirect(isMobileRequest(await headers()) ? "/app/mobile" : "/app");
}
