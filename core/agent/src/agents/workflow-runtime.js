import path from "node:path";

import { createGeneratedPageThumbnails } from "../online-pages/generated-page-thumbnails.js";
import { buildManagedPageAccess } from "../server/managed-links.js";
import {
  createSpecialistWorkflowDraftState,
  specialistWorkflowPageFolder,
  syncSpecialistWorkflowProgress,
} from "./workflow.js";
import { renderSpecialistWorkflowPage } from "./workflow-page.js";

export async function initializeSpecialistWorkflowRuntime({
  definition,
  projectKey,
  displayName,
  privatePublications,
  managedFiles = null,
  externalAccess = null,
} = {}) {
  if (!privatePublications?.publish || !privatePublications?.rootDir) {
    throw workflowRuntimeError("WORKFLOW_PROGRESS_PAGE_UNAVAILABLE", "specialist workflow progress Page publisher is unavailable");
  }
  const folder = specialistWorkflowPageFolder(definition, projectKey);
  const title = `${displayName || definition.agentId} - 项目进度`;
  const draft = createSpecialistWorkflowDraftState(definition, { projectKey });
  const currentStage = definition.stages.find((stage) => stage.id === draft.stage);
  const summary = `当前阶段：${currentStage?.title || draft.stage}。所有强制确认完成后才会进入下一阶段。`;
  const thumbnails = await createGeneratedPageThumbnails({
    title,
    summary,
    sourceLabel: `${definition.agentId} workflow`,
  });
  const basePublication = {
    publicationId: folder,
    fileName: "index.html",
    encoding: "utf8",
    mimeType: "text/html; charset=utf-8",
    overwrite: true,
    title,
    summary,
    desktopThumbnail: thumbnailInput("desktop", thumbnails.desktop, `${title}桌面预览`),
    mobileThumbnail: thumbnailInput("mobile", thumbnails.mobile, `${title}移动端预览`),
  };

  const firstPublication = privatePublications.publish({
    ...basePublication,
    content: renderSpecialistWorkflowPage(definition, draft, { title }),
  });
  const access = buildManagedPageAccess(firstPublication.url, resolveExternalAccess(externalAccess));
  const state = syncSpecialistWorkflowProgress(definition, draft, {
    pageId: firstPublication.pageId,
    ...access,
  });
  const publication = privatePublications.publish({
    ...basePublication,
    content: renderSpecialistWorkflowPage(definition, state, { title }),
  });
  if (publication.pageId !== state.progressPage.pageId) {
    throw workflowRuntimeError("WORKFLOW_PROGRESS_PAGE_CHANGED", "specialist workflow progress Page identity changed during initialization");
  }

  if (managedFiles?.reconcileLocalTree) {
    await managedFiles.reconcileLocalTree({
      root: path.join(privatePublications.rootDir, publication.publicationId),
      visibility: "private",
      source: "specialist-workflow-progress",
      prefix: `publications/${publication.publicationId}`,
      execute: true,
    });
  }
  return { state, publication };
}

export function specialistWorkflowRuntimeGuide(state) {
  const progress = state?.progressPage;
  if (!progress?.pageId) return "";
  const access = progress.url || progress.internalUrl || progress.linkNotice;
  return [
    "运行时已在启动本任务前创建并发布唯一的私有进度 Page；不要另建第二个进度 Page。",
    `进度 Page：pageId=${progress.pageId}，revision=${state.revision}，地址=${access}`,
    `当前阶段：${state.stage}。后续每次状态变化都必须覆盖发布同一 pageId，并在进入下一阶段前同步到当前 revision。`,
  ].join("\n");
}

function thumbnailInput(variant, buffer, alt) {
  return {
    fileName: `page-thumbnail-${variant}.png`,
    content: buffer.toString("base64"),
    encoding: "base64",
    mimeType: "image/png",
    alt,
  };
}

function resolveExternalAccess(value) {
  try {
    return typeof value === "function" ? value() : value;
  } catch {
    return null;
  }
}

function workflowRuntimeError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 503 });
}
