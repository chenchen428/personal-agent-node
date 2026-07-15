import zlib from 'node:zlib';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

export function extractZipMember(archive, expectedMember) {
  if (!Buffer.isBuffer(archive)) throw new TypeError('ZIP archive must be a Buffer');
  if (typeof expectedMember !== 'string' || !expectedMember || expectedMember.includes('\\') || expectedMember.split('/').includes('..')) {
    throw new Error('ZIP member path is unsafe');
  }
  const eocd = findEndOfCentralDirectory(archive);
  const entries = readUInt16(archive, eocd + 10);
  const centralSize = readUInt32(archive, eocd + 12);
  let offset = readUInt32(archive, eocd + 16);
  if (entries === 0xffff || centralSize === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  const centralEnd = offset + centralSize;
  if (centralEnd > eocd || centralEnd > archive.length) throw new Error('ZIP central directory is invalid');

  for (let index = 0; index < entries; index += 1) {
    requireRange(archive, offset, 46);
    if (archive.readUInt32LE(offset) !== CENTRAL_HEADER) throw new Error('ZIP central directory entry is invalid');
    const flags = readUInt16(archive, offset + 8);
    const method = readUInt16(archive, offset + 10);
    const expectedCrc = readUInt32(archive, offset + 16);
    const compressedSize = readUInt32(archive, offset + 20);
    const uncompressedSize = readUInt32(archive, offset + 24);
    const nameLength = readUInt16(archive, offset + 28);
    const extraLength = readUInt16(archive, offset + 30);
    const commentLength = readUInt16(archive, offset + 32);
    const localOffset = readUInt32(archive, offset + 42);
    requireRange(archive, offset + 46, nameLength + extraLength + commentLength);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== expectedMember) continue;
    if ((flags & 0x1) !== 0) throw new Error('Encrypted ZIP members are not supported');
    requireRange(archive, localOffset, 30);
    if (archive.readUInt32LE(localOffset) !== LOCAL_HEADER) throw new Error('ZIP local member header is invalid');
    const localMethod = readUInt16(archive, localOffset + 8);
    const localNameLength = readUInt16(archive, localOffset + 26);
    const localExtraLength = readUInt16(archive, localOffset + 28);
    if (localMethod !== method) throw new Error('ZIP compression method is inconsistent');
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    requireRange(archive, dataOffset, compressedSize);
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const output = method === 0 ? Buffer.from(compressed) : method === 8 ? zlib.inflateRawSync(compressed) : null;
    if (!output) throw new Error(`Unsupported ZIP compression method: ${method}`);
    if (output.length !== uncompressedSize) throw new Error('ZIP member size mismatch');
    if (crc32(output) !== expectedCrc) throw new Error('ZIP member CRC mismatch');
    return output;
  }
  throw new Error(`ZIP member is missing: ${expectedMember}`);
}

function findEndOfCentralDirectory(archive) {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error('ZIP end-of-central-directory record is missing');
}

function requireRange(buffer, offset, size) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > buffer.length) {
    throw new Error('ZIP member exceeds archive bounds');
  }
}

function readUInt16(buffer, offset) {
  requireRange(buffer, offset, 2);
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  requireRange(buffer, offset, 4);
  return buffer.readUInt32LE(offset);
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}
