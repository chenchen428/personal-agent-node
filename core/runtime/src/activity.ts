export async function requestActivity(config: any, capability: string, command: any) {
  const token = String(capability || "").trim();
  if (!token) throw activityCliError("MAIN_AGENT_REQUIRED", "Activity commands require the current main-Agent capability", 5);
  const response = await fetch(`http://127.0.0.1:${config.ports?.bridge || 8788}/api/internal/activity-agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-personal-agent-activity-capability": token,
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10_000),
  }).catch((error) => {
    throw activityCliError("DEPENDENCY_UNAVAILABLE", `Personal Agent Activity service is unavailable: ${error.message}`, 7);
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || body.ok !== true) {
    const code = response.status === 403 ? "MAIN_AGENT_REQUIRED" : String(body.code || "ACTIVITY_REQUEST_FAILED");
    throw activityCliError(code, String(body.error || `Activity request failed with HTTP ${response.status}`), response.status === 403 ? 5 : 7);
  }
  return body.result;
}

function activityCliError(code: string, message: string, exitCode: number) {
  return Object.assign(new Error(message), { code, exitCode });
}
