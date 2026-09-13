# 计划与日程实例

所有 Agent 命令使用 --json 和 --capability <ephemeral>。能力只来自当前主会话，不保存、不输出、不转交；Space 与操作者由运行时绑定。

pa-cli plan list|show|history|runs|create|update 管理系列；pa-cli calendar list|show|history|create|update|follow-up|due|poster 保留日程兼容入口。

- plan list 返回计划系列；plan show --id 返回单个系列；plan runs --id 查看它的每次执行和普通任务链接。
- calendar list --view upcoming --limit 1 查询下一次，不传固定 --to。nextEntry、ongoingEntry、asOf 分别表示下一次、进行中与查询基准。指定 --from/--to 查看带时区的明确范围；使用 limit/offset 翻页。
- calendar show --id 接受服务返回的实例 ID；不要自行拼接计划 ID 或发生时间来假冒实例。
- create 使用 --title、--participants-json、--start-at、--time-zone，可带 --end-at、--location、--notes、--status。复杂或多行内容优先使用 --input-file JSON，避免 shell 改写用户要求。
- 执行方式用 --execution-mode record|remind|execute，完整要求用 --execution-prompt；仅记录不需要提示。--missed-run-policy skip|latest 决定错过后跳过或最多补最近一次，缺省 skip。--enabled/--disabled 控制计划开关。
- 周期用 --recurrence-json 或输入文件的 recurrence。没有周期为 null；frequency 支持 daily、weekly、monthly、yearly，interval 为正整数；weekly 的 weekdays 为0至6数组（0周日、1周一）。工作日使用 [1,2,3,4,5]。until 是带偏移 ISO 截止时间，count 是总发生次数。规则按计划 IANA 时区的本地钟计算；月末不存在日期跳过，不悄悄改成别的日期。
- update 使用 --id、--expected-revision 和修改字段。--scope series 修改整个系列；--scope occurrence 或 future 必须携带服务返回的 --occurrence-at。仅本次写例外，后续修改拆分系列并保留以前记录。取消通过 status=cancelled；暂停整个计划可 disabled，不永久删除历史。
- history 支持 limit/offset；follow-up 使用最新 revision 和 content；due 只查待跟进，不会自动发送通知。

示例：每周一、三9点的仅记录安排，首次时间与星期匹配。

~~~text
pa-cli plan create --title "项目例会" --start-at 2026-09-14T09:00:00+08:00 --time-zone Asia/Shanghai --recurrence-json '{"frequency":"weekly","interval":1,"weekdays":[1,3]}' --execution-mode record --capability <ephemeral> --json
pa-cli plan show --id <plan-id> --capability <ephemeral> --json
pa-cli calendar list --view upcoming --limit 1 --capability <ephemeral> --json
~~~

变更后核对实际持久化的周期、执行方式、时区、下一次和 revision，不能只复述输入。查看海报优先固定模板：calendar poster --id <已核实实例ID>，或 from/to 明确范围；分页上限10张，过多时缩短范围。二维码仅绑定系统验证的当前 Space 手机地址。无链接或图片失败时仍报告文字事实。

后续拆分若覆盖已有执行记录会拒绝，应从尚未开始的下一次修改；历史执行快照始终保留，不通过改变系列ID重跑过去的工作。
