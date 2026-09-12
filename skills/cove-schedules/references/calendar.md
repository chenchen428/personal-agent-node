# 空间日程

使用本轮主会话临时能力 `--capability <ephemeral>`，不保存、不转交、不输出该值。Space 和操作者由运行时绑定，不接受调用者指定。

`pa-cli calendar list|show|history|create|update|follow-up|due|poster` 均使用 `--json` 和本轮能力。

- `list`：`--from --to --query --status --limit --offset`；起止范围使用带偏移量的 ISO 时间。
- `show/history`：`--id`；history 支持 `--limit --offset`。
- `create`：`--title --participants-json --start-at --time-zone`，可带 `--end-at --location --notes --next-follow-up-at --status` 或 `--input-file` JSON。
- `update`：`--id --expected-revision` 和要修改的字段。
- `follow-up`：`--id --expected-revision --content`，可更新状态及下次跟进时间。
- `due`：`--before --limit --offset`，只查询待跟进事项。
- `poster`：按 `--from --to --status --query` 选择范围并生成受管图片；不接受任意外部二维码地址。

参与人为字符串数组，时间采用带 offset 的 ISO 输入并保留 IANA timeZone。状态为 planned、in_progress、done、cancelled。结束时间不得早于开始；清空 endAt 或 nextFollowUpAt 使用 JSON null。

更新前读取当前记录，写后核对服务返回的 revision 和持久化内容。日程和跟进不会自动创建 cron，也不会向参与人发送消息。需要提醒时另行使用定时任务合同。

海报必须呈现所选范围内所有事项的标题、参与人、日期时间与必要状态；系统分页，最多10张，超限缩短范围。长备注与历史详情在链接查看。没有可用手机地址时明确报告不可生成可扫码海报。
