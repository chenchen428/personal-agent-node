import assert from "node:assert/strict";
import test from "node:test";
import { createGeneratedPageThumbnails } from "../src/online-pages/generated-page-thumbnails.js";
import { decodePageThumbnail } from "../src/online-pages/page-thumbnail.js";

test("generates distinct valid desktop and mobile gallery previews without a browser", async () => {
  const generated = await createGeneratedPageThumbnails({
    title: "装修设计交付",
    summary: "由注册模板生成，视觉与交互效果等待用户验收。",
    templateId: "interior-design-delivery",
  });
  const desktop = decodePageThumbnail({
    fileName: "desktop.png",
    content: generated.desktop.toString("base64"),
  }, { variant: "desktop" });
  const mobile = decodePageThumbnail({
    fileName: "mobile.png",
    content: generated.mobile.toString("base64"),
  }, { variant: "mobile" });
  assert.deepEqual([desktop.width, desktop.height], [1200, 750]);
  assert.deepEqual([mobile.width, mobile.height], [750, 1200]);
  assert.equal(generated.desktop.equals(generated.mobile), false);
});
