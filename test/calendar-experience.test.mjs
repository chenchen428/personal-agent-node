import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calendarLink, calendarSearch } from "../core/app/src/components/calendar/view.ts";
import { CalendarUpcomingSummary } from "../core/app/src/components/calendar/upcoming-summary.tsx";

test("calendar defaults to upcoming without a date horizon and preserves linked poster ranges", () => {
  const view = calendarLink(new URLSearchParams(), new Date("2026-09-13T00:00:00Z"));
  assert.equal(view.period, "upcoming");
  const search = calendarSearch({ ...view, query: "", status: "all", offset: 50 });
  assert.equal(search.get("view"), "upcoming");
  assert.equal(search.get("from"), null);
  assert.equal(search.get("to"), null);
  assert.equal(search.get("offset"), "50");
  const link = new URLSearchParams({ from: "2026-09-28T05:30:00+08:00", to: "2026-10-15T18:00:00+08:00", id: "cal_fixture", query: "会议", status: "planned" });
  const linked = calendarLink(link);
  assert.equal(linked.period, "day");
  const precise = calendarSearch({ ...linked, query: "会议", status: "planned", offset: 0 });
  assert.equal(precise.get("from"), "2026-09-27T21:30:00.000Z");
  assert.equal(precise.get("to"), "2026-10-15T10:00:00.000Z");
  assert.equal(precise.get("status"), "planned");
  assert.equal(precise.get("view"), null);
  for (const [period, days] of [["day", 1], ["week", 7]]) {
    const scoped = calendarSearch({ ...view, period, linkedRange: null, query: "", status: "all", offset: 0 });
    const from = new Date(scoped.get("from")), to = new Date(scoped.get("to"));
    const expected = new Date(from); expected.setDate(expected.getDate() + days);
    assert.equal(to.getTime(), expected.getTime());
  }
  assert.equal(calendarLink(new URLSearchParams("from=invalid&to=invalid")).period, "upcoming");
  assert.equal(calendarLink(new URLSearchParams("status=done")).period, "day");
});

const entry = { id: "cal_future", title: "公开测试安排", startAt: "2027-01-02T01:30:00.000Z", timeZone: "Asia/Shanghai", participants: ["测试人"] };
const render = (patch = {}) => renderToStaticMarkup(React.createElement(CalendarUpcomingSummary, {
  value: { nextEntry: entry, ongoingEntry: null }, loading: false, error: "", staleError: "", onSelect() {}, onRetry() {}, ...patch,
}));

test("shared upcoming summary states next date with year and timezone and distinguishes ongoing work", () => {
  const html = render({ value: { nextEntry: entry, ongoingEntry: { ...entry, id: "cal_ongoing", title: "进行中测试安排" } } });
  assert.match(html, /下一次日程/);
  assert.match(html, /进行中的安排/);
  assert.match(html, /2027.*1.*2.*09:30.*Asia\/Shanghai/);
  assert.match(html, /datetime="2027-01-02T01:30:00.000Z"/i);
  assert.match(render({ value: { nextEntry: null, ongoingEntry: null } }), /暂无即将到来的日程/);
  assert.match(render({ value: { nextEntry: null, ongoingEntry: entry } }), /之后暂时没有新的日程/);
  const failed = render({ value: null, error: "查询失败" });
  assert.match(failed, /暂时无法确认最近的日程/);
  assert.doesNotMatch(failed, /暂无即将到来的日程/);
  assert.match(render({ staleError: "离线" }), /上次查询结果/);
});
