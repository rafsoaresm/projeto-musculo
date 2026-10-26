/**
 * Postural photos (master document, section 8). They are images of a person's body, so the rules
 * are strict: JPEG only, no embedded metadata, a size cap, and never a public address.
 */
export const PHOTO_VIEWS = [
  { key: "ANTERIOR", label: "Anterior" },
  { key: "LATERAL_LEFT", label: "Lateral esquerda" },
  { key: "LATERAL_RIGHT", label: "Lateral direita" },
  { key: "POSTERIOR", label: "Posterior" },
] as const;
export type PhotoView = (typeof PHOTO_VIEWS)[number]["key"];
export const PHOTO_VIEW_KEYS = PHOTO_VIEWS.map((view) => view.key) as [PhotoView, ...PhotoView[]];
export const isPhotoView = (value: string): value is PhotoView =>
  (PHOTO_VIEW_KEYS as string[]).includes(value);
export const photoViewLabel = (view: PhotoView) =>
  PHOTO_VIEWS.find((item) => item.key === view)?.label ?? view;

/** What the browser sends after resizing; far below this in practice. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_SIDE = 8192;
/** The longest side the browser resizes to before uploading. */
export const UPLOAD_LONG_SIDE = 1600;

export type PhotoCheck =
  | { ok: true; bytes: Uint8Array; width: number; height: number }
  | { ok: false; reason: "NOT_JPEG" | "TOO_LARGE" | "BAD_DIMENSIONS" | "TRUNCATED" };

// APP markers worth keeping: JFIF (E0), the ICC colour profile (E2) and Adobe's colour flag (EE).
// Everything else that can carry text or positions is dropped: EXIF and XMP (E1), IPTC (ED),
// other APPn (including C2PA/JUMBF) and comments (FE).
const KEEP_APP = new Set([0xe0, 0xe2, 0xee]);

/**
 * Validates a JPEG by its structure and returns it without embedded metadata, so a phone's GPS
 * position, device and time never reach the storage. Only markers are read: the image is not
 * decoded. Anything that is not a JPEG with a frame header and a scan is refused.
 */
export function sanitizeJpeg(input: Uint8Array): PhotoCheck {
  if (input.length > MAX_PHOTO_BYTES) return { ok: false, reason: "TOO_LARGE" };
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return { ok: false, reason: "NOT_JPEG" };
  const kept: Array<[number, number]> = [[0, 2]];
  let width = 0;
  let height = 0;
  let frame = false;
  let scan = false;
  let offset = 2;
  while (offset < input.length) {
    if (input[offset] !== 0xff) return { ok: false, reason: "NOT_JPEG" };
    while (input[offset] === 0xff && offset + 1 < input.length) offset += 1; // fill bytes
    const marker = input[offset];
    const start = offset - 1;
    offset += 1;
    if (marker === 0xd9) return { ok: false, reason: "TRUNCATED" }; // end before any scan
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push([start, offset]);
      continue;
    }
    if (offset + 2 > input.length) return { ok: false, reason: "TRUNCATED" };
    const length = (input[offset] << 8) | input[offset + 1];
    if (length < 2 || offset + length > input.length) return { ok: false, reason: "TRUNCATED" };
    const end = offset + length;
    const isFrame = (marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (length < 8) return { ok: false, reason: "TRUNCATED" };
      height = (input[offset + 3] << 8) | input[offset + 4];
      width = (input[offset + 5] << 8) | input[offset + 6];
      frame = true;
    }
    if (marker === 0xda) {
      // The scan and everything after it (entropy-coded data and the end marker) stays as is.
      if (!frame) return { ok: false, reason: "NOT_JPEG" };
      kept.push([start, input.length]);
      scan = true;
      offset = input.length;
      break;
    }
    const droppable = (marker >= 0xe0 && marker <= 0xef && !KEEP_APP.has(marker)) || marker === 0xfe;
    if (!droppable) kept.push([start, end]);
    offset = end;
  }
  if (!frame || !scan)
    return { ok: false, reason: "TRUNCATED" };
  if (width < 1 || height < 1 || width > MAX_PHOTO_SIDE || height > MAX_PHOTO_SIDE)
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

/** The key of the object: unguessable, and under the organization so a bucket listing stays tidy. */
export const photoObjectKey = (organizationId: string, assessmentId: string) =>
  `assessments/${organizationId}/${assessmentId}/${crypto.randomUUID()}.jpg`;

/**
 * Photos are accepted, shown and served only when the bucket exists AND the environment opened them
 * on purpose with exactly "true". A bucket that is provisioned but not opened serves nothing.
 */
export const photosOpen = (env: { PHOTOS?: unknown; PHOTOS_ENABLED?: string }) =>
  Boolean(env.PHOTOS) && env.PHOTOS_ENABLED === "true";

/**
 * The environment's own switch. A variable declared on the Worker wins; a variable created in the
 * Webflow dashboard reaches `process.env` instead (the platform documents only the bindings of
 * `wrangler.json`, so the same variable can arrive by either road, as `DEMO_MODE` and `AUTH_ORIGIN` do).
 */
export const photosSwitch = (
  env: { PHOTOS_ENABLED?: string },
  processEnv: Record<string, string | undefined>,
) => env.PHOTOS_ENABLED || processEnv.PHOTOS_ENABLED;
