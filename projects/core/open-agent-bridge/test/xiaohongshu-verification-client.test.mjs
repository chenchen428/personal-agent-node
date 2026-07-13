import assert from "node:assert/strict";
import test from "node:test";
import {
  VerificationCapabilityUnavailableError,
  XiaohongshuVerificationClient,
} from "../src/channels/xiaohongshu/verification-client.js";

test("verification client capability-gates the upstream MCP tool", async () => {
  let closed = false;
  const client = new XiaohongshuVerificationClient({
    connect: async (endpoint) => {
      assert.equal(endpoint.toString(), "http://127.0.0.1:18060/mcp");
      return {
        client: { listTools: async () => ({ tools: [{ name: "check_login_status" }] }) },
        close: async () => { closed = true; },
      };
    },
  });
  await assert.rejects(() => client.submit("123456"), VerificationCapabilityUnavailableError);
  assert.equal(closed, true);
});

test("verification client submits the code without returning upstream content", async () => {
  let call;
  const client = new XiaohongshuVerificationClient({
    connect: async () => ({
      client: {
        listTools: async () => ({ tools: [{ name: "submit_login_verification_code" }] }),
        callTool: async (input) => {
          call = input;
          return { isError: false, content: [{ type: "text", text: "sensitive upstream response" }] };
        },
      },
      close: async () => {},
    }),
  });
  assert.deepEqual(await client.submit("123456"), { ok: true, submitted: true });
  assert.deepEqual(call, { name: "submit_login_verification_code", arguments: { code: "123456" } });
});
