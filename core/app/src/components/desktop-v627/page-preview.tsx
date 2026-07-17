import type { PageItem } from "./types";

export function PagePreview({ page }: { page: PageItem }) {
  const previewUrl = page.url || page.shareUrl;

  return <div className="gallery-preview">
    {previewUrl ? <iframe
      className="page-preview-frame"
      src={page.url || page.shareUrl}
      title={`${page.title}预览`}
      loading="lazy"
      sandbox="allow-scripts"
      tabIndex={-1}
    /> : <div className="page-preview-unavailable" role="img" aria-label={`${page.title}暂时无法预览`}>
      <strong>暂时无法预览</strong>
      <span>页面没有可访问地址</span>
    </div>}
  </div>;
}
