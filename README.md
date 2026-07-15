# Personal Agent Node

[English](README.en.md) | 简体中文

Personal Agent Node 是 [Personal Agent](https://chenjianhui.site) 的开源、本地优先运行时。对话、长期记忆、账号凭据、文件和 Agent 状态保存在你自己的电脑上；Personal Agent Cloud、自建公网入口和模型 Token 都是可选能力。

## 为什么是本地 Node

- **私密性**：业务数据和长期凭据留在本机数据目录，Cloud 只处理接入身份、隧道与脱敏用量。
- **可定制**：通过 Skills、Plugins、模型 Provider 和渠道适配器组合自己的工作流。
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
- 使用自己的 Skill 和 Plugin 扩展新能力。

## 连接模式

Personal Agent Node 默认不需要连接 `chenjianhui.site` 或任何已配置的 Cloud：

1. `local-only`：只在本机或局域网使用；
2. `self-hosted-edge`：使用自己的域名和 Edge；
3. `managed-cloud`：使用 Personal Agent Cloud 分配的专属域名和托管隧道。

连接模式与模型 Provider 相互独立。即使断开 Cloud，Local Console、BYOK、Skills、文件、自动化、Pages 与备份仍应可用。

## 安装发行版

Beta 用户只需要下载对应系统的完整安装包，不需要预装 Node.js、npm、开发助手或克隆源码。当前发行版为 `v0.2.0-beta.4`：

- Windows x86-64：`personal-agent-node-v0.2.0-beta.4-windows-x64-installer.exe`
- macOS Apple Silicon：`personal-agent-node-v0.2.0-beta.4-macos-arm64.pkg`
- macOS Intel：`personal-agent-node-v0.2.0-beta.4-macos-x64.pkg`
- Linux x86-64 / ARM64：对应的 `personal-agent-node-v0.2.0-beta.4-linux-*.tar.zst`

安装器会验证完整发行版和内置 Node.js `22.23.1`，保留可回滚的 `current` / `previous`，注册当前用户的后台服务，然后自动打开一次性授权的本机 Setup Center。用户在这里完成自己的本机密码，并分别查看：

安装后只有一个目录：`~/.personal-agent/core` 是可升级和回滚的产品运行时，`~/.personal-agent/workspace` 是用户拥有的 Harness、插件、文件和数据；卸载默认只移除 Core。

- 本机安装与登录是否可用；
- Codex 是否安装、登录且能完成 app-server 握手；
- 是否需要公网域名和远程访问；
- Agent 邮箱身份与真实邮件投递是否可用；
- 微信等可选渠道是否启用。

纯本机模式默认可用。公网连接、邮箱和微信都不会阻塞本机 Console；需要专属域名时，在 Setup Center 选择“连接 Personal Agent Cloud”，由浏览器完成用途分离的短期授权。安装细节、签名校验、回滚和开发环境见 [入门文档](docs/getting-started.md)。

Beta/RC 为持续迭代版本，可以暂缓付费的 Windows/macOS 原生签名，因此操作系统可能要求用户明确放行；每个 Release 都必须公开 `RELEASE-SECURITY.json`、SHA-256、Sigstore、provenance 与 SBOM。稳定版仍强制 Authenticode 和 Apple Developer ID/notarization。

高级用户可以运行 `personal-agent setup status --json` 或 `personal-agent doctor --json` 获取脱敏状态；这些命令只检测，不会修改系统。正常安装和修复不依赖把一段提示词交给 Agent。

## 客户机 Harness

仓库包含完整的客户机 Agent Harness：项目与技能注册表、Agent 约束、可移植 Skills、可复现 fixtures、workspace guards 和运行工作流。正式安装只创建规范工作区和 Codex 集成；Claude、Cursor 与通用 Agent 桥接仅用于源码仓库开发兼容，不是客户安装前置条件。

```bash
npm install
npm run doctor
npm run guard
npm run baseline:verify
node scripts/skill-tree.mjs cases verify
npm test
npm run check
```

## 安全边界

- 密钥、Token、数据库、日志和可变数据只能写入用户的 `workspace/`；凭据固定在 `workspace/secrets/`；
- 高风险操作使用带摘要、十分钟过期和本机人工确认的两阶段审批；
- Edge 是传输平面，不接收对话正文、私人文件、业务数据库或渠道凭据；
- 发行版是不可变制品，升级与回滚保留明确的 `current` / `previous` 边界。

## 许可证

Apache License 2.0。第三方组件与来源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
