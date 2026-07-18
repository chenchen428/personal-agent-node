export function buildActivityTargetPreview(target, pages = []) {
  if (!target || target.type !== "page" || !target.id) return null;
  const page = pages.find((item) => String(item?.id || "") === String(target.id));
  if (!page) return null;
  const url = String(page.mobileThumbnailUrl || page.thumbnailUrl || page.desktopThumbnailUrl || "").trim();
  if (!url) return null;
  return {
    kind: "image",
    url,
    alt: String(page.mobileThumbnailAlt || page.thumbnailAlt || page.desktopThumbnailAlt || page.title || "发布页预览").trim() || "发布页预览",
  };
}
