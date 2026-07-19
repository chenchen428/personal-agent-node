# 千寻 Pro 微信连接器协议

本文记录 Personal Agent Node 与千寻微信框架 Pro 的协议边界。上游安装、微信版本、授权和 HTTP API 行为以[千寻 Pro 官方快速入门](https://daenmax.github.io/qxpro-doc/doc/start/)及其接口文档为准。Personal Agent 不包含、不下载、不启动、不升级，也不分发千寻 Pro 或微信二进制。

## 架构边界

个人微信连接器与现有“微信 claw”连接器并存：

- 微信 claw 继续通过扫码连接独立承担远程主 Agent 对话。
- 个人微信通过千寻 Pro 承担用户本机真实微信账号的资料、联系人、群组和消息操作。
- 千寻 Pro 回调默认拒绝；只有通过本机访问策略的文本消息才进入主 Agent，对应回执与回复仍通过千寻 Pro 发回原私聊或群。
- 千寻 Pro 端点、SafeKey、回调内容和操作结果均不上传 Cloud。

连接器只连接 `http://127.0.0.1:<port>` 或 `http://[::1]:<port>`。不接受局域网、公网、HTTPS、带认证信息、路径、查询串或重定向的地址。

## HTTP 接入模式

官方文档定义两种 HTTP API 模式：

- `wechat`：直接连接一个已注入的微信进程，`POST /wechat/httpapi`。端口对应千寻 Pro 为该微信分配或指定的端口，不需要 `wxid` 查询参数。
- `qianxun`：连接千寻 Pro 框架的集中 HTTP 端口，`POST /qianxun/httpapi?wxid=<pinned-wxid>`。该模式必须预先固定目标账号；若配置 SafeKey，按官方协议在请求时加入 `safekey` 查询参数。

`endpointStyle=auto` 时先尝试 `wechat`；只有已经固定 `wxid` 时才会回退尝试 `qianxun`。历史配置值 `client`、`httpapi` 分别迁移为 `wechat`、`qianxun`。路径末尾不能额外添加 `/`，千寻 Pro 会把 `/wechat/httpapi/` 视为不存在的路由。

连接器首先发送：

```json
{
  "type": "checkWeChat",
  "data": {}
}
```

HTTP 2xx 且 JSON `code` 严格等于 `200` 才算协议成功。`checkWeChat` 还必须返回登录 `wxid`，且 `result.isExpire` 不得表示授权到期。响应必须是 JSON，最大 4 MiB，默认超时 5 秒，禁止跟随重定向。

## Pro 操作矩阵

| Pro `type` | 含义 | 连接器开放 | 风险 |
| --- | --- | --- | --- |
| `checkWeChat` | 微信状态检测 | 状态与配置探测 | R0 |
| `getSelfInfo` | 当前账号资料 | 直接读取 | R1 |
| `queryObj` | 对象资料 | 直接读取 | R1 |
| `getFriendList` | 好友列表 | 直接读取，`type="1"` 缓存、`type="2"` 刷新 | R1 |
| `getGroupList` | 群聊列表 | 直接读取，`type="1"` 缓存、`type="2"` 刷新 | R1 |
| `getPublicList` | 公众号列表 | 直接读取 | R1 |
| `getMemberList` | 群成员列表 | 直接读取 | R1 |
| `queryNewFriend` | 查询陌生人 | 直接读取 | R1 |
| `sendText` | 发送文本 | 审批后开放 | R2 |
| `sendImage` | 发送图片 | 审批后开放 | R2 |
| `sendFile` | 发送文件 | 审批后开放 | R2 |
| `editObjRemark` | 修改备注 | 审批后开放 | R2 |
| `agreeFriendReq` | 同意好友请求 | 审批后开放 | R2 |
| `addFriendByV3` | 通过 v3 添加好友 | 审批后开放 | R2 |
| `inviteMembers` | 邀请成员进群 | 审批后开放 | R2 |
| `delFriend` | 删除好友 | 审批后开放 | R3 |

连接器没有通用的 `type/data` 透传 API。要开放新的 Pro 操作，必须增加语义化输入校验、风险等级、测试和文档。

## 回调协议

微信进程直连回调示例：

```json
{
  "type": "recvMsg",
  "data": {
    "fromType": 2,
    "msgType": 1,
    "msgSource": 0,
    "fromWxid": "group@chatroom",
    "finalFromWxid": "wxid_sender",
    "atWxidList": ["wxid_owner"],
    "signature": "v1_example",
    "msg": "hello"
  },
  "wxid": "wxid_owner",
  "port": 8055
}
```

千寻 Pro 框架的 `{event, wxid, data: {type: "recvMsg", data: {...}}}` 外层格式也可解析。旧版 `D0003` 继续作为兼容事件类型，但新配置与测试以 `recvMsg` 为准。回调地址为：

```text
http://127.0.0.1:8843/api/internal/channels/wechat-personal/callback
http://127.0.0.1:8843/api/internal/channels/wechat-personal/callback/<space-code>
```

旧路径 `/api/internal/channels/wechat/qianxun/callback` 继续作为兼容别名。桌面端通过认证后的 `GET /api/connections/wechat-personal/setup` 读取当前实例的完整回调地址、默认千寻 Pro 地址和官方文档链接；界面不得用浏览器开发端口推导回调地址。

回调入口位于正常浏览器认证之前，但只接受无 `X-Forwarded-For` 的环回 TCP 连接，最大请求体 1 MiB，并要求回调 `wxid` 与配置时由 `checkWeChat` 固定的账号完全一致。回调不能创建或更改账号绑定。

`recvMsg` 只保存经过长度限制的消息字段；不读取回调中的本地附件路径。事件以账号、类型和签名生成稳定键，重复回调不会再次触发 Agent 或生成重复历史。诊断事件日志位于 Workspace 的 `connections/wechat/qianxun/events.ndjson`，单文件达到 5 MiB 时保留一个滚动副本。会话历史独立保存在 `connections/wechat/qianxun/history.sqlite`，按私聊或群聊的不可逆 `pwc_` 会话标识长期保存全部已接收消息；访问策略拒绝、当前账号自己发送和非文本消息同样写入历史，但不会触发 Agent。历史正文不会保存本地附件绝对路径。升级后会把仍保留在诊断事件日志中的旧 `recvMsg` 导入历史库。SafeKey、Base64 正文和未知嵌套对象不写入日志或历史库。

每条通过访问策略的个人微信文本消息进入主 Agent 前，连接器会按同一 `pwc_` 会话读取当前消息之前最多 100 条记录，作为标记为“不可信历史数据”的上下文附加到本次 Agent 输入。历史不会冒充系统指令，也不会重复显示为当前用户消息。会话列表和消息历史均按序号游标分页，只通过本机认证 API 与 CLI 查询，历史 API 不返回原始联系人、群或成员 wxid。

访问策略位于 `connections/wechat/qianxun/access-policy.json`。策略默认未启用；保存时会重新从千寻 Pro 读取联系人和群，并拒绝不在当前目录中的标识。页面和策略只使用与当前账号绑定的不可逆 `pwc_` 标识，不返回或持久化原始联系人、群 wxid。私聊校验联系人范围；群聊校验群、成员范围和群触发方式；当前账号自己发送的消息与非文本消息不会触发主 Agent。

## 本机数据与 SafeKey

配置、待审批输入、事件日志和会话历史位于：

```text
<PRIVATE_SITE_DATA_ROOT>/connections/wechat/qianxun/
```

配置和待审批文件按 `0600` 创建，目录按 `0700` 创建。API 只返回 `safeKeyConfigured`，不返回 SafeKey。SafeKey 只从权限受控文件进入配置，并仅在发送集中框架请求时按上游要求加入查询参数；错误、状态响应、命令摘要和日志均不得包含该值。待审批输入以 SHA-256 指纹绑定到操作计划；执行成功或失败后立即删除。

## 安装与使用引导

1. 打开[千寻 Pro 官方快速入门](https://daenmax.github.io/qxpro-doc/doc/start/)，安装千寻 Pro 与官方列出的受支持 PC 微信版本。
2. 在千寻 Pro 中设置微信安装目录、数据缓存目录和 HOOK 版本，添加微信并完成登录。
3. 申请试用或购买授权；`checkWeChat` 可能在授权过期时仍返回 `code=200`，连接器会同时检查 `result.isExpire`。
4. 为当前微信指定 HTTP 端口；桌面页面默认使用 `http://127.0.0.1:8055` 并请求 `/wechat/httpapi`。
5. 在千寻 Pro 的 HTTP 事件回调配置中填入“连接 → 个人微信”页面显示的完整消息回调地址；地址固定使用 `127.0.0.1:8843`。个人 Space 使用回调根路径，子 Space 在路径末尾追加用户定义的 Space code，不使用查询参数或内部 Space ID。
6. 返回页面执行检测；检测和授权均通过后才读取联系人和群，并由用户保存默认拒绝的访问策略。

上游客户端、微信版本、授权与升级节奏由千寻 Pro 维护；Personal Agent 只提供官方文档链接和协议配置说明。
