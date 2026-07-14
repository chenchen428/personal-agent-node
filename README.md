# Personal Agent Node

[English](README.en.md) | 简体中文

Personal Agent Node 是 [Personal Agent](https://chenjianhui.site) 的开源、本地优先运行时。对话、长期记忆、账号凭据、文件和 Agent 状态保存在你自己的电脑上；Personal Agent Cloud、自建公网入口和模型 Token 都是可选能力。

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

Personal Agent Node 默认不需要连接 `chenjianhui.site` 或任何已配置的 Cloud：

1. `local-only`：只在本机或局域网使用；
2. `self-hosted-edge`：使用自己的域名和 Edge；
3. `managed-cloud`：使用 Personal Agent Cloud 分配的专属域名和托管隧道。

连接模式与模型 Provider 相互独立。即使断开 Cloud，Local Console、BYOK、Skills、文件、自动化、Pages 与备份仍应可用。

## 安装发行版

当前 Beta 要求 Node.js 22.x。Node 24 移除了模板沙箱依赖的 permission-model flag，因此暂不支持。正式用户请安装 GitHub Release 的不可变发行包，不要把源码 checkout 当作生产运行时。

macOS / Linux：

```bash
TAG=v0.1.0-beta.16
INSTALLER="$(mktemp "${TMPDIR:-/tmp}/personal-agent-installer.XXXXXX.mjs")"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  --output "$INSTALLER" -- \
  "https://github.com/chenchen428/personal-agent-node/releases/download/$TAG/personal-agent-node-$TAG-installer.mjs"
node "$INSTALLER" --tag "$TAG"
rm -f "$INSTALLER"
export PATH="$HOME/.local/bin:$PATH"
personal-agent doctor --json
```

Windows PowerShell：

```powershell
$Tag = "v0.1.0-beta.16"
$Installer = Join-Path $env:TEMP "personal-agent-$Tag-installer.mjs"
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/chenchen428/personal-agent-node/releases/download/$Tag/personal-agent-node-$Tag-installer.mjs" -OutFile $Installer
node $Installer --tag $Tag
Remove-Item $Installer
& "$env:APPDATA\npm\personal-agent.cmd" doctor --json
```

这个独立引导器不依赖源码目录或 `npm install`；它只下载指定 tag 的发行包，核对 Release 中的 `SHA256SUMS`，再切换不可变的 `current` / `previous`。开发者从源码启动、定制数据目录和平台差异见 [入门文档](docs/getting-started.md)。

## 注册并接入专属域名

先在 [chenjianhui.site](https://chenjianhui.site) 使用邮箱验证码注册。管理员分配专属域名后，在安装 Node 的同一台电脑运行：

```bash
personal-agent cloud connect --json
```

CLI 会打开 `chenjianhui.site` 的短期页面授权，只展示 verification URL 与 user code。请使用刚注册的同一账户登录网页，核对专属域名并确认；CLI 随后使用一次性 enrollment credential 登记本机、验证 heartbeat 并完成自接入。不要把 user code 当成长期凭据，也不要通过聊天发送它。长期 Node token、生成的本地密码和隧道秘密不会显示在浏览器、终端输出或 `cloud.json` 中。

托管 Cloud 地址是配置项：`PERSONAL_AGENT_CLOUD_URL=https://cloud.example` 可设置当前进程的默认地址；`personal-agent cloud connect --cloud-url https://cloud.example --json` 是单次命令的显式覆盖，并且优先于环境变量。自定义地址必须使用 HTTPS。

如果浏览器没有自动打开，可复制终端给出的 `verificationUrlComplete`。授权过期、被拒绝或账户与 Site 不匹配时会失败关闭；重新运行命令即可开始一个新的短期授权。

### 复制给本机 Agent 的一键提示词

登录官网后也可以把下面这段交给本机 Agent。它只描述公开发行版和公开 CLI，不包含账号、验证码或任何秘密：

> 请在我的这台电脑上安装 Personal Agent Node v0.1.0-beta.16。先确认 Node.js 为 22.x；只从 `chenchen428/personal-agent-node` 的 GitHub Release 下载 `personal-agent-node-v0.1.0-beta.16-installer.mjs`，运行时显式传入 `--tag v0.1.0-beta.16`，不要 clone 源码作为运行时。安装器完成 SHA256 校验后，把 CLI 目录加入当前会话 PATH，运行 `personal-agent doctor --json`。如果检查通过，再运行 `personal-agent cloud connect --json`，让我在 chenjianhui.site 浏览器页面亲自登录并确认专属域名；不要索取、复述或保存 device code、一次性 enrollment credential、Node token、本地密码或隧道秘密。最后运行 `personal-agent status --json`，只汇报脱敏后的 release、连接模式、专属域名和健康状态。

Node 的发行与最终验收以 GitHub Release 安装版的 authenticated `/app/chat` 为准：发送一条唯一提示词，由真实 Agent runtime 执行，并在同一 session 确认 Agent reply。统一证据固定 `wechatRequired=false`；微信只是可选渠道，不作为 Node 是否可用的前置条件。

## 客户机 Harness

仓库包含完整的客户机 Agent Harness：项目与技能注册表、Agent 约束、可移植 Skills、可复现 fixtures、workspace guards、运行工作流，以及 Codex、Claude、Cursor 和通用 Agent 客户端的兼容桥接。

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

- 密钥、Token、数据库、日志和可变数据只能写入被忽略的 `.local/`、`secrets/` 或配置的数据根；
- 高风险操作使用带摘要、十分钟过期和本机人工确认的两阶段审批；
- Edge 是传输平面，不接收对话正文、私人文件、业务数据库或渠道凭据；
- 发行版是不可变制品，升级与回滚保留明确的 `current` / `previous` 边界。

## 许可证

Apache License 2.0。第三方组件与来源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
