# ADR 0010：项目级专业子 Agent 与 Agent Teams 产品模型

- 状态：提议
- 日期：2026-07-29
- 范围：Personal Agent Node 主 Agent 委派、专业 Worker、桌面端 Agent Teams、Pages 交付与用户 Workspace
- 设计事实来源：`projects/prototype`
- 相关文档：ADR 0003 Core/Workspace 交付、`AGENTS.md` 中主 Agent与 Worker 委派约定

## 摘要

Personal Agent 的产品模型调整为 **Agent Teams**。

用户始终只与唯一主 Agent 沟通。主 Agent 理解请求、识别项目、选择专业子 Agent、分派或恢复任务、汇总进度与结果。专业子 Agent 是拥有稳定领域身份、工作方法、项目上下文和交付标准的团队成员；在运行时仍然使用受隔离的 Worker 会话，不新增第二类用户助手或新的安全角色。

第一批专业子 Agent 包括：

1. 装修设计 Agent；
2. 海报设计 Agent；
3. 旅游规划 Agent；
4. 账务分析 Agent。

每个专业子 Agent 同时拥有：

- 面向运行时的 `agent.yaml`；
- 面向专业执行的 `AGENT.md`；
- 面向用户和桌面端的 `profile.yaml`；
- 经过脱敏、可验证来源的产出示例。

桌面端在“连接”之后新增 Agent 团队入口与每个成员的独立介绍页。Agent 团队页沿用 Personal Agent 主体卡片结构，展示成员身份、专业范围、能力摘要、可用状态和详情入口，不再使用像素办公室、运行模拟世界或任务分派动画。`/app` 首页继续承担当前 Space 总览。

Personal Agent 不再提供可选择、可配置、可复用的 Page 模板。模板目录、模板详情、模板注册表、模板选择 CLI、模板强制路由和独立 `personal-pages` Skill 下线。原模板中的垂直领域方法、适用范围、生成方式、产出示例与验收标准迁入对应专业子 Agent。

Pages 本身不下线。Pages 继续作为 Agent 产物的发布、访问、缩略图、Activity 关联和历史结果载体。

## 背景

现有 Worker 架构已经能够委派、恢复和返回受治理产物，但所有 Worker 使用同一种通用身份。垂直专业性依赖 Skill 触发、任务文本和 Page 模板直接路由，导致以下问题：

- 用户看不到团队中有哪些专业成员，也无法在使用前理解其边界；
- 同一个领域的稳定方法分散在 Skill、模板、路由提示和示例资产中；
- Page 模板同时承担产品入口、专业路由、生成约束和展示示例，职责过多；
- 模板看似是可以挑选的外观框架，实际却携带了装修等垂直领域的完整专业流程；
- 现有产品没有独立、可理解的专业成员目录，用户无法在使用前判断主 Agent 会把任务交给谁。

专业能力应归属于专业子 Agent，Page 应回到“交付结果”这一单一职责。

## 目标

满足以下条件即视为方案成功：

- 垂直领域任务获得稳定、版本化的专业身份与工作方法；
- 每个专业子 Agent 都有独立、详尽、可从桌面端进入的介绍页；
- 介绍页明确展示能力、使用范围、所需输入、工作方式、产出示例、限制和验收标准；
- 同一项目的后续修改恢复同一个专业子 Agent 会话；
- 不同项目、不同 Agent 和不同 Space 的上下文保持隔离；
- 跨领域协作只传递选定的受治理产物与必要上下文；
- Agent 团队页能清楚解释“主 Agent 统一分派、项目上下文连续、专业边界清晰”的协作模型；
- Page 模板产品层完全下线，不再承担专业路由；
- Page 发布、访问、历史结果和安全边界保持可用；
- 用户始终只面对一个连贯的主 Agent 会话。

## 非目标

本方案不做以下事情：

- 不把每一个 Skill 都改造成 Agent；
- 不复制或内嵌公共 Skill；
- 不允许专业子 Agent 之间点对点发送消息；
- 不增加独立“发布 Agent”；
- 不提供 Agent 市场、安装商店或用户编辑专业提示的设置界面；
- 不把只读 Agent 目录和介绍页做成配置管理界面；
- 不引入声明式工作流、DAG 运行时或自动审核循环；
- 不增加单独的领域记忆数据库；
- 不替换现有 `main` 和 `worker` 会话角色；
- 不让 Worker 直接面向用户、写入全局 Activity 或 Memory；
- 不把 Agent 团队目录做成任务控制面或运行状态模拟器；
- 不因模板下线而删除历史 Page 或用户产物；
- 不用自动视觉测试替代用户对设计稿和正式 UI 的验收。

## 核心决策

### 1. 产品层是 Agent Teams，安全层仍是 main + worker

产品向用户展示一个主 Agent 和多个专业团队成员。

主 Agent 继续负责：

- 理解用户请求和重要歧义；
- 判断是否需要委派；
- 选择专业子 Agent 或通用 Worker；
- 判断请求属于新项目还是已有项目；
- 启动、恢复和监控正确的 Worker 会话；
- 只传入当前任务需要的受治理对象与上下文；
- 接收进度、完成、缺少输入和失败结果；
- 组织 Activity、Memory、最终附件和用户回复。

专业子 Agent 继续运行在 `role: worker` 会话中。它不获得主 Agent 的权限，不成为第二个对话入口，也不创建 Agent 间消息网络。

产品名称变化不扩大权限边界。

### 2. 每个专业子 Agent 是一等产品实体

可移植源文件采用：

```text
agents/
├── interior-designer/
│   ├── agent.yaml
│   ├── AGENT.md
│   ├── profile.yaml
│   └── examples/
├── poster-designer/
├── travel-planner/
└── finance-analyst/

registry/
└── agents.json
```

三类文件职责不可混淆：

| 文件 | 受众 | 职责 |
| --- | --- | --- |
| `agent.yaml` | 运行时 | ID、版本、说明文件、推荐 Skill、路由摘要、公开资料引用 |
| `AGENT.md` | 专业 Worker | 如何理解任务、组合 Skill、维护项目、处理修改和报告产物 |
| `profile.yaml` | 用户与 UI | 介绍页内容、能力、边界、方法、结果类型、示例和验收标准 |

桌面端禁止直接展示完整 `AGENT.md`。内部提示、守卫说明、工具细节和不适合公开的实现约束不能通过介绍 API 泄露。

### 3. Agent 配置保持精简，公开资料保持结构化

`agent.yaml` 示例：

```yaml
schemaVersion: 1
id: interior-designer
version: 1
displayName: 装修设计 Agent
description: 负责装修、户型、空间布局和室内设计交付。
instructions: AGENT.md
profile: profile.yaml
skills:
  - home-renovation
  - interior-design
  - visual-content
  - media-toolkit
  - personal-files
routing:
  domains:
    - renovation
    - interior design
    - 装修
    - 户型
  summary: 户型、空间布局、室内概念、3D 场景与装修方案修订。
```

`profile.yaml` 必须支持：

```yaml
schemaVersion: 1
overview:
  role: 空间与室内设计专家
  tagline: 把户型证据、生活需求和设计取舍变成可持续修改的专业方案。
capabilities: []
useWhen: []
notFor: []
requiredInputs: []
workflow: []
deliverables: []
examples: []
limitations: []
acceptance: []
visualIdentity: {}
```

每个列表必须有明确数量和长度上限。示例只能引用产品打包的安全示例资产或受治理对象，不允许任意绝对路径、`file://`、loopback URL、远程脚本或未验证 HTML。

### 4. 公共 Skill 继续只维护一份

Skill 仍是可复用能力层。多个专业子 Agent 可以引用同一个 Skill，例如 `deep-research`、`visual-content`、`content-workbench`、`media-toolkit` 和 `personal-files`。

Agent 配置通过 Skill ID 引用公共能力，禁止：

- 把 Skill 复制到 Agent 目录；
- 将完整 Skill 内容嵌入 `AGENT.md`；
- 为同一公共能力建立 Agent 私有分叉；
- 因 Agent 产品化而改变原 Skill 的授权与安全规则。

独立 `personal-pages` Skill 例外：它当前以模板选择为首要职责，随模板产品层一起退休。通用 Page 发布的安全规则迁入 Worker 基础约定、CLI 契约和 Page 服务，不再作为用户可发现的垂直 Skill。

### 5. 使用项目级粘性专业 Worker 会话

专业子 Agent 会话身份键为：

```text
mainSessionId + agentId + projectKey
```

`mainSessionId` 保留用户关系，`agentId` 保留专业身份，`projectKey` 隔离同一专业子 Agent 的不同项目。

```text
主会话
├── interior-designer / project_7e6b2f20
├── interior-designer / project_a1700c31
├── travel-planner / project_f030dc57
└── finance-analyst / project_9c121e84
```

项目首个任务创建新会话；后续属于同一项目的任务恢复该会话。任务完成后可以进入 `idle`，但项目历史与当前产物仍然保留。

### 6. 当前事实必须持久化到项目产物

Worker 会话保留专业工作历史，但不是当前结果的权威数据库。

当前事实的优先级为：

1. 用户最新反馈；
2. 当前经过验证的项目文件和修订版本；
3. 此前已确认的决策；
4. 历史对话和废弃草稿。

各专业子 Agent 使用适合领域的项目结构：

- 装修设计保存证据、需求、布局、场景、修订、审计和交付记录；
- 海报设计保存内容规划、源素材、版式源文件、渲染结果和规格；
- 旅游规划保存限制、来源、行程、预订优先级、未知项、Page 和可选 PDF；
- 账务分析保存账单来源、标准化流水、分类确认、异常项、分析 Page 和复核清单。

### 7. 根据明确项目身份新建或续接

同时满足以下条件时恢复已有专业会话：

- 请求属于相同领域；
- 请求指向同一项目或产物版本链；
- 当前主会话下存在唯一匹配；
- 用户是在继续、回答、纠正或修改该工作；
- 没有另一个并发任务正在修改同一项目。

以下情况创建新会话：

- 请求属于另一个领域；
- 涉及另一套住房、旅行、活动、账务周期或其他独立项目；
- 用户明确要求从头开始；
- 需要并发执行彼此独立的分支；
- 多个历史项目匹配且用户选择了另一个项目；
- Agent 配置版本不兼容，必须创建延续会话。

不能只凭关键词相似恢复会话。多个重要项目都可能匹配时，主 Agent只提出一个会实质影响结果的简短问题。

### 8. Agent 间交接统一经过主 Agent

跨领域工作流程：

1. 来源专业子 Agent 完成或更新产物；
2. 主 Agent 选择受治理产物和必要摘要；
3. 主 Agent 启动或恢复目标专业子 Agent；
4. 目标 Agent 只接收选定上下文；
5. 结果返回主 Agent。

例如，将旅行攻略制作成社交卡片时，海报设计 Agent 接收确认后的攻略产物和新的传播目标，不接收旅游规划 Agent 的完整任务历史。

### 9. 专业子 Agent 负责自己的交付

发布属于领域任务，不新增发布 Agent。

- 装修设计 Agent 生成装修交付 Page；
- 海报设计 Agent 渲染并登记托管图片；
- 旅游规划 Agent 发布攻略 Page，并可导出 PDF；
- 账务分析 Agent 发布脱敏分析 Page，并可交付标准化账本和复核清单。

Agent 使用通用 `pa-cli pages publish` 或 `pa-cli pages upload` 契约。Page 服务继续负责：

- 公开与私有隔离；
- 安全内容与文件检查；
- `pageId`；
- 当前访问环境对应的安全 URL 或 `linkNotice`；
- 桌面端与移动端缩略图；
- Page Activity 的稳定 target；
- 历史访问兼容。

Page 服务不再选择模板，也不校验模板 ID、模板版本、模板 marker 或模板 contract digest。

## 桌面端产品信息架构

### Agent 团队成员目录

正式 Node 路由：

```text
/app/agents
```

Prototype 设计路由：

```text
/desktop/agents
```

该入口位于桌面端“连接”菜单之后，使用与桌面端其他一级页面一致的 Page Header、留白、边框和卡片语言。页面包含：

- 一段简洁的团队定位；
- “主 Agent 统一分派、项目上下文连续、专业边界清晰”三条协作原则；
- 四个专业成员在宽屏同排展示、窄屏自适应换列的紧凑卡片目录；
- 每张卡片中的专业名称、领域角色、能力摘要、可用状态、能力与产出数量；
- 进入独立 Agent 介绍页的整卡链接。

卡片必须直接使用“装修设计 Agent、海报设计 Agent、旅游规划 Agent、账务分析 Agent”等完整名称，不得使用“空间 Agent、视觉 Agent”等需要二次理解的抽象简称。页面不展示像素办公室、人物工位、任务移动、活动日志或模拟运行状态，也不提供安装、删除、启用、禁用或编辑提示操作。用户仍通过主 Agent 对话创建或修改工作。

### Agent 介绍页

正式 Node：

```text
/app/agents/<agentId>
```

Prototype：

```text
/desktop/agents/<agentId>
```

每个页面使用规整的三段式信息结构：

1. 身份与专业契约：名称、角色、定位、能力与产出数量、公开 Skill 摘要；
2. 代表产物：从原 Pages 模板展示能力迁入的真实页面、文件、图片或研究结果示例；
3. 专业说明：能力与使用边界、工作方法、其他交付类型和验收标准。

代表产物必须以可感知其专业质量的尺寸内嵌展示，不提供“打开完整产物”等跳离介绍页的操作。设备支持按产物本身决定，不强制所有示例同时提供 Web 和移动双视图：海报、社交卡片与旅行攻略可以只提供移动端主视图，装修 3D 与账务分析可以保留更适合的大屏视图。它是能力证明，不是用户可选择、可配置或可复用的模板。页面骨架可以复用，但不得只替换名称、图标和主题色。四个 Agent 的专业方法、示例与验收说明必须分别编写。

介绍页属于长内容阅读界面，不沿用团队卡片的压缩字号。主要说明文字应保持清晰可读，辅助标签只承担次要层级。一个代表产物同时支持桌面端与移动端预览时，设备切换必须单行等宽显示，不得因容器选择器或窄宽度变成上下两行；仅支持移动端时展示不可换行的设备说明。

### Pages 结果库

正式 Node：

```text
/app/pages
```

Prototype：

```text
/desktop/pages
```

Pages 只展示已生成和已发布结果。页面保留搜索、可见性筛选、缩略图、详情和打开操作；不再提供“查看模板”入口。

## Agent 团队卡片状态契约

### 状态模型

Agent 团队目录只展示成员注册与可用状态，不承载任务执行状态。受控值为：

```text
available
updating
unavailable
```

状态必须来自当前 Space 的 Agent 注册表与配置校验结果。任务是否已分派、执行中、等待输入、失败或完成继续由任务和对话页面表达，不投影到团队目录。

禁止在正式产品中：

- 用循环动画或演示事件冒充任务状态；
- 显示另一个 Space 的 Agent 可用状态；
- 展示内部路径、原始提示或未脱敏错误；
- 在卡片中提供与目录职责无关的运行控制；
- 使用无实际详情路由的点击卡片。

## 第一批专业子 Agent

| Agent | 核心范围 | 典型交付 | 主要公共 Skill |
| --- | --- | --- | --- |
| 装修设计 | 户型证据、空间策略、布局、3D 场景、修订 | 交互 Page、方案文档、布局与概念图 | `home-renovation`、`interior-design`、`visual-content`、`media-toolkit`、`personal-files` |
| 海报设计 | 传播信息、视觉概念、系列排版、多规格渲染 | 海报、轮播图、社交卡片、微信封面 | `guizang-social-card-skill`、`visual-content`、`media-toolkit`、`content-workbench`、`personal-files` |
| 旅游规划 | 约束、最新资料、交通与预约、行程可行性 | 攻略 Page、执行清单、来源说明、可选 PDF | `travel-guidebook`、`deep-research`、`knowledge-capture`、`content-workbench`、`personal-files` |
| 账务分析 | 账单解析、逐笔核对、分类确认、趋势与异常 | 分析 Page、标准化账本、异常与订阅复核清单 | `content-workbench`、`knowledge-capture`、`deep-research`、`personal-files` |

详尽能力、范围、方法和示例由各 Agent 的 `profile.yaml` 单独维护，不在主 Agent 提示中展开。

## Page 模板下线

### 下线范围

下列能力不再出现在新版本产品中：

- `registry/page-templates.json`；
- `/app/pages/templates` 和 `/app/pages/templates/*`；
- `/template-pages/*` 示例路由；
- Pages 页“查看模板”入口；
- 模板目录、模板详情、设备模板预览和模板面包屑；
- `pa-cli pages templates list`；
- `pa-cli pages templates inspect`；
- `pa-cli pages publish --template`；
- 模板语义匹配与强制委派；
- 模板 ID、版本、marker、contract digest 与 template provenance 的新写入；
- `skills/personal-pages` 作为独立可发现 Skill；
- 模板专属测试、基线和 Workspace 播种。

### 原模板内容迁移

| 原模板内容 | 新归属 |
| --- | --- |
| 名称、分类、摘要 | `profile.yaml` 的介绍与交付说明 |
| `useWhen`、匹配词 | `agent.yaml.routing` 与介绍页使用范围 |
| 关联 Skill | `agent.yaml.skills` |
| 固定框架 | Agent 工作方法和交付标准 |
| Agent 可调整范围 | `profile.yaml` 与 `AGENT.md` |
| Agent 执行说明 | `AGENT.md` |
| 生成器 | 对应领域 Skill 的内部实现 |
| 示例产物 | `agents/<id>/examples` 或安全打包的 Agent 示例资产 |
| 验收条款 | `profile.yaml.acceptance` 与领域测试 |
| 发布安全 | 通用 Page 服务与 CLI 契约 |

示例是 Agent 能力证明，不再是用户选择后复用的模板。UI 使用“产出示例”“专业交付示例”或“案例”，不得继续使用“模板”暗示创建入口。

### 保留范围

以下能力必须保留：

- `pa-cli pages publish`；
- `pa-cli pages upload`；
- 私有与公开 Page；
- `pageId`、安全 URL 与 `linkNotice`；
- 桌面与移动缩略图；
- Pages 结果库和详情页；
- Page Activity 关联；
- 历史已发布 Page；
- 领域 Agent 生成 Page 的能力。

### 历史兼容

历史 Page manifest 中已有的模板字段继续按只读兼容数据解析：

- 不改写；
- 不因字段存在而拒绝访问；
- 不在新发布中继续生成；
- 不把历史 Page 重新暴露成可选模板；
- 不删除用户文件、Page、Activity 或缩略图。

旧安装升级时显式退休产品管理的模板注册表与 `personal-pages` Skill，避免留下仍被路由或发现的幽灵能力。

## 运行时与 API

### Agent 注册表

新增：

```text
registry/agents.json
schemas/personal-agent/agents.schema.json
schemas/personal-agent/agent-profile.schema.json
scripts/agent-guard.mjs
```

守卫验证：

- Agent ID、目录和路由身份唯一；
- `agent.yaml`、`AGENT.md`、`profile.yaml` 存在；
- Schema 版本受支持；
- 引用 Skill 均存在；
- 路由摘要非空且有长度上限；
- 配置路径不能越出 `agents/`；
- 示例引用只指向允许的本地安全资产或受治理对象；
- 用户可见文案不包含绝对路径、secret、内部提示或不受信任 HTML；
- 安装后的 Workspace 存在注册的 Agent 源文件。

### 会话元数据

继续使用 `role: worker`：

```json
{
  "createdBy": "pa-cli",
  "agentId": "interior-designer",
  "agentProfileVersion": 1,
  "projectKey": "project_7e6b2f20"
}
```

专业字段保存于 `metadata_json`。恢复会话时不得静默切换 Agent 身份或配置版本。

### CLI

扩展会话创建：

```bash
pa-cli session start \
  --agent interior-designer \
  --project-key project_7e6b2f20 \
  --parent <main-session-id> \
  --title "家庭装修" \
  --description "室内概念与交付" \
  --task-file <task-file> \
  --json
```

扩展会话查询：

```bash
pa-cli session list \
  --parent <main-session-id> \
  --agent interior-designer \
  --project-key project_7e6b2f20 \
  --all \
  --json
```

`--agent` 与 `--project-key` 保持可选，以兼容通用 Worker。`session resume` 沿用原专业身份，不能接受会改变身份的参数。

Agent 公开目录增加只读命令：

```bash
pa-cli agents list --json
pa-cli agents inspect --id interior-designer --json
```

它们只返回经过 Schema 校验的公开资料，不返回 `AGENT.md`。

### HTTP API

`POST /api/sessions` 增加可选字段：

```json
{
  "agentId": "interior-designer",
  "projectKey": "project_7e6b2f20"
}
```

`GET /api/sessions` 增加 `agent` 与 `project` 过滤。

桌面端增加只读接口：

```text
GET /api/agents
GET /api/agents/<agentId>
GET /api/agent-team/status
```

接口必须绑定当前 Owner 与 Space。未知 Agent ID 返回明确客户端错误，不能静默退回通用 Worker。

### 提示组合

专业 Worker 提示按以下顺序组合：

```text
Worker 基础说明
+ 所选专业子 Agent 的 AGENT.md
+ 精简推荐 Skill 指引
+ 当前任务输入
```

主 Agent 只接收从 `registry/agents.json` 生成的精简目录，不接收所有 `AGENT.md` 或完整 `profile.yaml`。

### 安装后的 Workspace

Workspace 初始化与发布打包包含：

```text
agents/
registry/agents.json
scripts/agent-guard.mjs
```

用户任务数据和生成产物继续保存在用户拥有的 Workspace，禁止写入产品管理的 `agents/`。

## 实施顺序

### 阶段一：设计与契约

- 完成 ADR；
- 在 `projects/prototype` 下实现融合运行演示与成员目录的 Agent 团队页，以及四个介绍页；
- 从 Prototype 移除 Pages 模板入口、路由、组件和 fixture；
- 将设计路由登记在 `src/app/surfaces.ts`；
- 用户完成视觉与交互验收；
- 未获用户批准前不把 Prototype 直接同步到 Node 正式 UI。

### 阶段二：Agent 注册与公开资料

- 增加 Agent 注册表、Schema 和守卫；
- 增加四个 Agent 目录；
- 增加运行配置、专业说明、公开资料与示例元数据；
- 加入 Workspace 初始化和发布打包；
- 增加公开目录 CLI/API；
- `agentId` 缺失时保持通用 Worker 行为。

### 阶段三：专业会话与路由

- 为会话 CLI/API 增加 Agent 与项目字段；
- 持久化 `agentId`、配置版本和 `projectKey`；
- 组合专业提示；
- 实现主 Agent 的专业目录路由；
- 新建与恢复行为通过项目隔离用例；
- 配置缺失、版本不支持或未知 Agent 时失败关闭。

### 阶段四：模板退休与知识迁移

- 将装修模板中的方法、示例和验收迁入装修 Agent 与领域 Skill；
- 将通用发布安全规则迁入 Worker 基础约定和 Page 契约；
- 移除模板注册表、CLI、路由、UI、自动委派、Skill 和播种；
- 更新行为基线、Skill 注册表、route registry、site distribution 与测试；
- 对旧 Workspace 执行显式退休迁移；
- 保留历史 Page 的只读兼容。

### 阶段五：Node UI

- 用户批准 Prototype 后，在 Node 实现 `/app/agents` 与详情；
- 将 `/app/agents` 卡片目录绑定当前 Space 的真实 Agent 注册状态；
- 保持 `/app` 为当前 Space 总览；
- 从正式 Pages UI 移除模板入口；
- 覆盖正常、空、加载、等待输入、失败、离线和权限状态；
- 保持桌面、移动和 Space 隔离；
- 视觉与交互最终由用户验收。

## 设计文档与设计稿对齐矩阵

| 决策 | Prototype 设计证据 | 正式 Node 目标 |
| --- | --- | --- |
| Space 首页保持总览 | `/desktop` | `/app` |
| Agent 团队卡片目录 | `/desktop/agents` | `/app/agents` |
| 装修设计介绍 | `/desktop/agents/interior-designer` | `/app/agents/interior-designer` |
| 海报设计介绍 | `/desktop/agents/poster-designer` | `/app/agents/poster-designer` |
| 旅游规划介绍 | `/desktop/agents/travel-planner` | `/app/agents/travel-planner` |
| 账务分析介绍 | `/desktop/agents/finance-analyst` | `/app/agents/finance-analyst` |
| Pages 只保留结果 | `/desktop/pages` 无模板入口 | `/app/pages` 无模板入口 |
| 模板目录下线 | Prototype 不注册模板路由 | Node 删除模板路由 |
| 代表产物承接原模板展示能力 | 详情首屏嵌入真实 Page 或专业产物 | Node 读取 Agent 示例资产 |
| 目录不冒充任务状态 | 只展示成员可用状态 | Node 绑定 Agent 注册状态 |
| reduced motion | `prefers-reduced-motion` | 同等实现 |

本 ADR、`src/app/surfaces.ts` 和可运行 Prototype 必须同时更新。任何一处仍出现模板目录、模板选择入口或与 Agent 介绍不一致的能力说明，都视为未对齐。

## 验证方案

### 注册表与资料

- 有效 Agent 和 profile 通过；
- 重复 ID 失败；
- 缺少任一源文件失败；
- 引用未知 Skill 失败；
- 路径穿越和不安全示例引用失败；
- 内部提示不进入公开 API；
- 安装后源文件与注册表一致。

### 会话与路由

- 通用会话行为不变；
- 专业会话记录 Agent、版本和项目；
- 未知 Agent 失败；
- 恢复会话保留身份；
- 同 Agent 不同项目隔离；
- 不同 Agent 使用同一源产物仍隔离；
- 无匹配领域时使用通用 Worker；
- 跨领域交接只传递选定产物。

### Agent 团队与介绍页语义

- 每个注册 Agent 有独立详情路由；
- 详情完整覆盖能力、范围、输入、方法、产物、示例和验收；
- Agent 团队页每张成员卡片都进入正确详情；
- 详情首屏代表产物能展示原模板承载的专业结果能力，但不提供模板选择或复用；
- 演示数据明确标记为演示；
- 正式状态只来自当前 Space；
- reduced-motion 下信息不丢失；
- 不出现无行为的按钮或链接。

### 模板退休

- 新安装不包含模板注册表和独立 `personal-pages` Skill；
- 模板 CLI 和 `--template` 参数不可用；
- 新 Page 不写模板 provenance；
- Pages 结果库仍可搜索、打开和区分可见性；
- 历史 Page 继续读取；
- 专业 Agent 可以使用通用 Page 发布契约；
- 模板直接路由不再拦截新建 Page 请求。

### 仓库检查

正式实现必须通过 Node Harness：

```bash
npm run doctor
npm run guard
npm run baseline:verify
node scripts/skill-tree.mjs cases verify
npm run frontend:guard
npm test
npm run check
```

Prototype 必须通过：

```bash
npm run check
npm run build
npm run package:check
```

遵守仓库 UI 验收约定：除非用户明确要求，不运行浏览器自动化、截图或自动点击验收。编译成功不代表设计批准。

## 兼容与回滚

所有新增会话字段保持可选。没有 `agentId` 的现有会话继续作为通用 Worker。

如果专业路由引发回归：

- 暂停主 Agent 选择专业配置；
- 继续使用通用 Worker；
- 现有专业会话作为普通 Worker 会话保留；
- 保留项目和产物；
- 不恢复已退休的模板产品入口作为长期回退。

如果 Agent Teams UI 引发回归：

- 可以回退 Agent 团队卡片目录展示；
- 不删除会话、Agent 配置或项目数据；
- Pages 结果库保持独立可用。

删除专业路由或退休模板不会删除用户会话、文件、Page、Activity 或 Memory。

## 影响与取舍

正面影响：

- 产品从抽象的“主 Agent + 后台 Worker”变为用户可理解的 Agent Teams；
- 垂直领域拥有稳定、可解释的专业身份；
- 用户在使用前就能理解能力与边界；
- 专业方法、示例和验收不再分散在模板产品层；
- 同一项目保留有价值的专业历史；
- Pages 回到结果发布与访问的单一职责；
- 公共 Skill 仍然只维护一份；
- Agent 团队页能够解释真实协作过程。

需要接受的取舍：

- 主 Agent 必须正确识别或生成项目键；
- Agent 公开资料成为需要版本化和审核的新产品内容；
- 长期项目历史过长时可能需要延续会话；
- 任务历史过时时必须以当前项目文件为准；
- Agent 团队状态聚合必须防止跨 Space 泄露和伪实时；
- 四个 Agent 的介绍页不能依赖同一套泛化文案，维护成本高于模板卡片；
- 专业 Agent 能提高一致性，但不能替代用户验收或持证专业判断。

本 ADR 只采纳提议状态的产品、运行时和迁移方案。Prototype 的存在不表示 Agent 注册表、专业路由、模板退休或正式 Node UI 已经实现。
