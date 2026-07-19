import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  bridgeInvalidResponseError,
  bridgeResponseError,
  bridgeTransportError,
  controlApiErrorResponse,
} from "../core/control/api-errors.ts";

test("Control API preserves readable Agent errors as JSON", () => {
  const upstream = bridgeResponseError(400, JSON.stringify({
    ok: false,
    error: { code: "INVALID_DAILY_TOKEN_LIMIT", message: "每日 Token 限额无效" },
  }));
  const failure = controlApiErrorResponse(upstream);
  assert.equal(failure.statusCode, 400);
  assert.deepEqual(failure.payload, {
    ok: false,
    error: { code: "INVALID_DAILY_TOKEN_LIMIT", message: "每日 Token 限额无效" },
  });
});

test("Control API converts malformed and unavailable service responses into readable JSON", () => {
  assert.deepEqual(controlApiErrorResponse(new SyntaxError("private parser detail")), {
    statusCode: 400,
    payload: { ok: false, error: { code: "INVALID_JSON", message: "请求内容不是有效的 JSON，请刷新页面后重试" } },
  });
  assert.equal(controlApiErrorResponse(bridgeInvalidResponseError()).statusCode, 502);
  assert.equal(controlApiErrorResponse(bridgeTransportError(new Error("private socket detail"))).statusCode, 503);
  const unknown = controlApiErrorResponse(new Error("private implementation detail"));
  assert.equal(unknown.payload.error.code, "CONTROL_REQUEST_FAILED");
  assert.doesNotMatch(unknown.payload.error.message, /private/);
});

test("Control server sends API exceptions through the JSON error contract", () => {
  const source = fs.readFileSync(new URL("../core/control/server.ts", import.meta.url), "utf8");
  assert.match(source, /startsWith\('\/api\/'\)/);
  assert.match(source, /controlApiErrorResponse\(error\)/);
  assert.match(source, /sendJsonStatus\(response, failure\.statusCode, failure\.payload/);
});
