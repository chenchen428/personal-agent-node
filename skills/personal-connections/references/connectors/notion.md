# Notion

先运行 ntn doctor 检查会话。未登录或重新连接时使用 ntn login --no-browser 取得官方授权地址和校验码，打开系统浏览器，并在两分钟内使用 ntn login poll 兑换结果；超时后废弃会话。API 写入、文件上传和 Worker 部署前说明目标与影响，绝不输出凭据库令牌。

## 能做什么

- 浏览器授权与多工作区切换
- 调用 Notion API
- 查询和维护数据源
- 上传文件并管理 Notion Workers

## CLI 交互

命令入口：`ntn`

直接使用 Notion 官方 ntn CLI；页面展示的能力由同一连接契约生成。

已配置时，桌面端显示“清空配置”。确认后运行 `ntn logout` 注销当前隔离空间的工作区凭据并恢复到“配置”入口；Personal Agent 本机内容不会随连接配置删除。

| 操作 | 风险 | 说明 |
| --- | --- | --- |
| `login|logout|doctor` | R2 | 通过限时浏览器授权会话连接或重新连接，轮询兑换结果、退出或检查本地会话。 |
| `api` | R1 | 调用已认证的 Notion API；写入方法需要确认。 |
| `datasources` | R1 | 查询或维护 Notion 数据源。 |
| `files|workers` | R2 | 上传文件或部署和管理 Notion Workers。 |
