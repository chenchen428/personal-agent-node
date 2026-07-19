# 个人微信

先检测本机千寻 Pro 和授权状态，再读取当前账号、联系人和群；只有保存本机访问策略后才接收消息。私聊按联系人名单判断，群聊同时校验群名单、成员范围和 @ 规则；自己发送、未授权和不支持的消息只记录判定结果，不触发主 Agent。

## 能做什么

- 检测本机千寻 Pro 协议
- 从千寻 Pro 读取登录账号、联系人与群
- 按联系人和群控制触发范围
- 按私聊和群聊长期保存全部消息记录
- 为每条触发消息向主 Agent 提供同会话前 100 条上下文
- 通过 CLI 分页查询会话与历史
- 把合规消息交给主 Agent
- 通过千寻 Pro 回复个人微信

## CLI 交互

命令入口：`pa-cli connection wechat-personal`

提供 status、detect、directory、policy、events、conversations、history 与千寻 Pro 协议读写兼容命令；SafeKey、原始 wxid 和账号凭据不会显示在连接页面。

| 操作 | 风险 | 说明 |
| --- | --- | --- |
| `status|directory|policy` | R1 | 检测千寻 Pro 并读取脱敏账号、联系人、群和本机访问策略。 |
| `conversations|history` | R1 | 使用不可逆会话标识分页查询本机个人微信聊天记录。 |
| `set-policy` | R1 | 保存允许触发主 Agent 的联系人、群和群内触发方式。 |
| `plan-*|execute` | R2 | 经本机确认后配置千寻 Pro 或执行个人微信写操作；删除联系人为 R3。 |
