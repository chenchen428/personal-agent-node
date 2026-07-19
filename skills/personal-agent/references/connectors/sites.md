# Sites

检查本地站点与穿透状态，生成平台或自定义域名使用计划并在确认后应用；不读取或改写站点承载的用户内容。

## 能做什么

- 访问本地站点
- 查看站点健康状态
- 使用平台或自定义域名
- 建立和恢复安全穿透

## CLI 交互

命令入口：`pa-cli connection sites`

提供 list、status、tunnel-status，以及平台域名与自定义域名计划、验证和移除；域名与穿透变更需要确认。

| 操作 | 风险 | 说明 |
| --- | --- | --- |
| `list` | R0 | 列出本地站点。 |
| `status` | R0 | 检查本机访问和穿透状态。 |
| `use-platform-domain` | R2 | 通过 personal-agent.cn 限时认证，持续检查直至取得平台域名并建立安全穿透。 |
| `remove-platform-domain` | R2 | 移除本机的平台域名与穿透绑定并确认状态回调；保留 Workspace 数据和平台登记。 |
| `use-custom-domain` | R2 | 只提交并批准域名，生成全部 Space 的主域名/子域名映射、单密钥 WSS Relay 连接与检测契约；服务器和 DNS 由用户按引导准备。 |
| `verify-custom-domain` | R0 | 检查 DNS、TLS、加密转发和最终 HTTPS 内容证据，全部通过后生效。 |
| `remove-custom-domain` | R2 | 移除本机自定义域名绑定并保留 Site、Workspace 和本机能力。 |
| `tunnel-status` | R0 | 读取脱敏穿透健康状态。 |
