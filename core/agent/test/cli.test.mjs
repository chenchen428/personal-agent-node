import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createPageThumbnailPng } from "./page-thumbnail-fixture.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("legacy Memory CLI fails closed and points to main-Agent Activity", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [path.join(projectRoot, "bin", "pa-cli.mjs"), "memory", "recall", "--json"], {
      cwd: projectRoot,
      env: { ...process.env },
    }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /legacy Memory domain has been removed/);
      assert.match(error.stderr, /pa-cli activity/);
      return true;
    },
  );
});

test("session CLI requires concise child-task metadata and supports updates", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, session: {
      id: "task-1",
      title: body.title || "新标题",
      taskDescription: body.description || body.taskDescription || "新描述",
      internalUrl: "/app/chat/session/task-1/live",
      url: "https://owner.personal-agent.cn/app/mobile/workers/task-1",
      linkNotice: "",
    } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const env = { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token" };

  const { stdout: createdOutput } = await execFileAsync(process.execPath, [path.join(projectRoot, "bin", "pa-cli.mjs"), "session", "start", "--parent", "main-1", "--title", "整理发布页", "--description", "完成页面制作、发布和验证", "--task", "完成页面", "--json"], { cwd: projectRoot, env });
  await execFileAsync(process.execPath, [path.join(projectRoot, "bin", "pa-cli.mjs"), "session", "update", "--session", "task-1", "--description", "返回最终页面地址", "--json"], { cwd: projectRoot, env });

  assert.deepEqual(requests, [
    { method: "POST", url: "/api/sessions", body: { task: "完成页面", title: "整理发布页", description: "完成页面制作、发布和验证", parentSessionId: "main-1", createdBy: "pa-cli" } },
    { method: "PATCH", url: "/api/sessions/task-1", body: { taskDescription: "返回最终页面地址" } },
  ]);
  const created = JSON.parse(createdOutput);
  assert.equal(created.internalUrl, "/app/chat/session/task-1/live");
  assert.equal(created.url, "https://owner.personal-agent.cn/app/mobile/workers/task-1");
  assert.equal(created.linkNotice, "");
  await assert.rejects(
    execFileAsync(process.execPath, [path.join(projectRoot, "bin", "pa-cli.mjs"), "session", "start", "--parent", "main-1", "--task", "work", "--json"], { cwd: projectRoot, env }),
    (error) => /必须设置标题/.test(error.stderr),
  );
});

test("session CLI preserves the unavailable-domain notice instead of inventing a task URL", async (t) => {
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, session: {
      id: "task-local-only",
      internalUrl: "/app/chat/session/task-local-only/live",
      url: "",
      linkNotice: "暂未配置可访问的公网域名，无法在线查看任务进度。",
    } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "session", "start",
    "--parent", "main-1",
    "--title", "本机任务",
    "--description", "验证没有公网域名时的任务链接契约",
    "--task", "执行任务",
    "--json",
  ], {
    cwd: projectRoot,
    env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token" },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.internalUrl, "/app/chat/session/task-local-only/live");
  assert.equal(result.url, "");
  assert.equal(result.linkNotice, "暂未配置可访问的公网域名，无法在线查看任务进度。");
});

test("session CLI preserves split, file-backed, and resumed task prompts", async (t) => {
  const requests = [];
  const working = fs.mkdtempSync(path.join(os.tmpdir(), "pa-cli-task-prompt-"));
  const taskFile = path.join(working, "task.txt");
  const fileTask = "完整任务第一行\n提醒内容：\"买黄皮寄回家\"\n保留参数文本：--keep-original";
  fs.writeFileSync(taskFile, fileTask, "utf8");
  t.after(() => fs.rmSync(working, { recursive: true, force: true }));
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, session: { id: "task-1" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const env = {
    ...process.env,
    OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`,
    OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token",
  };
  const cli = path.join(projectRoot, "bin", "pa-cli.mjs");

  await execFileAsync(process.execPath, [
    cli, "session", "start",
    "--parent", "main-1",
    "--title", "买黄皮提醒",
    "--description", "明天九点提醒用户买黄皮寄回家",
    "--task", "请创建提醒，提醒内容为", "买黄皮寄回家",
    "--json",
  ], { cwd: working, env });
  await execFileAsync(process.execPath, [
    cli, "session", "start",
    "--parent", "main-1",
    "--title", "完整任务文件",
    "--description", "从 UTF-8 文件读取完整执行说明",
    "--task-file", taskFile,
    "--json",
  ], { cwd: working, env });
  await execFileAsync(process.execPath, [
    cli, "session", "resume",
    "--session", "task-1",
    "--task", "继续任务，提醒内容为", "买黄皮寄回家",
    "--json",
  ], { cwd: working, env });

  assert.equal(requests[0].body.task, "请创建提醒，提醒内容为 买黄皮寄回家");
  assert.equal(requests[1].body.task, fileTask);
  assert.deepEqual(requests[2], {
    method: "POST",
    url: "/api/sessions/task-1/input",
    body: { content: "继续任务，提醒内容为 买黄皮寄回家", notifyWechat: false },
  });
});

test("CLI sends an explicit execute boolean for local storage verification", async (t) => {
  let received = null;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, execute: received.execute }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "file",
    "verify-storage",
    "--execute",
    "--json",
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`,
      OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token",
    },
  });

  assert.deepEqual(received, { execute: true });
  assert.equal(JSON.parse(stdout).execute, true);
});

test("channel login is a no-side-effect plan until the user confirms execution", async (t) => {
  let requestCount = 0;
  const server = http.createServer((_request, response) => {
    requestCount += 1;
    response.writeHead(500);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "channel",
    "login",
    "xiaohongshu",
    "--json",
  ], {
    cwd: projectRoot,
    env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token" },
  });

  const result = JSON.parse(stdout);
  assert.equal(result.execute, false);
  assert.equal(result.confirmationRequired, true);
  assert.equal(requestCount, 0);
});

test("confirmed channel login delegates QR delivery and monitoring to the bridge", async (t) => {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    requests.push({ method: request.method, url: request.url, body });
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url === "/api/channels/xiaohongshu/login") {
      response.end(JSON.stringify({
        ok: true,
        status: "pending",
        session: "login-session",
        expiresAt: "2026-07-11T20:10:00.000Z",
        delivered: true,
        monitoring: true,
      }));
      return;
    }
    response.end(JSON.stringify({ ok: false, error: "unexpected request" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "channel",
    "login",
    "xiaohongshu",
    "--execute",
    "--json",
  ], {
    cwd: projectRoot,
    env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token" },
  });

  const result = JSON.parse(stdout);
  assert.equal(result.execute, true);
  assert.equal(result.delivered, true);
  assert.equal(result.monitoring, true);
  assert.equal(result.session, "login-session");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body, {});
  assert.doesNotMatch(stdout, /qrImage|base64/);
});

test("pages publish sends HTML and both device screenshots as one Page contract", async (t) => {
  const working = fs.mkdtempSync(path.join(os.tmpdir(), "pa-cli-pages-"));
  fs.writeFileSync(path.join(working, "index.html"), "<h1>CLI Page</h1>");
  fs.writeFileSync(path.join(working, "desktop.png"), createPageThumbnailPng());
  fs.writeFileSync(path.join(working, "mobile.png"), createPageThumbnailPng(750, 1200));
  let received = null;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { url: request.url, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      asset: {
        url: "/public/uploads/cli-page/index.html",
        page: { pageId: "public-cli-page", title: received.body.title, thumbnails: { desktop: { fileName: received.body.desktopThumbnail.fileName }, mobile: { fileName: received.body.mobileThumbnail.fileName } } },
      },
      access: {
        internalUrl: "/public/uploads/cli-page/index.html",
        url: "https://owner.personal-agent.cn/public/uploads/cli-page/index.html",
        linkNotice: "",
      },
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "pages", "publish",
    "--file", "index.html",
    "--folder", "cli-page",
    "--desktop-thumbnail", "desktop.png",
    "--mobile-thumbnail", "mobile.png",
    "--title", "CLI Page",
    "--summary", "Published from the stable CLI contract.",
    "--desktop-thumbnail-alt", "CLI Page desktop overview",
    "--mobile-thumbnail-alt", "CLI Page mobile overview",
    "--json",
  ], {
    cwd: working,
    env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token" },
  });

  assert.equal(received.url, "/api/pages/publish");
  assert.equal(received.body.folder, "cli-page");
  assert.equal(received.body.desktopThumbnail.alt, "CLI Page desktop overview");
  assert.equal(received.body.mobileThumbnail.alt, "CLI Page mobile overview");
  assert.ok(Buffer.from(received.body.desktopThumbnail.content, "base64").subarray(1, 4).equals(Buffer.from("PNG")));
  const output = JSON.parse(stdout);
  assert.equal(output.page.pageId, "public-cli-page");
  assert.equal(output.page.thumbnails.mobile.fileName, "page-thumbnail-mobile.png");
  assert.equal(output.internalUrl, "/public/uploads/cli-page/index.html");
  assert.equal(output.url, "https://owner.personal-agent.cn/public/uploads/cli-page/index.html");
  assert.equal(output.linkNotice, "");
});

test("pages publish returns an explicit notice when no managed domain is accessible", async (t) => {
  const working = fs.mkdtempSync(path.join(os.tmpdir(), "pa-cli-pages-no-domain-"));
  fs.writeFileSync(path.join(working, "index.html"), "<h1>CLI Page</h1>");
  fs.writeFileSync(path.join(working, "desktop.png"), createPageThumbnailPng());
  fs.writeFileSync(path.join(working, "mobile.png"), createPageThumbnailPng(750, 1200));
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      asset: { url: "/public/uploads/cli-page/index.html" },
      access: {
        internalUrl: "/public/uploads/cli-page/index.html",
        url: "",
        linkNotice: "暂未配置可访问的域名链接，无法直接访问页面",
      },
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "pages", "publish",
    "--file", "index.html",
    "--folder", "cli-page",
    "--desktop-thumbnail", "desktop.png",
    "--mobile-thumbnail", "mobile.png",
    "--json",
  ], {
    cwd: working,
    env: { ...process.env, OPEN_AGENT_BRIDGE_API_BASE: `http://127.0.0.1:${address.port}`, OPEN_AGENT_BRIDGE_API_TOKEN: "cli-test-token" },
  });

  assert.deepEqual(JSON.parse(stdout), {
    url: "",
    internalUrl: "/public/uploads/cli-page/index.html",
    linkNotice: "暂未配置可访问的域名链接，无法直接访问页面",
  });
});

test("pages upload rejects HTML so it cannot bypass thumbnail generation", async () => {
  const working = fs.mkdtempSync(path.join(os.tmpdir(), "pa-cli-pages-upload-"));
  fs.writeFileSync(path.join(working, "index.html"), "<h1>Missing thumbnail</h1>");
  await assert.rejects(execFileAsync(process.execPath, [
    path.join(projectRoot, "bin", "pa-cli.mjs"),
    "pages", "upload", "--file", "index.html", "--folder", "bad-page", "--json",
  ], { cwd: working, env: { ...process.env } }), (error) => {
    assert.match(error.stderr, /pages publish with desktop and mobile thumbnails/);
    return true;
  });
});
