import { fetchJson } from "@/lib/client-json";

type Operation = { id: string; digest: string };

export async function runSetupAction(actionId: string, input: Record<string, unknown> = {}) {
  const post = (phase: string, body: object) => fetchJson<{ operation: Operation }>(`/api/system/setup/actions/${actionId}/${phase}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const planned = (await post("plan", { input })).operation;
  await post("approve", { operationId: planned.id, digest: planned.digest, approved: true });
  await post("execute", { operationId: planned.id, digest: planned.digest, input });
}
