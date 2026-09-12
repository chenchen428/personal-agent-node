# ADR 0013：统一 Agent 运行环境

日期：2026-09-12

## 决策与配置入口

运行设置的“运行环境”统一承载基座、模型、推理强度和自定义服务配置。通用设置移除独立的“Agent 执行”模型配置。当前空间默认使用 Codex，也可选择 Claude Code；每种基座保留自己的配置草稿和已保存配置。此次交互与视觉由用户在研发、测试和本机重装完成后验收。

账号模式使用本机已安装并登录的对应 CLI。自定义模式配置模型 ID、Base URL、API Key 或授权令牌。Codex 对接 OpenAI Responses 兼容服务；Claude Code 对接 Anthropic Messages 兼容服务，二者不会自动转换协议。模型 ID 允许手动输入，不以账号模型目录作为自定义模型的白名单。

保存从下一次对话回合生效；已经执行的回合保留启动时的基座与配置快照。Codex 与 Claude Code 的续接标识分别保存，往返切换不会把一种基座的会话标识交给另一种。后台任务、定时任务、主 Agent 与 Worker 使用同一执行抽象。

## 状态和检测

检测分别报告安装、版本、账号状态和执行协议。连通性测试使用当前表单草稿，调用对应协议完成一次短响应；测试不保存配置、不切换默认基座、不写入用户主对话。版本命令成功、凭据已保存、HTTP 成功但返回非模型正文，都不能代替真实连通成功。失败结果区分缺失凭据、配置错误、授权失败、超时、网络错误及协议不匹配。

CLI 未安装或账号未登录时，配置页面保留并显示明确状态。Claude Code 的非交互执行遵守当前空间授权策略：无需授权模式开放所声明的产品工具；操作前确认模式对不可交互确认的写操作失败关闭，不擅自提升权限。Codex 保留 app-server 原有审批能力。

## 配置与安全边界

- 非敏感配置位于当前 Space 的 `config/runtime-environments.json`，含 schema、revision、engine 和双基座 profile。首次读取兼容已有 Codex 模型与推理设置。
- 授权凭据位于当前 Space 的 `secrets/runtime-environments/`，配置仅保存随机凭据引用；HTTP 只返回 `credentialConfigured`。空白输入保留已有凭据，显式清除才移除。变更服务来源不能把旧凭据自动发送到新来源。
- 保存使用 revision、跨进程排他锁、不可变凭据版本和原子配置替换。并发或损坏配置失败关闭；不把账号设置写进系统级 Codex/Claude 配置。
- URL 禁止内嵌账号密码、查询串、fragment 和控制字符。远端仅允许 HTTPS；允许本机 HTTP 模型服务。规范化 Base URL 与完整 API 端点，执行与探测复用相同路径规则。
- 网关、Next BFF、控制服务和 Agent API 检查本机桌面来源；反向隧道不开放运行环境配置。检测输入限长，超时和响应体大小有界，不跟随重定向传递授权信息。
- 密钥只进入对应执行子进程环境和目标协议授权头，不进入命令参数、响应、日志、事件、测试证据或发布制品。

## 验证与交付

测试覆盖配置迁移、Space 隔离、凭据保留与清除、revision 冲突、不同 URL 形式、真实本地协议请求、超时和错误脱敏，以及双基座回合切换、恢复、排队和取消。网关/BFF 集成验证真实发布路径，防止仅后端单元测试通过而设置页面返回 404。

交付使用校验过的不可变 Windows 本地候选安装器，保留用户 Workspace 与上一版本。真实第三方服务必须由用户提供授权后验证；本地模拟协议通过不代表第三方账号已经启用。

## 协议依据

- [Codex app-server](https://developers.openai.com/codex/app-server/)
- [Codex 自定义提供方配置](https://developers.openai.com/codex/config-advanced/)
- [Claude Code 程序化运行](https://code.claude.com/docs/en/headless)
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)
- [Claude Code 安装](https://code.claude.com/docs/en/setup)
