# 个人微信连接器

个人微信是独立于“微信 claw”的 Windows 本机连接器。由于上游千寻与受支持的 PC 微信仅运行在 Windows，此连接只在 Windows 版 Personal Agent 中展示；macOS 和 Linux 不提供该入口。它只连接用户已经安装并运行的千寻协议服务；Personal Agent 不下载、启动、打包或分发千寻二进制。

## 启用顺序

1. 从 [`daenmax/pc-wechat-hook-http-api`](https://github.com/daenmax/pc-wechat-hook-http-api/) 获取免费开源版千寻客户端，按上游当前分支说明安装受支持的 PC 微信版本。
2. 启动千寻、添加并登录微信、开启 HTTP API，把“连接 → 个人微信”页面显示的完整本机地址填入千寻的消息事件回调配置。
3. 检测回环地址上的千寻服务，并用 `Q0000` 确认当前登录账号。
4. 通过千寻的 `Q0003`、`Q0005`、`Q0006` 读取账号、联系人和群。
5. 在页面中只显示名称和脱敏标识；浏览器与本机策略使用账号绑定的不可逆标识，不持有原始联系人或群 wxid。
6. 把策略保存在本机后启用消息接收。策略未启用时默认拒绝全部消息。

## 访问策略

- 私聊必须来自允许联系人，并且该联系人的范围包含私聊。
- 群聊必须来自允许群；默认还要求发言者在允许联系人中、范围包含群内，并且明确 @ 当前登录账号。
- 群可改为“任何成员 + @我”或“名单成员发言”。
- 当前账号自己发送的消息、非文本消息、未授权联系人和未授权群不会触发主 Agent。
- 策略中的联系人和群标识必须来自本次千寻目录读取，不能手工注入未知标识。

## 回调与回复

千寻回调仅接受本机请求，并绑定配置时确认的微信账号。当前实例的完整回调地址由页面从本机服务读取并提供复制，不应根据浏览器端口手工猜测。连接器先进行去重、消息规范化和访问策略判断；只有通过判断的文本消息才进入主 Agent。主 Agent 的回执和回复通过同一个千寻连接器发回原私聊或群，不会误用微信 claw。

## CLI

```text
pa-cli connection wechat-personal status
pa-cli connection wechat-personal detect [--url http://127.0.0.1:8055] [--safe-key-file <path>]
pa-cli connection wechat-personal directory
pa-cli connection wechat-personal policy
pa-cli connection wechat-personal set-policy --file <policy.json>
pa-cli connection wechat-personal events --limit 50
```

历史命令 `pa-cli connection wechat qianxun ...` 继续保留，用于兼容已有脚本。SafeKey 只从文件读取并保存在权限受限的本机配置中，不出现在状态输出、页面或回调日志中。
