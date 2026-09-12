import crypto from "node:crypto";
import sharp from "sharp";
import { createTypography, COLORS, imageOverlay, posterError, shape } from "./text.js";
import { createPosterQr } from "./qr.js";

const WIDTH = 1200;
const HEIGHT = 1600;
const TOP = 432;
const BOTTOM = 1268;
const STATUS = { planned: "待进行", in_progress: "进行中", done: "已完成", cancelled: "已取消" };
const date = (value, zone) => new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const time = (value, zone) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length > 500) throw posterError("POSTER_RANGE_TOO_LARGE", "请缩短日程范围，最多生成十张海报");
  const ids = new Set();
  for (const entry of entries) {
    if (!entry?.id || ids.has(entry.id) || !entry.title || !Array.isArray(entry.participants) || entry.participants.length > 100 || !STATUS[entry.status] || typeof entry.timeZone !== "string" || !entry.timeZone) throw posterError("POSTER_ENTRY_INVALID", "日程内容不完整");
    ids.add(entry.id);
    if (!Number.isFinite(Date.parse(entry.startAt)) || (entry.endAt && (!Number.isFinite(Date.parse(entry.endAt)) || Date.parse(entry.endAt) < Date.parse(entry.startAt)))) throw posterError("POSTER_ENTRY_INVALID", "日程时间无效");
    try { date(entry.startAt, entry.timeZone); } catch { throw posterError("POSTER_ENTRY_INVALID", "日程时区无效"); }
    if ([entry.title, ...entry.participants, entry.location || ""].some((value) => typeof value !== "string" || value.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))) throw posterError("POSTER_ENTRY_INVALID", "日程文字格式无效");
    if (entry.participants.some((value) => value.length > 120)) throw posterError("POSTER_ENTRY_INVALID", "参与人名称过长");
  }
  return [...entries].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || String(a.id).localeCompare(String(b.id)));
}

async function entryBlocks(entry, typography) {
  const zone = entry.timeZone;
  const startDate = date(entry.startAt, zone);
  const endDate = entry.endAt ? date(entry.endAt, zone) : "";
  const zoneLabel = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, timeZoneName: "long" }).formatToParts(new Date(entry.startAt)).find((part) => part.type === "timeZoneName")?.value || zone;
  const rail = [
    { text: startDate.replaceAll("-", "."), size: 26 },
    { text: time(entry.startAt, zone), size: 42 },
    ...(entry.endAt ? [{ text: endDate === startDate ? `— ${time(entry.endAt, zone)}` : `至 ${endDate.replaceAll("-", ".")}`, size: 26 }, ...(endDate !== startDate ? [{ text: time(entry.endAt, zone), size: 30 }] : [])] : []),
  ];
  const details = [];
  for (const [value, size, weight, color, field] of [
    [entry.title, 40, "Medium", COLORS.ink, "title"],
    [`参与人 · ${entry.participants.length ? entry.participants.join("、") : "未指定"}`, 28, "Regular", COLORS.muted, "participants"],
    [`${STATUS[entry.status]} · ${zoneLabel}`, 26, "Regular", COLORS.muted, "status"],
    ...(entry.location ? [[`地点 · ${entry.location}`, 26, "Regular", COLORS.muted, "location"]] : []),
  ]) {
    for (const line of await typography.lines(value, 752, size, color, weight)) details.push({ ...line, size, field, height: Math.max(line.info.height + 10, Math.ceil(size * 1.45)) });
  }
  const railLines = [];
  for (const line of rail) railLines.push({ ...line, ...(await typography.text(line.text, line.size, COLORS.ink)), height: Math.ceil(line.size * 1.4) });
  const railHeight = railLines.reduce((sum, line) => sum + line.height, 0);
  const fragments = [];
  let pending = [];
  let height = 0;
  for (const line of details) {
    if (height + line.height > BOTTOM - TOP - 62 && pending.length) {
      fragments.push({ entryId: entry.id, rail: railLines, lines: pending, height: Math.max(height, railHeight) + 46 });
      pending = []; height = 0;
    }
    pending.push(line); height += line.height;
  }
  if (pending.length) fragments.push({ entryId: entry.id, rail: railLines, lines: pending, height: Math.max(height, railHeight) + 46 });
  return fragments.map((fragment, index) => ({ ...fragment, continued: index > 0 }));
}

export async function layoutCalendarPosters({ entries, typography = createTypography() }) {
  const sorted = validateEntries(entries);
  const pages = [[]];
  let used = 0;
  for (const entry of sorted) {
    for (const block of await entryBlocks(entry, typography)) {
      if (used + block.height > BOTTOM - TOP && pages.at(-1).length) { pages.push([]); used = 0; }
      if (pages.length > 10) throw posterError("POSTER_RANGE_TOO_LARGE", "日程内容超过十张海报，请缩短日期范围后重试");
      pages.at(-1).push({ ...block, top: TOP + used });
      used += block.height;
    }
  }
  return { pages, entries: sorted };
}

export async function renderCalendarPosters({ entries, targetUrl, period = "day", startAt, endAt, timeZone = "Asia/Shanghai", title, fontPath } = {}) {
  if (!["day", "week"].includes(period)) throw posterError("POSTER_PERIOD_INVALID", "海报只支持日或周视图");
  if (!Number.isFinite(Date.parse(startAt)) || (endAt && (!Number.isFinite(Date.parse(endAt)) || Date.parse(endAt) < Date.parse(startAt)))) throw posterError("POSTER_RANGE_INVALID", "请提供有效的日程起止日期");
  try { date(startAt, timeZone); } catch { throw posterError("POSTER_RANGE_INVALID", "日程时区无效"); }
  const qr = await createPosterQr(targetUrl);
  const typography = createTypography({ fontPath });
  const layout = await layoutCalendarPosters({ entries, typography });
  const range = `${date(startAt, timeZone).replaceAll("-", ".")}${endAt && date(endAt, timeZone) !== date(startAt, timeZone) ? ` — ${date(endAt, timeZone).replaceAll("-", ".")}` : ""}`;
  const spanDays = endAt ? Math.round((Date.parse(date(endAt, timeZone)) - Date.parse(date(startAt, timeZone))) / 86400000) + 1 : 1;
  const heading = title || (period === "day" ? "日程手记" : spanDays === 7 ? "一周日程" : "日程总览");
  if (typeof heading !== "string" || [...heading].length > 24) throw posterError("POSTER_TITLE_TOO_LONG", "海报标题请控制在24字以内");
  const images = [];
  for (let index = 0; index < layout.pages.length; index += 1) {
    const blocks = layout.pages[index];
    const layers = [];
    const add = async (value, size, x, y, color = COLORS.ink, weight) => layers.push(imageOverlay(await typography.text(value, size, color, weight), x, y));
    const artwork = shape(`<rect width="1200" height="1600" fill="${COLORS.paper}"/>
      <path d="M0 0H1200V348C937 394 551 288 0 381Z" fill="${COLORS.glass}"/>
      <path d="M856 -60C715 28 708 179 835 257C969 340 1173 280 1244 166" fill="none" stroke="#C4D8CD" stroke-width="78"/>
      <path d="M82 82a18 18 0 1 0 0 28" fill="none" stroke="${COLORS.ink}" stroke-width="9" stroke-linecap="round"/>
      <line x1="80" y1="390" x2="1120" y2="390" stroke="${COLORS.rule}"/>
      <line x1="80" y1="1320" x2="1120" y2="1320" stroke="${COLORS.rule}"/>`);
    await add("Cove", 31, 107, 78, COLORS.ink, "Medium");
    await add(period === "day" ? "D A I L Y   N O T E S" : "T H E   W E E K   A H E A D", 18, 80, 141, COLORS.muted);
    const headingLines = await typography.lines(heading, 740, 66, COLORS.ink, "Medium");
    if (headingLines.length > 2) throw posterError("POSTER_TITLE_TOO_LONG", "海报标题过长，请使用更简洁的标题");
    for (const [lineIndex, line] of headingLines.entries()) layers.push(imageOverlay(line, 76, 195 + lineIndex * 77));
    await add(range, 26, 80, 341, COLORS.muted);
    const numeral = date(startAt, timeZone).slice(-2);
    await add(numeral, 198, 842, 145, COLORS.ink, "Thin");
    await add(`${layout.entries.length} 项安排`, 22, 962, 343, COLORS.muted);
    if (!blocks.length) {
      await add("留一点空白，给自己。", 44, 80, 658, COLORS.ink, "Medium");
      await add("这段时间还没有日程。", 29, 82, 741, COLORS.muted);
    }
    for (const block of blocks) {
      let y = block.top;
      for (const line of block.rail) { layers.push(imageOverlay(line, 80, y)); y += line.height; }
      y = block.top;
      for (const line of block.lines) { layers.push(imageOverlay(line, 352, y)); y += line.height; }
      if (block.continued) await add("续", 20, 298, block.top + 2, COLORS.muted);
      layers.push({ input: shape(`<line x1="80" y1="${block.top + block.height - 23}" x2="1120" y2="${block.top + block.height - 23}" stroke="${COLORS.rule}"/>`), left: 0, top: 0 });
    }
    await add("YOUR TIME, WELL KEPT.", 22, 80, 1380, COLORS.ink, "Medium");
    await add("扫码查看日程与最新进展", 26, 80, 1432, COLORS.muted);
    await add(`${String(index + 1).padStart(2, "0")} / ${String(layout.pages.length).padStart(2, "0")}`, 22, 80, 1510, COLORS.muted);
    const qrLeft = WIDTH - 80 - qr.width;
    const qrTop = HEIGHT - 64 - qr.height;
    layers.push({ input: qr.buffer, left: qrLeft, top: qrTop });
    const buffer = await sharp(artwork).composite(layers).png().toBuffer();
    images.push({ buffer, mimeType: "image/png", fileName: `cove-calendar-${date(startAt, timeZone)}-${String(index + 1).padStart(2, "0")}.png`, width: WIDTH, height: HEIGHT,
      sizeBytes: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      alt: `${heading}，${range}，第${index + 1}张，共${layout.pages.length}张`, entryIds: [...new Set(blocks.map((block) => block.entryId))], pageNumber: index + 1, pageCount: layout.pages.length,
      qr: { left: qrLeft, top: qrTop, width: qr.width, modules: qr.modules, modulePixels: qr.modulePixels, quietZoneModules: 4 },
    });
  }
  return { images, targetUrl: qr.targetUrl };
}
