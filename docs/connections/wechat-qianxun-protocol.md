# 千寻微信连接器协议

本文记录 Personal Agent Node 与千寻/DaenWxHook 的协议边界。连接器不包含、不下载、不启动、也不分发千寻或微信二进制。用户从 [`daenmax/pc-wechat-hook-http-api`](https://github.com/daenmax/pc-wechat-hook-http-api/) 获取免费开源版千寻客户端；该版本已包含本连接器所需的 HTTP API、联系人、群和消息事件能力。

## 架构边界

个人微信连接器与现有“微信 claw”连接器并存：

- 微信 claw 继续通过扫码连接独立承担远程主 Agent 对话。
- 个人微信通过千寻承担用户本机真实微信账号的资料、联系人、群组和消息操作。
- 千寻回调默认拒绝；只有通过本机访问策略的文本消息才进入主 Agent，对应回执与回复仍通过千寻发回原私聊或群。
- 千寻端点、SafeKey、回调内容和操作结果均不上传 Cloud。

连接器只连接 `http://127.0.0.1:<port>` 或 `http://[::1]:<port>`。不接受局域网、公网、HTTPS、带认证信息、路径、查询串或重定向的地址。

## 请求与响应

连接器向千寻发送：

```json
{
  "type": "Q0000",
  "data": {}
}
```

可用路径：

- `POST /DaenWxHook/client/`
- `POST /DaenWxHook/httpapi/?wxid=<pinned-wxid>`

`endpointStyle=auto` 时优先尝试 `client`；已固定 `wxid` 时失败后可尝试 `httpapi`。显式选择 `httpapi` 必须同时提供预期 `wxid`。成功路径会记入本机配置。

SafeKey 仅放在 HTTP `safekey` 请求头，不放入 URL、日志、CLI 参数或 API 响应。HTTP 2xx 且 JSON `code` 严格等于 `200` 才算成功；响应必须是 JSON，最大 4 MiB，默认超时 5 秒，禁止跟随重定向。

## Q 协议矩阵

| 代码 | 含义 | 连接器开放 | 风险 |
| --- | --- | --- | --- |
| Q0000 | 微信状态检测 | 状态与配置探测 | R0 |
| Q0001 | 发送文本 | 审批后开放 | R2 |
| Q0002 | 修改图片下载窗口 | 仅协议登记 | R2 |
| Q0003 | 当前账号资料 | 直接读取 | R1 |
| Q0004 | 查询对象资料 | 直接读取 | R1 |
| Q0005 | 好友列表 | 直接读取，`type=1` 缓存、`type=2` 刷新 | R1 |
| Q0006 | 群聊列表 | 直接读取，`type=1` 缓存、`type=2` 刷新 | R1 |
| Q0007 | 公众号列表 | 直接读取，`type=1` 缓存、`type=2` 刷新 | R1 |
| Q0008 | 群成员列表 | 直接读取 | R1 |
| Q0009 | 发送聊天记录 | 仅协议登记 | R2 |
| Q0010 | 发送本地图片 | 审批后开放 | R2 |
| Q0011 | 发送本地文件 | 审批后开放 | R2 |
| Q0012 | 发送分享链接 | 仅协议登记 | R2 |
| Q0013 | 发送小程序 | 仅协议登记 | R2 |
| Q0014 | 发送音乐 | 仅协议登记 | R2 |
| Q0015 | 发送 XML | 仅协议登记 | R3 |
| Q0016 | 确认收款 | 禁止公开执行 | R3 |
| Q0017 | 同意好友请求 | 审批后开放 | R2 |
| Q0018 | 通过 v3 添加好友 | 审批后开放 | R2 |
| Q0019 | 通过 wxid 添加好友 | 审批后开放 | R2 |
| Q0020 | 查询陌生人 | 直接读取 | R1 |
| Q0021 | 邀请成员进群 | 审批后开放 | R2 |
| Q0022 | 删除好友 | 审批后开放 | R3 |
| Q0023 | 修改备注 | 审批后开放 | R2 |

连接器没有通用的 `type/data` 透传 API。要开放新的 Q 操作，必须增加语义化输入校验、风险等级、测试和文档。

## 回调协议

千寻框架外层格式：

```json
{
  "event": 10008,
  "wxid": "wxid_owner",
  "data": {
    "type": "D0003",
    "port": 8055,
    "data": {
      "fromType": 2,
      "msgType": 1,
      "msgSource": 0,
      "fromWxid": "group@chatroom",
      "finalFromWxid": "wxid_sender",
      "signature": "v1_example",
      "msg": "hello"
    }
  }
}
```

Daen 直接格式 `{type, data, wxid, port}` 也可解析。回调地址为：

```text
http://127.0.0.1:<personal-agent-port>/api/internal/channels/wechat-personal/callback
```

旧路径 `/api/internal/channels/wechat/qianxun/callback` 继续作为兼容别名。

桌面端通过认证后的 `GET /api/connections/wechat-personal/setup` 读取当前实例的完整回调地址、默认千寻 HTTP API 地址和免费版仓库链接。界面不得用浏览器开发端口推导回调地址；实际监听端口可能由安装配置覆盖。

回调入口位于正常浏览器认证之前，但只接受无 `X-Forwarded-For` 的环回 TCP 连接，最大请求体 1 MiB，并要求回调 `wxid` 与配置时由 Q0000 固定的账号完全一致。回调不能创建或更改账号绑定。

D0003 只保存经过长度限制的消息字段；不读取回调中的本地附件路径。事件以账号、类型和签名生成稳定键，最近事件重复回调不会再次触发 Agent。事件日志位于 Workspace 的 `connections/wechat/qianxun/events.ndjson`，单文件达到 5 MiB 时保留一个滚动副本。SafeKey、Base64 正文和未知嵌套对象不写入日志。

访问策略位于 `connections/wechat/qianxun/access-policy.json`。策略默认未启用；保存时会重新从千寻读取联系人和群，并拒绝不在千寻目录中的标识。页面和策略只使用与当前账号绑定的不可逆 `pwc_` 标识，不返回或持久化原始联系人、群 wxid。私聊校验联系人范围；群聊校验群、成员范围和群触发方式；当前账号自己发送的消息与非文本消息不会触发主 Agent。

## 本机数据

配置、待审批输入和事件日志位于：

```text
<PRIVATE_SITE_DATA_ROOT>/connections/wechat/qianxun/
```

配置和待审批文件按 `0600` 创建，目录按 `0700` 创建。API 只返回 `safeKeyConfigured`，不返回 SafeKey。待审批输入以 SHA-256 指纹绑定到操作计划；执行成功或失败后立即删除。

## 下载与使用引导

1. 打开免费开源版[仓库](https://github.com/daenmax/pc-wechat-hook-http-api/)，按当前分支说明安装受支持的 PC 微信版本，并从“千寻框架”目录获取千寻客户端。
2. 启动千寻，设置微信安装目录、数据缓存目录和对应 HOOK 版本，添加微信并完成登录。
3. 开启千寻 HTTP API；连接器默认探测 `http://127.0.0.1:8055`。
4. 在千寻的 HTTP API / 事件回调配置中填入“连接 → 个人微信”页面显示的完整消息回调地址。
5. 返回页面执行检测；检测成功后才读取联系人和群，并由用户保存默认拒绝的访问策略。

仓库中的客户端、微信版本与升级节奏由上游维护；Personal Agent 只提供链接和协议配置说明，不把二进制纳入安装包或升级包，也不替用户自动启动或更新。
