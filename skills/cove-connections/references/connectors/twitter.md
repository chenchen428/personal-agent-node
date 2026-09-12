# Twitter / X

先用status分别检查浏览器环境、Twitter / X登录状态和只读能力；未确认不得当已连接。Windows/macOS支持，Linux拒绝。needs_login或CONNECTION_LOGIN_REQUIRED时用open打开固定官方登录页面，保留原查询上下文，用户完成登录后重新status确认并继续原已授权search/read。等待最多两分钟，超时保持待用户登录，不假称任务完成；前端不会自动唤醒Agent任务。搜索和读取每次都在同Space、同浏览器profile/session重新校验登录，登录墙/401立即失效，验证码与风控由用户处理。仅允许公开status/open/search/read，不调用任意脚本、Cookie工具或写命令，不输出Cookie、Token或账号标识。

## 能做什么

- 检测浏览器操作环境
- 检测平台登录状态
- 检测 Twitter / X 只读能力
- 在浏览器打开 Twitter / X
- 搜索可见推文
- 读取推文线程和回复
- 返回结构化互动与媒体链接

## CLI 交互

命令入口：`pa-cli connection twitter`

提供浏览器环境、平台登录、读取能力三层status；open引导人工登录，search/read每次验证同一浏览器会话。

| 操作 | 风险 | 说明 |
| --- | --- | --- |
| `status` | R0 | 分别检查浏览器环境、可见平台登录信号与搜索读取能力，未知状态不视为已连接。 |
| `open` | R1 | 在当前Space绑定的浏览器会话打开固定Twitter / X官方登录页面；此动作不要求预先登录，不自动填写或提交账号。 |
| `search` | R0 | 按查询词搜索推文并返回结构化结果。 |
| `read` | R0 | 按 tweet ID 或状态 URL 读取线程与回复。 |
