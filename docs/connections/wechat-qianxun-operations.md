# 个人微信（千寻）连接器操作手册

## 配置

先按[千寻 Pro 官方快速入门](https://daenmax.github.io/qxpro-doc/doc/start/)安装千寻 Pro 与受支持的 PC 微信版本，申请试用或购买授权，启动千寻 Pro、完成微信登录并配置 HTTP API。在“连接 → 个人微信”复制当前隔离空间的完整消息回调地址，填入千寻 Pro 的 HTTP 事件回调配置。回调统一使用固定本机入口 `127.0.0.1:8843`；个人 Space 使用回调根路径，子 Space 在路径末尾追加用户定义的 Space code，不使用查询参数或空间内部服务端口。

先把 SafeKey 单独保存在本机权限受控的文本文件中，避免把它写入命令行历史或进程参数。生成配置计划：

```powershell
pa-cli connection wechat qianxun plan-configure `
  --url http://127.0.0.1:8055 `
  --endpoint-style auto `
  --safe-key-file D:\secure\qianxun-safe-key.txt `
  --json
```

默认 `auto` 先检测当前微信进程的 `/wechat/httpapi`。若连接千寻 Pro 框架的集中端口，使用 `--endpoint-style qianxun --wxid <预期账号>`；集中模式请求 `/qianxun/httpapi?wxid=...`，连接器不会从回调推断绑定账号。历史值 `client`、`httpapi` 会分别迁移为 `wechat`、`qianxun`。

计划结果包含 `operation.id`、`operation.digest`、`approvalCommand` 和 `executeCommand`。在本机交互终端审批并执行：

```powershell
personal-agent operation approve <op-id> --digest <digest> --json
pa-cli connection wechat qianxun execute --operation <op-id> --digest <digest> --json
```

执行配置时会调用 `checkWeChat`。只有返回 `code=200`、包含登录 `wxid`、授权未过期，并与计划中的预期账号一致，配置才会落盘。

桌面连接页的“千寻服务端口”可以修改，范围为 `1` 到 `65535`，默认值为 `8055`。检测成功后端口会随本机连接配置保存；再次打开页面时应回显已保存端口。修改端口后再次检测会重新配置千寻端点，并保留已有 SafeKey。

## 收发连通测试

访问策略保存后，连接还必须完成一次独立的收发测试：

1. 在桌面连接页点击“开始收发测试”，复制页面生成的唯一测试文字。
2. 打开微信“文件传输助手”，把这段文字发给自己。Personal Agent 等待本机回调并把消息写入聊天历史，但这条自发消息不会触发主 Agent。
3. 页面显示“消息回调已收到”后点击“准备测试回复”。系统只准备固定测试文字，不允许 Agent 自由生成内容。
4. 检查回复摘要并点击“确认发送测试回复”。该操作按 R2 写操作处理，只能由本机已认证用户确认。
5. 千寻 Pro 返回发送成功后，页面才显示“收发测试均已通过”，个人微信连接才算完成。

测试有效期为 10 分钟。过期、回调文字不匹配、回调不是文件传输助手会话，或测试回复失败时都不能把连接标记为完成。不要用普通联系人代替文件传输助手，以免向他人发送测试内容。

## 状态与读取

```powershell
pa-cli connection wechat qianxun status --json
pa-cli connection wechat qianxun profile --json
pa-cli connection wechat qianxun friends --json
pa-cli connection wechat qianxun friends --refresh 1 --json
pa-cli connection wechat qianxun groups --json
pa-cli connection wechat qianxun official-accounts --json
pa-cli connection wechat qianxun lookup --wxid <wxid> --json
pa-cli connection wechat qianxun members --group <group-wxid> --json
pa-cli connection wechat qianxun stranger --pq <查询值> --json
pa-cli connection wechat qianxun events --limit 50 --json
```

本机个人微信会话记录使用不可逆会话标识查询，并支持按消息序号继续分页：

```text
pa-cli connection wechat-personal conversations --limit 50 --json
pa-cli connection wechat-personal conversations --limit 50 --before <latest-seq> --json
pa-cli connection wechat-personal history --conversation <pwc_id> --limit 100 --json
pa-cli connection wechat-personal history --conversation <pwc_id> --limit 100 --before <message-seq> --json
```

会话历史不要求千寻 Pro 当前在线；它读取本机 `history.sqlite`。输出不包含原始联系人、群或成员 wxid。每条允许触发的入站消息会自动向主 Agent 附加同一会话当前消息之前最多 100 条记录，无需调用者手工查询。

`status --probe 0` 只读取本机配置，不访问千寻。

## 写操作

每个写操作都分为计划、人工审批和执行三步。例如发送文本：

```powershell
pa-cli connection wechat qianxun plan-send-text --to <wxid> --text "你好" --json
personal-agent operation approve <op-id> --digest <digest> --json
pa-cli connection wechat qianxun execute --operation <op-id> --digest <digest> --json
```

其他计划命令：

```text
plan-send-image --to <wxid> --file <path>
plan-send-file --to <wxid> --file <path>
plan-set-remark --wxid <wxid> --remark <text>
plan-accept-friend --scene <n> --v3 <value> --v4 <value> [--role <n>]
plan-add-friend-v3 --v3 <value> --content <text> --scene <n>
plan-add-friend-group --group <group-wxid> --member <member-wxid> --content <text>
plan-invite-group --group <group-wxid> --member <member-wxid>
plan-remove-contact --wxid <wxid>
```

发送图片或文件时，千寻与 Personal Agent 必须在同一台机器上，并能访问审批计划中固定的绝对路径。删除好友属于 R3；摘要会明确显示永久删除的目标。

## 故障判断

- `needs_setup`：尚未配置。
- `unavailable`：本机端点不可达、超时、返回非 JSON、HTTP 非 2xx 或业务 `code != 200`。
- `account_mismatch`：`checkWeChat` 返回的账号不是已固定账号。
- `QIANXUN_AUTHORIZATION_EXPIRED`：千寻 Pro 授权已到期，需要续费或重新申请试用。
- `DIGEST_MISMATCH`：执行参数与计划摘要不一致。
- `APPROVAL_REQUIRED`：计划尚未由本机交互终端审批。
- 回调返回 `ignored:account_mismatch`：回调账号与固定账号不一致，事件未入库。

连接器不会自动启动千寻或自动切换微信账号。收到的消息只有在本机访问策略启用并通过联系人、群和群触发方式校验后才会交给主 Agent；未授权消息只保留规范化判定记录。连接器不会在错误信息中输出 SafeKey。

正式入口使用 `pa-cli connection wechat-personal ...`。历史 `pa-cli connection wechat qianxun ...` 命令保留兼容。访问策略可以在“连接 → 个人微信”的折叠配置流程中完成，也可以使用 `directory`、`policy` 和 `set-policy --file` 管理。
