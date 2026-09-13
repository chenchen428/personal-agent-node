# 到点提醒与执行

优先通过 pa-cli plan 创建统一计划。指定一次时间与周期时间都由同一调度器产生普通任务；record 模式不启动 Agent。remind 只提醒本人，execute 执行用户明确要求的工作，任务结果由主 Agent 汇总交付。

保存 executionPrompt 的完整要求，不要把“每周整理销售周报并返回表格”压成“执行任务”。未说明时区时采用当前 Cove 时区并在结果中说明。通过 --missed-run-policy 明确停机错过策略：skip 不补跑，latest 最多补最近一次，避免开机后集中执行多次。已经领取但结果未知的运行显示中断，不自动重做可能有副作用的工作。

每次发生都有独立执行记录，plan runs --id <plan-id> --capability <ephemeral> --json 查看状态和任务链接；需要完整结果时再用 cove-tasks 查看对应任务。触发成功仅说明已开始，只有核对结果与交付才能说完成。

旧 pa-cli cron 是兼容入口，读取和修改同一份计划，不是另一套产品。旧数据保留并按稳定来源幂等接入，不重复触发。兼容命令：

~~~text
pa-cli cron list --json
pa-cli cron create --name <name> --cron "0 21 * * *" --timezone Asia/Shanghai --prompt <完整要求> --capability <ephemeral> --json
pa-cli cron update --id <id> --enabled --capability <ephemeral> --json
pa-cli cron delete --id <id> --capability <ephemeral> --json
pa-cli cron run --id <id> --capability <ephemeral> --json
~~~

兼容 cron 仍支持五字段表达式和不少于15分钟的频率限制。变更需要当前主 Agent 临时能力，浏览器只读。删除、取消或手动立即执行必须有用户明确的对应意图；不要把查询状态变成手动运行。写后重新读取计划及下一次执行时间，失败时报告实际原因。

升级接管后旧调度表保持停用而新计划保留原开关；回滚旧版不会重新启用已过期的旧规则。若确需在旧版恢复自动化，先核对当前意图与规则，再明确恢复。
