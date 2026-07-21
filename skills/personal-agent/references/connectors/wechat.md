# 微信 claw

查询微信连接状态，发起两分钟本机扫码会话并持续检查结果；二维码过期后重新生成，已连接时可显式重新连接。发送文字、图片和文件前遵守确认边界，绝不输出二维码内容或会话凭据。

## 能做什么

- 继续主 Agent 对话
- 发送文字、图片和文件
- 接收任务进展与结果
- 扫码连接与状态恢复

## CLI 交互

命令入口：`pa-cli connection wechat`

提供微信 claw 的 status、connect、send-file、send-image；状态和凭据输出经过脱敏。

已配置时，桌面端显示“清空配置”。清空会删除当前隔离空间的微信登录凭据、同步游标和上下文缓存，并释放安装级账号独占绑定；本机对话记录和用户文件保留。清空后恢复到“配置”入口。

官方 `ilinkai.weixin.qq.com` 默认直连，不继承可能仅允许模型服务的通用 `HTTP_PROXY` / `HTTPS_PROXY`。确需代理时，优先配置 `WECHAT_ILINK_HTTP_PROXY`、`WECHAT_ILINK_HTTPS_PROXY` 与 `WECHAT_ILINK_NO_PROXY`；只有明确设置 `WECHAT_ILINK_USE_SYSTEM_PROXY=1` 时才继承通用代理。二维码请求有固定超时、有限重试和响应校验，界面只显示可行动且脱敏的失败原因。

| 操作 | 风险 | 说明 |
| --- | --- | --- |
| `status` | R0 | 读取脱敏连接状态。 |
| `connect` | R2 | 在本机生成限时二维码，持续检查手机确认结果，并支持过期重试或重新连接。 |
| `send-file` | R2 | 向已确认接收人发送本机文件。 |
| `send-image` | R2 | 向已确认接收人发送本机图片。 |
