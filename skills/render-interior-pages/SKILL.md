---
name: render-interior-pages
description: Deterministically render an interior-workspace V5 project into an owner-facing booklet, six discipline-specific SVG drawings, editable semantic Three.js 3D, panorama review, and a gated krpano tour entry. Use when interior-designer creates, inspects, revises, or regenerates shareable 装修方案 Pages；不要用它制作任意网页。
---

# 装修工作区 Page 渲染 V5

只从已通过概念质量门的 `project.json`、`geometry.json` 和 `artifact-workflow.json` 渲染。阅读 [contract.md](references/contract.md)，然后运行：

`node skills/render-interior-pages/scripts/cli.mjs render --project-dir <项目工作区> --json`

输出固定为 `<项目工作区>/pages/`：

- `index.html`：业主设计册和默认入口。
- `assets/drawings/`：平面、天花灯具、开关、插座、给排水、柜体六类独立 SVG。
- `3d/index.html`：带门窗、家具柜体、灯具、相机节点和键盘漫游的语义草图。
- `panorama-review/index.html`：通过本地 360° 球面查看器逐视角展示相机、空间一致性检查与 Imagegen 实景全景确认状态；内部 Blender 控制图和提示词包不向用户展示。
- `tour/index.html`：未解锁时解释门禁；全部全景确认后由 krpano 组装器替换。
- `manifest.json` 与 `agent-review.json`：当前 revision、哈希和检查目标。

观察结果使用当前 revision 与 renderer version 5：

`node skills/render-interior-pages/scripts/cli.mjs review --bundle <项目工作区>/pages --input <observations.json> --json`

问题修改对应过程产物并依赖失效，不直接修改生成的 HTML、CSS 或 viewer bundle。Agent 自检通过只表示可交给用户检查；视觉与交互最终验收归用户。
