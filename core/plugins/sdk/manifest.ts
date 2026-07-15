import { z } from "zod";

export const pluginPermission = z.enum([
  "workspace.files:read", "workspace.files:write", "workspace.data:read", "workspace.data:write",
  "network:read", "network:write", "agent:tool", "channel:receive", "channel:send", "schedule:run",
]);

const entrypoint = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]*$/), entry: z.string().regex(/^(?!\/)(?!.*\.\.)(?!.*\\).+\.(?:mjs|js)$/) }).strict();

export const personalAgentPluginManifest = z.object({
  apiVersion: z.literal("personal-agent/v1"),
  id: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/).max(96),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  compatibility: z.object({ core: z.string().min(1).max(64) }).strict(),
  permissions: z.array(pluginPermission).superRefine((values, context) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: "permissions must be unique" });
  }),
  contributes: z.object({
    navigation: z.array(z.object({ id: z.string(), label: z.string().min(1).max(40), slot: z.enum(["primary", "secondary", "settings"]), view: z.string() }).strict()).optional(),
    views: z.array(z.object({ id: z.string(), renderer: z.enum(["cards", "table", "document", "status"]), dataEndpoint: z.string().regex(/^\/api\/extensions\/[a-z0-9.-]+\//).optional() }).strict()).optional(),
    tools: z.array(entrypoint).optional(), workers: z.array(entrypoint).optional(), channels: z.array(entrypoint).optional(), schedules: z.array(entrypoint).optional(),
  }).strict(),
}).strict();

export type PersonalAgentPluginManifest = z.infer<typeof personalAgentPluginManifest>;

export function parsePluginManifest(value: unknown): PersonalAgentPluginManifest {
  return personalAgentPluginManifest.parse(value);
}
