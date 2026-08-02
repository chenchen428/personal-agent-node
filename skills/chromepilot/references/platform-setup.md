# 平台安装与诊断

## 依赖边界

ChromePilot CLI、bridge 和 Chrome 扩展由其授权发行渠道提供，不属于 Personal Agent 发布物。技能不得执行全局包安装、修改 shell 配置、创建逃逸工作区的软链，或迁移未知的旧版浏览器数据。

先运行：

```text
node <skill-dir>/scripts/doctor.mjs --json
```

诊断脚本只做读取检查：

- 支持 macOS、Linux 和 Windows；
- 从 `PATH` 或绝对的 `CHROMEPILOT_BIN` 查找 CLI；
- Windows 同时识别 `.exe`、`.cmd`、`.bat` 和 `PATHEXT` 中的可执行后缀；
- 找到 CLI 后执行固定的 `help` 与 `doctor` 探测；
- 不输出 ChromePilot 的原始 stdout、Cookie、Token 或页面数据；
- 不自动安装、启动、重载或修改浏览器。

## CLI 缺失

从用户有权使用的 ChromePilot 发行渠道安装 CLI，并将 `chromepilot` 命令加入 `PATH`。不要假设它存在于公共 npm，也不要回退到公司内网包管理器或本机旧 Harness 路径。

若必须使用非标准位置，设置绝对的 `CHROMEPILOT_BIN`：

- Windows PowerShell：`$env:CHROMEPILOT_BIN = 'C:\\Tools\\ChromePilot\\chromepilot.cmd'`
- macOS/Linux：在当前进程环境中把它设为 CLI 的绝对路径。

Agent 日常命令仍应直接使用 `chromepilot` 并逐条传作用域；不要使用 `cp`、交互式 alias 或只在某一种 shell 中生效的函数。

## 扩展或 bridge 未连接

1. 执行 `chromepilot extension path`，确认授权发行物能给出扩展目录。
2. 让用户在可见的 `chrome://extensions/` 中开启开发者模式并加载或重载该目录。Agent 不自动拖放扩展，也不接管浏览器焦点。
3. 按当前 CLI 的帮助运行 bridge 启动命令，例如先检查 `chromepilot server --help`，再使用其中登记的 `start` 动作。
4. 再次执行 `chromepilot doctor`，确认 CLI、bridge 和扩展都通过后才继续标签页操作。

## Windows 注意事项

- 使用 `chromepilot` 命令名，不依赖 Bash、Zsh、`which`、`export`、POSIX 软链或平台专用文件管理器。
- 路径必须加引号，输出路径使用 Windows 绝对路径。
- npm 风格的 `.cmd` shim 由调用它的 PowerShell 或 Command Prompt 解析；诊断脚本只对固定参数使用兼容调用，不把用户输入拼接进 shell 命令。
- Chrome 扩展安装仍是用户可见的人工步骤；不要把“找到 CLI”误报为“扩展已连接”。

## 失败报告

报告平台、检查阶段和退出码即可。不要粘贴可能包含本机路径、会话信息或浏览器数据的完整 stderr。CLI 版本不兼容时，引用具体缺失的子命令并停止，不要切换到未登记的浏览器工具来伪造完成。
