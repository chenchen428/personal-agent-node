# 小红书

先用 status 检查内置 OpenCLI、浏览器桥接和小红书只读 Provider，不检查账号登录状态，也不创建平台授权。OpenCLI 运行时随 Personal Agent 安装和升级，用户无需安装 CLI。需要用户处理页面时用 open 打开固定站点；只允许 search 和 read，不得调用任意 OpenCLI 命令、浏览器脚本或 Cookie 工具。遇到未登录、验证码、风控或限频时停止并请用户直接在浏览器处理。旧 channel 扫码接口仅为历史兼容，不属于本连接器。

## 能做什么

- 检测浏览器操作环境
- 检测小红书只读能力
- 在浏览器打开小红书
- 搜索笔记
- 读取笔记正文和互动数据

## CLI 交互

命令入口：`pa-cli connection xiaohongshu`

提供浏览器执行器 status、固定站点 open、search 和 read；不保存账号授权。

| 操作 | 风险 | 说明 |
| --- | --- | --- |
| `status` | R0 | 只检查内置 OpenCLI、浏览器桥接与小红书只读 Provider，不读取登录态。 |
| `open` | R1 | 在用户现有浏览器中打开固定小红书首页，不创建账号授权。 |
| `search` | R0 | 按关键词搜索笔记。 |
| `read` | R0 | 用搜索返回的签名 URL 或兼容 id/token 读取笔记。 |
