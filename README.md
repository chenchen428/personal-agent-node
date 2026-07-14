# Personal Agent Node

[English](README.en.md) | 简体中文

Personal Agent Node 是一个开源、本地优先的个人助手运行时。对话、长期记忆、账号凭据、文件和 Agent 状态保存在你自己的电脑上；Personal Agent Cloud、自建公网入口和模型 Token 都是可选能力。

## 为什么是本地 Node

- **私密性**：业务数据和长期凭据留在本机数据目录，Cloud 只处理接入身份、隧道与脱敏用量。
- **可定制**：通过 Skills、Extensions、模型 Provider 和渠道适配器组合自己的工作流。
- **可自进化**：Agent 可以在受控权限和可回滚发行版边界内更新技能、流程与自动化。
- **长期记忆**：本机持久化会话、文件、计划和个人知识，不依赖临时网页会话。
- **连接自由**：支持纯本机/LAN、自有域名与隧道、可选 Personal Agent Cloud Edge。
- **模型自由**：支持 BYOK 和 OpenAI-compatible Token 网关，连接方式与模型选择互不绑定。

## 可以用来做什么

- 记录日常收支、归集账单并生成月度财务摘要；
- 把行程、照片和笔记整理成旅行卡片或可分享页面；
- 在明确授权后管理个人平台账号、内容草稿和发布任务；
- 通过微信或浏览器继续同一个长期对话；
- 整理私人文件、研究资料、邮件事件和周期自动化；
- 使用自己的 Skill 和 Extension 扩展新能力。

## 连接模式

Personal Agent Node 默认不需要连接 `personal-agent.cn`：

1. `local-only`：只在本机或局域网使用；
2. `self-hosted-edge`：使用自己的域名和 Edge；
3. `managed-cloud`：使用 Personal Agent Cloud 分配的专属域名和托管隧道。

连接模式与模型 Provider 相互独立。即使断开 Cloud，Local Console、BYOK、Skills、文件、自动化、Pages 与备份仍应可用。

## 开始使用

当前 Beta 开发环境要求 Node.js 22.x。Node 24 移除了模板沙箱依赖的 permission-model flag，因此暂不支持。

```bash
git clone https://github.com/chenchen428/personal-agent-node.git
cd personal-agent-node
npm install
npm run doctor
```

开发启动与本地初始化参见 [入门文档](docs/getting-started.md)。正式用户应优先安装 GitHub Release 的不可变发行包，而不是使用源码目录作为生产运行时。

如果已经在 Personal Agent Cloud 注册且管理员分配了专属域名，可运行：

```bash
personal-agent cloud connect --json
```

CLI 会打开 `personal-agent.cn` 的短期页面授权，只展示 verification URL 与 user code；网页确认后，CLI 使用一次性 enrollment credential 完成接入。长期 Node token 不会显示在浏览器、终端输出或 `cloud.json` 中。

Node 的发行与最终验收以 GitHub Release 安装版的 authenticated `/app/chat` 为准：发送一条唯一提示词，由真实 Agent runtime 执行，并在同一 session 确认 Agent reply。统一证据固定 `wechatRequired=false`；微信只是可选渠道，不作为 Node 是否可用的前置条件。

## 客户机 Harness

仓库包含完整的客户机 Agent Harness：项目与技能注册表、Agent 约束、可移植 Skills、可复现 fixtures、workspace guards、运行工作流，以及 Codex、Claude、Cursor 和通用 Agent 客户端的兼容桥接。

```bash
npm run doctor
npm run guard
npm run baseline:verify
node scripts/skill-tree.mjs cases verify
npm test
npm run check
```

## 安全边界

- 密钥、Token、数据库、日志和可变数据只能写入被忽略的 `.local/`、`secrets/` 或配置的数据根；
- 高风险操作使用带摘要、十分钟过期和本机人工确认的两阶段审批；
- Edge 是传输平面，不接收对话正文、私人文件、业务数据库或渠道凭据；
- 发行版是不可变制品，升级与回滚保留明确的 `current` / `previous` 边界。

## 许可证

Apache License 2.0。第三方组件与来源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
