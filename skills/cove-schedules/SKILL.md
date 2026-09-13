---
name: cove-schedules
description: 管理当前空间统一任务计划、单次及周期日程、提醒和自动执行，查看下一次安排及每次执行结果。使用 pa-cli plan 管理计划、calendar 查询日程实例；默认仅记录，明确要求后才提醒或执行。
---

# Cove 任务计划与日程

同一件事只建立一个计划，任务中心的计划、日程、执行记录共享它。立即进行的普通委托仍使用 cove-tasks；有指定时间、重复规则、未来提醒或自动执行时使用本技能。先读 [calendar.md](references/calendar.md)，涉及执行或旧自动化时再读 [scheduled-tasks.md](references/scheduled-tasks.md)。

区分行为：record 只记录；remind 提醒本人；execute 交给 Cove 执行。缺省为 record。不能因用户提到参与人而联系他们，也不能把每周开会自动理解成让 Agent 每周运行。提醒或执行保存完整要求到 executionPrompt；不要为同一计划再创建一条 cron。

创建、修改和运行计划使用当前主会话临时能力，不输出、保存或转交它。修改先读最新 revision；周期修改明确 scope：整个系列、仅本次、这次及以后。单次例外和历史执行不覆盖原系列；完成一次不等于完成整个周期。

查看“最近一次”“下一次”时执行 pa-cli calendar list --view upcoming --limit 1，带本轮能力和 --json。先文字回答 nextEntry 的完整日期、时间、时区和事项，有 ongoingEntry 时另行说明。不要默认限制未来7天。无界视图展示各计划下一次；指定日期范围才展开每次发生，不能把系列数当作全部未来发生次数。

查询成功为空才说没有记录；对话或 Page 中的行程不是已登记计划。需要海报时再调用 calendar poster，使用已核实实例或明确范围，通过受管附件交付。海报失败仍保留文字答案。

所有写入从服务重新读取并核对计划、下一次及 revision。执行结果通过 plan runs 和关联普通任务核实，不凭到点、触发成功或进程退出宣称完整工作已交付。错过执行按用户选择的 skip 或 latest 策略处理；对已开始但结果未知的运行不得静默重跑。
