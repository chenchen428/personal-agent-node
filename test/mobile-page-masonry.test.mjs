import assert from "node:assert/strict";
import test from "node:test";
import { computeOrderedMasonryLayout } from "../core/app/src/components/mobile-current/page-masonry-layout.ts";

test("ordered page masonry alternates DOM items while preserving unequal column heights", () => {
  const layout = computeOrderedMasonryLayout([120, 80, 60, 140], 144, 12, 19);
  assert.deepEqual(layout.positions, [
    { x: 0, y: 0 },
    { x: 156, y: 0 },
    { x: 0, y: 139 },
    { x: 156, y: 99 },
  ]);
  assert.equal(layout.height, 239);
});

test("ordered page masonry handles empty and single-page layouts", () => {
  assert.deepEqual(computeOrderedMasonryLayout([], 144), { positions: [], height: 0 });
  assert.deepEqual(computeOrderedMasonryLayout([96], 144), { positions: [{ x: 0, y: 0 }], height: 96 });
});
