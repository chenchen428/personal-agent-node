import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listUploadedAssets, uploadStaticAsset } from "./upload.js";

export function createOnlinePagesMcpServer() {
  const server = new McpServer({
    name: "open-agent-bridge-online-pages",
    version: "1.0.0",
  });

  server.tool(
    "upload_static_asset",
    "Upload a static asset and return a public sharing URL under pages.personal-agent.local.",
    {
      fileName: z.string().min(1).describe("File name, for example index.html, diagram.svg, or style.css."),
      content: z.string().describe("File content. Use UTF-8 text by default, or base64 for binary files."),
      encoding: z.enum(["utf8", "base64"]).default("utf8").describe("Content encoding."),
      folder: z.string().optional().describe("Optional upload folder under /uploads. Defaults to today's yyyy-mm-dd folder."),
      mimeType: z.string().optional().describe("Optional MIME type override."),
      overwrite: z.boolean().default(false).describe("Overwrite an existing file instead of creating a numbered copy."),
    },
    async (input) => {
      const result = await uploadStaticAsset(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );

  server.tool(
    "list_uploaded_assets",
    "List recently uploaded static assets with public URLs.",
    {
      limit: z.number().int().min(1).max(200).default(50).describe("Maximum number of assets to return."),
    },
    async ({ limit }) => {
      const result = await listUploadedAssets(limit);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: { assets: result },
      };
    },
  );

  return server;
}
