# ADR 0012：专业子 Agent 的 Page 驱动交互工作流

状态：已实施
日期：2026-08-01

## 背景

专业子 Agent 会生成设计稿、图片、路线、账本、报告、分镜和视频等长内容。只在聊天消息里描述“当前做到哪一步”，既不利于手机查看，也无法证明用户确认的是哪一版产物。单纯把阶段写进提示词，同样不能阻止跳步、过期确认或静默覆盖。

## 决策

每个注册专业 Agent 必须提供 `agents/<agent-id>/workflow.json` schema v2。它是工作流唯一的可执行授权状态；公开 `profile.yaml` 只负责介绍，领域 Skill 负责产物质量，二者都不能绕过它。

开启工作流时必须：

1. 以 `workflow-{agentId}-{projectKey}` 稳定 folder 生成移动优先的进度 Page；
2. 私有发布 Page，并使用真实发布结果中的 `pageId`、URL 或 `linkNotice` 初始化状态；
3. 每次推进、回退或重开后覆盖发布同一进度 Page，再同步其 `publishedRevision`；
4. 进度 Page 落后于状态 revision 时失败关闭，不得继续下一阶段。

产品运行时必须在注册专业 Worker 执行前完成首次私有发布，把稳定 `pageId`、受管访问地址和 revision 0 状态写入会话，并在任务事件中暴露该 Page。首次发布失败时 Worker 不得执行；服务恢复旧任务时，如果会话还没有初始 Page，必须先补建再恢复执行。提示词只能说明如何维护 Page，不能代替这项运行时事实。

进度 Page 显示目标、当前阶段、整体进度、已确认阶段、待确认对象、产物 Page 链接、revision 和反馈重开记录。布局以窄屏单列为基线；Page 本身只负责审阅，用户仍在主 Agent 会话中确认。

## 确认表面

阶段必须声明一种 `review.surface`：

- `text`：只用于短而完整的需求摘要、范围、约束或口径；
- `page`：用于设计稿、图片、多图画廊、长材料、表格、账本、报告、分镜、粗剪和最终交付；
- `terminal`：只用于 `delivered` 终态。

Page 确认必须引用该阶段最新受治理产物的准确 `pageId`。只回复“可以”、沉默、Worker 自检、内部工具成功或引用旧 Page，均不构成有效确认。每次确认记录表面、摘要、Page ID（如适用）、所覆盖阶段和 revision。

所有状态使用 optimistic revision。过期 revision、跳过阶段、缺少事实、缺少当前产物、确认表面不匹配、确认错误 Page，或进度 Page 未同步，均失败关闭。反馈改变上游事实时，回到最早受影响阶段；下游产物标记 stale，重新提交后才能再次满足门禁。

## 装修设计的强制顺序

`interior-designer` 固定为：

1. `initial-requirements`：把家庭、范围、预算、时间、户型依据和关键偏好整理成短文字，由用户确认；
2. `floorplan-adjustment`：发布带拆墙、新建墙、门洞、功能变化、保留边界和风险提示的标注户型 Page；
3. `three-d-design-review`：发布与已确认户型同源的可审阅 3D 设计稿 Page；
4. `render-style-sample`：只生成一张效果图样张并发布 Page，确认风格、材质、光线和视觉密度；
5. `full-render-set`：样张通过后，从入户门开始按真实空间路径生成不少于十五张视角，在多图 Page 中按“路径章节 → 空间 → 全景/关系/功能/细节”排版；
6. `final-delivery`：发布汇总需求、户型调整、3D、风格合同、全量效果图、未知项和专业边界的最终 Page；
7. `delivered`：仅表示最终进度 Page 已同步，不代替用户视觉验收。

唯一批处理例外：用户明确说“按推荐走”并写入 `recommended-mode-authorized` 后，可以把 `floorplan-adjustment` 与 `three-d-design-review` 合并成一个 3D Page 一次确认。初步需求、单张样张、十五张以上全量图和最终交付仍不可跳过或合并。

## 其他专业 Agent

五个专业 Agent 都遵守同一 Page/文字门禁，但领域产物独立：

| Agent | 文字确认 | Page 确认主链 |
| --- | --- | --- |
| 海报设计 | 任务建档 | 内容稿、素材盘点、视觉方向、代表页、系列稿、复核、最终视觉包 |
| 旅游规划 | 任务建档、硬约束冻结 | 调研证据、事实核验、行程草案、路线复核、执行包、最终行程 |
| 账务分析 | 任务建档 | 来源清单、标准账本、分类结果、分析口径、发现、报告、最终分析包 |
| 视频创作 | 任务建档 | 素材盘点、叙事、视觉风格、分镜、粗剪、成片、最终视频包 |
| 装修设计 | 初步需求 | 标注户型、3D、单张样张、十五张以上全量图、最终设计稿 |

专业 Worker 仍不直接联系用户。每轮最多向主 Agent 返回三个会实质改变结果的问题；主 Agent 负责提问、发布和记录确认。

## Page 资源模型

Page 是目录资源包。`index.html` 以同源相对路径引用图片、视频和其他资源；发布器逐文件保留目录关系。限制按单文件执行，不给整个 bundle 错套 20 MiB 聚合上限，也不把图片 base64 内嵌进 HTML。所有审阅 Page 默认私有，除非用户另行明确授权公开。

## 实现与验证

- `core/agent/src/agents/workflow.js`：定义验证、初始化、推进、回退、stale 产物和进度同步；
- `core/agent/src/agents/workflow-page.js`：确定性移动优先进度 Page；
- `core/agent/src/agents/workflow-runtime.js`：会话启动前的私有 Page 发布、托管索引和 Worker 运行时上下文；
- `scripts/specialist-workflow.mjs`：`validate / accept / page / init / advance / reopen / sync / status`；其中 `accept --agent <id>` 会只在内存中遍历完整工作流、验证确认与进度 Page 门禁并渲染移动端 Page，供独立 Codex 会话执行可复现验收；
- `schemas/personal-agent/agent-workflow.schema.json`：schema v2；
- `test/specialist-agent-workflow.test.mjs`：跨五个 Agent 的门禁和完整路径测试。

装修项目只使用注册的工作区流程；项目事实、几何事实和用户确认均来自当前 revision，不保留第二套项目内工作流或兼容授权状态。
