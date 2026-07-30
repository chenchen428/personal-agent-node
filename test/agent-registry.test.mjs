import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAgentCatalogInstructions,
  buildSpecialistAgentInstructions,
  listAgentProfiles,
  resolveAgentProfile,
  serializeAgentProfile,
} from "../core/agent/src/agents/registry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("registers the HyperFrames-backed video creation specialist", () => {
  const profiles = listAgentProfiles(root);
  assert.equal(profiles.length, 5);
  const profile = resolveAgentProfile(root, "video-creator");
  assert.equal(profile.displayName, "视频创作");
  assert.equal(profile.version, 2);
  assert.equal(profile.skills[0], "hyperframes-video");
  assert.ok(profile.routing.includes("产品介绍视频"));
  assert.ok(profile.routing.includes("旅游剪辑"));
  assert.equal(profile.example.title, "Personal Agent 介绍视频");
  assert.equal(profile.example.kind, "video");
  assert.equal(profile.example.poster, "/assets/agent-examples/personal-agent-intro-v1/poster.jpg");
  assert.equal(profile.publicProfile.role, "影像内容专业 Agent");
  assert.ok(profile.publicProfile.capabilities.includes("把产品能力整理成有证据的演示叙事与镜头脚本"));
  assert.equal(profile.styleGuide, "STYLE-GUIDE.md");
  assert.equal(profile.styleCatalog, "styles.json");
  assert.equal(profile.styleContract.defaultStyleId, "pa-continuous-product-story");
  assert.equal(profile.styleContract.styles.length, 7);
  assert.deepEqual(
    new Set(profile.styleContract.styles.map((style) => style.category)),
    new Set(["product", "travel", "hybrid"]),
  );

  const catalog = buildAgentCatalogInstructions(root);
  assert.match(catalog, /video-creator/);
  assert.match(catalog, /pa-continuous-product-story/);
  assert.match(catalog, /vertical-travel-spark/);
  assert.match(catalog, /--agent <agent-id> --project-key/);
  assert.doesNotMatch(catalog, /你是 Personal Agent 的视频创作专业子 Agent/);

  const instructions = buildSpecialistAgentInstructions(root, {
    agentId: "video-creator",
    projectKey: "project_personal_agent_intro",
  });
  assert.match(instructions, /视频创作（video-creator@2）/);
  assert.match(instructions, /project_personal_agent_intro/);
  assert.match(instructions, /hyperframes-video/);
  assert.match(instructions, /完整风格参数：agents\/video-creator\/styles\.json/);
  assert.match(instructions, /PA 连续产品叙事/);
  assert.match(instructions, /旅行明信片拼贴/);
  assert.match(instructions, /最多组合一个主风格和一个辅助风格/);
  assert.match(instructions, /产品介绍视频标准/);
  assert.match(instructions, /旅游剪辑标准/);
  assert.match(instructions, /Personal Agent 介绍视频/);
});

test("registers the AMap-backed travel planning specialist", () => {
  const profile = resolveAgentProfile(root, "travel-planner");
  assert.equal(profile.displayName, "旅游规划 Agent");
  assert.equal(profile.version, 1);
  assert.equal(profile.skills[0], "amap-travel-routing");
  assert.ok(profile.skills.includes("travel-guidebook"));
  assert.ok(profile.skills.includes("personal-pages"));
  assert.ok(profile.routing.includes("高德地图查询"));
  assert.ok(profile.routing.includes("行程规划"));
  assert.equal(profile.styleContract, null);
  assert.equal(profile.publicProfile.role, "行程规划专业 Agent");
  assert.ok(profile.publicProfile.outputs.includes("完整旅行规划 Page 和出发前检查清单"));
  assert.equal(profile.example.kind, "page");
  assert.equal(profile.example.title, "福州老城水岸 3 晚 4 天");
  assert.deepEqual(profile.example.devices, ["web", "mobile"]);

  const serialized = serializeAgentProfile(profile);
  assert.equal(serialized.styleCatalogVersion, null);
  assert.equal(serialized.defaultStyleId, null);
  assert.deepEqual(serialized.styles, []);
  assert.equal(serialized.publicProfile.tagline, profile.publicProfile.tagline);

  const catalog = buildAgentCatalogInstructions(root);
  assert.match(catalog, /travel-planner/);
  assert.match(catalog, /旅游规划 Agent/);

  const instructions = buildSpecialistAgentInstructions(root, {
    agentId: "travel-planner",
    projectKey: "fuzhou-planning-demo",
  });
  assert.match(instructions, /旅游规划 Agent（travel-planner@1）/);
  assert.match(instructions, /fuzhou-planning-demo/);
  assert.match(instructions, /amap-travel-routing/);
  assert.match(instructions, /不能用手写直线、大致点位或地图瓦片代替路径证据/);
  assert.match(instructions, /Page 不是旅行回顾或照片墙/);
  assert.match(instructions, /页面视觉与路线体验等待用户最终验收/);
});

test("registers the governed renovation specialist with SU-to-render delivery", () => {
  const profile = resolveAgentProfile(root, "interior-designer");
  assert.equal(profile.displayName, "装修设计 Agent");
  assert.equal(profile.version, 1);
  assert.equal(profile.skills[0], "home-renovation");
  assert.ok(profile.skills.includes("interior-design"));
  assert.ok(profile.routing.includes("SU 设计稿"));
  assert.ok(profile.routing.includes("装修渲染稿"));
  assert.equal(profile.styleContract, null);
  assert.equal(profile.publicProfile.role, "住宅空间专业 Agent");
  assert.ok(profile.publicProfile.boundaries.includes("不把未经测量或核验的尺寸当作施工依据"));
  assert.equal(profile.example.src, "/assets/templates/interior-design-delivery-v2/index.html");
  assert.deepEqual(profile.example.devices, ["web", "mobile"]);

  const catalog = buildAgentCatalogInstructions(root);
  assert.match(catalog, /interior-designer/);
  assert.match(catalog, /装修设计 Agent/);

  const instructions = buildSpecialistAgentInstructions(root, {
    agentId: "interior-designer",
    projectKey: "home-renovation-demo",
  });
  assert.match(instructions, /装修设计 Agent（interior-designer@1）/);
  assert.match(instructions, /home-renovation-demo/);
  assert.match(instructions, /interior-design/);
  assert.match(instructions, /SU 对应渲染/);
  assert.match(instructions, /interior render register/);
  assert.match(instructions, /视觉与交互等待用户最终验收/);
  assert.doesNotMatch(instructions, /默认创作风格/);
});

test("registers the governed poster design specialist", () => {
  const profile = resolveAgentProfile(root, "poster-designer");
  assert.equal(profile.displayName, "海报设计 Agent");
  assert.equal(profile.version, 1);
  assert.equal(profile.skills[0], "guizang-social-card-skill");
  assert.ok(profile.skills.includes("visual-content"));
  assert.ok(profile.skills.includes("personal-files"));
  assert.ok(profile.routing.includes("海报设计"));
  assert.ok(profile.routing.includes("公众号封面"));
  assert.equal(profile.styleContract, null);
  assert.equal(profile.publicProfile.role, "品牌与社交视觉专业 Agent");
  assert.ok(profile.publicProfile.outputs.includes("目标渠道所需的海报、卡片、轮播和封面文件"));
  assert.equal(profile.example.kind, "gallery");
  assert.equal(profile.example.items.length, 5);
  assert.deepEqual(profile.example.devices, ["mobile"]);

  const catalog = buildAgentCatalogInstructions(root);
  assert.match(catalog, /poster-designer/);
  assert.match(catalog, /海报设计 Agent/);

  const instructions = buildSpecialistAgentInstructions(root, {
    agentId: "poster-designer",
    projectKey: "summer-campaign-poster",
  });
  assert.match(instructions, /海报设计 Agent（poster-designer@1）/);
  assert.match(instructions, /summer-campaign-poster/);
  assert.match(instructions, /guizang-social-card-skill/);
  assert.match(instructions, /主 Agent 统一负责/);
  assert.match(instructions, /视觉与渠道效果等待用户最终验收/);
  assert.doesNotMatch(instructions, /默认创作风格/);
});

test("registers the governed finance and data analysis specialist", () => {
  const profile = resolveAgentProfile(root, "finance-analyst");
  assert.equal(profile.displayName, "账务分析 Agent");
  assert.equal(profile.version, 1);
  assert.equal(profile.skills[0], "personal-data");
  assert.ok(profile.skills.includes("deep-research"));
  assert.ok(profile.skills.includes("personal-pages"));
  assert.ok(profile.routing.includes("数据分析"));
  assert.ok(profile.routing.includes("流水核对"));
  assert.equal(profile.styleContract, null);
  assert.equal(profile.publicProfile.role, "个人账务与数据分析专业 Agent");
  assert.ok(profile.publicProfile.outputs.includes("脱敏分析 Page、复核清单与方法说明"));
  assert.equal(profile.example.kind, "image");
  assert.equal(profile.example.title, "月度账务核对报告");
  assert.deepEqual(profile.example.devices, ["web", "mobile"]);

  const catalog = buildAgentCatalogInstructions(root);
  assert.match(catalog, /finance-analyst/);
  assert.match(catalog, /账务分析 Agent/);

  const instructions = buildSpecialistAgentInstructions(root, {
    agentId: "finance-analyst",
    projectKey: "personal-expense-review",
  });
  assert.match(instructions, /账务分析 Agent（finance-analyst@1）/);
  assert.match(instructions, /personal-expense-review/);
  assert.match(instructions, /personal-data/);
  assert.match(instructions, /不得直接打开内部数据库/);
  assert.match(instructions, /每个汇总数字都应能回到参与计算的交易或来源记录/);
  assert.match(instructions, /账务结论与页面表达等待用户最终验收/);
  assert.doesNotMatch(instructions, /默认创作风格/);
});

test("serializes every registered Agent for the public registry API", () => {
  const agents = listAgentProfiles(root).map(serializeAgentProfile);
  assert.equal(agents.length, JSON.parse(fs.readFileSync(path.join(root, "registry", "agents.json"), "utf8")).agents.length);
  assert.ok(agents.every((agent) => agent.publicProfile.role && agent.publicProfile.outputs.length));
  assert.ok(agents.every((agent) => Array.isArray(agent.styles)));
  assert.ok(agents.every((agent) => agent.example?.title && agent.example.meta.length));
  assert.deepEqual(new Set(agents.map((agent) => agent.example.kind)), new Set(["page", "gallery", "image", "video"]));
  assert.equal(agents.find((agent) => agent.id === "video-creator").styles.length, 7);
  assert.equal(agents.find((agent) => agent.id === "interior-designer").styles.length, 0);
  assert.equal(agents.find((agent) => agent.id === "travel-planner").styles.length, 0);
  assert.equal(agents.find((agent) => agent.id === "poster-designer").styles.length, 0);
  assert.equal(agents.find((agent) => agent.id === "finance-analyst").styles.length, 0);
});

test("rejects unknown specialist identities instead of falling back to a generic Worker", () => {
  assert.throws(
    () => resolveAgentProfile(root, "missing-agent"),
    (error) => error.code === "AGENT_PROFILE_NOT_FOUND" && error.statusCode === 400,
  );
});

test("Agent registry guard validates manifests, skills, routes, and instructions", () => {
  const result = spawnSync(process.execPath, ["scripts/agent-guard.mjs", "--working"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Agent guard completed successfully/);
  assert.equal(fs.existsSync(path.join(root, "schemas", "personal-agent", "agents.schema.json")), true);
  assert.equal(fs.existsSync(path.join(root, "schemas", "personal-agent", "video-styles.schema.json")), true);
});
