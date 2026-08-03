# 装修项目工作区 V5

最终交付是一个持续更新的用户工作区。私有项目数据维护当前设计 revision，不保留旧引擎、旧 schema 或兼容副本。

```text
workspace/
├── workspace.json
├── project.json                  # 需求、证据、材料、预算与专业边界
├── geometry.json                 # 毫米制设计事实源与全景节点
├── artifact-workflow.json        # 每个过程产物的修订、确认和依赖状态
├── quality-report.json
├── manifest.json
├── evidence/source/              # 私有，不进入 Pages
├── derived/plan.svg
├── panoramas/                    # Blender 控制底稿、Imagegen 提示词包与实景全景原件
└── pages/
    ├── index.html                # 用户设计册
    ├── assets/drawings/*.svg     # 六类独立在线图纸
    ├── 3d/index.html             # 可修改的语义 3D 草图
    ├── panorama-review/index.html# 逐视角确认
    └── tour/index.html           # 最终 krpano 漫游
```

## 三个权威源

- `project.json`：范围、生活需求、证据、材料、预算、未知项和专业复核。
- `geometry.json`：楼层、房间、墙体、洞口、家具、柜体、天花、灯具、电气、给排水、相机与热点。
- `artifact-workflow.json`：图纸、3D、每个相机、结构控制底稿、Imagegen 提示词包、实景全景、热点、krpano 与走查记录的独立状态。

所有过程产物都能修改。修改后清除自身确认并递增 revision，只把传递依赖它的下游标记为 `invalidated`；不相关的图纸和全景节点保持确认。

事实状态保持 `verified`、`specified`、`image-derived`、`estimated`、`site-measure-required` 和 `excluded` 可区分。概念方案可在待复尺项存在时审阅，但不得宣称施工或生产就绪。
