import assert from "node:assert/strict";
import test from "node:test";
import { buildPageTemplateTask, formatTaskStatusReply, isTaskStatusRequest, matchPageTemplateRequest } from "../src/server/main-turn-routing.js";

test("matches an actionable renovation Page request to the built-in template", () => {
  const template = matchPageTemplateRequest("请立即开始制作一套 90 平方米二手房的可交互装修设计交付 Page");
  assert.equal(template?.id, "interior-design-delivery");
  assert.equal(template?.skill, "interior-design");

  const task = buildPageTemplateTask({ request: "制作装修设计 Page", template });
  assert.match(task, /interior-design-delivery/);
  assert.match(task, /interior-design/);
  assert.match(task, /fixedFramework/);
  assert.match(task, /agentInstructions/);
  assert.match(task, /personal-agent-page-template/);
  assert.match(task, /agentBrowserReview/);
  assert.match(task, /不要打开浏览器/);
  assert.match(task, /用户原始请求：\n制作装修设计 Page/);
});

test("keeps template discovery questions and task status questions on the main Agent", () => {
  assert.equal(matchPageTemplateRequest("装修设计 Page 有哪些模板？"), null);
  assert.equal(matchPageTemplateRequest("刚才的装修设计页面做到哪一步了？"), null);
  assert.equal(isTaskStatusRequest("现在做到哪一步了？请只返回刚才那个任务的当前状态。"), true);
});

test("formats child task states without internal worker terminology", () => {
  assert.equal(formatTaskStatusReply([]), "当前没有可报告的任务。");
  const reply = formatTaskStatusReply([
    { title: "装修设计交付页", status: "running", url: "https://agent.example.test/app/tasks/1" },
    { title: "旧任务", status: "idle", url: "" },
  ]);
  assert.match(reply, /装修设计交付页”当前状态：处理中/);
  assert.match(reply, /旧任务”当前状态：已完成/);
  assert.doesNotMatch(reply, /worker|子任务/i);
});
