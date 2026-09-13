# Generic Page publishing

Page publishing is a runtime contract, not a discoverable Skill or a template product. Generate the governed HTML inside the current Space, then publish it without `--template`:

```bash
pa-cli pages publish \
  --file "<project>/derived/page/index.html" \
  --bundle "<project>/derived/page" \
  --folder "<page-folder>" \
  --title "<title>" \
  --summary "<summary>" \
  --json
```

## Mobile authoring contract

Treat mobile as a separate composition, not the desktop composition merely scaled to the viewport. Before publishing every Page:

- Include `width=device-width` viewport metadata and design the primary reading and interaction flow for 360-430 CSS px without page-wide horizontal overflow. Do not use `user-scalable=no` or a restrictive `maximum-scale` to hide layout defects. Keep ordinary reading text at least 16 CSS px, essential diagram or annotation labels at least 12 CSS px at the mobile composition, and interactive targets at least 44 CSS px.
- Reflow navigation, cards, tables, comparisons, controls, and multi-column content. Do not rely on hover, a fixed desktop width, or uniform `transform: scale(...)` / `width: 100%` shrinkage as the mobile implementation.
- Treat floor plans, annotated images, maps, timelines, canvases, and other information-dense diagrams specially. Never shrink a desktop coordinate system until its labels become unreadable. Provide a mobile-specific rearrangement, readable detail crops with an external legend, or a bounded pan/zoom or horizontal-scroll surface that preserves a readable working width. Constrain scrolling to the component and expose a visible cue or control.
- Size raster images for device density: intrinsic width must be at least twice the maximum rendered CSS width used on mobile; prefer three times for fine-line drawings or embedded text. Use SVG for line work where possible, but still calculate the effective CSS size of SVG labels after scaling; vector output does not make 4-5 CSS px text readable.
- Use responsive media (`max-width`, intrinsic dimensions, `srcset`/`sizes` when multiple resolutions exist) and prevent distortion, clipping, accidental text rasterization, and layout shifts. Keep essential explanations available as semantic HTML rather than only inside an image.
- Perform static source and semantic checks for both 360 and 430 CSS px compositions. If the user explicitly requests visual QA, separately review mobile and desktop behavior; otherwise report both as pending user acceptance. A generated mobile gallery preview is not visual or interaction acceptance.

Reject or revise a Page before publication when its only mobile behavior is compressing a desktop canvas, diagram, table, or annotation layer to phone width.

The command validates the governed directory, uploads every referenced asset through its own bounded file request, and only then publishes `index.html` with relative-path references. CSS, JavaScript, JSON, images, fonts, and other passive assets keep their same-origin paths; the final publish request never embeds their bytes. Omit `--bundle` only when the entry file's parent directory is already the complete bundle. The normal per-file upload limit applies to each asset, not to the sum of the directory, and HTML must not base64-inline large images merely to collapse the Page into one file. Use the returned `pageId`, complete managed HTTPS `url`, or explicit `linkNotice`; never construct a hostname or return a drive path, absolute filesystem path, `file://` URL, or loopback URL.

For gallery media, either provide both governed device previews or omit both. When omitted, the CLI generates distinct desktop and mobile previews without opening a browser. This deterministic preview generation is not visual acceptance. The user-facing result remains pending user acceptance.

Stored Page metadata exposes the two device records as `page.thumbnails.desktop` and `page.thumbnails.mobile`. Desktop clients use the desktop thumbnail and mobile clients use the mobile thumbnail.

Create Page Activity only after publication succeeds:

```bash
personal-agent activity upsert \
  --capability <ephemeral> \
  --type page \
  --title "<result title>" \
  --detail "<user-facing result>" \
  --target-type page \
  --target-id "<pageId returned by pa-cli pages publish>" \
  --idempotency-key "<stable retry key>" \
  --correlation-key "<stable story key>" \
  --json
```

Never use a URL, folder, local path, or guessed client route as the Activity target. Existing historical Page records may retain legacy metadata for read compatibility, but new publications do not write template provenance.

用户查看发布页时，优先通过 cove-files 的海报交付规范设计主视觉，再绑定系统验证的手机链接，以受管图片附件返回。页面自由设计，不恢复预设专业角色或强制阶段流程。

## 发布页与二维码失败后的处理

`pa-cli pages poster --id <pageId> --source-object <obj_id> --capability <ephemeral> --json` 在可诊断失败时返回 `ok:false`、安全 `code`、`error`、`recovery`，并非零退出。读取这些字段，不要把所有失败解释为“页面不存在”，也不要忽略失败反复重发同一张图片。

- `POSTER_PAGE_NOT_FOUND`：先核对本次 `pages publish` 成功返回的 pageId，或当前会话已验证的页面产物引用。没有可核对记录时报告缺口，不猜测 ID；不要调用未实现的页面列表命令。
- `POSTER_PAGE_ENTRY_MISSING`、`POSTER_PAGE_ENTRY_AMBIGUOUS`：核对原受管 HTML 及资源目录，用明确入口重新执行正式 `pages publish`；使用其返回的 pageId 继续。不能猜入口或编辑内部发布清单、数据库。
- `POSTER_PAGE_ASSET_MISSING`、`POSTER_PAGE_ASSET_INVALID`：从原作品目录补齐资源及双端预览图，重新发布完整目录。无法找到源资源就说明具体缺口，不宣称原结果已恢复。
- `POSTER_PAGE_VERSION_CONFLICT`：等本次页面更新完成后重生成一次；再次冲突就先查原因，不无限重试。
- `POSTER_SOURCE_NOT_READY`、`POSTER_SOURCE_CHANGED`、`POSTER_SOURCE_DENIED`：用 `pa-cli file stat --id <obj_id> --json` 核对当前空间底图，通过 cove-files 完成就绪或重新登记后再试，不能绕过完整性校验。
- `POSTER_LINK_UNAVAILABLE`：先 `personal-agent status --json` 检查可用访问方式，按 cove-connectivity 定位连接问题。保留已核实的文字、普通受管图片或服务返回的可用结果；明确尚未附上可扫码二维码，不自行拼域名或外部短链。
- 其他失败按 `recovery` 做最小检查。只有依赖已修复才重试；重试仍失败时交付当前可用结果和具体阻塞原因，不让用户重复催促才能获知状态。

用户已授权修复或完成当前作品时，原授权覆盖范围内的本机修复、重新发布和核对，不需要重复询问。改变公开范围、删除不可恢复内容或联系他人仍须相应明确授权。既有产品缺陷应遵循 cove-product-development 的开发与验证路径，不能直接修改运行数据库或伪造发布成功。
