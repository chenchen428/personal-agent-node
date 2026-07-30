import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTaskCreate,
  normalizeTaskPatch,
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "../src/server/task-contract.js";

test("child tasks require concise Agent-generated title and description", () => {
  assert.deepEqual(normalizeTaskCreate({
    parentSessionId: "main-1",
    title: " 整理发布页 ",
    description: " 完成页面制作、发布和验证 ",
    task: "Read the workspace rules and finish the page.",
  }), {
    parentSessionId: "main-1",
    title: "整理发布页",
    description: "完成页面制作、发布和验证",
    task: "Read the workspace rules and finish the page.",
  });
  assert.throws(() => normalizeTaskCreate({ parentSessionId: "main-1", description: "说明", task: "work" }), /必须设置标题/);
  assert.throws(() => normalizeTaskCreate({ parentSessionId: "main-1", title: "标题", task: "work" }), /必须设置描述/);
  assert.throws(() => normalizeTaskCreate({ parentSessionId: "main-1", title: "标题", description: "说明" }), /必须设置执行内容/);
  assert.throws(() => normalizeTaskCreate({ parentSessionId: "main-1", title: "标".repeat(TASK_TITLE_MAX_LENGTH + 1), description: "说明", task: "work" }), /不能超过 20 个字/);
  assert.throws(() => normalizeTaskCreate({ parentSessionId: "main-1", title: "标题", description: "说".repeat(TASK_DESCRIPTION_MAX_LENGTH + 1), task: "work" }), /不能超过 100 个字/);
});

test("task metadata updates preserve the same length contract", () => {
  assert.deepEqual(normalizeTaskPatch({ title: "新标题" }), { title: "新标题" });
  assert.deepEqual(normalizeTaskPatch({ description: "新的任务描述" }), { taskDescription: "新的任务描述" });
  assert.throws(() => normalizeTaskPatch({}), /至少需要更新/);
  assert.throws(() => normalizeTaskPatch({ title: "" }), /标题不能为空/);
});

test("specialist tasks require a parent-scoped Agent and project identity", () => {
  assert.deepEqual(normalizeTaskCreate({
    parentSessionId: "main-1",
    title: "制作产品介绍视频",
    description: "使用 HyperFrames 完成产品介绍短片",
    task: "制作 Personal Agent 介绍视频",
    agentId: "video-creator",
    projectKey: "project_personal_agent_intro",
  }), {
    parentSessionId: "main-1",
    title: "制作产品介绍视频",
    description: "使用 HyperFrames 完成产品介绍短片",
    task: "制作 Personal Agent 介绍视频",
    agentId: "video-creator",
    projectKey: "project_personal_agent_intro",
  });
  assert.throws(() => normalizeTaskCreate({
    parentSessionId: "main-1",
    title: "视频",
    description: "制作视频",
    task: "work",
    agentId: "video-creator",
  }), /同时设置/);
  assert.throws(() => normalizeTaskCreate({
    title: "视频",
    description: "制作视频",
    task: "work",
    agentId: "video-creator",
    projectKey: "project_video",
  }), /属于一个主会话/);
  assert.throws(() => normalizeTaskCreate({
    parentSessionId: "main-1",
    title: "视频",
    description: "制作视频",
    task: "work",
    agentId: "../video",
    projectKey: "project_video",
  }), /ID 格式无效/);
});

test("child task execution prompts preserve quoted and multiline requirements", () => {
  const task = "请创建一次性提醒：\n时间：2026-07-19 09:00 Asia/Shanghai\n提醒内容：\"买黄皮寄回家\"";
  const normalized = normalizeTaskCreate({
    parentSessionId: "main-1",
    title: "买黄皮提醒",
    description: "明天九点提醒用户买黄皮寄回家",
    task,
  });
  assert.equal(normalized.task, task);
});
