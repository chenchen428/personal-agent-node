# Personal Agent 产品研发

产品研发修改 Personal Agent 本身；用户工作区演进只更新用户拥有的技能和流程。

1. 运行 `personal-agent development status --json`，再运行 `personal-agent development ensure --json`。已有明确的完整私有根仓库时，优先用 `personal-agent development ensure --checkout-source <绝对路径> --json` 校验并绑定，避免重复克隆。
2. GitHub 认证、私有可见性、写权限、origin、Cloud 与 Node 标准子模块边界必须通过。既有源目录和未提交改动保留；另一目标已占用固定研发入口时不覆盖。子模块版本未对齐时不 reset，由研发流程完成正确 gitlink 记录。
3. 使用正式结果中的 `checkoutPath` 启动工作：`pa-cli session start --parent <main-session> --workspace <checkoutPath> ... --json`。不得编辑已安装的不可变 `core/current`，也不能用单独公开 Node、源码包、应用或技能替代产品源码修复。
4. 私有根 Harness 负责 Cloud 与协调交付。阅读它的 `AGENTS.md`、注册表和适用技能；Node 保持标准公开子模块，先完成 Node 提交与发布，再更新私有根 gitlink。
5. 已认证用户发起请求持续授权该事项内的分支、提交、推送、CI、Node 发布、Cloud 部署、本机升级和自动回滚；不要求第二次本机确认。范围外工作不在授权内。
6. 自动执行测试、CI、扫描、制品校验、健康检查和回滚。失败时先依据脱敏 `diagnostic` 与 `nextActions` 恢复；传输网络或超时最多一次重试，使用进程级长路径和 HTTP/1.1 设置，不修改全局 Git 配置、不关闭证书验证。
7. `cloneFailurePolicy: stop` 表示恢复耗尽或必要边界不满足时不得把入口宣称为就绪。它不禁止有新证据的安全恢复或绑定已验证的本机根仓库。同一失败不原样反复重试；真实外部前提缺失时保留成果，明确已停止与必要恢复动作，不声称后台仍在执行。
