# 装修设计 Page 渲染契约 v1

`interior-designer` 只拥有受治理项目数据；`render-interior-pages` 独占 Page 结构、样式、脚本、3D 查看器、响应式行为和 manifest。Agent 不得提交任意 HTML、CSS 或 JavaScript。

- 输入：通过专业质量门禁的 Pascal v2 项目 revision、编译场景、审计、脱敏图像与概念效果图。
- 请求契约：`personal-agent/interior-page-request/v1`。
- 输出契约：`personal-agent/interior-page-bundle/v1`。
- 固定输出：`index.html`、`3d/index.html`、`scene.json`、`style-guide.json`、`audit.json`、`agent-review.json`、`manifest.json` 与相对路径媒体。

主体设计册是需求、设计说明、材料预算、过程确认与专业边界的唯一叙事承载面。独立 `3d/index.html` 只允许项目识别、模型画布、加载/故障状态、返回设计册入口和模型查看控制，不得重复需求说明或设计册叙事章节。

渲染器先完成确定性合同检查，再返回五个 Agent 必查目标。Agent 查看真实 Page 后提交结构化观察；任何问题都回到项目数据或场景操作，生成新 revision 并重渲染。Agent 通过不等于用户验收通过。

`style-guide.json` 是 3D 与后续效果图共用的单一已选风格契约。Agent 可先通过渲染器的 `styles` 命令读取能力拥有的风格目录，再把一个 `styleId` 写入 `demandWorkflow.styleProfile.primary`。该 `styleId` 同时约束调色板、材质族、灯光曝光、软装语言、效果图正向提示和负向提示。成品 Page 不包含风格选择器，也不暴露客户端风格切换 API；收到风格反馈后，Agent 必须更新项目风格、把旧效果图标记为 stale、编译新 revision、重渲染 Page 并完成 Agent review，再使用同一 `styleId` 和 manifest 中的 `styleGuideSha256` 生成效果图。

manifest 固定记录渲染能力 ID、版本、请求与输出契约。相同请求主版本可使用向后兼容的新版渲染器重建；未知主版本必须失败。
