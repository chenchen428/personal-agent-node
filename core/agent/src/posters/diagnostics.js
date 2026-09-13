// Only these fixed messages may cross the poster boundary; never expose a
// filesystem error, private path, source bytes or exception stack to the Agent.
const diagnostics = {
  POSTER_PAGE_NOT_FOUND: [404, "当前空间没有该发布页", "核对本次 pages publish 成功返回的 pageId 或当前会话已验证的页面产物引用，再操作已确认的页面；没有可核对记录时报告缺口，不猜测 ID。"],
  POSTER_PAGE_ENTRY_MISSING: [409, "发布页入口记录缺失", "从原受管 HTML 和资源目录重新发布该页面，再使用返回的 pageId 生成海报；不要编辑发布清单或数据库。"],
  POSTER_PAGE_ENTRY_AMBIGUOUS: [409, "发布页入口记录不唯一", "核对原受管页面入口，用明确的 HTML 文件重新发布；不要猜测入口或修改发布清单。"],
  POSTER_PAGE_ASSET_MISSING: [409, "发布页引用的资源缺失", "从原页面资源目录补齐资源并重新发布完整页面，再生成海报。"],
  POSTER_PAGE_ASSET_INVALID: [409, "发布页资源引用或关联无效", "核对原受管资源及双端预览图后重新发布，不直接修改清单或替换内部文件。"],
  POSTER_PAGE_UNAVAILABLE: [409, "发布页当前无法完成完整性检查", "先核对本次 pages publish 返回的 pageId 或当前会话已验证的页面产物引用，再检查原受管发布目录；无法恢复时保留可用结果并报告此错误码。"],
  POSTER_PAGE_VERSION_CONFLICT: [409, "发布页内容在生成期间发生变化", "页面更新完成后重新生成一次海报；再次冲突时停止重复请求并报告。"],
  POSTER_SOURCE_REQUIRED: [400, "缺少有效的受管海报底图", "选择当前空间已登记的图片 obj_ ID，用 pa-cli file stat --id <obj_id> --json 核对后重试。"],
  POSTER_SOURCE_DENIED: [403, "底图不属于当前空间或不是可用图片", "通过 pa-cli file stat --id <obj_id> --json 核对，选择当前空间已就绪且不超过25MB的 PNG、JPEG 或 WebP。"],
  POSTER_SOURCE_NOT_READY: [409, "海报底图尚未就绪或无法读取", "通过 pa-cli file stat --id <obj_id> --json 核对状态，完成受管登记后再生成海报。"],
  POSTER_SOURCE_CHANGED: [409, "海报底图完整性检查失败或内容已变化", "重新登记原底图，核对新 obj_ ID 后重试，不绕过完整性检查。"],
  POSTER_LINK_UNAVAILABLE: [409, "当前没有可用的 HTTPS 手机访问地址", "检查 personal-agent status --json 和连接状态；先交付已核实的文字或普通受管图片，地址就绪后再生成二维码。"],
  POSTER_LINK_TOO_LONG: [400, "手机访问地址过长，无法生成二维码", "保留系统返回的可用页面链接；不要自造短链或外部二维码地址。"],
  POSTER_REGISTRATION_FAILED: [500, "海报受管文件登记失败", "核对文件服务状态后重试一次；未经登记的图片不能宣称已经交付。"],
  POSTER_RENDER_FAILED: [500, "海报图片生成失败", "核对底图格式和文件状态，先交付已核实的文字或可用结果；不要反复重发同一请求。"],
};

export function posterDiagnostic(code) {
  const entry = Object.hasOwn(diagnostics, code) ? diagnostics[code] : null;
  return entry ? { code, statusCode: entry[0], error: entry[1], recovery: entry[2] } : null;
}

export function posterFailure(error, fallback = "POSTER_PAGE_UNAVAILABLE") {
  const diagnostic = posterDiagnostic(error?.code) || posterDiagnostic(fallback);
  return Object.assign(new Error(`${diagnostic.error}。${diagnostic.recovery}`), {
    code: diagnostic.code, statusCode: diagnostic.statusCode,
  });
}
