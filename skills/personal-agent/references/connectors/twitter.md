# Twitter / X

先用 status 检查内置 OpenCLI、浏览器桥接和 Twitter / X 只读 Provider，不检查账号登录状态，也不创建平台账号授权。OpenCLI 运行时随 Personal Agent 安装和升级，用户无需安装 CLI。需要用户处理页面时用 open 打开固定 X 首页；只允许 search 和 read，不得调用 OpenCLI 的写命令、任意浏览器脚本或 Cookie 工具。遇到未登录、2FA、风控或限频时停止并请用户直接在浏览器处理。

## 能做什么

- 检查浏览器执行器可用性
- 在浏览器打开 Twitter / X
- 搜索可见推文
- 读取推文线程和回复
- 返回结构化互动与媒体链接

## CLI 交互

命令入口：`pa-cli connection twitter`

提供浏览器执行器 status、固定站点 open、search 和 read；不保存账号授权。

| 操作 | 风险 | 说明 |
| --- | --- | --- |
| `status` | R0 | 只检查内置 OpenCLI、浏览器桥接与 Twitter / X 只读 Provider，不读取登录态。 |
| `open` | R1 | 在用户现有浏览器中打开固定 X 首页，不创建账号授权。 |
| `search` | R0 | 按查询词搜索推文并返回结构化结果。 |
| `read` | R0 | 按 tweet ID 或状态 URL 读取线程与回复。 |

连接采用“检测内置 OpenCLI / 检测浏览器桥接 / 校验 Twitter / X Provider / 只读能力就绪”横向 SOP。整个正常链路由 status 自动检测，不包含平台授权；只有真实检测结果可用后才开放 `open`、`search` 和 `read`。浏览器桥接异常时可以提供环境修复入口，但必须明确这不是 Twitter / X 账号授权。
