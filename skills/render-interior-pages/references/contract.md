# 装修设计 Page 渲染契约 v1

`interior-designer` 只拥有受治理项目数据；`render-interior-pages` 独占 Page 结构、样式、脚本、3D 查看器、响应式行为和 manifest。Agent 不得提交任意 HTML、CSS 或 JavaScript。

- 输入：通过专业质量门禁的 Pascal v2 项目 revision、编译场景、审计、脱敏图像与概念效果图。
- 请求契约：`personal-agent/interior-page-request/v1`。
- 输出契约：`personal-agent/interior-page-bundle/v1`。
- 固定输出：`index.html`、`3d/index.html`、`scene.json`、`audit.json`、`agent-review.json`、`manifest.json` 与相对路径媒体。

主体设计册是需求、设计说明、材料预算、过程确认与专业边界的唯一叙事承载面。独立 `3d/index.html` 只允许项目识别、模型画布、加载/故障状态、返回设计册入口和模型查看控制，不得重复需求说明或设计册叙事章节。

渲染器先完成确定性合同检查，再返回五个 Agent 必查目标。Agent 查看真实 Page 后提交结构化观察；任何问题都回到项目数据或场景操作，生成新 revision 并重渲染。Agent 通过不等于用户验收通过。

manifest 固定记录渲染能力 ID、版本、请求与输出契约。相同请求主版本可使用向后兼容的新版渲染器重建；未知主版本必须失败。
