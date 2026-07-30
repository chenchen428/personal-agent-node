# ADR 0010：项目级专业子 Agent 配置

- 状态：已采纳（基础运行时与五个专业配置已实现）
- 日期：2026-07-29
- 实现更新：2026-07-30
- 范围：Personal Agent Node 主 Agent 委派、Worker 会话、可移植 Skill 与用户 Workspace
- 相关文档：ADR 0003 Core/Workspace 交付、`AGENTS.md` 中主 Agent 与 Worker 委派约定

## 摘要

Personal Agent 应在不替换现有主 Agent、Worker、Skill、Page、文件与会话架构的前提下，提高垂直领域任务的专业性。

本方案增加一组轻量的专业子 Agent 配置。每个专业子 Agent 本质上是一种具名的 Worker 配置，包含：

- 稳定的专业角色说明；
- 推荐优先使用的现有 Skill 列表；
- 供主 Agent 路由使用的简明领域描述；
- 项目级会话身份。

唯一的主 Agent 继续负责面向用户。对于一个新的垂直领域项目，主 Agent 选择对应的专业子 Agent 并启动一个 Worker 会话；用户以后继续修改同一个项目时，主 Agent 恢复同一个会话。专业子 Agent 的 Codex 任务保留该项目的专业工作历史，项目文件保留当前有效事实。不同项目或不同专业子 Agent 使用不同的 Worker 会话。

本方案刻意不引入通用工作流引擎、Agent 间消息网络、新的记忆产品、新的权限系统或自动化审核层级。用户仍然通过主 Agent 查看专业子 Agent 的产物，并直接提出修改意见。

## 目标

目标是让专业子 Agent 专注处理自己的垂直领域工作，同时保持当前产品结构，尽量减少改造范围。

规划中的领域专业子 Agent 包括：

1. 装修设计；
2. PPT 设计；
3. 海报与社交视觉设计；
4. 旅游规划；
5. 个人账务与数据分析。

当前正式注册并随 Node 交付的配置包括“视频创作”“装修设计”“旅游规划”“海报设计”和“账务分析”。PPT 设计只有在说明、测试与代表产物完整后才进入注册表。

满足以下条件即视为方案成功：

- 垂直领域任务能够获得稳定的专业说明，而不只是通用 Worker 提示；
- 专业子 Agent 可以继续使用现有公共 Skill 与产品命令；
- 同一个项目的后续修改能够保留此前的专业推理与工作上下文；
- 无关项目不会共享专业子 Agent 会话；
- 跨领域协作只传递选定的源产物与任务上下文；
- 用户始终只面对一个连贯的主 Agent 会话。

## 非目标

本方案不做以下事情：

- 不把每一个 Skill 都改造成 Agent；
- 不把公共 Skill 复制到各个 Agent 目录；
- 不引入 Agent 之间的点对点对话；
- 不增加独立的“发布 Agent”；
- 不增加 Agent 市场或 Agent 设置界面；
- 不增加声明式工作流或 DAG 运行时；
- 不增加单独的领域记忆数据库；
- 不增加自动化的“创作 Agent + 审核 Agent”循环；
- 不替换现有的 `main` 和 `worker` 会话角色；
- 不让 Worker 成为第二个面向用户的助手；
- 不改变由用户查看结果并提出修改意见的产品方式。

## 当前架构

Personal Agent Node 已经具备所需的执行基础：

- 唯一主 Agent 负责用户对话、任务委派、进度汇总与最终回复；
- 每个 Worker 拥有独立的 Codex 任务；
- Worker 会话可以恢复，也可以在中断后继续；
- Worker 已经能够返回受治理的产物，但不能写入全局 Activity 或 Memory；
- `pa-cli session start`、`resume`、`list`、`search` 与 `status` 已提供任务生命周期；
- 可移植 Skill 已经包含垂直工作所需的专业流程、脚本、参考资料、素材与质量检查；
- Online Pages、托管文件、研究、媒体处理等公共能力已经具有稳定的产品或 Skill 入口。

当前缺少的是一等的“专业子 Agent 配置”概念。现在创建的 Worker 都使用同一套基础说明，只以 `worker` 身份存在。垂直领域选择主要依赖任务文本、Skill 触发和少量硬编码路由。

## 决策

### 1. 保留唯一主 Agent

主 Agent 继续负责：

- 理解用户当前请求；
- 判断任务是否需要委派；
- 在领域归属明确时选择专业子 Agent；
- 判断请求是否属于已有项目；
- 启动或恢复正确的 Worker 会话；
- 传入用户最新请求和相关受治理产物；
- 接收进度、完成、缺少输入和失败结果；
- 与用户沟通。

主 Agent 一旦完成委派，就不再重复执行专业子 Agent 的主体工作。

### 2. 在现有 Worker 之上增加专业配置

专业子 Agent 不是新的安全角色，也不是新的运行时进程类型。它仍然是 Worker 会话，只是在会话元数据中记录所使用的 Agent 配置。

可移植源文件采用以下目录结构：

```text
agents/
├── video-creator/
│   ├── agent.yaml
│   └── AGENT.md
├── interior-designer/
│   ├── agent.yaml
│   └── AGENT.md
├── travel-planner/
│   ├── agent.yaml
│   └── AGENT.md
├── poster-designer/
│   ├── agent.yaml
│   └── AGENT.md
└── finance-analyst/
    ├── agent.yaml
    └── AGENT.md

registry/
└── agents.json
```

`agent.yaml` 保持精简：

```yaml
schemaVersion: 1
id: interior-designer
version: 1
displayName: 装修设计 Agent
description: 负责装修、户型、空间布局和室内设计交付。
instructions: AGENT.md
skills:
  - home-renovation
  - interior-design
  - visual-content
  - media-toolkit
  - personal-files
  - personal-pages
routing:
  - renovation
  - interior design
  - floor plan
  - furniture layout
  - 装修
  - 室内设计
  - 户型
  - 家居布局
```

Agent 配置不复制 Skill 说明。`AGENT.md` 只定义稳定的专业身份与组合方式：

- 负责的领域；
- 如何理解任务；
- 优先使用哪些现有 Skill；
- 预期结果结构；
- 如何处理用户提出的修改；
- 跨 Skill 都必须遵守的领域边界；
- 如何向主 Agent 报告产物和缺失输入。

### 3. 公共 Skill 只维护一份

Skill 继续作为可复用能力层。任意数量的专业子 Agent 都可以引用同一个 Skill。

例如：

```text
装修设计 Agent ───┐
PPT 设计 Agent ───┼── personal-pages
旅游规划 Agent ───┘
```

`personal-pages`、`personal-files`、`visual-content`、`media-toolkit`、`deep-research` 等公共 Skill 继续只保留一个源目录和一个注册表条目。Agent 配置通过 Skill ID 引用它们，禁止复制、分叉或内嵌 Skill 内容。

第一阶段不必隐藏其他已安装 Skill。Agent 提示说明其日常工作应优先使用哪些 Skill，现有的 Skill 触发与安全规则仍然有效。只有在实际观察到提示长度或错误 Skill 选择问题后，才考虑限制专业子 Agent 可见的 Skill 目录。

### 4. 使用项目级粘性 Worker 会话

专业子 Agent 的会话身份键为：

```text
mainSessionId + agentId + projectKey
```

`mainSessionId` 保留用户关系，`agentId` 保留专业身份，`projectKey` 隔离同一专业子 Agent 处理的不同项目。

例如：

```text
主会话
├── interior-designer / home-renovation-001
├── interior-designer / parents-home-renovation-001
├── presentation-designer / annual-review-2026
└── travel-planner / japan-2026-october
```

一个项目的首个任务会启动新的 Worker 会话。以后属于同一项目的任务恢复这个 Worker 会话。任务完成后，会话可以进入 `idle`；`idle` 只表示当前轮次已完成，不代表需要丢弃项目历史。

这样可以保留下列隐性上下文：

- 为什么此前选择了某个方案；
- 用户否定过哪些选项；
- 已经讨论并确认的假设；
- 工作文件的位置与版本关系；
- 之前出现过的工具或生成问题；
- 当前产物与历史产物之间的关系；
- 项目中已经建立的专业术语。

### 5. 当前事实必须持久化到项目产物

Worker 任务保留专业工作历史，但它不是当前结果的权威数据库。

各专业子 Agent 继续使用原有的领域产物：

- 装修设计保存受治理的项目结构、证据、需求、修订、场景、审计和发布记录；
- PPT 设计在任务目录保存需求简报、大纲、视觉方向、演示文件和修订记录；
- 海报设计保存内容规划、源素材、布局源文件、渲染结果和交付记录；
- 旅游规划保存旅行需求、行程、来源、未确认事实、HTML 和可选 PDF。

恢复任务时，专业子 Agent 按以下优先级判断当前事实：

1. 用户最新反馈；
2. 当前经过验证的项目文件与修订版本；
3. 此前已经确认的决策；
4. 历史对话与已废弃草稿。

这样可以防止会话中的旧信息覆盖项目文件中的当前状态。

### 6. 根据明确的项目身份决定新建或续接

同时满足以下条件时，主 Agent 恢复已有专业子 Agent 会话：

- 请求属于相同领域；
- 请求指向同一个项目或同一条产物版本链；
- 当前主会话下存在唯一匹配的子会话；
- 用户是在继续、回答、纠正或修改该工作；
- 没有另一个并发任务正在修改同一个项目。

典型的续接请求包括：

- 回答专业子 Agent 此前提出的问题；
- 补充缺失的尺寸、来源或图片；
- 修改当前布局、风格、行程、海报或 PPT；
- 重新生成或重新发布当前交付物；
- 继续此前中断的工作；
- 明确要求继续某个已命名项目。

出现以下情况时，主 Agent 启动新的专业子 Agent 会话：

- 请求属于另一个领域；
- 请求涉及另一套住房、旅行、PPT、营销活动或其他独立项目；
- 用户明确要求从头开始，不保留此前工作历史；
- 需要并发执行彼此独立的分支；
- 多个历史项目都可能匹配，而用户选择了另一个项目；
- 未来 Agent 配置版本不兼容，必须使用新的延续会话。

不能仅凭关键词相似就恢复会话。如果存在多个可能匹配的项目，而且选择会实质影响结果，主 Agent 只向用户提出一个简短的澄清问题。

### 7. 在系统内部生成并保留 `projectKey`

`projectKey` 是内部路由身份，不是面向用户的项目名称。

如果现有领域对象已经拥有稳定项目 ID，应直接使用该 ID。否则由主 Agent 或编排器在第一次启动 Worker 会话时生成不透明键。

提示或诊断中可以展示便于阅读的示例，但运行时不能依赖用户输入的标题具有唯一性。

Worker 会话同时保存：

```json
{
  "agentId": "interior-designer",
  "agentProfileVersion": 1,
  "projectKey": "project_7e6b2f20"
}
```

标题与任务描述仍然是便于用户阅读的元数据，但不是身份键。

### 8. 粘性会话中的每一轮仍然是具体任务

每次 `start` 或 `resume` 的输入都必须是一个明确任务。主 Agent 传入：

- 用户最新请求，完整保留日期、数量、名称和限制；
- 本轮期望结果；
- 本轮新增的受治理对象 ID；
- 由专业子 Agent 管理的相关现有产物 ID 或项目路径；
- 用户对当前结果的明确反馈；
- 本轮必须交付的内容。

恢复已有会话时，主 Agent 不需要重建整个项目历史，因为专业子 Agent 任务和项目产物已经保留这些信息。

新建专业子 Agent 会话时，包括跨领域交接，应传入更完整的任务包：

```json
{
  "agentId": "presentation-designer",
  "objective": "根据已经确认的装修设计结果制作一份 PPT。",
  "userRequest": "把装修方案做成一份 PPT",
  "inputs": [
    {
      "kind": "page",
      "id": "page_123",
      "purpose": "已经确认的装修设计交付物"
    }
  ],
  "context": {
    "audience": "房屋业主及家人",
    "language": "zh-CN"
  },
  "deliverables": [
    "PPT 文件",
    "已发布的 PPT Page"
  ]
}
```

第一阶段可以继续使用普通任务文本，不要求立即引入新的线协议。关键约定是：任务必须完整保留用户请求、受治理产物引用、限制条件和交付要求。

### 9. Agent 之间的沟通统一经过主 Agent

专业子 Agent 不直接共享任务，也不互相发送对话消息。

跨领域工作采用以下流程：

1. 来源专业子 Agent 完成或更新产物；
2. 主 Agent 选择要交接的产物和相关结果摘要；
3. 主 Agent 启动或恢复目标专业子 Agent；
4. 目标专业子 Agent 只接收选定的上下文；
5. 目标结果返回主 Agent。

例如，将装修设计结果转换为 PPT 时，主 Agent 用已经确认的设计产物启动 PPT 设计会话，不会把装修设计 Agent 的完整任务历史开放给 PPT 设计 Agent。

该方式在保持上下文隔离的同时，不需要新增 Agent 消息总线。

### 10. 领域专业子 Agent 负责发布自己的交付物

当用户要求发布结果时，发布属于领域任务本身，不需要独立的发布 Agent。

例如：

- 装修设计 Agent 生成并发布装修交付 Page；
- PPT 设计 Agent 生成并发布演示文稿；
- 旅游规划 Agent 发布攻略 Page，并在用户需要时导出 PDF；
- 海报设计 Agent 渲染并登记托管输出文件。

专业子 Agent 使用现有公共 `personal-pages` Skill 与 `pa-cli pages publish` 契约。Page 服务继续负责校验模板、产物、可见性和返回 URL。专业子 Agent 将真实的 `pageId`、URL 或 `linkNotice` 以及产物元数据返回主 Agent，由主 Agent 向用户说明结果。

如果用户只要求草稿，任务在发布之前结束。

### 11. 保留现有主 Agent 与 Worker 权限边界

本方案不需要新的权限框架。继续遵守现有规则：

- 主 Agent 负责 Activity、Memory、用户沟通和最终回复附件选择；
- Worker 执行分配的工作并报告产物；
- Worker 不独立发送渠道通知；
- 发布与文件操作继续经过注册的产品契约；
- 当前授权与确认行为保持不变。

## 第一批专业子 Agent

### 装修设计 Agent

主要 Skill：

- `home-renovation`
- `interior-design`
- `visual-content`
- `media-toolkit`
- `personal-files`

负责装修需求、户型证据、布局与概念方案、受治理场景生成、修改、审计、经授权的 SU 对应渲染和装修交付 Page。

### PPT 设计 Agent

主要 Skill：

- `guizang-ppt-skill`
- `content-workbench`
- `visual-content`
- `media-toolkit`
- `deep-research`
- `personal-files`
- `personal-pages`

负责受众与演示目标梳理、大纲与叙事、视觉系统、PPT 生成、修改和发布。

### 海报设计 Agent

主要 Skill：

- `guizang-social-card-skill`
- `visual-content`
- `media-toolkit`
- `content-workbench`
- `personal-files`

负责海报、社交卡片、轮播图片、微信封面组合，同一视觉活动的渲染与修改。

### 旅游规划 Agent

主要 Skill：

- `travel-guidebook`
- `deep-research`
- `knowledge-capture`
- `content-workbench`
- `personal-files`
- `personal-pages`

负责旅行限制、最新资料调研、行程可行性、攻略生成、修改、发布和可选 PDF 导出。

### 账务分析 Agent

主要 Skill：

- `personal-data`
- `personal-files`
- `content-workbench`
- `deep-research`
- `knowledge-capture`
- `personal-pages`

负责个人与家庭账单、交易流水和脱敏表格的字段归一、逐笔核对、异常识别、周期分析与脱敏 Page 交付；保持计算可追溯，不替代持证会计、税务或投资意见。

### 视频创作 Agent

主要 Skill：

- `hyperframes-video`
- `media-toolkit`
- `visual-content`
- `content-workbench`
- `deep-research`
- `personal-files`

负责产品介绍、功能演示、旅游素材剪辑、横竖屏变体、HyperFrames 确定性合成、快照检查和本地成片交付。代表案例为 Personal Agent 介绍视频。

## 运行时与 API 方案

### Agent 注册表

新增：

```text
registry/agents.json
schemas/personal-agent/agents.schema.json
scripts/agent-guard.mjs
```

守卫脚本验证：

- Agent 配置 ID 和目录唯一；
- `agent.yaml` 与 `AGENT.md` 存在；
- 配置清单 Schema 版本受支持；
- 引用的每一个 Skill 都存在于 `registry/skills.json`；
- 路由词非空且数量、长度受限；
- 配置路径不能越出 `agents/`；
- 安装后的 Workspace 中存在注册的 Agent 配置源文件。

### 会话元数据

继续保留 `role: worker`，将专业字段保存在 `metadata_json`：

```json
{
  "createdBy": "pa-cli",
  "agentId": "interior-designer",
  "agentProfileVersion": 1,
  "projectKey": "project_7e6b2f20"
}
```

第一阶段不需要数据库迁移。

### CLI

扩展会话创建命令：

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

`--agent` 与 `--project-key` 均为可选参数，因此通用 Worker 与现有调用方继续保持兼容。

扩展会话查询命令：

```bash
pa-cli session list \
  --parent <main-session-id> \
  --agent interior-designer \
  --project-key project_7e6b2f20 \
  --all \
  --json
```

`session resume` 保留原 Agent 配置与项目元数据，不能接受会静默改变现有 Agent 身份的参数。

### HTTP API

为 `POST /api/sessions` 增加可选字段：

```json
{
  "agentId": "interior-designer",
  "projectKey": "project_7e6b2f20"
}
```

为 `GET /api/sessions` 增加可选的 `agent` 与 `project` 过滤条件。

遇到未知 Agent ID 时，返回明确的客户端错误，不能静默退回通用 Worker。

### 编排器提示组合

专业 Worker 的提示按以下顺序组合：

```text
Worker 基础说明
+ 所选专业子 Agent 的 AGENT.md
+ 精简的推荐 Skill 指引
+ 当前任务输入
```

Worker 基础说明继续作为主 Agent/Worker 权限边界、产物返回格式、发布规则和用户通知限制的唯一来源。专业说明只增加领域行为，不替代基础约定。

会话元数据与事件记录实际加载的 Agent ID 和版本，确保恢复会话时不能静默切换专业身份。

### 主 Agent 路由说明

从 `registry/agents.json` 为主 Agent 生成精简的专业子 Agent 目录。主 Agent 应：

1. 按现有规则直接处理简单请求；
2. 只在专业领域明确拥有主体工作时选择专业子 Agent；
3. 按父会话、Agent 与项目查询子会话；
4. 恢复唯一匹配的项目；
5. 没有匹配项时创建新的项目会话；
6. 多个重要项目都匹配时，只提出一个简短问题；
7. 没有专业子 Agent 负责时使用通用 Worker。

不能把每个专业子 Agent 的完整 `AGENT.md` 都注入主 Agent。

### 安装后的 Workspace

扩展 Workspace 初始化与发布打包范围，包含：

```text
agents/
registry/agents.json
scripts/agent-guard.mjs
```

内置 Agent 配置源文件与其他可移植 Harness 源文件一样由产品管理。用户任务数据和生成产物继续保存在用户拥有的 Workspace 中，禁止写入 `agents/`。

第一阶段由 Personal Agent 注册表加载 Agent 配置，不要求 Codex、Claude、Cursor 或其他客户端识别新的标准目录，因此不需要修改兼容桥。

## 详细调度示例

### 新建装修项目

1. 用户提供户型图并要求设计。
2. 主 Agent 选择 `interior-designer`。
3. 系统没有找到匹配项目。
4. 主 Agent 使用新生成的 `projectKey` 启动 Worker。
5. Worker 使用装修相关 Skill 创建项目，并在用户要求时发布。
6. Worker 返回项目和 Page 产物。
7. 主 Agent 向用户报告结果。

### 修改同一个装修项目

1. 用户要求保留钢琴区域并更换木色。
2. 主 Agent 根据已确认的装修产物或项目名称识别项目。
3. 主 Agent 找到匹配的 `interior-designer` 会话。
4. 主 Agent 使用用户反馈恢复该会话。
5. Worker 读取当前项目版本，完成修改和验证，并在用户要求时重新发布。
6. 主 Agent 向用户报告更新后的结果。

### 设计另一套住房

1. 用户为父母的住房提供另一张户型图。
2. 主 Agent 识别出这是独立项目。
3. 主 Agent 使用另一个 `projectKey` 启动第二个 `interior-designer` 会话。
4. 两个专业会话不会接收到另一套住房的上下文。

### 将装修结果制作成 PPT

1. 用户要求把已经确认的设计制作成 PPT。
2. 主 Agent 选择已经确认的设计产物。
3. 主 Agent 使用新的 PPT `projectKey` 启动 `presentation-designer`。
4. PPT 设计 Agent 只接收选定产物与新的 PPT 任务，不接收装修 Agent 的完整任务历史。
5. 后续 PPT 修改恢复 PPT 设计会话。

### 缺少关键输入

1. 专业子 Agent 发现没有某个关键选择就无法继续。
2. 专业子 Agent 结束当前轮次，返回待确认问题与当前项目引用。
3. 主 Agent 向用户提出问题。
4. 用户回答后，恢复同一个专业子 Agent 会话。

### 执行中断

未完成的专业任务继续使用现有 Worker 恢复机制。恢复时沿用同一个会话，不创建新项目，也不重复已经完成的发布副作用。

## 实施顺序

### 阶段一：注册表与配置加载器

- 增加 `registry/agents.json`；
- 增加 Agent 清单 Schema 与守卫脚本；
- 增加经过完整说明与测试的专业子 Agent 目录；首个交付目录为 `video-creator`；
- 支持按 ID 加载并校验 Agent 配置；
- 将 Agent 配置源文件加入 Workspace 初始化与打包；
- `agentId` 缺失时保持所有现有运行时行为不变。

### 阶段二：会话元数据与 CLI/API

- 为 `pa-cli session start` 增加 `--agent` 和 `--project-key`；
- 在 `POST /api/sessions` 中接收并校验这些字段；
- 将字段持久化到 `metadata_json`；
- 在会话摘要中返回这些字段；
- 增加列表过滤条件；
- 确保恢复会话时保留原专业身份。

### 阶段三：专业提示组合

- 在 Worker 基础说明之后追加所选 `AGENT.md`；
- 在经过脱敏的诊断事件中展示所选 Agent 配置与 Skill 列表；
- 增加提示组合测试；
- 注册配置缺失或无效时失败关闭；
- 保持通用 Worker 行为不变。

### 阶段四：主 Agent 路由

- 只把精简的已注册 Agent 目录注入主 Agent；
- 实现 `agentId + projectKey` 查询路径；
- 更新新建与恢复会话指引；
- 只有在对应行为已经由专业配置完整覆盖后，才移除硬编码的领域路由文本；
- 在专业替代方案通过相同行为测试前，保留现有 Page 模板直接路由。

以上顺序不要求一次性切换。每个阶段都可以独立测试，现有通用 Worker 始终作为回退方案。

## 验证方案

### 注册表测试

- 有效配置通过；
- 重复 ID 失败；
- 缺少说明文件失败；
- 引用未知 Skill 失败；
- 路径穿越失败；
- 安装后的配置源文件与发布注册表一致。

### 会话测试

- 通用会话创建行为不变；
- 专业会话记录 `agentId`、配置版本和 `projectKey`；
- 未知 Agent ID 失败；
- 列表过滤能够返回预期会话；
- 恢复会话保留 Agent 身份；
- 同一专业子 Agent 的两个项目保持隔离；
- 使用同一源产物的两个专业子 Agent 仍然保持隔离。

### 提示测试

- Worker 基础约定仍然存在；
- 所选专业子 Agent 说明存在；
- 无关专业子 Agent 说明不存在；
- 只引用推荐 Skill 名称，不复制其完整说明；
- 不向 Worker 授予只属于主 Agent 的 Activity 与 Memory 能力。

### 行为用例

至少覆盖：

1. 新建装修项目；
2. 修改同一个装修项目；
3. 新建第二个独立装修项目；
4. 将已确认的装修结果交给 PPT 设计；
5. 缺少输入时提问并恢复；
6. Worker 中断后恢复；
7. 专业子 Agent 发布 Page 并返回产物；
8. 无匹配领域时退回通用 Worker。

### 仓库检查

正式实现必须通过 Node Harness 的全部要求：

```bash
npm run doctor
npm run guard
npm run baseline:verify
node scripts/skill-tree.mjs cases verify
npm run frontend:guard
npm test
npm run check
```

截至 2026-07-30，注册表、Schema、守卫、安装态分发、会话元数据、CLI/API 过滤、专业提示组合、主 Agent 精简目录，以及 `video-creator`、`interior-designer`、`travel-planner`、`poster-designer` 和 `finance-analyst` 配置已经实现。`video-creator@2` 包含版本化视频风格合同：从现有 Personal Agent 成片沉淀默认产品介绍风格，并注册产品演示、文字发布、人物纪实、电影感旅程、旅行明信片和竖屏旅行等可选风格。`interior-designer@1` 使用受治理项目与 Pascal v2 作为空间事实，并在用户明确授权后用生图工具生成结构保持型 SU 对应渲染；渲染注册会绑定当前修订、场景、模型依据、参考图、提示词与图片哈希，交付页提供同舞台切换。`travel-planner@1` 使用独立编写的 `amap-travel-routing` 核验中国境内 POI 与相邻路段，把 provider 时长与门到门缓冲、开放预约来源、逐日备选和完整规划 Page 绑定在同一交付链路中。`poster-designer@1` 组合社交卡片、视觉内容、媒体处理和内容工作台能力，交付可追溯素材与多渠道规格。`finance-analyst@1` 通过受治理数据与文件能力完成可追溯的账务归一、复核、分析和脱敏 Page。PPT 配置仍是后续候选，不得因为本 ADR 中存在示例就宣称已经注册。

## 兼容与回滚

所有新增字段都是可选字段。没有 `agentId` 的现有会话继续作为通用 Worker。现有 `pa-cli session start` 调用方保持有效。

如果专业路由引发回归：

- 停止在主 Agent 说明中选择专业配置；
- 继续运行通用 Worker；
- 将已有专业会话记录作为普通 Worker 会话保留；
- 保留已经生成的项目和产物。

删除路由条目不会删除会话或用户数据。

## 影响

正面影响：

- 垂直任务获得稳定的专业身份；
- 迭代工作保留有价值的专业历史；
- 无关项目保持隔离；
- 公共 Skill 仍然只需维护一份；
- 发布继续属于领域任务本身；
- 用户提出的修改可以直接复用现有会话恢复机制；
- 实现方式贴近当前 Worker 架构，改造范围较小。

需要接受的取舍：

- 主 Agent 必须正确识别或生成项目键；
- 长期项目的任务历史过长后，可能需要创建延续会话；
- 任务历史过时时，必须以当前项目文件为准；
- 专业路由质量依赖简洁且边界清晰的领域描述；
- 专业子 Agent 能提高一致性，但不能替代用户验收。

相比每一轮都创建完全无状态的子 Agent，或建设一套庞大的多 Agent 平台，这些取舍更符合当前“只拆分专业工作、不大改造”的目标。
