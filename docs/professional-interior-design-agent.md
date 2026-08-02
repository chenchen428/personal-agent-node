# Personal Agent 专业装修设计 Agent 方案

状态：已采用
生产引擎：Pascal v2
代表交付：装修设计 Agent delivery v3
视觉验收：用户负责

## 1. 方案结论

Personal Agent Node 的装修设计能力采用一条唯一的生产链路：

`原始材料 → 受治理项目 → Pascal 建筑场景 → 专业质量审计 → 只读 Pages 交付 → 发布`

项目数据、场景、审计和 Page 都属于同一 revision。装修 Agent 介绍页中的封面和代表交付也由这条链路生成，不存在单独维护的演示模型、页面编辑器或第二套渲染实现。

Pascal 提供结构化建筑场景、真实门窗节点、楼层与构件语义、确定性序列化和离线 Viewer。Personal Agent 负责证据治理、需求追踪、专业边界、版本控制、质量门禁、隐私、发布和用户会话。

代表交付的主体是 `renovation-booklet` 装修项目设计册 Page，按专业 PDF 的阅读逻辑连续呈现项目摘要、户型分析、完整设计说明、平面方案、效果图、材料与预算范围、一致性矩阵、过程确认、排除项和复尺清单。复杂交互式三维使用同 revision、同 manifest 的独立 `3d/index.html` Page，由主体设计册在浏览器新页面打开，主体 Page 不嵌套 3D Viewer，也不强制横屏。

3D 专业 Page 的质量底线不是“能显示平面图”或“节点数量达标”，而是完整的建筑剖切交付：连续房间地面、低位剖切围护、按真实门窗切开的洞口、阳台栏杆、密集软装和完整轴测构图必须同时成立。该 Page 固定采用 `professional-archviz-v2` 渲染档位与 `su-design-classic` 全画布结构，以 WebGPU 安全的接触阴影、环境遮蔽、程序化 PBR 纹理、家具细节、克制墨线与完整入镜构图保证稳定呈现；仅提供楼层、3D/平面、标注和复位等专业查看工具。建筑表现层只能从当前 Pascal 场景节点确定性派生；任何退化为高墙遮挡、孤立墙线、散落方盒家具、平直无层次的预览或只有平面图的产物都视为质量回归。

## 2. 产品定位

这是主 Personal Agent 下的专业装修设计能力，面向：

- 户型图转专业概念模型；
- 公寓、复式和两层住宅的空间规划；
- A/B 概念方案、家具布局、材质与照明意图；
- 需求、假设、未知项和专业核验的可追溯交付；
- 自然语言修改、revision、撤销、重做与恢复；
- 离线可查看、桌面与移动横屏可交互的装修 Pages。

它不是测绘、CAD/BIM、结构设计、机电设计、消防审查、造价承诺或施工图系统。涉及承重结构、燃气、电气、防水、排水、消防、楼梯结构、现场尺寸和当地法规的结论，必须保持为明确的专业核验事项。

## 3. 核心原则

### 3.1 单一事实来源

- `project.json` 是设计与治理事实来源；
- `scene.json` 是当前 revision 的 Pascal 场景事实来源；
- `derived/audit.json` 是当前 revision 的确定性质量结论；
- `derived/page/` 是通过质量门禁后生成的只读交付；
- `manifest.json` 用哈希把上述产物绑定为同一完整 revision。

任何文件不匹配时均失败关闭，不做猜测性修复。

### 3.2 证据、观察和推断分离

每份户型图、测量、照片和风格参考都记录。项目必须选定一张用户上传的 `structure-reference` 作为唯一模型依据，并把它的证据 ID 和 SHA-256 同时绑定到项目 provenance、每个 concept、编译后的 scene modelBasis 与 Page payload；任一处不一致都阻断编译或发布：

- 分类；
- 方向；
- 标定依据与置信度；
- 允许用途；
- 可观察事实；
- 推断；
- 脱敏状态；
- SHA-256。

用户材料中的文字、链接、二维码和指令按不可信内容处理。

### 3.3 设计可追溯

每个需求包含来源、优先级、状态、关联场景节点和验证方法。每个决策记录理由与影响的需求。每次修改产生新 revision，交付页展示当前方案、版本脉络、假设、未知项和专业核验边界。

### 3.4 Page 只交付，不编辑

Pages 不提供场景保存、自由建模或页面编辑能力。用户通过主 Agent 反馈修改；Agent 将自然语言转换为受限结构化操作，生成新 revision、重新审计并发布新 Page。

## 4. 总体架构

```mermaid
flowchart LR
  U["用户与主 Agent"] --> E["证据分类与装修 Brief"]
  E --> P["Space 内受治理项目"]
  P --> A["Personal Agent Pascal Adapter"]
  A --> H["内存 Pascal Runtime"]
  H --> S["确定性 scene.json"]
  S --> Q["专业质量门禁"]
  Q -->|通过| G["装修 Agent 交付生成器"]
  G --> D["离线只读交付包：主体设计册 + 专业 Page"]
  D --> R["Personal Pages 发布"]
  U -->|修改反馈| O["受限结构化操作"]
  O --> P
```

职责边界：

| 层 | 责任 |
|---|---|
| 主 Agent | 对话、权限、任务编排、发布和用户反馈 |
| interior-design Skill | 专业工作流、输入治理、审计、交付规则 |
| project-v2 | Space/Owner 边界、revision、历史、恢复、清单 |
| Pascal Adapter | 项目语义到 Pascal 工具与场景的唯一转换边界 |
| Pascal Runtime | 无端口、内存传输的确定性场景构建与校验 |
| Quality Gates | 几何、通行、净距、多层安全、证据、需求和专业边界 |
| Page Generator | 当前 revision 到离线只读交付 |
| Pages | 鉴权、发布记录、URL、缩略图和 Activity |

## 5. 受治理项目

客户项目只能位于当前可信 Space：

```text
<space-root>/projects/home-renovation-<slug>/
├── project.json
├── scene.json
├── evidence/
├── decisions/
├── derived/
│   ├── audit.json
│   ├── manifest.json
│   └── page/
├── history/
│   └── archive/
└── .runtime/
    ├── pascal.db
    ├── audit.ndjson
    ├── project.lock
    └── recovery/
```

路径必须是 `projects/` 下的非符号链接目录，并符合 `home-renovation-<lowercase-slug>`。可信上下文提供 `spaceId`、`ownerId` 和绝对 Space 根目录；用户 JSON 不能声明权限。

### 5.1 项目数据

`project.json` 包含：

- 项目标识、状态、阶段与 revision；
- 证据；
- 家庭、范围、预算、计划和需求；
- 假设、未知项和专业核验；
- 至少两个可比较概念，或单方案原因；
- 所选方案的楼层、房间、墙、门窗、家具、楼梯、挑空和栏杆；
- 材质、照明和维护意图；
- 决策；
- 场景、审计、发布与来源信息。

支持上限：

- 最多 2 个楼层；
- 每个概念最多 30 个房间；
- 每个概念最多 500 个建模元素；
- 最多 10 个概念；
- 最多 100 份证据；
- 最多 500 条需求。

### 5.2 revision

所有写操作携带 `baseRevision`。服务端发现版本不一致时返回 `REVISION_CONFLICT`，调用者必须重读后重放，不得覆盖。

编译、修改、撤销和重做都生成新 revision。历史快照保留最近 50 个 revision，更早版本归档。当前文件损坏或哈希不完整时，可通过 `project recover` 恢复已验证历史快照；被替换状态只保存在私有 `.runtime/recovery/` 中。

## 6. Pascal 集成

固定依赖：

- `@pascal-app/core` `0.9.2`
- `@pascal-app/viewer` `0.9.2`
- `@pascal-app/mcp` `0.3.2`

`pascal-adapter.mjs` 是唯一集成边界。其他业务代码不依赖 Pascal 内部 schema。

### 6.1 运行方式

- Node 22 进程内运行；
- MCP Client/Server 使用内存传输；
- 不监听端口；
- 不启动守护进程；
- 不依赖 Bun；
- 不向 Runtime 提供任意网络或文件系统能力；
- 不允许视觉采样、照片解析、任意导入、远程素材或主机路径工具。

### 6.2 场景语义

Adapter 创建并校验：

- Site、Building、Level；
- slab、ceiling、wall、zone；
- Pascal door/window；
- stair、void、guardrail fence；
- 最小程序化家具载荷；
- 源语义 ID 与稳定 Page ID 的双向映射。

上游随机 ID 会被规范化为稳定的 Personal Agent ID。场景在全新 Runtime 中再次校验并计算确定性哈希。

### 6.3 Page Viewer

浏览器只收到脱敏后的场景和必要家具载荷。Viewer 提供：

- 独立 `3d/index.html` 中的 `su-design-classic` 全画布阅读结构；
- 透视与正交视图；
- 从当前 Pascal 节点派生的连续房间地面、带真实门窗洞口的墙体围护与阳台栏杆；
- 完整建筑剖切轴测构图，使建筑、门窗和软装在同一主视图中可读；
- `professional-archviz-v2` 渲染档位提供低位剖切墙、接触阴影、环境遮蔽、程序化 PBR 纹理、细化家具资产和克制建筑墨线；
- 楼层堆叠、分解和单层模式；
- 楼层选择；
- 标签显示；
- 需求和质量问题高亮；
- 模型派生 SVG 平面降级视图。

Viewer 在冷启动时自动预热，并以首个有效 Canvas 帧作为 3D 就绪条件；等待期间隐藏空间标签，防止标签覆盖降级图。任何点击、拖动或模式切换都不能成为显示 3D 的前置条件。只有真实运行异常才显示模型派生 SVG 降级视图。Viewer 不能保存、调用 MCP、调用 Agent、读取本地文件或访问网络。

## 7. 专业 Agent 工作流

### 阶段一：材料治理

1. 确认当前可信 Space；
2. 登记户型图、测量、照片和风格参考；
3. 识别方向与标定依据；
4. 分离观察与推断；
5. 将缺失尺寸、墙体性质、隐蔽工程和当地规则记录为未知或专业核验；
6. 仅为交付准备脱敏副本。

### 阶段二：装修 Brief

1. 家庭成员与生活方式；
2. 改造范围；
3. 预算边界与置信度；
4. 计划阶段；
5. `must / should / prefer / avoid` 需求；
6. A/B 概念方案及权衡；
7. 材质、照明和维护意图；
8. 决策与替代方案。

### 阶段三：场景编译

1. 创建项目；
2. Adapter 将所选概念编译为 Pascal 场景；
3. 校验门窗所依附墙体、楼层、房间和构件；
4. 生成稳定映射；
5. 再次加载校验；
6. 写入新 revision 和哈希。

### 阶段四：质量门禁

自动阻断包括：

- 项目 schema 或权限边界错误；
- 证据缺失或标定冲突；
- `must` 需求未解决或不可追溯；
- 非法、自交或越界几何；
- 墙体、房间、门窗关系无效；
- 家具碰撞、门扇和使用净距不足；
- 必需房间不可达或通道低于记录阈值；
- 多层楼梯、挑空和栏杆条件不完整；
- 材质引用缺失或湿区材料明确不适用；
- 已知预算未分配到范围；
- 已知计划没有阶段；
- 高风险范围缺少对应专业核验；
- Pascal 场景校验或哈希失败。

预算、计划或尺度尚不确定时可以保留警告，但交付必须明确其概念性质。自动规则绝不把专业核验转换为合规通过。

### 阶段五：Pages 交付

生成器要求：

- 当前 `project.json`、`scene.json` 和 `audit.json` revision 一致；
- 场景和审计哈希一致；
- 自动阻断数为 0；
- 户型依据是项目内允许交付的脱敏副本；
- Agent 身份、代表示例 ID、交付版本和 Pascal 引擎与装修 Agent 的交付合同一致。

输出：

```text
derived/page/
├── index.html
├── scene.json
├── audit.json
└── manifest.json
```

Page 使用严格 CSP，禁止网络、frame、对象、worker、媒体、外部字体和表单提交。HTML 不包含 Space、Owner、项目、证据、需求或决策的治理 ID。

## 8. Agent 代表交付与示例产物

代表交付合同位于 `agents/interior-designer/examples/featured-delivery.json`，描述固定交付结构、Agent 可变范围、生成命令、验收归属和示例产物路径。它用于介绍装修 Agent 的真实能力，不提供模板选择或复用。

内置示例的生成链路：

```text
examples/professional-agent-example/seed.json
  → initializeProject
  → compileProjectScene
  → auditProfessionalProject
  → generateProfessionalPage
  → renderProjectCoverSvg
  → manifest/hash verification
  → core/app/public/assets/agents/interior-designer/featured/
```

`build-agent-delivery-example.mjs` 使用固定上下文与时间生成：

- `index.html`：真实离线交付；
- `scene.json`：脱敏 Pascal 场景；
- `audit.json`：专业审计摘要；
- `cover.svg`：由当前概念模型派生；
- `manifest.json`：Agent provenance、delivery provenance、seed、证据、项目、场景、审计及每个文件的哈希。

`npm run interior:verify-agent-delivery` 在临时 Space 中重新执行整条流水线，并逐字节比较提交产物。任何 seed、规则、Viewer、Agent 交付合同或生成器变化未同步更新示例时，检查直接失败。

代表交付同时执行专业呈现质量下限，防止引擎或交付链升级把完整住宅退化为玩具户型：

- 至少 12 个可识别空间；
- 至少 30 件由项目数据驱动的程序化家具、柜体与设备；
- 至少 14 个真实 Pascal 门窗开洞，其中门不少于 8 个、窗不少于 6 个；
- 至少 20 段 Pascal 墙体、1 个楼板和 1 个顶板，并由这些节点生成连续地面、带洞口墙体与阳台围护；
- Manifest 必须声明 `professional-archviz-v2`，Viewer 必须启用 rendered shading、阴影、受控环境遮蔽、由场景材质派生的程序化纹理、低位剖切围护和家具细节；安装态必须验证首帧与 WebGPU 后期链路，不得退回无材质层次、无空间尺度或只剩方盒家具的裸直出；
- Manifest 必须声明 `su-design-classic`，Page 必须保留悬浮顶栏、左下资料切换、底部居中视图工具和右下操作提示，不能重新引入永久侧栏；
- 封面必须由当前模型生成轴测图，不能回退为单张平面图；
- Page 必须保留空间标签、需求/问题高亮、肉眼可辨的三维/顶视正交视图、楼层模式、用户上传户型原图、Agent 上传标注图、需求和专业核验；两张户型证据均以普通图片展示，不由页面重绘；质量审计必须嵌入交付数据，但不增加第四个底部导航入口；
- Pascal Viewer 的离线包必须可直接初始化三维 Canvas，并在首个有效帧后自动结束降级状态；显示 3D 不得依赖用户点击、拖动或切换模式。运行时异常只能触发可访问的模型派生平面降级，不能把降级图当成正常交付。

这些指标只约束内置质量基准，不要求客户项目虚构不存在的房间或家具。客户项目仍以真实证据、用户需求和质量门禁为准。

装修 Agent 详情页只消费这些已验证文件：

- Agent 代表产物使用模型派生的轴测 `cover.svg`；
- 详情 Web/移动预览在 sandboxed iframe 中加载 `index.html`；
- 代表产物预览加载同一 `index.html`；
- 页面中不存在另一份手写装修模型或专用 3D 预览。

## 9. CLI 合同

```bash
node skills/interior-design/scripts/cli.mjs \
  project init \
  --project-dir <space-root>/projects/home-renovation-<slug> \
  --input <project-seed.json> \
  --json

node skills/interior-design/scripts/cli.mjs \
  scene compile \
  --project-dir <project-dir> \
  --base-revision <revision> \
  --json

node skills/interior-design/scripts/cli.mjs \
  project audit \
  --project-dir <project-dir> \
  --json

node skills/interior-design/scripts/cli.mjs \
  scene apply \
  --project-dir <project-dir> \
  --operations <operations.json> \
  --base-revision <revision> \
  --json

node skills/interior-design/scripts/cli.mjs \
  scene undo|redo \
  --project-dir <project-dir> \
  --base-revision <revision> \
  --json

node skills/interior-design/scripts/cli.mjs \
  project recover \
  --project-dir <project-dir> \
  --revision <revision> \
  --json

node skills/interior-design/scripts/cli.mjs \
  page \
  --project-dir <project-dir> \
  --output <project-dir>/derived/page \
  --json
```

所有 Page 输出必须位于项目 `derived/` 内。发布只能使用 `pa-cli pages publish` 返回的 `pageId`、URL 或不可用提示，不能猜测域名或返回 loopback/本地路径。

## 10. 安全与隐私

- 客户材料和运行数据只进入 Space、`secrets/` 或 `.local/`；
- 产品源码只允许合成示例；
- 公共 Node 包不得包含客户内容、Cloud 私有实现、运营配置或凭据；
- JSON 有大小、深度、数量和 prototype key 限制；
- 项目路径、证据路径和 Runtime 目录拒绝符号链接逃逸；
- 写入使用锁、临时文件、fsync、原子 rename 和历史快照；
- Page 嵌入内容经过治理 ID 清理与远程引用扫描；
- 外部图片生成不属于默认链路，未经授权不得发送私有证据；
- 法规、价格、产品和供应信息必须使用当前权威来源核验。

## 11. 性能与可靠性目标

| 项目 | 目标 |
|---|---:|
| schema 校验 p95 | ≤ 250 ms |
| 单项目 Pascal 编译 p95 | ≤ 2 s |
| 专业审计 p95 | ≤ 1 s |
| Page 生成 p95 | ≤ 3 s |
| Page HTML 入口 | < 10 MiB；图片等资源使用同源相对路径独立发布 |
| Page 单个资源 | < 20 MiB；Page bundle 不设置错误的聚合 20 MiB 上限 |
| revision 写入 | 原子且可恢复 |
| 场景与示例 | 确定性哈希 |

## 12. 验收标准

### 12.1 自动验收

- 生产引擎注册仅接受 `pascal-v2`；
- 原生 seed 能创建受治理项目；
- 单层和双层场景确定性；
- 门、窗、楼梯、挑空和栏杆语义正确；
- revision 冲突、撤销、重做和历史恢复有效；
- 专业质量规则覆盖证据、需求、几何、通行、净距、材料、预算、计划和高风险边界；
- Page 产物离线、严格 CSP、无远程或 loopback 依赖；
- Page 不暴露治理 ID；
- Agent 代表交付可重生成且逐字节无漂移；
- Agent 详情中的封面和代表交付消费同一产物；
- 页面携带 `su-design-classic` 结构标记与自动首帧预热合同；
- 前端组件满足单一职责与 300 行限制；
- 路由、鉴权、发布和发布包完整。

### 12.2 用户验收

自动检查不代替视觉和交互验收。用户需要在实际桌面与移动横屏环境确认：

- 场景构图与空间表达；
- 旋转、缩放、楼层和视角操作；
- `SU 设计稿 / 户型图 / 用户需求` 三项视觉切换，质量审计随交付数据保留；
- 文字密度、层级、颜色和可读性；
- 多方案项目的方案比较表达；单方案项目的单方案理由与无冗余切换；
- 与真实装修任务的专业感。

移动端验收只评审横屏构图：移动设备竖屏进入时，页面必须自动交换实时视口宽高并旋转为横向画布，不显示竖版替代布局或旋转提示；移动设备已横屏时直接使用同一横屏构图，桌面窄窗口保持桌面行为。

在用户完成上述检查前，状态保持 `visualAcceptance: user`。

## 13. 实施基线

关键文件：

- `registry/interior-design.json`
- `agents/interior-designer/examples/featured-delivery.json`
- `skills/interior-design/SKILL.md`
- `skills/interior-design/schemas/project-v2.schema.json`
- `skills/interior-design/scripts/project-v2.mjs`
- `skills/interior-design/scripts/pascal-adapter.mjs`
- `skills/interior-design/scripts/scene-v2.mjs`
- `skills/interior-design/scripts/quality/`
- `skills/interior-design/scripts/generate-page-v2.mjs`
- `skills/interior-design/scripts/build-agent-delivery-example.mjs`
- `skills/interior-design/examples/professional-agent-example/`
- `core/app/public/assets/agents/interior-designer/featured/`

本文件是装修设计 Agent 的当前完整设计基线。实现、Agent 交付合同、测试和发布产物都必须与它保持一致。
