import type { PageItem } from "./types";
import { PageThumbnail } from "./shared";

export function PagePreview({ page }: { page: PageItem }) {
  return <div className="gallery-preview">
    <PageThumbnail page={page} />
  </div>;
}
