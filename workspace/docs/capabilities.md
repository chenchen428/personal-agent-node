# 个人助手可以做什么

主 Agent 可以在当前对话的最终回复中显式选择已托管的 `obj_` 图片或安全文件；服务端会校验当前空间归属、安全状态、大小、magic bytes、MIME 与扩展名，剥离控制信封，并通过原微信连接器按顺序发送原生图片或文件消息，同时在桌面和移动聊天记录中保存同一结构化附件。Worker 只能报告候选 `objectIds`，不能发送；动态附件和手工通知命令也不会触发普通回复附件直发。

Personal Agent 以这个工作区作为用户拥有的长期上下文和资产目录。它可以：

- 处理对话任务，拆分、继续和汇总后台工作；
- 创建、整理、检索和导出本地文件；
- 生成公开 Pages；`/public/**` 无需个人验证，其余远程页面必须先登录；
- 构建并维护移动端优先、同时支持桌面的 Personal Apps；
- 查询和维护 Agent 专属数据，运行定时或事件自动化；
- 连接用户选择的消息渠道和本地邮件入口；
- 安装、检查和迭代受治理的 Skills、Plugins 与工作流；
- 由主 Agent 维护对用户有价值的动态。

产品能力共建是独立能力，不属于上述自迭代。用户要求修改 Personal Agent 的 Cloud、Node、
发布流程或产品 Harness 时，助手通过 `personal-agent development ensure --json` 把注册的
GitHub 私有根仓库克隆到当前 Agent Workspace 的 `projects/personal-agent`，然后以该目录作为
研发任务工作区。认证、权限、克隆或子模块失败时直接停止；绝不修改已安装的
`core/current`，也不以 App 或 Skill 代替产品源码修改。

默认边界：数据留在本机；不自行开通 Cloud；不读取密钥或绕过权限；对外发送、发布、
删除、账号连接等高风险操作必须遵循计划与确认规则。没有可用穿透域名或隧道离线时，
助手只说明页面或进度暂不支持远程查看，不输出本机地址或不可访问的链接。

命令行职责：

- `personal-agent status|doctor|setup|connection|cloud|backup|update ...` 管理安装和运行时。
- `pa-cli session|channel|wechat|data|automation|cron|file|pages ...` 操作助手能力。

以两条命令各自的 `--help` 和 JSON 输出为准。不要调用内部端口或数据库来绕过缺失能力。

## Interior design and managed images

- `$interior-design` recognizes renovation concepts, floor plans, 2D-to-3D requests, material schemes, floor-plan animation, and rotatable Page requests.
- Without CAD/BIM or a reliable known dimension, its geometry is explicitly a calibrated concept model rather than survey, structural, code, or construction output.
- The workflow produces normalized model JSON, a verified managed still image through `$visual-content`, and an optional self-contained Three.js Page published by the governed Pages operation.
- Ready image `obj_` IDs are selected by the main Agent in the unified final-reply attachment protocol so supported connectors can deliver native images. Workers only report candidate IDs.
