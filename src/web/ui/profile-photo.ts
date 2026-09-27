/**
 * Profile-photo preparation: turn ANY camera/gallery image into a small square JPEG.
 *
 * A profile photo is stored in the public profile record and downloaded by every peer that shows the
 * avatar, so it must be small — but that is our job, not the user's: phones routinely produce 8-15 MB
 * originals, and refusing them ("must be 2 MB or smaller") only sends people away. The original is
 * decoded, centre-cropped to a square, scaled down, and re-encoded, stepping quality (then size) down
 * until the result fits the byte budget.
 *
 * The geometry and the quality/size ladder are pure and injectable so they can be unit-tested without
 * a real canvas (jsdom has none); `shrinkProfilePhoto` wires them to the browser's canvas.
 */

/**
 * Edge length of the stored square photo. Avatars render at <= 160 CSS px (40 px in the roster), so 320
 * is sharp on 2x screens. The photo lives in the public Gun record `user-public-profile/<userId>`
 * (field `headshot`) that every peer downloads, so it is deliberately small — there is no separate
 * image store.
 */
export const PROFILE_PHOTO_EDGE_PX = 320;
/** Encoded-size budget for the stored data URL (bytes of the decoded image, not of the base64 text). */
export const PROFILE_PHOTO_MAX_BYTES = 48 * 1024;
/** Sanity ceiling on the ORIGINAL file so a pathological input can't exhaust memory while decoding. */
export const PROFILE_PHOTO_MAX_SOURCE_BYTES = 128 * 1024 * 1024;

const QUALITY_LADDER = [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4];
const EDGE_LADDER = [PROFILE_PHOTO_EDGE_PX, 256, 192, 128];

export class ProfilePhotoError extends Error {
  constructor(public readonly code: 'unreadable' | 'too-large-source') {
    super(code);
    this.name = 'ProfilePhotoError';
  }
}

/** Centre square crop of a w x h image: the largest square, offset so it is centred. */
export function coverCropRect(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.max(1, Math.min(width, height));
  return { sx: Math.max(0, Math.floor((width - size) / 2)), sy: Math.max(0, Math.floor((height - size) / 2)), size };
}

/** Byte length of the image inside a `data:<mime>;base64,<payload>` URL. */
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const payload = dataUrl.slice(comma + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export type PhotoEncoder = (edgePx: number, quality: number) => string;

/**
 * Walk the ladder from best quality at full size downwards and return the first encoding that fits
 * `maxBytes`. If even the smallest step is over budget the smallest is returned anyway — a slightly
 * heavy avatar is better than refusing the photo.
 */
export function encodeWithinBudget(
  encode: PhotoEncoder,
  maxBytes = PROFILE_PHOTO_MAX_BYTES,
  edges: readonly number[] = EDGE_LADDER,
  qualities: readonly number[] = QUALITY_LADDER,
): string {
  let last = '';
  for (const edge of edges) {
    for (const quality of qualities) {
      last = encode(edge, quality);
      if (dataUrlByteLength(last) <= maxBytes) return last;
    }
  }
  return last;
}

type Decoded = { width: number; height: number; draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number, edge: number) => void; close: () => void };

async function decodeImage(file: Blob): Promise<Decoded> {
  // Preferred: createImageBitmap honours EXIF orientation and decodes off the main thread.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, sx, sy, size, edge) => ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, edge, edge),
        close: () => bitmap.close?.(),
      };
    } catch {
      /* fall through to the <img> path (older WebViews, or a format createImageBitmap rejects) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ProfilePhotoError('unreadable'));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, sx, sy, size, edge) => ctx.drawImage(img, sx, sy, size, size, 0, 0, edge, edge),
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * Any image Blob/File -> `data:image/jpeg;base64,...`, square, <= PROFILE_PHOTO_MAX_BYTES (best effort).
 * Throws ProfilePhotoError('unreadable') when the bytes are not a decodable image (e.g. a PDF, or a
 * HEIC the WebView cannot decode) and ('too-large-source') only past the sanity ceiling.
 */
export async function shrinkProfilePhoto(file: Blob): Promise<string> {
  if (file.size > PROFILE_PHOTO_MAX_SOURCE_BYTES) throw new ProfilePhotoError('too-large-source');
  const decoded = await decodeImage(file);
  try {
    if (decoded.width < 1 || decoded.height < 1) throw new ProfilePhotoError('unreadable');
    const { sx, sy, size } = coverCropRect(decoded.width, decoded.height);
    const canvas = document.createElement('canvas');
    return encodeWithinBudget((edge, quality) => {
      canvas.width = edge;
      canvas.height = edge;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new ProfilePhotoError('unreadable');
      // JPEG has no alpha: paint white first so a transparent PNG/WebP doesn't turn black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, edge, edge);
      decoded.draw(ctx, sx, sy, size, edge);
      return canvas.toDataURL('image/jpeg', quality);
    });
  } finally {
    decoded.close();
  }
}
