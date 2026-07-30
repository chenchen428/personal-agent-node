import fs from 'node:fs';
import path from 'node:path';
import { loadPlanImageAsset } from './page-assets.mjs';
import { canonicalJson, projectError, readProject, sha256 } from './project-v2.mjs';

const RENDER_METADATA = 'su-design-render.json';
const RENDER_BASENAME = 'su-design-render';
const RENDER_GENERATORS = new Set(['imagegen', 'other-authorized-image-generator']);
const RASTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

export function registerDesignRender({
  projectDir: projectDirInput,
  context,
  input,
  reference,
  promptFile,
  generator,
  baseRevision,
  now = () => new Date().toISOString(),
}) {
  const { projectDir, project } = readProject(projectDirInput, context);
  if (project.revision !== baseRevision) {
    throw projectError('REVISION_CONFLICT', `render base revision ${baseRevision} does not match current revision ${project.revision}`, 4);
  }
  const scene = readJson(path.join(projectDir, 'scene.json'));
  if (scene.projectId !== project.projectId
    || scene.revision !== project.revision
    || scene.sceneHash !== project.scene.sha256) {
    throw projectError('SCENE_REQUIRED', 'compile the current Pascal scene before registering its render', 3);
  }
  const normalizedGenerator = String(generator || '').trim();
  if (!RENDER_GENERATORS.has(normalizedGenerator)) {
    throw projectError('INVALID_RENDER_GENERATOR', `--generator must be one of ${[...RENDER_GENERATORS].join(', ')}`, 2);
  }
  const inputPath = path.resolve(String(input || ''));
  const referencePath = path.resolve(String(reference || ''));
  const promptPath = path.resolve(String(promptFile || ''));
  const extension = normalizedRasterExtension(inputPath);
  normalizedRasterExtension(referencePath);
  const image = loadPlanImageAsset(inputPath, { alt: '基于当前 SU 设计稿生成的概念渲染稿' });
  const referenceImage = loadPlanImageAsset(referencePath, { alt: '用于生成渲染稿的 SU 设计参考图' });
  const prompt = fs.readFileSync(promptPath);
  if (!prompt.length || prompt.length > 256 * 1024) {
    throw projectError('INVALID_RENDER_PROMPT', 'render prompt must be between 1 byte and 256 KiB', 2);
  }
  const derivedRoot = path.join(projectDir, 'derived');
  const renderFile = `${RENDER_BASENAME}${extension}`;
  const renderPath = path.join(derivedRoot, renderFile);
  fs.mkdirSync(derivedRoot, { recursive: true, mode: 0o700 });
  atomicWrite(renderPath, fs.readFileSync(inputPath));
  for (const staleExtension of RASTER_EXTENSIONS) {
    const stalePath = path.join(derivedRoot, `${RENDER_BASENAME}${staleExtension}`);
    if (stalePath !== renderPath && fs.existsSync(stalePath)) fs.rmSync(stalePath);
  }
  const metadata = {
    schemaVersion: 1,
    kind: 'su-design-render',
    projectId: project.projectId,
    revision: project.revision,
    sceneSha256: scene.sceneHash,
    modelBasisSha256: scene.modelBasis?.sha256 || project.provenance.sourcePlanSha256,
    imageRelativePath: `derived/${renderFile}`,
    imageSha256: image.sha256,
    referenceImageSha256: referenceImage.sha256,
    promptSha256: sha256(prompt),
    generator: normalizedGenerator,
    createdAt: now(),
  };
  atomicWrite(path.join(derivedRoot, RENDER_METADATA), Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`));
  return { projectDir, project, metadata };
}

export function loadProjectDesignRender(projectDir, project, scene) {
  const metadataPath = path.join(projectDir, 'derived', RENDER_METADATA);
  if (!fs.existsSync(metadataPath)) return null;
  const metadata = readJson(metadataPath);
  if (metadata.schemaVersion !== 1
    || metadata.kind !== 'su-design-render'
    || metadata.projectId !== project.projectId
    || metadata.revision !== project.revision
    || metadata.sceneSha256 !== scene.sceneHash
    || metadata.modelBasisSha256 !== scene.modelBasis?.sha256
    || !RENDER_GENERATORS.has(metadata.generator)
    || !/^[a-f0-9]{64}$/.test(String(metadata.promptSha256 || ''))
    || !/^[a-f0-9]{64}$/.test(String(metadata.referenceImageSha256 || ''))) {
    throw projectError('STALE_DESIGN_RENDER', 'registered design render does not match the current governed scene', 4);
  }
  const imagePath = resolveRenderImagePath(projectDir, metadata.imageRelativePath);
  const image = loadPlanImageAsset(imagePath, { alt: '基于当前 SU 设计稿生成的概念渲染稿' });
  if (image.sha256 !== metadata.imageSha256) {
    throw projectError('DESIGN_RENDER_HASH_MISMATCH', 'registered design render image hash does not match its metadata', 4);
  }
  return { ...image, metadata: structuredClone(metadata) };
}

function resolveRenderImagePath(projectDir, relativePath) {
  if (!/^derived\/su-design-render\.(?:jpe?g|png|webp)$/i.test(String(relativePath || ''))) {
    throw projectError('INVALID_DESIGN_RENDER_PATH', 'registered design render path is invalid', 4);
  }
  const target = path.resolve(projectDir, relativePath);
  const derivedRoot = path.resolve(projectDir, 'derived');
  if (!target.startsWith(`${derivedRoot}${path.sep}`)) {
    throw projectError('INVALID_DESIGN_RENDER_PATH', 'registered design render escapes the project derived directory', 4);
  }
  return target;
}

function normalizedRasterExtension(file) {
  const extension = path.extname(file).toLowerCase();
  if (!RASTER_EXTENSIONS.has(extension)) {
    throw projectError('INVALID_RENDER_IMAGE', 'render and SU reference must be JPG, PNG, or WebP images', 2);
  }
  return extension === '.jpeg' ? '.jpg' : extension;
}

function readJson(file) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size > 10 * 1024 * 1024) {
    throw projectError('INVALID_RENDER_METADATA', `missing or oversized render dependency: ${path.basename(file)}`, 4);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function atomicWrite(file, buffer) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, buffer, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function designRenderMetadataSha256(metadata) {
  return sha256(canonicalJson(metadata));
}
