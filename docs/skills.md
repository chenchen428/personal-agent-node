# Cove 技能来源

Cove发行包仅内置13项技能：cove-runtime、cove-connectivity、cove-connections、cove-memory、cove-activity、cove-tasks、cove-schedules、cove-files、cove-data、cove-updates、cove-product-development、cove-bug-report、cove-acceptance。

内置技能来自不可变发行目录 `skills/`；用户总结或自定义技能留在每个Space的 `agent-workspace/skills`。UI显示“内置技能／我的技能”，来源由服务端解析，不能通过名字、frontmatter或可变registry伪造。

旧内置副本只有在完整文件集合及逐文件hash与受信基线一致时才排除默认发现。修改、增加文件、来源未知或符号链接都保留；排除发现不代表删除目录。用户技能正文不预先加载，模型仅获得索引，按任务读取对应SKILL.md与相对资源。

Codex使用本产品进程及线程的技能禁用配置关闭原生自动发现，再以每轮开发者索引提供同源目录；Claude关闭原生slash技能并使用受管系统索引。显式技能请求由同一解析器选择，冲突必须用来源ID消歧。不会改写用户全局引擎配置。

日程和定时任务共享cove-schedules但合同不同：calendar保存空间事项和跟进；cron只承担明确要求的提醒或自动化。海报指引位于cove-files，不再引入专业角色或大模板技能。

修改后运行 `node scripts/skill-guard.mjs --working`、`node scripts/skill-tree.mjs cases verify`、来源与引擎测试，并完成仓库required checks。
