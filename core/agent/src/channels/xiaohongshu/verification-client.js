import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TOOL_NAME = "submit_login_verification_code";

export class XiaohongshuVerificationClient {
  constructor({ baseUrl = "http://127.0.0.1:18060", connect = connectMcp } = {}) {
    this.endpoint = new URL("/mcp", `${String(baseUrl).replace(/\/+$/, "")}/`);
    this.connect = connect;
  }

  async submit(code) {
    const connection = await this.connect(this.endpoint);
    try {
      const result = await connection.client.listTools();
      if (!result.tools?.some((tool) => tool.name === TOOL_NAME)) {
        throw new VerificationCapabilityUnavailableError(
          "The installed Xiaohongshu runtime does not support verification-code submission.",
        );
      }
      const response = await connection.client.callTool({
        name: TOOL_NAME,
        arguments: { code: String(code) },
      });
      if (response.isError) {
        throw new XiaohongshuVerificationError("The Xiaohongshu runtime rejected the verification code.");
      }
      return { ok: true, submitted: true };
    } finally {
      await connection.close().catch(() => {});
    }
  }
}

export class VerificationCapabilityUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationCapabilityUnavailableError";
  }
}

export class XiaohongshuVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "XiaohongshuVerificationError";
  }
}

async function connectMcp(endpoint) {
  const client = new Client({ name: "open-agent-bridge", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(endpoint);
  await client.connect(transport);
  return {
    client,
    close: async () => client.close(),
  };
}
