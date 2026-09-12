import type { PageItem } from "./types";
import { PageThumbnail } from "./shared";

export function PagePreview({ page }: { page: PageItem }) {
  return <div className={`gallery-preview${page.poster ? " has-cove-poster" : ""}`}>
    {page.poster ? <img src={page.poster.imageUrl} alt={`${page.title} · Cove 海报`} style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : <PageThumbnail page={page} />}
  </div>;
}
