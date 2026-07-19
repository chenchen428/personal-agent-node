# 个人微信连接器

个人微信是独立于“微信 claw”的 Windows 本机连接器。由于上游千寻与受支持的 PC 微信仅运行在 Windows，此连接只在 Windows 版 Personal Agent 中展示；macOS 和 Linux 不提供该入口。它只连接用户已经安装并运行的千寻协议服务；Personal Agent 不下载、启动、打包或分发千寻二进制。

## 启用顺序

1. 按[千寻 Pro 官方快速入门](https://daenmax.github.io/qxpro-doc/doc/start/)安装千寻 Pro 与受支持的 PC 微信版本，并申请试用或购买授权。
2. 启动千寻 Pro、添加并登录微信、配置当前微信的 HTTP 端口；在“连接 → 个人微信”填写相同的千寻服务端口，再把页面显示的完整本机地址填入千寻 Pro 的 HTTP 事件回调配置。
3. 检测回环地址上的 `/wechat/httpapi`，并用 `checkWeChat` 确认当前登录账号和授权状态。
4. 通过千寻 Pro 的 `getSelfInfo`、`getFriendList`、`getGroupList` 读取账号、联系人和群。
5. 在页面中只显示名称和脱敏标识；浏览器与本机策略使用账号绑定的不可逆标识，不持有原始联系人或群 wxid。
6. 把策略保存在本机后启用消息接收。策略未启用时默认拒绝全部消息。
7. 点击“开始收发测试”，把页面生成的唯一文字通过微信文件传输助手发给自己；只有匹配的本机回调会推进测试。
8. 回调收到并落入本机会话历史后，先准备固定测试回复，再由本机用户明确确认 R2 发送操作。
9. 千寻 Pro 成功把测试回复发回文件传输助手后才算连接完成。测试消息属于自发消息，只存储、不触发主 Agent。

## 访问策略

- 私聊必须来自允许联系人，并且该联系人的范围包含私聊。
- 群聊必须来自允许群；默认还要求发言者在允许联系人中、范围包含群内，并且明确 @ 当前登录账号。
- 群可改为“任何成员 + @我”或“名单成员发言”。
- 当前账号自己发送的消息、非文本消息、未授权联系人和未授权群不会触发主 Agent。
- 策略中的联系人和群标识必须来自本次千寻目录读取，不能手工注入未知标识。

## 回调与回复

千寻 Pro 的 `recvMsg` 回调统一使用固定本机入口 `http://127.0.0.1:8843`。个人 Space 使用 `/api/internal/channels/wechat-personal/callback`；子 Space 在路径末尾追加用户定义且唯一的 Space code，例如 `/api/internal/channels/wechat-personal/callback/pwx`，不使用查询参数或内部 `sp_...` ID。页面从本机服务读取并提供完整地址，不应根据浏览器或空间内部端口手工猜测。固定入口只接受来自本机、指向有效且正在运行 Space 的个人微信回调，并继续绑定配置时确认的微信账号。连接器先进行去重和消息规范化，再把每个私聊或群聊的消息写入目标空间的本机会话历史；策略拒绝、自己发送和非文本消息也保留，但不会触发主 Agent。只有通过判断的文本消息才进入主 Agent，并自动附带同一会话在当前消息之前最多 100 条历史作为不可信上下文。主 Agent 的回执和回复通过同一个千寻连接器发回原私聊或群，不会误用微信 claw。

历史保存在 `connections/wechat/qianxun/history.sqlite`，不自动裁剪，且只暴露不可逆 `pwc_` 会话标识。附件类型保存安全占位文本，不保存千寻回调中的本地绝对路径。升级时会导入仍保留在旧诊断事件日志中的消息。

## CLI

```text
pa-cli connection wechat-personal status
pa-cli connection wechat-personal detect [--url http://127.0.0.1:8055] [--safe-key-file <path>]
pa-cli connection wechat-personal directory
pa-cli connection wechat-personal policy
pa-cli connection wechat-personal set-policy --file <policy.json>
pa-cli connection wechat-personal events --limit 50
pa-cli connection wechat-personal conversations [--limit 50] [--before <seq>]
pa-cli connection wechat-personal history --conversation <pwc_id> [--limit 100] [--before <seq>]
```

历史命令 `pa-cli connection wechat qianxun ...` 继续保留，用于兼容已有脚本。SafeKey 只从文件读取并保存在权限受限的本机配置中，不出现在状态输出、页面或回调日志中。
