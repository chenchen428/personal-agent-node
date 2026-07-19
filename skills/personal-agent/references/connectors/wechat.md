# 微信 claw

查询微信连接状态，发起两分钟本机扫码会话并持续检查结果；二维码过期后重新生成，已连接时可显式重新连接。发送文字、图片和文件前遵守确认边界，绝不输出二维码内容或会话凭据。

## 能做什么

- 继续主 Agent 对话
- 发送文字、图片和文件
- 接收任务进展与结果
- 扫码连接与状态恢复

## CLI 交互

For an ordinary reply in the current inbound WeChat conversation, native managed image/file delivery is owned by the canonical main-Agent final-reply contract, not by the manual CLI commands below. The main Agent selects ready `obj_` objects; the orchestrator validates them and chooses the existing connector `sendImage` or `sendFile` method. Workers do not send, and Activity attachments do not trigger channel delivery. See [final reply attachments](../final-reply-attachments.md).

命令入口：`pa-cli connection wechat`

提供 status、connect、send-file 和 send-image；状态输出经过脱敏。

| 操作 | 风险 | 说明 |
| --- | --- | --- |
| `status` | R0 | 读取脱敏连接状态。 |
| `connect` | R2 | 展开“生成登录二维码 / 手机微信扫码 / 手机确认连接 / 检测连接状态”横向 SOP；在本机生成限时二维码，持续检查真实手机确认结果，并支持过期重试或重新连接。 |

二维码生成只通过第一节点，扫码也不等于连接成功。用户必须在手机微信确认，Node 最终检测到连接状态后才更新绿色连接 Badge；二维码过期停留在扫码节点并提供重新生成，不按倒计时自动推进。
| `send-file` | R2 | 向已确认接收人发送本机文件。 |
| `send-image` | R2 | 向已确认接收人发送本机图片。 |

千寻能力属于独立的“个人微信”连接器，见 [个人微信](wechat-personal.md)。历史 `pa-cli connection wechat qianxun ...` 命令仅保留脚本兼容，不代表两项连接仍属于同一渠道。
