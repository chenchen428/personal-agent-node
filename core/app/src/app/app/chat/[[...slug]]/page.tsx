import { redirect } from "next/navigation";

export default function LegacyChatPage() {
  redirect("/app/conversations");
}
