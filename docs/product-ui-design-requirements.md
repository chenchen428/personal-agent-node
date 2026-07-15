# Personal Agent Node 产品与 UI 设计需求

> 文档版本：1.0  
> 面向角色：产品设计、UI/UX 设计、前端研发、验收人员  
> 设计状态：Node Console 统一改造基线  
> 适用范围：Personal Agent Node 本机控制台、响应式 Web、移动端 Web 及 Node 对外发布页

## 1. 文档目的

本文件是 Personal Agent Node 的界面设计与交互事实源。设计师应基于本文输出信息架构、用户流程、桌面端高保真稿、移动端高保真稿和组件状态，而不是只对当前页面做视觉修饰。

设计必须解决以下问题：

1. 用户能够自己完成安装后的本机准备，不依赖复制提示词给开发 Agent。
2. 本机、Codex、公网、Agent 邮箱和渠道的可用性均有明确状态、失败原因和下一步操作。
3. 所有主功能使用同一套导航、版式、色彩和交互语言，切换页面时导航不消失。
4. Console 同时适用于桌面浏览器和手机浏览器，不把桌面双栏简单压缩到手机宽度。
5. Core 可以升级替换，Workspace 中的对话、邮件、数据、文件和用户配置始终归用户所有。
6. 危险操作、外部发布和渠道写入必须先展示影响范围，再由用户确认。

本文描述目标体验，也标注当前实现状态。设计稿需要覆盖目标状态，研发按优先级逐步替换当前占位或旧版页面。

## 2. 产品定位与设计方向

### 2.1 产品定位

Personal Agent Node 是安装在用户自己电脑上的个人 Agent 运行环境。它包含：

- **Core**：可升级替换的应用、运行时、网关和插件机制。
- **Workspace**：用户拥有的 Harness 环境、对话、邮件、数据库、发布内容、配置和审计记录。
- **Cloud 可选能力**：公网域名、Agent 邮箱和远程接入。未配置 Cloud 不应影响纯本机使用。

控制台是工作界面，不是营销网站。首页和各功能页应便于扫描、判断状态和重复操作，避免大面积装饰、层层卡片和冗长说明。

### 2.2 视觉方向

沿用 `DESIGN.md` 的“温暖纸张 + 编辑部工具”方向：克制、安静、可信，但必须保持工具界面的清晰密度。

核心视觉记忆点是：**浅暖画布上的精密工作台，珊瑚色只标记动作和当前焦点，深色区域只用于高对比的系统状态摘要。**

基础色：

| Token | 建议值 | 用途 |
| --- | --- | --- |
| `canvas` | `#faf9f5` | 页面背景 |
| `surface` | `#ffffff` | 输入、弹层、关键内容面 |
| `surface-soft` | `#f5f0e8` | 次级区域、列表选中底色 |
| `card` | `#efe9de` | 少量独立对象卡片 |
| `ink` | `#141413` | 标题与主要文字 |
| `body` | `#3d3d3a` | 正文 |
| `muted` | `#6c6a64` | 辅助说明 |
| `hairline` | `#e6dfd8` | 分隔线与边框 |
| `accent` | `#cc785c` | 主按钮、当前项、关键链接 |
| `accent-active` | `#a9583e` | 按下与高对比 hover |
| `success` | `#2f7d46` | 可用、已连接、已完成 |
| `warning` | `#9a6a00` | 需处理、即将过期 |
| `error` | `#b33636` | 故障、失败、危险操作 |
| `info` | `#2f6785` | 运行中、同步中、说明 |
| `dark` | `#181715` | 仅用于系统摘要等少量深色区域 |

色彩规则：

- 状态不能只靠颜色表达，必须同时有图标、文字标签和可访问名称。
- 深色区域正文使用接近白色，次级文字至少达到 WCAG AA 对比度；不得在深色底上使用黑色标题。
- 主按钮使用实心 accent + 白色文字；次按钮使用白底、边框和 ink 文字；破坏性按钮使用 error。
- 禁止把按钮做成大面积渐变色块。圆角矩形文字只用于明确命令；图标型工具操作优先使用 Lucide 图标按钮并提供 tooltip。
- 页面不应被一种暖色填满。成功、警告、错误、信息色需要真实参与状态表达。

字体与密度：

- 页面标题可使用有编辑感的中文宋体/衬线字体；操作区、表格、表单和正文使用高可读无衬线字体。
- 元数据、时间、版本和代码可使用等宽字体。
- 字号不随 viewport 连续缩放；通过固定字号和断点切换保证稳定。
- 字间距统一为 `0`，不使用负字间距。
- 页面 H1 32–40px；功能区标题 20–24px；卡片/面板标题 15–18px；正文 14–16px；元数据 12–13px。

圆角与阴影：

- 输入和按钮 6px，工具卡片 8px，Modal/Sheet 12px，系统摘要最大 12px。
- 不在卡片中再嵌套装饰卡片。列表项通过分隔线、选中底色和留白区分。
- 阴影仅用于浮层和当前可拖离背景的对象，普通页面区块使用边框与背景层级。

### 2.3 组件策略

优先复用 shadcn/ui 原语，并在全局主题中统一视觉，不自行重复实现基础组件。

| 场景 | 组件 |
| --- | --- |
| 命令 | `Button`、`DropdownMenu`、`Tooltip` |
| 状态 | `Badge`、`Alert`、`Progress`、`Skeleton` |
| 导航 | `Tabs`、`NavigationMenu`、`Sheet`、`Breadcrumb` |
| 输入 | `Input`、`Textarea`、`Select`、`Checkbox`、`Switch`、`Form` |
| 信息 | `Table`、`Accordion`、`Collapsible`、`Separator` |
| 浮层 | `Dialog`、`AlertDialog`、`Drawer`、`Sheet`、`Popover` |
| 反馈 | `Toast/Sonner`、字段级错误、页面级错误态 |

所有组件必须有：默认、hover、focus-visible、disabled、loading、success、error 状态。加载过程中按钮宽度不得变化。

## 3. 信息架构

### 3.1 主导航

桌面端使用全局顶部导航，所有 `/app/*` 页面必须保留：

1. 对话
2. 邮件
3. 页面
4. 渠道
5. 数据
6. 技能
7. 插件
8. 本机设置（图标按钮）

Logo 点击进入 `/app` 总览。当前页面使用文字、颜色和底线/底色三者中的至少两种表达，不只改变文字颜色。

移动端使用固定底部导航：

- 对话
- 邮件
- 页面
- 渠道
- 更多

“更多”打开底部 Drawer，包含数据、技能、插件、本机设置、更新记录。底部导航必须考虑 `safe-area-inset-bottom`，页面正文预留不小于导航高度的底部空间。

### 3.2 页面地图与实现状态

| 页面 | 路由 | 优先级 | 当前状态 | 目标 |
| --- | --- | --- | --- | --- |
| 总览 | `/app` | P1 | 已有基础页 | 改为工作台入口与状态摘要 |
| 对话 | `/app/chat`、`/app/chat/:id` | P0 | 已统一 | 完善状态和移动端细节 |
| 邮件 | `/app/mail` | P0 | 已统一 | 完善接入向导和详情状态 |
| 页面 | `/app/pages` | P0 | 已统一 | 完善移动预览和发布反馈 |
| 渠道 | `/app/channels` | P0 | 已统一概览 | 增加多渠道详情与连接流程 |
| 数据 | `/app/data` | P0 | Next 占位页 | 迁移为数据库浏览与查询工作台 |
| 技能 | `/app/skills` | P0 | Next 占位页 | 迁移目录、搜索和详情 |
| 插件 | `/app/plugins` | P1 | 已有基础页 | 增加生命周期管理 |
| 本机设置 | `/app/setup` | P0 | 已统一 | 持续优化检测、认证和行动引导 |
| 更新 | `/app/update` | P1 | Next 占位页 | 版本、升级、回滚和结果 |
| 发布记录 | `/app/releases/:id?` | P1 | 旧页面 | 纳入统一 Shell |
| 自动化 | `/app/automations` | P2 | 旧页面 | 纳入统一 Shell |
| 计划任务 | `/app/schedules` | P2 | 旧页面 | 纳入统一 Shell |
| 登录 | `/login` | P0 | 独立响应式页 | 保持轻量、统一视觉语言 |
| 公共页面 | `/pages/*` | P0 | 已有发布能力 | 由用户内容决定视觉，不加载 Console Shell |

`/app/files` 不进入目标主导航。文件不是独立产品域：对话附件归对话，邮件附件归邮件，网页文件归 Pages，数据库和 Workspace 数据归数据页。旧路由只做兼容跳转或明确退役提示。

### 3.3 全局页面结构

桌面端：

- 顶部导航高度 56–64px，sticky。
- 主内容最大宽度建议 1180–1280px；对话、邮件、数据等工作台页可全宽使用剩余空间。
- 页面标题区包含标题、短说明、页面级主操作；不放功能宣传文案。
- 工具页优先使用“工具栏 + 列表/工作区”结构，不把每个区块都做成浮动卡片。

移动端：

- 顶部只保留当前页面标题和 1–2 个最关键操作。
- 复杂筛选放 Drawer/Sheet；详情页使用完整页面或全屏 Sheet。
- 不保留永久双栏。列表选择后进入详情，并提供明确返回。
- 触控目标至少 44×44px；输入区域弹出键盘后仍能看到发送/确认按钮。

## 4. 全局交互规范

### 4.1 状态语义

统一使用以下状态，不允许不同页面用相反颜色：

| 状态 | 图标语义 | 颜色 | 文案示例 |
| --- | --- | --- | --- |
| 可用/完成 | Check Circle | success | 可用、已连接、已完成 |
| 运行中 | Loader/Activity | info | 检测中、发布中、同步中 |
| 需处理 | Alert Circle | warning | 需登录、需配置、即将过期 |
| 不可用 | X Circle | error | 连接失败、验证失败 |
| 未启用 | Circle/Minus | muted | 未配置、未启用 |

### 4.2 异步反馈

- 首次加载显示与最终布局等高的 Skeleton，禁止整页只显示旋转图标。
- 操作提交后，触发按钮显示 spinner 和动词进行时，且禁用重复提交。
- 成功同时更新当前对象状态并显示 toast；重要成功结果应留在页面中，不能只靠短暂 toast。
- 错误必须包含：发生了什么、可能原因、下一步操作。保留服务端错误码用于复制和支持排查，但不把错误码作为主文案。
- 自动轮询必须显示“最后检查时间”；断线后暂停并提供重试。

### 4.3 危险与外部操作

风险等级：

- **R0 只读**：直接执行。
- **R1 本机可逆**：说明结果后执行，例如导入邮件、创建快照。
- **R2 外部写入或配置变更**：执行前确认目标、权限和影响，例如发布公网页面、渠道发帖、启用插件。
- **R3 破坏性/不可逆**：二次确认，并要求输入对象名或明确确认文本，例如执行危险 SQL、删除数据、回滚覆盖。

确认弹层必须写清“会改变什么”和“不会改变什么”，不能只显示“确定吗”。

### 4.4 空状态与帮助

- 空状态只给当前最合适的下一步，不堆叠多个平级按钮。
- 首次使用说明尽量放在上下文中，例如邮件页的接入向导，而不是独立的“使用说明”长页。
- 技术细节放可展开区或“检测详情”，普通用户先看到结论和行动。

## 5. 页面详细需求

## 5.1 总览

**路由：** `/app`  
**目标：** 用户在 10 秒内知道 Node 是否可用、最近在做什么，以及下一步可以去哪里。

### 页面结构

1. 顶部欢迎区：简短标题、当前运行位置（本机）、“开始对话”主按钮、“检查本机”次按钮。
2. 状态摘要带：本机、Codex、公网、Agent 邮箱、渠道五类状态。公网和邮箱是可选能力，不可用时不得把整个 Node 标为故障。
3. 最近活动：最近对话、最近邮件、最近页面发布，按时间排序，最多 6 条。
4. 快速入口：新对话、导入邮件、发布页面、管理数据。
5. 所有权说明：Core、Workspace、Plugins 三者关系，保持简洁，作为次级信息。

### 数据与交互

- 读取 Setup 摘要、最近会话、邮件统计、页面统计。
- 点击状态进入 `/app/setup` 对应检测项。
- 点击最近活动进入具体对象，不进入泛列表。
- 所有模块独立失败；邮件接口失败不应阻止对话入口显示。

### 移动端

- 状态摘要改为横向可滚动的紧凑状态单元或两列网格，不能出现五张纵向大卡。
- 最近活动使用单列列表；隐藏次要元数据。
- 快速入口最多展示两个常用动作，其余放“更多操作”。

### 验收状态

首次启动、部分能力不可用、全部可用、单模块加载失败、无最近活动、窄屏长用户名。

## 5.2 对话

**路由：** `/app/chat`、`/app/chat/:sessionId`  
**目标：** 用户在 Console 中直接与本机 Codex Agent 完成一次真实对话，并能继续、停止和回看会话。

### 页面结构

桌面端使用工作台布局：

- 左侧 280–320px 会话栏：新对话、搜索/筛选预留、会话列表、状态与更新时间。
- 右侧对话区：会话标题、状态、停止/更多操作、消息流、底部输入框。
- 输入框固定在对话区底部，不覆盖最后一条消息。

消息样式：

- 用户消息右侧或有明确用户标识；Agent 消息左侧，正文宽度适合阅读。
- `tool`、`system`、`error` 消息使用可折叠技术记录，不与普通回答视觉同级。
- Markdown、代码块、长 URL、表格和命令输出不得撑破容器。
- 运行中在最后消息位置显示稳定的状态行，不使用不断改变高度的占位内容。

### 主要操作

- 新建会话：`POST /api/chat/sessions`，字段 `task`、`title`、`createdBy: "web"`。
- 查看会话：`GET /api/chat/sessions/:id`。
- 继续对话：`POST /api/chat/sessions/:id/input`。
- 停止运行：`POST /api/chat/sessions/:id/stop`，需有明确停止反馈。
- 实时状态：WebSocket `/api/chat/ws`；断开后降级为轮询并提示连接状态。

### 数据结构

```ts
type ChatSession = {
  id: string;
  title: string;
  status: "starting" | "running" | "idle" | "paused" | "done" | "archived";
  summary?: string;
  updatedAt?: string;
  messages?: ChatMessage[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "agent" | "tool" | "system" | "error";
  content: string;
  createdAt?: string;
};
```

### 空态与错误

- 无会话：主区直接显示任务输入，不要求先点击“新建”。
- Codex 未登录/不可用：解释原因，并提供跳到 Setup 对应项的按钮。
- 发送失败：保留用户输入，支持重试，不自动清空。
- 会话不存在：返回会话列表并提示已删除或不可访问。

### 移动端

- 默认只显示当前对话；会话列表由顶部菜单按钮打开全高 Sheet。
- 选择会话后 Sheet 自动关闭，标题栏保留再次打开入口。
- Composer 适配软键盘和 safe area；发送使用图标按钮并有“发送”可访问标签。
- Enter 换行还是发送必须保持一致：桌面 Enter 发送、Shift+Enter 换行；手机使用按钮发送。

### 验收状态

无会话、创建中、真实运行中、停止中、完成、网络断开、Codex 不可用、长回复、代码块、移动端软键盘。

## 5.3 邮件

**路由：** `/app/mail`  
**目标：** 用户理解 Agent 邮件是什么、如何接入自己的邮件来源，并能查看本地归档、正文、附件及关联会话。

### 页面结构

1. 顶部状态带：本地接收是否就绪、归档数量、Workspace 存储说明。
2. 首次/未接入时显示接入向导；接入后默认显示邮件工作台。
3. 桌面工作台：左侧邮件列表，右侧邮件详情。
4. 详情包含主题、发件人、收件人、时间、正文、附件、匹配原因和关联会话。

### 接入自己的邮件来源

必须提供可执行的分步向导，而不是只显示“启用检测”：

1. **快速试用：导入 EML。** 选择 `.eml` 文件，本机解析并写入 Workspace。
2. **长期接入：用户自管 MTA/转发规则。** 展示当前设备可复制的接收命令 `open-abg-mail-ingest`、所需环境状态、允许的收件地址和测试步骤。
3. **可选 Agent 公网邮箱。** 从 Setup 完成 Cloud 授权后展示已分配地址；公网邮箱与域名作为同一个验证流程。
4. **发送测试邮件并检查结果。** 显示最后检测时间、是否收到、失败原因和重试。

产品不代用户托管 SMTP 凭证。涉及邮箱提供商的操作应在新窗口打开对应设置页，回到 Console 后点击“重新检测”。

### 主要操作与接口

- 状态：`GET /api/system/mail/status`。
- 列表/详情：`GET /api/app/mail/messages?message=:id`。
- EML 导入：`POST /api/app/mail/import`，请求体为原始 RFC822 内容。
- 原文：`/app/mail/messages/:id/raw`。
- 附件：`/app/mail/messages/:id/attachments/:index`。
- 关联对话：跳转 `/app/chat/:sessionId`。

### 数据结构

```ts
type MailStatus = {
  suggestedRecipients: string[];
  ingress: { ready: boolean; tokenConfigured: boolean; shimReady: boolean; command: string };
  archive: { messages: number; bytes: number };
  policy: { mtaUserManaged: boolean };
};

type MailEvent = {
  id: string;
  title: string;
  sender: { address: string; displayName?: string };
  receivedAt: string;
  matched: boolean;
  payload: {
    recipients: string[];
    textPreview: string;
    attachments: Array<{ name: string }>;
  };
};

type MailContent = {
  subject: string;
  from: Array<{ name?: string; address: string }>;
  to: string[];
  date: string;
  body: string;
  bodyTruncated?: boolean;
  error?: string;
  attachments: Array<{ index: number; name: string; contentType: string; sizeBytes: number }>;
};
```

### 移动端

- 列表与详情分成两个视图，选择邮件后进入详情页，顶部提供返回邮件列表。
- 接入向导使用步骤 Accordion；当前步骤展开，已完成步骤显示成功状态。
- 附件操作保持 44px 触控高度，长文件名截断但可查看完整 tooltip/详情。

### 验收状态

未接入、可导入、导入中、导入成功、格式错误、文件过大、空归档、正文截断、附件下载失败、已关联/未关联会话、公网邮箱未配置。

## 5.4 页面发布

**路由：** `/app/pages`  
**目标：** 用户选择本机 HTML 内容，发布为可预览页面，并分别检查 Web 与 Mobile 效果。

### 页面结构

- 顶部标题与“选择文件/发布”主操作。
- 文件区显示文件名、大小、更新时间、发布路径和持久化状态。
- 内容列表按最近更新排序。
- 预览区提供 `Web` / `Mobile` segmented control、刷新、在新窗口打开。
- iframe 使用 sandbox，预览与 Console 权限隔离。

### 主要操作与数据

- 列表：`GET /api/publications`。
- 发布：`POST /api/publications/upload`。

```ts
type PublishInput = {
  fileName: string;
  folder: "console";
  content: string;
  encoding: "utf8";
  mimeType: string;
};

type PageAsset = {
  fileName: string;
  bytes: number;
  updatedAt: string;
  publicPath: string;
  url: string;
  durable?: boolean;
};
```

发布到公网属于 R2 操作。确认中展示目标 URL、是否覆盖同名内容、文件大小和公开可访问提示。本机预览不需要 R2 确认。

### 移动端

- 不展示缩小后的桌面双栏。先显示内容列表，选择后进入独立预览视图。
- Web 预览允许在固定宽度画布内横向查看；Mobile 预览按 390px 逻辑宽度缩放适配容器。
- 主发布按钮固定在页面工具栏，不做遮挡内容的悬浮大按钮。

### 验收状态

无页面、已选文件、文件读取失败、发布中、发布成功、覆盖确认、发布失败、URL 不可用、Web/Mobile 预览、iframe 内容异常。

## 5.5 渠道

**路由：** `/app/channels`、目标详情 `/app/channels/:provider`  
**目标：** 统一管理多个输入/输出渠道，清楚区分已连接、需要登录、不可用和计划中。

### 渠道范围

- Web Console：默认可用。
- 微信：内置渠道，可启用和扫码登录。
- 小红书：可选托管平台，默认关闭，支持扫码、验证码保护、搜索和笔记详情。
- 后续渠道：通过同一适配器与插件机制进入，不为单个渠道重做一级页面。

### 概览页结构

- 顶部展示已连接数量、需处理数量、最近检查时间和刷新。
- 渠道以紧凑列表或同级卡片展示：图标、名称、状态、账号摘要、能力、最后检查、主要操作。
- 计划中渠道放独立“可用扩展”区域，不与故障渠道混合。

### 详情/连接流程

- 基本信息：provider、版本、只读/可写、来源（内置/插件）。
- 连接状态：登录账号、过期时间、诊断结果。
- 能力：对话、页面、桌面/移动、图片、文件、扫码、搜索、详情等。
- 权限：读取、外部写入、通知范围。
- 操作：连接、重新登录、检查状态、断开。断开和外部写入为 R2。
- 扫码在 Dialog（桌面）或全屏 Drawer（移动）中完成；状态包含等待扫码、已扫码待确认、需要验证码、成功、过期、失败。

```ts
type Channel = {
  provider: string;
  label: string;
  state: string;
  statusLabel: string;
  description?: string;
  capabilities?: string[] | Record<string, string[]>;
  readOnly?: boolean;
};
```

### 移动端

- 渠道概览单列；能力标签最多显示 3 个，其余显示数量。
- 扫码页保持二维码足够大，并给出“在另一台设备打开”或复制登录链接的备选路径。
- 验证码输入使用数字键盘、自动聚焦和清晰的过期倒计时。

### 验收状态

已连接、需登录、检查中、过期、验证码中、服务不可用、只读、计划中、无渠道、多个账号摘要、移动端扫码。

## 5.6 数据

**路由：** `/app/data`  
**目标：** 让用户浏览 Workspace 中的 SQLite 数据对象、筛选查询、查看结构、执行受保护 SQL 并用快照恢复。

当前 Next 页面是占位页。本页为 P0 迁移目标。

### 桌面端页面结构

1. 顶部状态栏：数据库可用状态、对象数、数据库大小、快照数、刷新。
2. 左侧对象导航 240–280px：表/视图分组、搜索、行数。
3. 主工作区 Tabs：`数据`、`结构`、`SQL`、`快照`、`操作记录`。
4. 数据工具栏：筛选、排序、列显示、分页、刷新。
5. 表格使用 sticky header；数字右对齐，空值显示 `NULL`，Blob 显示类型和大小。

### 数据浏览

- 选择对象后调用对象描述与查询接口。
- 筛选器使用字段、操作符、值三个控件，可添加最多 24 条。
- 支持搜索、排序、分组、聚合指标和分页；每页 1–200，默认 50。
- URL 可保存当前对象、Tab、页码和基础筛选，但不得把敏感值写入 URL。
- 大表先展示 Skeleton 和总数加载状态，避免页面冻结。

### 结构

展示：对象类型、建表 SQL、字段名、类型、非空、默认值、主键位置、隐藏字段、索引、外键。SQL 默认折叠，可复制。

### SQL 工作台

- 编辑器上方明确当前目标是本机 Workspace 数据库。
- 只读 SQL 可直接执行；写入 SQL 显示影响提示。
- 破坏性 SQL 自动创建快照，并进行 R3 确认。
- 系统阻止 ATTACH、DETACH、`load_extension`、`VACUUM INTO`、危险 PRAGMA 和用户事务控制时，要在编辑器下方解释限制。
- 结果显示列、行数、执行耗时、是否创建快照和操作 ID。

### 快照

- 列表字段：创建时间、原因、大小、是否有托管副本、关联操作。
- 创建快照是 R1；恢复是 R3，确认覆盖范围并自动生成回滚快照。
- 恢复成功展示恢复的 snapshot ID、rollback snapshot ID 和新 schema version。

### 接口与数据

| 接口 | 用途 |
| --- | --- |
| `GET /api/app/data/status` | 数据库状态与操作记录 |
| `GET /api/app/data/schema` | 对象目录与元数据 |
| `GET /api/app/data/objects/:name` | 对象结构 |
| `POST /api/app/data/query` | 筛选、分组、排序、分页查询 |
| `POST /api/app/data/distinct` | 筛选值建议 |
| `POST /api/app/data/sql` | 受保护 SQL |
| `GET/POST /api/app/data/snapshots` | 查询/创建快照 |
| `POST /api/app/data/snapshots/:id/restore` | 恢复快照 |
| `POST /api/app/data/metadata` | 更新对象元数据 |

```ts
type DataStatus = {
  databasePath: string;
  sizeBytes: number;
  schemaVersion: number;
  objects: number;
  snapshotCount: number;
};

type DataObject = {
  name: string;
  type: "table" | "view";
  sql: string;
  columnCount: number;
  rowCount: number;
};

type QueryPage = {
  number: number;
  size: number;
  totalRows: number;
  totalPages: number;
};

type Snapshot = {
  id: string;
  reason?: string;
  sizeBytes: number;
  createdAt: string;
  managed?: unknown;
};
```

数据库绝对路径属于实现细节。UI 默认显示“Workspace / data”，只有展开诊断详情时才显示本机路径，并提供复制按钮。

### 移动端

- 对象目录使用 Drawer；选择后进入主工作区。
- Tabs 可横向滚动，但默认只显示数据、结构、更多，SQL 和快照放“更多”内。
- 表格保持列宽，不强行压缩所有列；首列 sticky，区域允许横向滚动。
- 筛选器使用全屏 Sheet，一行一个条件。
- SQL 编辑与结果上下排列，执行按钮在键盘弹出时可见。

### 验收状态

数据库为空、对象很多、视图、无行、NULL/Blob、加载大表、筛选无结果、SQL 成功/被阻止/语法错误、自动快照、恢复成功/失败、移动横向表格。

## 5.7 技能

**路由：** `/app/skills`  
**目标：** 用户可以发现 Node 已携带的技能，理解用途、成熟度、风险和使用入口。

当前 Next 页面是占位页；旧版 `/agent-skills` 有目录数据。本页为 P0 迁移目标。

### 页面结构

- 顶部：技能数量、搜索框、分类筛选、刷新。
- 主列表：按分类分组，行项目展示名称、描述、成熟度、来源、风险数量和 CLI 标记。
- 桌面详情使用右侧 Sheet，移动端使用全屏详情页/Drawer。
- 分类：研究与知识、写作与内容、视觉与媒体、发布与自动化。

### 详情内容

1. 名称、描述、目录和来源。
2. 成熟度状态与风险标签。
3. 安全约束和权限说明。
4. CLI 命令，以可复制代码块展示。
5. 使用示例。
6. 是否要求用例验收。
7. 相关技能，可直接切换详情。

### 数据结构

技能目录由 Node Harness 的 `registry/skills.json` 和各技能 `SKILL.md` frontmatter 共同生成：

```ts
type SkillCatalog = {
  categories: Array<{ id: string; label: string; order?: number }>;
  skills: Skill[];
};

type Skill = {
  name: string;
  directory: string;
  category: string;
  maturity: string;
  risks: string[];
  security: Record<string, unknown>;
  origin: string;
  cli: string[];
  examples: string[];
  caseRequired: boolean;
  related: string[];
  description: string;
};
```

目标增加只读接口 `GET /api/skills`（经 Console 网关暴露）。UI 不直接读取文件系统。

### 交互与状态

- 搜索匹配名称、描述、分类和 CLI；输入 150ms 后本地筛选。
- 分类筛选保持在 URL query 中，方便返回。
- 成熟度和风险不是装饰 Badge，hover/focus 可看到定义。
- 技能目录默认只读。未来安装/更新技能应走插件或 Node Harness 工作流，不在此页面直接写入未知来源代码。
- 目录不一致、SKILL.md 缺失或 frontmatter 错误时显示“目录异常”并提供诊断信息。

### 移动端

- 搜索置顶，分类用横向 Tabs 或 Select；避免多行 Chip 占满首屏。
- 技能列表单列，描述最多三行。
- 详情全屏，底部只保留“复制命令”等直接操作。

### 验收状态

正常目录、无技能、搜索无结果、分类切换、缺失说明、风险技能、无 CLI、长命令、相关技能跳转、移动详情。

## 5.8 插件

**路由：** `/app/plugins`  
**目标：** 管理 Node 功能扩展，并让用户理解插件能访问什么。

### 页面结构

- 已安装插件列表：名称、版本、状态、来源、权限、更新时间。
- 插件详情：描述、贡献点、权限、配置、运行状态、日志入口。
- 扩展能力说明作为次级区块，不使用大面积深色代码示例占据首屏。

贡献点：Page slot、Agent tool、后台任务、渠道适配器、计划任务。

```ts
type Plugin = {
  id: string;
  version: string;
  name: string;
  description?: string;
  state: "enabled" | "disabled";
  permissions: string[];
};
```

### 操作

- 安装/导入、启用、停用、更新、移除、查看权限和诊断。
- 安装、启用、更新、移除均为 R2；新增权限必须再次确认。
- 更新前显示版本变化、权限差异和回滚能力。
- 插件故障不能让 Console 整体不可用；列表明确“已隔离/加载失败”。

### 移动端

- 列表单列；详情用全屏 Sheet。
- 权限差异使用逐行列表，不使用难以横向阅读的表格。

## 5.9 本机设置 / Setup Center

**路由：** `/app/setup`  
**目标：** 用一个 Todo List 帮用户把电脑准备好。每个未通过项都要有原因、解决动作和重新检测。

### 信息层级

1. 页面标题：把这台电脑准备好。
2. 深色 readiness 摘要：已完成数、待处理数、进度；所有文字保持高对比。
3. “现在处理”Todo List：只包含当前能执行且影响使用的事项。
4. “完成自己的配置”：包含可选能力和检测详情，放在 Todo List 之后，不采用左右高低不平的双栏。

### 检查项

- 本机安装与 Core 链接。
- 本机登录密码。
- Codex 安装、版本、登录和真实对话。
- 公网域名 + Agent 邮箱，作为一个 Cloud 授权任务。
- 邮件来源接入。
- 渠道状态。

公网与邮箱验证流程：

1. Node 检测本机已有 Cloud binding。
2. 未绑定时显示“验证公网与邮箱”。
3. 点击后打开已登录的 `chenjianhui.site` 页面进行一次授权。
4. 页面回调本机，Node 拉取公开资源状态。
5. 同时展示公网域名和 Agent 邮箱结果；部分成功时明确哪一项未就绪。
6. Cloud 授权服务不可达时保留重试，并显示本机仍可正常使用，不能形成死循环。

### 检查与动作数据

```ts
type SetupState = "ready" | "checking" | "action-required" | "blocked" | "not-selected";
type SetupRequirement = "required-for-console" | "required-for-agent" | "conditional" | "optional";

type SetupCheck = {
  id: string;
  group: string;
  requirement: SetupRequirement;
  state: SetupState;
  summary: string;
  why: string;
  guidance: string;
  actionIds?: string[];
};

type ManagedCloudAction = {
  state: "idle" | "starting" | "running" | "succeeded" | "failed";
  phase: "idle" | "enrollment" | "resources" | "complete";
  code?: string;
};
```

动作统一使用三段式接口：

- `POST /api/system/setup/actions/:id/plan`
- `POST /api/system/setup/actions/:id/approve`
- `POST /api/system/setup/actions/:id/execute`

### Todo 项设计

每项包含：序号、状态图标、任务名、一句话结果、展开区、主操作、重新检测、技术详情。一个时刻只默认展开最优先的未完成项；完成项折叠并移到列表后部。

本机密码：

- 两个密码字段，至少 12 个字符。
- 实时展示长度与一致性，不展示密码强度伪评分。
- 条件满足后“确认设置”必须可点击；提交中保持按钮尺寸；错误显示在字段和任务级。

Codex：

- 缺失时提供官方安装链接；版本过低给升级指引；未登录提供登录指引。
- “开始真实对话”跳到实际对话组件，而不是只触发后台检测。
- 完成真实回复后回到 Setup 自动更新状态。

### 移动端

- 全部单列。深色摘要压缩为进度、完成数、待处理数。
- Todo 展开内容中的表单单列排列。
- 主按钮全宽只用于关键步骤，其余按钮保持内容宽度。
- 底部导航不遮挡最后一个任务和错误提示。

### 验收状态

首次检测、检测中、本机密码错误/成功、Codex 缺失/未登录/真实回复、Cloud 未绑定/授权中/成功/服务不可达/部分成功、邮件未接入、全部完成、手机表单。

## 5.10 更新与发布记录

**路由：** `/app/update`、`/app/releases/:releaseId?`  
**目标：** 用户知道当前版本、是否有更新、更新会改变什么，并能查看历史结果和回滚信息。

页面包含当前 Core 版本、可用版本、Workspace 兼容性、变更摘要、更新前检查、下载/安装进度、验收结果、回滚入口。更新是 R2，回滚覆盖当前 Core 时为 R3；任何更新都不能删除 Workspace 数据。

发布记录按时间列出 release ID、版本、验收状态、时间、变更和证据。桌面使用列表 + 详情，移动使用列表到详情导航。两个路由最终纳入统一 Shell，不保留旧版孤立导航。

## 5.11 自动化与计划任务

**路由：** `/app/automations`、`/app/schedules`  
**优先级：** P2 统一迁移。

自动化页展示触发条件、步骤、状态、最近运行和失败原因；计划任务页展示 cron/自然语言计划、时区、下次运行、启停和运行历史。启用、停用和修改计划为 R2；立即运行显示实际影响范围。

移动端列表与编辑器分屏切换，复杂步骤编辑使用全屏页面。时间必须同时显示用户时区和绝对时间 tooltip。

## 5.12 登录

**路由：** `/login`  
**目标：** 用本机密码验证身份并安全返回原页面。

- 单一密码字段、显示/隐藏密码、提交按钮、错误提示。
- 不展示注册、找回密码和云账户入口。
- 失败不清空输入；多次失败提示等待但不泄漏内部策略。
- `return_to` 只接受本机安全路径。
- 手机软键盘弹出后按钮仍可见。

## 5.13 公共页面

**路由：** `/pages/*`  
**目标：** 展示用户发布的内容，不带 Console 导航、内部状态或管理控件。

- 与 Console 权限和 session 隔离。
- 不存在时使用简洁 404。
- 页面需声明 viewport 并由发布内容负责响应式；Console Preview 提供 Web/Mobile 验证入口。

## 6. 核心用户流程

### 6.1 首次准备

```text
打开本机 Console
  -> 自动进入 Setup / 或总览显示待处理
  -> 设置本机密码
  -> 检测 Codex
  -> 在真实对话组件获得一次回复
  -> 本机能力完成
  -> 可选：浏览器授权公网域名 + Agent 邮箱
  -> 可选：接入邮件来源和渠道
  -> 进入总览
```

关键原则：本机能力与 Cloud 可选能力分开计分。用户不付费、不配置 Cloud 时仍能正常对话、管理本地数据和迭代 Core。

### 6.2 对话到任务结果

```text
新建任务 -> Agent 运行 -> 实时消息/工具记录 -> 用户继续或停止 -> 完成 -> 可回看
```

中途关闭浏览器后会话仍保留，重新打开显示真实运行状态。

### 6.3 邮件接入

```text
邮件空态 -> 选择 EML 快速试用 / 自管 MTA / Agent 公网邮箱
  -> 按向导配置
  -> 发送或导入测试邮件
  -> 检测归档
  -> 查看正文、附件和关联会话
```

### 6.4 页面发布

```text
选择文件 -> 本机预览 -> Web/Mobile 检查 -> 确认公开目标 -> 发布 -> 打开 URL
```

### 6.5 数据恢复

```text
选择快照 -> 查看时间/原因/大小 -> R3 确认 -> 自动创建回滚快照 -> 恢复 -> 验证 schema 和数据
```

## 7. 响应式与移动端规范

### 7.1 建议断点

- `< 640px`：手机，单列、底部导航、全屏详情。
- `640–899px`：大屏手机/小平板，单列或主次切换。
- `900–1199px`：紧凑桌面，可使用窄侧栏。
- `>= 1200px`：完整工作台。

断点应基于内容是否容纳，而不是设备品牌。

### 7.2 导航与层级

- 固定底部导航只显示五项；更多功能进入 Drawer。
- 进入对象详情时，顶部显示返回与对象标题，底部主导航可保留，但不得同时出现两个固定底栏。
- Modal 在手机上优先转换为 Drawer 或完整页面。
- 浏览器返回必须回到上一列表状态，包括筛选、滚动位置和选中项。

### 7.3 内容适配

- 表格保留语义和列宽，允许横向滚动；不要把一行拆成难以比较的十个字段卡。
- 代码、路径、邮箱和 URL 可换行或水平滚动，不能撑破页面。
- 双栏工作台在手机上转换成“列表 -> 详情”，不简单上下堆叠造成超长页面。
- 页面标题、按钮、Badge 和导航文字必须在 320px 宽度不重叠。

### 7.4 键盘与可访问性

- 全站可用键盘操作，focus-visible 清晰。
- Dialog/Sheet 正确管理焦点，关闭后返回触发按钮。
- 图标按钮有 `aria-label` 和 tooltip。
- 状态、进度和错误用语义元素或 live region 通知。
- 支持 `prefers-reduced-motion`；不依赖动画传达状态。

## 8. API 与数据边界

### 8.1 前端访问原则

- Console 前端只访问同源 `/api/*`，不直接连接 Agent 内部端口。
- Next API catch-all 负责转发到本机服务；鉴权、CSRF 和写入策略由网关统一执行。
- UI 不直接读取 Workspace 文件系统，不在 localStorage 保存 token、密码、邮件正文或数据库内容。
- 绝对路径、内部端口、命令输出和错误栈默认放诊断详情，不作为用户主信息。

### 8.2 主要 API 矩阵

| 产品域 | API 前缀 | 读/写 |
| --- | --- | --- |
| 对话 | `/api/chat` | 读写 |
| 邮件 | `/api/app/mail`、`/api/system/mail` | 读写/导入 |
| 页面 | `/api/publications` | 读写/公开发布 |
| 渠道 | `/api/channels`、`/api/managed-platforms` | 读写 |
| 数据 | `/api/app/data` | 读写/危险写受保护 |
| 技能 | `/api/skills` | 只读目录 |
| 插件 | `/api/plugins`、`/api/extensions` | 读写 |
| Setup | `/api/system/setup` | 检测与受控动作 |
| 更新 | `/api/system`/发布相关接口 | 读写 |

### 8.3 用户数据归属

- 对话、邮件、数据库、快照、页面源文件、配置和审计记录属于 Workspace。
- Core 更新不能移动或覆盖 Workspace。
- 插件只能访问 manifest 声明并由用户批准的权限。
- Cloud 只同步用户明确开启的资源和必要公开状态；本机诊断、数据库内容、邮件正文默认不上传。

## 9. 设计稿交付清单

设计师至少需要交付以下画板和组件状态。

### 9.1 桌面端画板

1. 全局 Shell 与总览：正常、部分不可用。
2. 对话：空态、运行中、完成、错误、工具记录展开。
3. 邮件：未接入向导、列表详情、导入错误。
4. Pages：空态、选中文件、Web 预览、Mobile 预览、发布确认。
5. 渠道：多渠道概览、连接详情、扫码、验证码、失败。
6. 数据：数据表、结构、筛选、SQL、快照恢复确认。
7. 技能：分类列表、搜索无结果、详情 Sheet、目录异常。
8. 插件：列表、详情、权限差异、加载失败。
9. Setup：首次检测、Todo 展开、密码表单、真实对话、Cloud 授权、全完成。
10. Update/Release：有更新、更新中、成功、失败/回滚、发布详情。
11. 登录：默认、错误、提交中。

### 9.2 移动端画板

1. 全局底部导航与“更多” Drawer。
2. 对话与会话列表 Sheet、软键盘状态。
3. 邮件列表、详情、接入步骤。
4. Pages 列表、Web/Mobile 预览。
5. 渠道列表、扫码与验证码。
6. 数据对象 Drawer、横向表格、筛选 Sheet、SQL。
7. 技能列表与全屏详情。
8. Setup Todo、密码输入、Cloud 授权结果。
9. 登录。

### 9.3 组件与状态

- 全部 Button variant 和 loading。
- Input/Textarea/Select 的默认、focus、disabled、error。
- 状态 Badge、Alert、Progress。
- List row 默认、hover、selected、disabled、error。
- Tabs/segmented control。
- Dialog、AlertDialog、Sheet、Drawer。
- Skeleton、空态、页面级错误、Toast。
- 数据表、分页、筛选条件、代码块。

### 9.4 标注要求

- 字号、行高、间距、圆角、颜色 token、最大/最小宽度。
- 桌面与移动断点行为，不只给两张静态图。
- hover、focus、loading、disabled、error、empty 的行为说明。
- 长文本、长邮箱、长路径、中文/英文混排和 320px 屏幕下的处理。
- 每个外部写入和危险操作的确认层级。

## 10. 研发与验收准出

每个迁移页面必须满足：

1. 使用统一 App Shell，页面切换时导航不消失。
2. 使用 shadcn/ui 原语和全局 token，不复制一套局部按钮、输入或弹层。
3. 语义 HTML、键盘操作和 focus-visible 可用。
4. 覆盖 loading、empty、success、partial、error、offline 等真实状态。
5. 桌面和移动不是简单缩放；双栏在手机上转换为列表到详情。
6. 用户数据不离开 Workspace，敏感内容不进入日志、URL 和 localStorage。
7. API、路由和 session 自动化测试通过。
8. 视觉外观与交互最终由用户验收；不得以测试通过代替设计验收。

## 11. 当前实施顺序

1. 完成 Data 页 Next 迁移：状态、对象目录、数据、结构、SQL、快照和移动端。
2. 完成 Skills 页 Next 迁移：目录 API、分类搜索、详情和移动端。
3. 统一 Channels 详情和连接流程。
4. 完成 Update/Release 统一迁移。
5. 迁移 Automations/Schedules，退役独立 Files 页面。
6. 按本文设计稿持续收敛 Overview、Mail、Pages、Plugins 和 Setup 的细节。

