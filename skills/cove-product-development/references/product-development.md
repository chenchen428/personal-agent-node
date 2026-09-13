# 产品研发与故障恢复

用户工作区演进用于用户拥有的技能和流程；产品研发修改注册私有根仓库，包括 Cloud 源码与公开 Node 子模块。

1. 运行 `personal-agent development status --json`。默认 `personal-agent development ensure --json` 复用既有入口或下载完整仓库。
2. 已知本机有完整研发根仓库时，优先用 `personal-agent development ensure --checkout-source <绝对路径> --json`。正式命令检查当前 GitHub 身份具有私有仓库写权限、源目录是正确 Git 根、origin 与注册匹配、Cloud 是普通目录且 Node 是版本对齐的标准子模块，然后把固定研发入口链接到源目录。保留源目录、未提交改动与历史；重复绑定同一来源安全复用，不自动替换另一来源。此参数不能指向已安装的 `core/current`、单独 Node 仓库或不明来源。
3. 使用成功结果的 `checkoutPath` 作为 `pa-cli session start --workspace`。不根据猜测路径启动，也不用源码包或应用代替产品源码修复。
4. 转移命令有十分钟上限，启用进程级 Git 长路径支持；网络或超时失败最多再尝试一次，并改用 HTTP/1.1。失败 JSON 只提供固定分类、次数与下一步，不回显 stderr、凭据或带令牌的 URL。
5. 遇到 `network` 或 `timeout`，先确认环境是否恢复或是否有已验证的本机仓库可复用；没有新证据不要原样重试。`authentication`、`certificate`、`disk`、`filesystem`、`long_path` 按 `nextActions` 修复相应前提，不关闭证书校验，不覆盖用户数据，不绕过写权限或来源检查。`unknown` 不应触发无休止重试。
6. 有未提交改动时，入口准备仅验证子模块，不执行可能切换其版本的更新。子模块版本与根 gitlink 不一致时，当前研发工作必须先按根 Harness 完成版本记录；不要为通过入口检查而 reset 或丢弃改动。
7. 已认证用户发起请求授权该事项内的提交、推送、CI、发布、部署、升级与回滚，无需第二次逐项确认。测试、扫描、精确版本、制品与健康检查仍须自动完成。真实外部前提缺失时保留成果，明确已停止和唯一必要的恢复动作；不要声称后台仍在执行，也不要扩大为无关发布。

根 Harness 决定 Cloud/Node 的归属、检查和发布顺序。公开 Node 完成并发布后，私有根再记录对应 gitlink。正式入口复用不会把用户目录复制进产品发行包。
