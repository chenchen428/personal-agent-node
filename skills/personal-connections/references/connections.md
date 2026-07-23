# Connection operations

Connection-specific instructions live in one reference file per connector. The authenticated Connections page reads and displays those files directly. Dynamic status comes from the runtime and never changes the declared capability surface.

- [微信 claw](connectors/wechat.md)：连接后可从微信远程联系主 Agent
- [钉钉](connectors/dingtalk.md)：通过官方 Stream 模式远程联系主 Agent
- [个人微信](connectors/wechat-personal.md)：仅 Windows，通过本机千寻 Pro 连接个人微信账号
- [小红书](connectors/xiaohongshu.md)：仅 Windows / macOS，通过 OpenCLI 操作浏览器并安全搜索和阅读小红书
- [Twitter / X](connectors/twitter.md)：仅 Windows / macOS，通过 OpenCLI 操作浏览器并搜索和阅读 Twitter / X
- [Notion](connectors/notion.md)：通过官方 CLI 连接工作区并操作 Notion
- [本地邮箱](connectors/mail.md)：默认连接本地邮箱，支持平台或自定义域名公网收件
- [Sites](connectors/sites.md)：默认连接本地站点，支持平台或自定义域名公网访问
