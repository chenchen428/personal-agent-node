export { renderCalendarPosters, layoutCalendarPosters } from "./calendar.js";
export { renderPagePoster } from "./page.js";
export { pagePosterVersion } from "./version.js";
export { validatePosterTarget, createPosterQr } from "./qr.js";
export { POSTER_FONT_PATH } from "./text.js";

// The server writes image.buffer under the current Space's files/managed root,
// then registers the file through ManagedFileService. Never send a local path
// as a conversation attachment; only the main Agent selects the ready obj_ ID.
export function posterManagedMetadata(image) {
  return { originalName: image.fileName, contentType: image.mimeType, sizeBytes: image.sizeBytes, sha256: image.sha256,
    visibility: "private", source: "poster", metadata: { width: image.width, height: image.height, alt: image.alt,
      ...(image.pageId ? { pageId: image.pageId, pageVersion: image.pageVersion } : {}),
      ...(image.entryIds ? { entryIds: image.entryIds, pageNumber: image.pageNumber, pageCount: image.pageCount } : {}),
    } };
}
