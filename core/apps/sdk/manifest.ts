import { z } from "zod";

export const PERSONAL_APP_API_VERSION = "personal-agent/app-v1" as const;
export const PERSONAL_APP_MANIFEST = "personal-agent.app.json" as const;
export const SUPPORTED_NODE_API_MAJORS = Object.freeze(["1"]);

const appId = z.string()
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
  .max(96);

const safeHtmlEntry = z.string()
  .min(1)
  .max(240)
  .refine((value) => !value.includes("\\") && !value.startsWith("/") && !value.split("/").includes(".."), "entry must stay inside the App directory")
  .refine((value) => value.toLowerCase().endsWith(".html"), "entry must be an HTML file");

export const personalAgentAppManifest = z.object({
  apiVersion: z.literal(PERSONAL_APP_API_VERSION),
  id: appId,
  name: z.string().min(1).max(80),
  entry: safeHtmlEntry,
  requires: z.object({ nodeApi: z.string().regex(/^\d+$/) }).strict(),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).optional(),
  description: z.string().max(280).optional(),
  icon: z.string().min(1).max(240).optional(),
}).strict();

export type PersonalAgentAppManifest = z.infer<typeof personalAgentAppManifest>;

export function parsePersonalAppManifest(value: unknown): PersonalAgentAppManifest {
  return personalAgentAppManifest.parse(value);
}
