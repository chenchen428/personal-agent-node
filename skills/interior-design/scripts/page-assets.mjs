import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DELIVERY_ID = 'interior-c-layout-delivery';
const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_IMAGE_DIMENSION = 20_000;
const MAX_SVG_ELEMENTS = 20_000;

export function loadInteriorDeliveryContract(skillRoot) {
  const contractPath = path.resolve(
    skillRoot,
    '..',
    '..',
    'agents',
    'interior-designer',
    'examples',
    'featured-delivery.json',
  );
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  if (contract.id !== DELIVERY_ID) throw new Error(`representative Agent delivery is missing: ${DELIVERY_ID}`);
  if (contract.agent?.id !== 'interior-designer' || Number(contract.agent?.version) !== 1) {
    throw new Error(`${DELIVERY_ID} must belong to interior-designer version 1`);
  }
  if (Number(contract.delivery?.version) !== 3 || contract.delivery?.engine !== 'pascal-v2') {
    throw new Error(`${DELIVERY_ID} must use Pascal delivery version 3`);
  }
  if (contract.delivery?.layoutProfile !== 'renovation-booklet'
    || contract.delivery?.specialistPages?.threeD?.path !== '3d/index.html'
    || contract.delivery?.specialistPages?.threeD?.layoutProfile !== 'su-design-classic'
    || contract.delivery?.renderProfile !== 'professional-mesh-ink') {
    throw new Error(`${DELIVERY_ID} is missing its approved booklet or specialist Page profiles`);
  }
  return contract;
}

export function loadPlanImageAsset(filePath, { alt = '装修设计图纸' } = {}) {
  const resolved = path.resolve(filePath);
  const extension = path.extname(resolved).toLowerCase();
  const mimeType = ({
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  })[extension];
  if (!mimeType) throw new Error('source plan must be a redacted JPG, PNG, SVG, or WebP image');
  const buffer = fs.readFileSync(resolved);
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) throw new Error('source plan must be between 1 byte and 12 MB');
  if (mimeType === 'image/svg+xml') {
    const source = buffer.toString('utf8');
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(source)) throw new Error('plan image extension does not match SVG content');
    if (/<!DOCTYPE|<!ENTITY|<(?:script|foreignObject|iframe|image|use|link|style)\b|(?:href|src|on[a-z]+)\s*=|url\s*\(/i.test(source)) {
      throw new Error('plan image SVG must not contain executable or remote-reference markup');
    }
    const elementCount = source.match(/<[a-z][^>]*>/gi)?.length || 0;
    if (elementCount > MAX_SVG_ELEMENTS) throw new Error(`source plan SVG exceeds ${MAX_SVG_ELEMENTS} elements`);
  } else if (!matchesRasterSignature(buffer, extension)) {
    throw new Error('source plan extension does not match the image content');
  } else {
    validateRasterDimensions(buffer, extension);
  }
  return {
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    alt,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

export function loadSourcePlanAsset(filePath) {
  return loadPlanImageAsset(filePath, { alt: '用户上传并脱敏的原始户型图' });
}

function validateRasterDimensions(buffer, extension) {
  const dimensions = extension === '.png'
    ? pngDimensions(buffer)
    : extension === '.webp'
      ? webpDimensions(buffer)
      : jpegDimensions(buffer);
  if (!dimensions) throw new Error('source plan image dimensions could not be validated');
  const { width, height } = dimensions;
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new Error(`source plan image dimensions exceed ${MAX_IMAGE_DIMENSION}px or ${MAX_IMAGE_PIXELS} pixels`);
  }
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) return null;
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(buffer) {
  if (buffer.length < 30) return null;
  const chunk = buffer.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function matchesRasterSignature(buffer, extension) {
  if (extension === '.png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === '.jpg' || extension === '.jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === '.webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}
