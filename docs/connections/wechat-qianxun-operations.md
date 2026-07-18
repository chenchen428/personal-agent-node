# 个人微信（千寻）连接器操作手册

## 配置

先打开 [`daenmax/pc-wechat-hook-http-api`](https://github.com/daenmax/pc-wechat-hook-http-api/) 获取免费开源版千寻客户端。按仓库当前分支说明安装受支持的 PC 微信版本，启动千寻、完成微信登录并开启 HTTP API。在“连接 → 个人微信”复制当前实例的消息回调地址，填入千寻的 HTTP API / 事件回调配置；不要根据浏览器开发端口猜测回调端口。

先把 SafeKey 单独保存在本机权限受控的文本文件中，避免把它写入命令行历史或进程参数。生成配置计划：

```powershell
pa-cli connection wechat qianxun plan-configure `
  --url http://127.0.0.1:8055 `
  --endpoint-style auto `
  --safe-key-file D:\secure\qianxun-safe-key.txt `
  --json
```

若千寻只开放 `httpapi`，需使用 `--endpoint-style httpapi --wxid <预期账号>`。连接器不会从回调推断绑定账号。

计划结果包含 `operation.id`、`operation.digest`、`approvalCommand` 和 `executeCommand`。在本机交互终端审批并执行：

```powershell
personal-agent operation approve <op-id> --digest <digest> --json
pa-cli connection wechat qianxun execute --operation <op-id> --digest <digest> --json
```

执行配置时会调用 Q0000。只有返回 `code=200` 且包含登录 `wxid`，并与计划中的预期账号一致，配置才会落盘。

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
plan-accept-friend --scene <n> --v3 <value> --v4 <value>
plan-add-friend-v3 --v3 <value> --content <text> --scene <n> --type <n>
plan-add-friend-wxid --wxid <wxid> --content <text> --scene <n>
plan-invite-group --group <group-wxid> --member <member-wxid> [--type <n>]
plan-remove-contact --wxid <wxid>
```

发送图片或文件时，千寻与 Personal Agent 必须在同一台机器上，并能访问审批计划中固定的绝对路径。删除好友属于 R3；摘要会明确显示永久删除的目标。

## 故障判断

- `needs_setup`：尚未配置。
- `unavailable`：本机端点不可达、超时、返回非 JSON、HTTP 非 2xx 或业务 `code != 200`。
- `account_mismatch`：Q0000 返回的账号不是已固定账号。
- `DIGEST_MISMATCH`：执行参数与计划摘要不一致。
- `APPROVAL_REQUIRED`：计划尚未由本机交互终端审批。
- 回调返回 `ignored:account_mismatch`：回调账号与固定账号不一致，事件未入库。

连接器不会自动启动千寻或自动切换微信账号。收到的消息只有在本机访问策略启用并通过联系人、群和群触发方式校验后才会交给主 Agent；未授权消息只保留规范化判定记录。连接器不会在错误信息中输出 SafeKey。

正式入口使用 `pa-cli connection wechat-personal ...`。历史 `pa-cli connection wechat qianxun ...` 命令保留兼容。访问策略可以在“连接 → 个人微信”的折叠配置流程中完成，也可以使用 `directory`、`policy` 和 `set-policy --file` 管理。
