# Renderer V5 合同

- 请求：`personal-agent/interior-workspace/v5`。
- 输出：`personal-agent/interior-page-bundle/v5`。
- 权威源：`project.json`、毫米制 `geometry.json`、`artifact-workflow.json`。
- 主入口：`index.html`，按业主决策顺序组织，不呈现内部工作区说明。
- 在线图纸：六类专业主题 SVG，可切换、缩放、拖动和下载。
- 3D：`3d/index.html`，支持鸟瞰、平面、全景节点直达、无鼠标锁定键盘漫游。
- 全景审阅：`panorama-review/index.html`，一次一张，通过本地 360° 球面查看器显示相机状态、空间一致性检查和 Imagegen 实景全景确认状态；Blender 控制图与提示词包保留在内部工作流。
- 最终漫游：全部 Imagegen 照片级实景全景确认且存在合法 krpano 运行时后才组装。
- 隐私：不发布原始证据、绝对路径、环回地址或远程运行时。
- 修改：只通过源数据与过程产物状态修改，按依赖关系精准失效。
- 验收：自动检查不能替代用户视觉与交互验收。
