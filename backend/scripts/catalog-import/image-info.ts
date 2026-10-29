/**
 * Image validation without an image library: the type comes from the file's magic bytes (never
 * from its extension or a server header) and the dimensions from its header. Anything that
 * cannot be identified is rejected rather than stored.
 */
export interface ImageInfo {
  readonly contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly widthPx: number;
  readonly heightPx: number;
  readonly byteSize: number;
}

export type ImageRejection =
  'unrecognised_format' | 'too_large' | 'too_small' | 'unreadable_dimensions';

export const IMAGE_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  minWidthPx: 300,
  minHeightPx: 300,
} as const;

function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) hold the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpSize(bytes: Buffer): { width: number; height: number } | null {
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && bytes.length >= 30) {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

export function inspectImage(
  bytes: Buffer,
): { ok: true; info: ImageInfo } | { ok: false; reason: ImageRejection } {
  if (bytes.length > IMAGE_LIMITS.maxBytes) return { ok: false, reason: 'too_large' };

  let contentType: ImageInfo['contentType'];
  let size: { width: number; height: number } | null;

  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    contentType = 'image/jpeg';
    size = jpegSize(bytes);
  } else if (bytes.length > 24 && bytes.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n') {
    contentType = 'image/png';
    size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (
    bytes.length > 16 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    contentType = 'image/webp';
    size = webpSize(bytes);
  } else {
    return { ok: false, reason: 'unrecognised_format' };
  }

  if (!size || size.width <= 0 || size.height <= 0)
    return { ok: false, reason: 'unreadable_dimensions' };
  if (size.width < IMAGE_LIMITS.minWidthPx || size.height < IMAGE_LIMITS.minHeightPx) {
    return { ok: false, reason: 'too_small' };
  }

  return {
    ok: true,
    info: { contentType, widthPx: size.width, heightPx: size.height, byteSize: bytes.length },
  };
}

export function extensionFor(contentType: ImageInfo['contentType']): string {
  return contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
}
