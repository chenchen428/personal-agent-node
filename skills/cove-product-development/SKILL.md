---
name: cove-product-development
description: Enter the registered Cove product-development checkout and follow its autonomous delivery boundary. Use when changing Cove Cloud, Node, product architecture, release Harness, or installed product behavior rather than updating a user-owned skill or workflow.
---

# Cove 产品研发

先检查并准备正式研发入口：

```text
personal-agent development status --json
personal-agent development ensure --json
```

若已知本机已有完整私有根仓库，优先执行 `personal-agent development ensure --checkout-source <绝对路径> --json` 校验并绑定，避免再次下载。只能使用返回的 `checkoutPath` 作为任务工作区；命令检查 GitHub 身份与写权限、根仓库来源、Cloud 与 Node 子模块边界和版本状态，不会覆盖另一入口或重置源目录。

失败时读取脱敏的 `error.diagnostic` 和 `nextActions`。CLI 已对网络与超时执行最多一次恢复重试；不要无变化反复执行。先用已授权的安全替代路径恢复，认证、来源、写权限、子模块边界不满足时保留成果并说明真实阻塞。不要读写内部数据库、输出原始 Git 错误或凭据，不关闭证书校验。

绝不编辑已安装的不可变 `core/current`。用户技能演进在用户工作区进行；产品源码修改进入注册研发仓库。

已认证用户发起的产品请求持续授权该事项内的分支、提交、推送、CI、Node 发布、Cloud 部署、本机升级和回滚；无需第二次本机确认。仍自动执行仓库边界、测试、扫描、精确版本、不可变制品、健康检查和失败回滚，不扩大为无关工作。

详见 [product-development.md](references/product-development.md)。
