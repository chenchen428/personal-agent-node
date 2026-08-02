# 代理规则安全契约

## 规则来源优先级

按以下顺序选择规则：

1. 目标 Tab Group 当前已应用的完整规则；
2. 用户明确点名、且在 `proxy schemes` 中名称唯一匹配的已保存方案；
3. 当前项目内公开、受版本控制且与目标 host 明确匹配的规则；
4. 用户在本轮提供并确认作用域的规则。

技能不提供租户、公司内网或预发环境默认包。没有可靠来源时，列出方案名称、规则数和作用域，等待用户选择。

## 修改前

1. 执行 `chromepilot --tab-group <group-id> --json proxy list`。
2. 执行 `chromepilot --json proxy schemes`，但只在用户需要方案或当前规则来源不明时使用结果。
3. 记录当前规则总数、目标 host、动作类型和预期变化。
4. 对 Cookie、Authorization 或私有 header 值脱敏；不要把它们写入临时日志或提交。

## 合并规则

- 把现有规则数组当作基线，在内存或受管临时文件中生成完整的新数组。
- 更窄的 mock 或 redirect 放在更宽规则之前，但不要改变无关规则的相对顺序。
- 相同 action、pattern 和 payload 去重。同一 header 值覆盖多个 host 时优先使用一个边界清晰的正则规则，避免复制多条只差 host 的规则。
- `proxy start --rules-file` 与 `proxy update --rules-file` 按全量替换处理，除非当前 CLI 帮助明确承诺增量语义。
- 不把代理扩展到另一个 Tab Group、当前活动标签页或整个浏览器。

应用已保存方案时，先通过 `proxy schemes` 确认名称唯一，再对已选分组执行 `proxy scheme-apply --scheme-name <name> --tab-group <group-id>`。名称不唯一、方案为空或规则数异常时停止并说明。

## 外部写入边界

代理规则可能改变远端请求、提交内容或响应。若规则会触发真实写请求、改变账户状态或把本地内容发往远端，先展示目标 host、方法、数据类别和回滚方式，取得最终确认后再导航或提交。

## 验证

1. 应用后再次 `proxy list`，验证规则数和关键规则。
2. 导航或刷新目标后台标签页。
3. 执行 `proxy log`，按作用域检查命中、状态码和错误。
4. 对 mock 检查 OPTIONS/CORS；对 host/IP 映射检查 TLS/SNI；对 header 规则检查是否只命中预期 host。
5. 零命中、HTTP 失败、CORS 错误、证书错误或页面异常都视为未完成。停止、恢复已保存的基线规则，并报告可执行的下一步。
