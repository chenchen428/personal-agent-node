import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { renderCalendarPosters, renderPagePoster } from "../src/posters/index.js";
import { createTypography, imageOverlay, shape } from "../src/posters/text.js";

// Synthetic fixtures only. These reserved-domain QR targets test rendering and
// decoding; they are not live product links or an accepted customer delivery.
const targetUrl = "https://demo.example.com/app/mobile/calendar";
const outputRoot = path.resolve(process.argv[2] || ".local/poster-preview");
fs.mkdirSync(outputRoot, { recursive: true });
const entry = (id, title, startAt, endAt, participants, extra = {}) => ({ id, title, startAt, endAt, participants, timeZone: "Asia/Shanghai", status: "planned", ...extra });
const daily = [
  entry("demo_day_1", "把想法，变成下一步", "2026-09-12T01:30:00Z", "2026-09-12T02:15:00Z", ["林沐", "周可"], { status: "done", location: "工作室 · 圆桌" }),
  entry("demo_day_2", "Cove / 产品方向小结", "2026-09-12T06:00:00Z", "2026-09-12T07:00:00Z", ["林沐", "陈屿", "Alex"], { status: "in_progress" }),
  entry("demo_day_3", "跨时区同步 · Research review", "2026-09-12T15:30:00Z", "2026-09-12T17:15:00Z", ["周可", "Alex", "Maya"], { location: "线上会议" }),
];
const weekTitles = ["本周，从一次散步开始", "整理访谈里的真实需求", "Design review / 保留重要的部分", "阅读与安静的工作时间", "和朋友一起，准备周末晚餐", "把本周的收获写下来", "城市漫游 · 去看看新的风景"];
const weekly = weekTitles.map((title, index) => entry(`demo_week_${index}`, title, `2026-09-${String(14 + index).padStart(2, "0")}T02:00:00Z`, `2026-09-${String(14 + index).padStart(2, "0")}T03:00:00Z`, index % 2 ? ["林沐", "周可", "Alex"] : ["林沐"], { status: index === 1 ? "done" : index === 4 ? "cancelled" : "planned" }));
const dense = Array.from({ length: 12 }, (_, index) => entry(`demo_dense_${index}`, index % 3 === 0 ? "把长讨论变成清楚的行动：核对用户反馈、设计取舍与每位参与者的下一步安排" : `第${index + 1}项 · Planning & review`, `2026-09-${String(14 + Math.floor(index / 3)).padStart(2, "0")}T${String(1 + index % 3 * 3).padStart(2, "0")}:00:00Z`, null, ["林沐", "周可", "陈屿", "Alex", "Maya", "许青"], { location: index % 2 ? "线上会议" : "工作室 · 海湾会议桌" }));
const samples = [
  ["day", { entries: daily, period: "day", startAt: "2026-09-12T00:00:00Z" }],
  ["week", { entries: weekly, period: "week", startAt: "2026-09-14T00:00:00Z", endAt: "2026-09-20T15:59:59Z" }],
  ["dense", { entries: dense, period: "week", startAt: "2026-09-14T00:00:00Z", endAt: "2026-09-20T15:59:59Z" }],
];
const manifest = [];
for (const [name, input] of samples) {
  const result = await renderCalendarPosters({ ...input, targetUrl });
  for (const image of result.images) {
    const fileName = `${name}-${image.pageNumber}.png`;
    fs.writeFileSync(path.join(outputRoot, fileName), image.buffer);
    const { buffer: _buffer, ...metadata } = image;
    manifest.push({ ...metadata, fileName, targetUrl, synthetic: true });
  }
}
const typography = createTypography();
const pageLayers = [];
for (const [text, size, x, y, color, weight] of [
  ["FIELD NOTES / 012", 23, 82, 86, "#EADAC5"],
  ["慢一点", 108, 77, 215, "#F7EDDE", "Medium"],
  ["看见更多。", 108, 77, 365, "#F7EDDE", "Medium"],
  ["城市漫游手记", 35, 84, 586, "#EADAC5"],
  ["一条街，一次停留。", 30, 84, 666, "#EADAC5"],
  ["Cove", 29, 84, 1480, "#203D40", "Medium"],
]) pageLayers.push(imageOverlay(await typography.text(text, size, color, weight), x, y));
const original = await sharp(shape('<rect width="1200" height="1600" fill="#234449"/><circle cx="1010" cy="450" r="348" fill="#B87656"/><path d="M0 1130L690 680L1200 963V1600H0Z" fill="#D9C1A1"/><path d="M0 1330L578 933L766 1600H0Z" fill="#ACB3A0"/><path d="M840 1600V1090a125 125 0 0 1 250 0v510Z" fill="#234449"/>')).composite(pageLayers).png().toBuffer();
const pageUrl = "https://demo.example.com/app/mobile/pages/private-field-notes";
const page = await renderPagePoster({ image: original, targetUrl: pageUrl, pageId: "private-field-notes", pageVersion: "c".repeat(64) });
fs.writeFileSync(path.join(outputRoot, "page-poster.png"), page.buffer);
const { buffer: _buffer, ...pageMetadata } = page;
manifest.push({ ...pageMetadata, fileName: "page-poster.png", targetUrl: pageUrl, synthetic: true });
fs.writeFileSync(path.join(outputRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ outputRoot, images: manifest.length, synthetic: true }));
