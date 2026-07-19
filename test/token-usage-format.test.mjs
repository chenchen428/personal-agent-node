import assert from "node:assert/strict";
import test from "node:test";
import { formatCompactTokenCount } from "../core/app/src/components/token-usage/format.ts";

test("Token usage formats thousands, millions and yi with K, M and B", () => {
  assert.equal(formatCompactTokenCount(1_200), "1.2K");
  assert.equal(formatCompactTokenCount(2_500_000), "2.5M");
  assert.equal(formatCompactTokenCount(100_000_000), "1B");
  assert.equal(formatCompactTokenCount(268_000_000), "2.7B");
});
