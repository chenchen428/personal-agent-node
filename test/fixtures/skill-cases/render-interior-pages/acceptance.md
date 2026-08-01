# 装修设计 Page 渲染能力验收

代表产物必须由 `render-interior-pages` v1 生成，manifest 固定记录请求/输出契约，并携带五视图 `agent-review.json`。装修 Agent 只能修改项目数据后重渲染，不能直接修改生成页面。主体设计册承接需求和完整说明，独立 3D Page 只承载模型浏览与必要控制。Agent 自检通过只表示可提交用户验收。
