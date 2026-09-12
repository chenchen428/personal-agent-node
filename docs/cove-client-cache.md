# Cove 客户端菜单与数据缓存

目标是让返回常用菜单时立即看到原来的筛选、选中项和滚动位置，同时在后台读取最新数据；网络不通时继续展示上次成功结果，明确提示更新失败。顶栏的刷新按钮重新请求当前可见页面的数据。

## 实现范围

- 桌面客户端明确注册的菜单页面使用 React 19.2 公开 `Activity` API。按最近访问顺序保留最多8个页面实例；超出上限的最旧实例卸载。被淘汰的页面下次重新初始化，尚在缓存中的页面保留本地状态。
- 页面仍使用原来的独立页面组件。侧栏通过 Next 支持的原生 History API 更新地址；服务端详情、兼容路由和手机页面继续交给 Next。没有保存或冻结 Next 的路由 children，也没有依赖内部 Context。
- `Activity` 隐藏时会清理 effects，重新显示时重新订阅和获取数据。邮件、数据、任务、Token和运行设置因此需要保留已有选择与未保存草稿，而不能在每次 effect 启动时重置。
- 数据缓存仅存在当前浏览器文档内，最多64项、约8 MiB，不写 localStorage、sessionStorage、IndexedDB 或服务端共享缓存。通过独立 Control 服务的 `/api/system/client-scope` 返回的 installationId、spaceId 与当前 origin 绑定身份；该接口不读取Agent、不列出其他空间、不接受客户端选择Space。切换完整文档、退出、认证失效时清除缓存；bfcache 恢复时重新校验空间身份。
- 身份尚未绑定时SSR仍输出不含私有数据的初始化/运行设置启动壳和真实恢复入口，不渲染旧空间的缓存页面。Control可用但Agent故障时仍可完成身份绑定，进入完整客户端与初始化、设置界面；具体Agent功能独立显示自己的错误状态，不阻塞整个客户端。
- 请求使用 AbortController 与版本编号。取消、切换Space后的迟到结果不得写回缓存；同一资源较旧的并发响应也不能覆盖较新的成功结果。HTTP 401/403 清除全部私有快照，不以旧数据代替访问授权。
- 每个缓存页面单独捕获渲染错误。“重新加载此页面”仅重建该实例并移除它读取的缓存，不重置其他菜单。Next 页面和全局错误也使用统一恢复面板。

## 新页面接入

普通JSON读取使用 `@/lib/use-client-resource` 的 `useClientResource<T>(url)`：

- `value`：最后成功结果；首次还未得到结果时为null。
- `loading`：仅无可用结果时的首次加载。
- `refreshing`：后台请求正在执行。
- `error`：首次读取失败；已有结果时不会清空页面。
- `staleError`：已有结果但最新请求失败；顶栏同时展示更新提示。
- `refresh()`：强制新请求，取消先前同hook请求。

hook在可见期间订阅手动刷新、重新联网、窗口聚焦与恢复可见事件；持续停留时每60秒轻量刷新一次，浏览器文档隐藏时跳过。菜单的Activity隐藏后清理定时器和订阅；这是周期更新，不是实时同步。自有数据控制器通过 `usePageRefresh(callback)` 接入相同入口。详情切换仍由具体页面负责，不允许迟到响应覆盖新选择。

## 方案依据与验证

当前依赖版本为 Next 16.2.12、React 19.2.7。Next官方的 [`cacheComponents`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents) 同时改变预渲染和动态数据规则，现有项目包含 `headers()` 与 `force-dynamic`，本轮没有全局启用它。

React [`Activity`](https://react.dev/reference/react/Activity) 提供隐藏页面时保留状态、清理effects的公开机制。Next明确支持原生 [`pushState`/`replaceState`](https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api) 与 `usePathname`、`useSearchParams` 同步；侧栏仅对已注册的客户端菜单使用此机制。

状态与语义测试覆盖LRU、容量上限、Space隔离、认证失效、请求取消、迟到结果、后台失败保留内容与页面独立恢复。类型与组件边界检查通过；视觉、滚动体验及交互最终由用户验收。
