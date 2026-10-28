import { MAX_PHOTO_BYTES, MAX_PHOTO_SIDE, sanitizeJpeg } from "@/modules/avaliacoes/photos";

/**
 * The images of the public page. What a person sends is never trusted: the browser re-draws the picture
 * (right way up, at most 2000 px, as JPEG or PNG, no metadata) and the server checks the structure again and
 * writes it back without the chunks and segments that can carry text, a position or a device. Only JPEG and
 * PNG: no SVG (it can hold script), no GIF or WebP (animations and a larger surface to check), nothing the
 * browser would have to guess the type of. The image is never decoded here: only its markers are read.
 */
export const MAX_IMAGE_BYTES = MAX_PHOTO_BYTES;
export const MAX_IMAGE_SIDE = MAX_PHOTO_SIDE;
/** Width times height. A flat PNG of 8192 x 8192 is small in bytes and huge in memory when the browser draws it. */
export const MAX_IMAGE_PIXELS = 16_000_000;
/** The longest side the browser re-draws to before sending. */
export const UPLOAD_LONG_SIDE = 2000;
export const MAX_ASSETS_PER_SITE = 60;
export const ALT_MAX = 200;
export const CAPTION_MAX = 200;

export const IMAGE_TYPES = ["image/jpeg", "image/png"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const IMAGE_EXTENSION: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png" };

export type ImageCheck =
  | { ok: true; type: ImageType; bytes: Uint8Array; width: number; height: number }
  | { ok: false; reason: "UNSUPPORTED" | "TOO_LARGE" | "BAD_DIMENSIONS" | "TRUNCATED" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Chunks that draw the picture, and the two that say how its colors are meant to look. Everything else that is
// optional (text, EXIF, time, physical size, an embedded profile, animation) is dropped; an unknown chunk that the
// image needs to be drawn (an uppercase first letter) makes it a file this page does not take.
const KEEP_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sRGB", "gAMA", "cHRM"]);

const u32 = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));

type PngCheck = { ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; reason: "UNSUPPORTED" | "TRUNCATED" | "BAD_DIMENSIONS" };

function sanitizePng(input: Uint8Array): PngCheck {
  const kept: Array<[number, number]> = [[0, 8]];
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette = false;
  let data = false;
  let end = false;
  let first = true;
  while (offset + 12 <= input.length) {
    const length = u32(input, offset);
    const type = ascii(input, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type) || length > input.length - offset - 12) return { ok: false, reason: "TRUNCATED" };
    const next = offset + 12 + length;
    if (first) {
      if (type !== "IHDR" || length !== 13) return { ok: false, reason: "UNSUPPORTED" };
      width = u32(input, offset + 8);
      height = u32(input, offset + 12);
      colorType = input[offset + 17];
      const compression = input[offset + 18];
      const filter = input[offset + 19];
      const interlace = input[offset + 20];
      if (compression !== 0 || filter !== 0 || interlace > 1) return { ok: false, reason: "UNSUPPORTED" };
      first = false;
    }
    if (KEEP_CHUNKS.has(type)) {
      kept.push([offset, next]);
      if (type === "PLTE") palette = true;
      if (type === "IDAT") data = true;
    } else if (type[0] >= "A" && type[0] <= "Z") {
      return { ok: false, reason: "UNSUPPORTED" };
    }
    offset = next;
    if (type === "IEND") {
      end = true;
      break;
    }
  }
  if (first) return { ok: false, reason: "UNSUPPORTED" };
  if (!end || !data) return { ok: false, reason: "TRUNCATED" };
  if (colorType === 3 && !palette) return { ok: false, reason: "TRUNCATED" };
  if (width < 1 || height < 1 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS)
    return { ok: false, reason: "BAD_DIMENSIONS" };
  const size = kept.reduce((total, [from, to]) => total + (to - from), 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const [from, to] of kept) {
    out.set(input.subarray(from, to), at);
    at += to - from;
  }
  return { ok: true, bytes: out, width, height };
}

/** The image as it may be stored: a JPEG or a PNG, validated by structure and cleaned of everything optional. */
export function sanitizeImage(input: Uint8Array): ImageCheck {
  if (input.length > MAX_IMAGE_BYTES) return { ok: false, reason: "TOO_LARGE" };
  if (input.length >= 8 && PNG_SIGNATURE.every((byte, index) => input[index] === byte)) {
    const png = sanitizePng(input);
    return png.ok ? { ok: true, type: "image/png", bytes: png.bytes, width: png.width, height: png.height } : png;
  }
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8) {
    const jpeg = sanitizeJpeg(input);
    if (!jpeg.ok) return { ok: false, reason: jpeg.reason === "NOT_JPEG" ? "UNSUPPORTED" : jpeg.reason === "TOO_LARGE" ? "TOO_LARGE" : jpeg.reason };
    if (jpeg.width * jpeg.height > MAX_IMAGE_PIXELS) return { ok: false, reason: "BAD_DIMENSIONS" };
    return { ok: true, type: "image/jpeg", bytes: jpeg.bytes, width: jpeg.width, height: jpeg.height };
  }
  return { ok: false, reason: "UNSUPPORTED" };
}

/** The key of the object: unguessable, under the organization and the site so a bucket listing stays tidy. */
export const imageObjectKey = (organizationId: string, siteId: string, type: ImageType) =>
  `sites/${organizationId}/${siteId}/${crypto.randomUUID()}.${IMAGE_EXTENSION[type]}`;

export const IMAGE_REFUSAL_MESSAGE: Record<Extract<ImageCheck, { ok: false }>["reason"], string> = {
  UNSUPPORTED: "A imagem precisa ser JPEG ou PNG.",
  TOO_LARGE: "A imagem é grande demais (até 5 MB).",
  BAD_DIMENSIONS: "A imagem tem dimensões fora do limite (até 8192 pixels de lado e 16 milhões de pixels).",
  TRUNCATED: "A imagem está incompleta ou corrompida.",
};
