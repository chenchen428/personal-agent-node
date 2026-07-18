import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityTargetPreview } from "../src/activity/presentation.js";

test("Page Activity uses the stored mobile thumbnail as representative media", () => {
  const preview = buildActivityTargetPreview({ type: "page", id: "page-report" }, [{
    id: "page-report",
    title: "调研报告",
    thumbnailUrl: "/pages/report/fallback.png",
    thumbnailAlt: "报告预览",
    desktopThumbnailUrl: "/pages/report/desktop.png",
    desktopThumbnailAlt: "报告桌面预览",
    mobileThumbnailUrl: "/pages/report/mobile.png",
    mobileThumbnailAlt: "报告移动端预览",
  }]);

  assert.deepEqual(preview, {
    kind: "image",
    url: "/pages/report/mobile.png",
    alt: "报告移动端预览",
  });
});

test("Activity target preview stays empty for unrelated or missing targets", () => {
  assert.equal(buildActivityTargetPreview({ type: "work", id: "task-1" }, []), null);
  assert.equal(buildActivityTargetPreview({ type: "page", id: "missing" }, []), null);
  assert.equal(buildActivityTargetPreview(null, []), null);
});
