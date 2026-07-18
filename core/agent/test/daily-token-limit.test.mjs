import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  dailyTokenLimitError,
  dailyTokenLimitExceeded,
  dailyTokenLimitSettings,
  readDailyTokenLimit,
  writeDailyTokenLimit,
} from "../src/agent/daily-token-limit.ts";

test("daily Token limit defaults to unlimited and persists M units", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-token-limit-"));
  const target = path.join(root, "config", "daily-token-limit.json");
  try {
    assert.deepEqual(readDailyTokenLimit(target), dailyTokenLimitSettings(0));
    const saved = writeDailyTokenLimit(target, 1.25);
    assert.equal(saved.enabled, true);
    assert.equal(saved.dailyLimitMillions, 1.25);
    assert.equal(saved.dailyLimitTokens, 1_250_000);
    assert.deepEqual(readDailyTokenLimit(target), saved);
    assert.throws(() => writeDailyTokenLimit(target, -1), /0.*1,?000,?000|0.*1000000/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("daily Token limit blocks at the configured threshold and explains recovery", () => {
  const unlimited = dailyTokenLimitSettings(0);
  const limited = dailyTokenLimitSettings(2);
  assert.equal(dailyTokenLimitExceeded(unlimited, 99_000_000), false);
  assert.equal(dailyTokenLimitExceeded(limited, 1_999_999), false);
  assert.equal(dailyTokenLimitExceeded(limited, 2_000_000), true);
  const error = dailyTokenLimitError(limited, 2_100_000);
  assert.equal(error.code, "DAILY_TOKEN_LIMIT_EXCEEDED");
  assert.match(error.message, /2 M/);
  assert.match(error.message, /设为 0/);
  assert.match(error.message, /Asia\/Shanghai/);
});
