import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompactTokenCount } from "../core/app/src/components/token-usage/compact-token-count.tsx";
import { formatCompactTokenCount, TOKEN_UNIT_DETAILS } from "../core/app/src/components/token-usage/format.ts";

test("Token usage formats thousands through trillions with K, M, B and T", () => {
  assert.equal(formatCompactTokenCount(1_200), "1.2K");
  assert.equal(formatCompactTokenCount(2_500_000), "2.5M");
  assert.equal(formatCompactTokenCount(100_000_000), "100M");
  assert.equal(formatCompactTokenCount(999_999_999), "1,000M");
  assert.equal(formatCompactTokenCount(1_000_000_000), "1B");
  assert.equal(formatCompactTokenCount(2_680_000_000), "2.7B");
  assert.equal(formatCompactTokenCount(1_500_000_000_000), "1.5T");
});

test("compact Token units expose hover and accessible descriptions", () => {
  const markup = renderToStaticMarkup(createElement(CompactTokenCount, { value: 1_000_000_000 }));
  assert.match(markup, /^1<abbr/);
  assert.match(markup, /title="B（Billion）：十亿（10⁹）"/);
  assert.match(markup, /aria-label="B，Billion，十亿，10 的 9 次方"/);
  assert.equal(TOKEN_UNIT_DETAILS.T.description, "T（Trillion）：万亿（10¹²）");
});
