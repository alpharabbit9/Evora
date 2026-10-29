import { inflateRawSync } from 'node:zlib';

/**
 * Kaggle serves some single files (`styles.csv`, images over ~900 KB) wrapped in a ZIP archive.
 * This reads one named entry — stored or deflated — through the central directory, which is
 * where the authoritative sizes live when the local header defers them to a data descriptor.
 *
 * ZIP64 per-entry fields are supported because Kaggle uses them even for small files: the
 * central record says 0xFFFFFFFF and the real size sits in the ZIP64 extra field (id 0x0001),
 * observed on `styles.csv` 2026-10-27. Archives that need the ZIP64 end-of-central-directory
 * record (over 65,535 entries or a 4 GB directory offset) are refused, not misread.
 */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_ID = 0x0001;
const MARKER_32 = 0xffffffff;

export function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === LOCAL_SIGNATURE;
}

function readUInt64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP entry too large');
  return Number(value);
}

/**
 * Applies the ZIP64 extra field. Its values appear in a fixed order — uncompressed size,
 * compressed size, local header offset — but only for the fields whose 32-bit slot is the marker.
 */
function resolveZip64(
  extra: Buffer,
  fields: { uncompressed: number; compressed: number; offset: number },
): { compressed: number; offset: number } {
  let { uncompressed, compressed, offset } = fields;
  let cursor = 0;

  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor);
    const size = extra.readUInt16LE(cursor + 2);
    const body = extra.subarray(cursor + 4, cursor + 4 + size);
    cursor += 4 + size;
    if (id !== ZIP64_EXTRA_ID) continue;

    let position = 0;
    const next = () => {
      if (position + 8 > body.length) throw new Error('Corrupt ZIP archive: short ZIP64 field');
      const value = readUInt64(body, position);
      position += 8;
      return value;
    };
    if (uncompressed === MARKER_32) uncompressed = next();
    if (compressed === MARKER_32) compressed = next();
    if (offset === MARKER_32) offset = next();
  }

  if (compressed === MARKER_32 || offset === MARKER_32) {
    throw new Error('Corrupt ZIP archive: ZIP64 marker without a ZIP64 extra field');
  }
  return { compressed, offset };
}

export function readZipEntry(archive: Buffer, wanted: (name: string) => boolean): Buffer {
  // The end-of-central-directory record is in the last 22 + 65535 (max comment) bytes.
  const searchFrom = Math.max(0, archive.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = archive.length - 22; offset >= searchFrom; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive: end of central directory not found');

  const entries = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cursor === MARKER_32) {
    throw new Error('ZIP64 end-of-central-directory archives are not supported');
  }

  for (let entry = 0; entry < entries; entry += 1) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('Corrupt ZIP archive: bad central directory entry');
    }
    const method = archive.readUInt16LE(cursor + 10);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    const name = archive.toString('utf8', nameStart, nameStart + nameLength);
    const extra = archive.subarray(nameStart + nameLength, nameStart + nameLength + extraLength);
    const { compressed, offset } = resolveZip64(extra, {
      uncompressed: archive.readUInt32LE(cursor + 24),
      compressed: archive.readUInt32LE(cursor + 20),
      offset: archive.readUInt32LE(cursor + 42),
    });
    cursor = nameStart + nameLength + extraLength + commentLength;

    if (!wanted(name)) continue;

    if (archive.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
      throw new Error('Corrupt ZIP archive: bad local header');
    }
    const localName = archive.readUInt16LE(offset + 26);
    const localExtra = archive.readUInt16LE(offset + 28);
    const start = offset + 30 + localName + localExtra;
    const data = archive.subarray(start, start + compressed);

    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    throw new Error(`Unsupported ZIP compression method ${method}`);
  }

  throw new Error('ZIP archive does not contain the requested entry');
}
