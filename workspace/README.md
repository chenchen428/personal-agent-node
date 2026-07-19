# 你的 Personal Agent 工作区

这里是个人助手长期工作的用户侧空间，不是产品源码目录。你的 Apps、文件、邮件、
数据库、自动化、技能、发布内容以及助手在工作中形成的可维护资产都保存在这里。
核心程序升级只补充缺失的工作区骨架，不覆盖你的内容；卸载时也默认保留此目录。

个人助手可以在授权范围内完成对话任务、整理和生成文件、构建 Personal Apps、管理
Pages、查询本地数据、运行自动化、处理本地邮件、使用已安装技能并维护动态。具体边界
见 `docs/capabilities.md`。

工作区允许助手持续迭代，但每次迭代都必须可解释、可验证、可回退。修改 Apps、技能、
工作流或自动化前，先读 `AGENTS.md` 和对应 registry/workflow；完整方法见
`docs/self-iteration.md`。

修改 Personal Agent 产品本身属于“产品能力共建”，不是上述自迭代。该流程先把注册的
GitHub 私有根仓库克隆到 `agent-workspace/projects/personal-agent`，再在克隆副本中研发 Cloud
与 Node；安装中的 `core/current` 始终保持不可变。具体流程见
`workflows/product-development.md`。

命令行分为两层：

- `personal-agent`：安装、运行时、连接、备份、升级和诊断。
- `pa-cli`：个人助手能力，包括会话、渠道、数据、自动化、文件和 Pages 等。

旧的 `open-abg`、`oab`、`open-agent-bridge` 命令不提供兼容入口。
