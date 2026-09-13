import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { recurrenceLabel, executionHref, planHref } from "../core/app/src/components/plans/format.ts";
import { calendarContext } from "../core/app/src/components/calendar/view.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("legacy plan links preserve series identity while occurrence links preserve occurrence identity", () => {
  for (const prefix of ["/app", "/app/mobile"]) {
    for (const oldRoute of ["plans", "schedules"]) {
      assert.deepEqual(calendarContext(`${prefix}/workers/${oldRoute}`, new URLSearchParams("id=cal%20%40%2F1")), { planId: "cal @/1", selectedId: null });
    }
    const current = new URL(planHref("cal @/1", prefix.includes("mobile")), "https://fixture.invalid");
    assert.deepEqual(calendarContext(current.pathname, current.searchParams), { planId: "cal @/1", selectedId: null });
    assert.deepEqual(calendarContext(`${prefix}/workers/calendar`, new URLSearchParams("id=occ_42&planId=cal_7")), { planId: "cal_7", selectedId: "occ_42" });
  }
});

test("calendar and execution share the same header before their content states", () => {
  for (const directory of ["desktop-v627", "mobile-current"]) {
    const calendar = read(`core/app/src/components/${directory}/calendar-page.tsx`);
    const workers = read(`core/app/src/components/${directory}/${directory === "desktop-v627" ? "workers-page" : "workers"}.tsx`);
    assert.match(calendar, /CalendarModuleHeader active="calendar"/);
    assert.match(workers, /CalendarModuleHeader active="tasks"/);
    assert.ok(calendar.indexOf("<CalendarModuleHeader") < calendar.indexOf("calendar.error"));
    assert.doesNotMatch(read(`core/app/src/components/${directory}/plans-page.tsx`), /PlanList|usePlans|TaskModuleViewNavigation/);
  }
  const header = read("core/app/src/components/calendar/module-header.tsx");
  assert.match(header, /PageHeader title="日程" description=\{calendarModuleDescription\}/);
  assert.ok(header.indexOf("<TaskModuleViewNavigation") < header.indexOf("<CalendarUpcomingSummary"));
  assert.match(read("core/app/src/components/desktop-v627/calendar-page.tsx"), /calendar\.planId \? <PlanDetail/);
  assert.match(read("core/app/src/components/mobile-current/calendar-page.tsx"), /calendar\.planId && !calendar\.selectedId \? <PlanDetail/);
});

test("recurrence wording and deep links preserve plan and execution identity", () => {
  assert.equal(recurrenceLabel(null), "单次安排");
  assert.equal(recurrenceLabel({ frequency: "weekly", interval: 2, weekdays: [1, 5], count: 6 }), "每 2 周 · 周一、周五 · 共 6 次");
  assert.equal(recurrenceLabel({ frequency: "cron", expression: "0 9 * * 1" }), "每周一 09:00");
  assert.equal(planHref("cal @/1", true), "/app/mobile/workers/calendar?planId=cal%20%40%2F1");
  assert.equal(executionHref("run /1"), "/app/workers?task=run%20%2F1");
  assert.equal(executionHref("run /1", true), "/app/mobile/workers/run%20%2F1");
});

test("both clients own one calendar menu and two views with compatible old links", () => {
  const navigation = read("core/app/src/components/navigation.ts");
  assert.equal((navigation.match(/label: "日程"/g) || []).length, 2);
  assert.doesNotMatch(navigation, /label: "任务"|workers\/plans/);
  for (const prefix of ["", "mobile/"]) {
    for (const [route, component] of [["plans", "plans-page"], ["calendar", "calendar-page"]]) {
      assert.match(read(`core/app/src/app/app/${prefix}workers/${route}/page.tsx`), new RegExp(component));
    }
  }
  assert.match(read("core/app/src/components/mobile-current/shell.tsx"), /section === "workers" \|\| section === "calendar"/);
  for (const directory of ["desktop-v627", "mobile-current"]) {
    const source = read(`core/app/src/components/${directory}/calendar-page.tsx`);
    assert.match(source, /各计划下一次/);
    const toolbar = source.slice(source.indexOf('className="' + (directory === "desktop-v627" ? "cove" : "mobile") + '-calendar-toolbar"'));
    assert.ok(toolbar.indexOf(directory === "desktop-v627" ? "SegmentedControl" : "查看时间范围") < toolbar.indexOf("calendar-date-slot"));
  }
  assert.match(read("core/app/src/components/desktop-v627/scheduled-tasks-page.tsx"), /<PlansPage/);
  assert.match(read("core/app/src/components/desktop-v627/task-conversation.tsx"), /planHref\(session.metadata.planId\)/);
  assert.match(read("core/app/src/components/mobile-current/mobile-task-detail.tsx"), /planHref\(history.task.metadata.planId, true\)/);
  const writes = fs.readdirSync(path.join(root, "core/app/src/components/plans")).map(name => read(`core/app/src/components/plans/${name}`)).join("\n");
  assert.doesNotMatch(writes, /method:\s*["'](?:POST|PATCH|DELETE)/);
});

test("plan rows and navigation render real next dates, repeat modes, errors, and distinct routes", async () => {
  const compiled = await build({ absWorkingDir: root, tsconfig: "core/app/tsconfig.json", platform: "node", format: "cjs", bundle: true, write: false,
    stdin: { resolveDir: root, contents: `
      import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {PlanList} from './core/app/src/components/plans/plan-list';
      import {TaskModuleViewNavigation} from './core/app/src/components/desktop-v627/task-module-view-navigation';
      const plan={id:'cal-fixture',title:'每周例会',participants:[],startAt:'2027-01-04T01:00:00Z',timeZone:'Asia/Shanghai',status:'planned',enabled:true,recurrence:{frequency:'weekly',weekdays:[1]},executionMode:'remind',nextOccurrenceAt:'2027-01-04T01:00:00Z',latestRun:{status:'failed',occurrenceAt:'2026-12-28T01:00:00Z'}};
      const base={value:{items:[plan],total:1},loading:false,error:'',staleError:'',selectedId:'cal-fixture',onSelect(){},onRetry(){}};
      export const result={row:renderToStaticMarkup(React.createElement(PlanList,base)),
        empty:renderToStaticMarkup(React.createElement(PlanList,{...base,value:{items:[],total:0}})),
        error:renderToStaticMarkup(React.createElement(PlanList,{...base,value:null,error:'读取失败'})),
        loading:renderToStaticMarkup(React.createElement(PlanList,{...base,value:null,loading:true})),
        desktop:renderToStaticMarkup(React.createElement(TaskModuleViewNavigation,{active:'calendar'})),
        mobile:renderToStaticMarkup(React.createElement(TaskModuleViewNavigation,{active:'calendar',mobile:true}))};
    ` }, plugins: [{ name: "static-link", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, ({ path }) => ({ path, namespace: "static-link" }));
      builder.onLoad({ filter: /.*/, namespace: "static-link" }, () => ({ contents: "import React from 'react'; export default function Link({children,...props}){return React.createElement('a',props,children)}", resolveDir: root }));
    } }],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const result = module.exports.result;
  assert.match(result.row, /每周.*周一/); assert.match(result.row, /提醒本人/); assert.match(result.row, /2027.*1.*4.*09:00/);
  assert.match(result.row, /执行失败/); assert.match(result.row, /aria-pressed="true"/);
  assert.match(result.error, /role="alert".*读取失败/); assert.doesNotMatch(result.error, /暂无符合条件/);
  assert.match(result.empty, /暂无符合条件的计划/); assert.match(result.loading, /role="status"/);
  assert.match(result.desktop, /href="\/app\/workers\/calendar" aria-current="page"/);
  assert.match(result.mobile, /href="\/app\/mobile\/workers\/calendar" aria-current="page"/);
  assert.match(result.mobile, /href="\/app\/mobile\/workers"/);
  assert.equal((result.desktop.match(/<a /g) || []).length, 2);
  assert.equal((result.mobile.match(/<a /g) || []).length, 2);
  assert.doesNotMatch(result.desktop + result.mobile, />计划<|\/workers\/plans/);
});
