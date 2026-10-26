import { describe, expect, it } from "vitest";
import { isPhotoView, MAX_PHOTO_BYTES, photoObjectKey, photosOpen, photosSwitch, sanitizeJpeg } from "@/modules/avaliacoes/photos";

const bytes = (...parts: Array<number[] | Uint8Array>) => Uint8Array.from(parts.flatMap((part) => [...part]));
const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const text = (value: string) => [...new TextEncoder().encode(value)];
/** A structurally valid JPEG (markers only; it does not need to decode). */
const jpeg = (extra: number[][] = [], size = { width: 640, height: 480 }) =>
  bytes(
    [0xff, 0xd8],
    segment(0xe0, [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...extra,
    segment(0xdb, [0, ...new Array(64).fill(8)]),
    segment(0xc0, [8, size.height >> 8, size.height & 0xff, size.width >> 8, size.width & 0xff, 1, 1, 0x11, 0]),
    segment(0xc4, [0, ...new Array(16).fill(0), 0]),
    segment(0xda, [1, 1, 0, 0, 63, 0]),
    [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9],
  );
const contains = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle));

describe("postural photos", () => {
  it("keeps the image and drops what a phone writes into it: EXIF, GPS, XMP, comments and other markers", () => {
    const dirty = jpeg([
      segment(0xe1, [...text("Exif\0\0"), ...text("GPSLatitude -23.55 GPSLongitude -46.63 iPhone 15 2026:10:24")]),
      segment(0xe1, [...text("http://ns.adobe.com/xap/1.0/\0"), ...text("<x:xmpmeta>studio location</x:xmpmeta>")]),
      segment(0xed, text("Photoshop 3.0 IPTC city")),
      segment(0xeb, text("jumb c2pa claim")),
      segment(0xfe, text("comentário privado")),
      segment(0xe2, [...text("ICC_PROFILE\0"), 1, 1, 9, 9]),
    ]);
    const clean = sanitizeJpeg(dirty);
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    for (const secret of ["Exif", "GPSLatitude", "iPhone", "xmpmeta", "studio location", "Photoshop", "c2pa", "privado"])
      expect(contains(clean.bytes, secret), secret).toBe(false);
    // The structure and the picture survive: JFIF header, the colour profile, tables, frame, scan, data and end.
    expect(contains(clean.bytes, "JFIF")).toBe(true);
    expect(contains(clean.bytes, "ICC_PROFILE")).toBe(true);
    expect(clean.bytes.length).toBeLessThan(dirty.length);
    expect([clean.width, clean.height]).toEqual([640, 480]);
    expect(Array.from(clean.bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(clean.bytes.slice(-2))).toEqual([0xff, 0xd9]);
    expect(Array.from(clean.bytes.slice(-7))).toEqual([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
    // Cleaning twice changes nothing more.
    const again = sanitizeJpeg(clean.bytes);
    expect(again.ok && Buffer.from(again.bytes).equals(Buffer.from(clean.bytes))).toBe(true);
  });

  it("leaves an already clean file as it was", () => {
    const clean = jpeg();
    const result = sanitizeJpeg(clean);
    expect(result.ok && Buffer.from(result.bytes).equals(Buffer.from(clean))).toBe(true);
  });

  it("refuses what is not a usable JPEG", () => {
    const reason = (input: Uint8Array) => {
      const result = sanitizeJpeg(input);
      return result.ok ? "ok" : result.reason;
    };
    expect(reason(bytes(text("<html><script>alert(1)</script></html>")))).toBe("NOT_JPEG");
    expect(reason(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe("NOT_JPEG"); // PNG
    expect(reason(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]))).toBe("NOT_JPEG"); // GIF
    expect(reason(new Uint8Array())).toBe("NOT_JPEG");
    expect(reason(bytes([0xff, 0xd8]))).toBe("NOT_JPEG");
    expect(reason(bytes([0xff, 0xd8, 0xff, 0xd9]))).toBe("TRUNCATED"); // end before any image
    const whole = jpeg();
    expect(reason(whole.slice(0, 30))).toBe("TRUNCATED"); // cut inside a segment
    expect(reason(bytes([0xff, 0xd8], segment(0xe0, text("JFIF\0")), segment(0xda, [1, 1, 0, 0, 63, 0]), [1, 2, 0xff, 0xd9]))).toBe("NOT_JPEG"); // scan with no frame header
    expect(reason(bytes([0xff, 0xd8], segment(0xe0, text("JFIF\0")), segment(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0])))).toBe("TRUNCATED"); // frame, no scan
    expect(reason(jpeg([], { width: 9000, height: 100 }))).toBe("BAD_DIMENSIONS");
    expect(reason(jpeg([], { width: 100, height: 0 }))).toBe("BAD_DIMENSIONS");
    expect(reason(new Uint8Array(MAX_PHOTO_BYTES + 1))).toBe("TOO_LARGE");
  });

  it("knows the four views of the master document and nothing else", () => {
    expect(["ANTERIOR", "LATERAL_LEFT", "LATERAL_RIGHT", "POSTERIOR"].every(isPhotoView)).toBe(true);
    for (const other of ["", "anterior", "TOP", "../POSTERIOR", "ANTERIOR "]) expect(isPhotoView(other), other).toBe(false);
  });

  it("makes unguessable keys under the organization and assessment, never from the student's name", () => {
    const a = photoObjectKey("org-a", "as-1");
    const b = photoObjectKey("org-a", "as-1");
    expect(a).toMatch(/^assessments\/org-a\/as-1\/[0-9a-f-]{36}\.jpg$/);
    expect(a).not.toBe(b);
  });
});

describe("when the photos are open", () => {
  const bucket = {};
  it("opens only with the bucket and exactly PHOTOS_ENABLED=true", () => {
    expect(photosOpen({ PHOTOS: bucket, PHOTOS_ENABLED: "true" })).toBe(true);
  });
  it("stays closed when the bucket exists but nobody opened the photos on purpose", () => {
    for (const flag of [undefined, "", "false", "TRUE", "True", "1", "yes", " true"])
      expect(photosOpen({ PHOTOS: bucket, PHOTOS_ENABLED: flag }), String(flag)).toBe(false);
  });
  it("reads the Worker variable first and the dashboard variable (process.env) when the Worker has none", () => {
    expect(photosSwitch({ PHOTOS_ENABLED: "true" }, {})).toBe("true");
    expect(photosSwitch({}, { PHOTOS_ENABLED: "true" })).toBe("true");
    expect(photosSwitch({ PHOTOS_ENABLED: "" }, { PHOTOS_ENABLED: "true" })).toBe("true");
    expect(photosSwitch({}, {})).toBeUndefined();
    // A value set on the Worker is not overridden by the other road.
    expect(photosSwitch({ PHOTOS_ENABLED: "false" }, { PHOTOS_ENABLED: "true" })).toBe("false");
    const bucket2 = {};
    expect(photosOpen({ PHOTOS: bucket2, PHOTOS_ENABLED: photosSwitch({}, { PHOTOS_ENABLED: "true" }) })).toBe(true);
    expect(photosOpen({ PHOTOS: bucket2, PHOTOS_ENABLED: photosSwitch({ PHOTOS_ENABLED: "false" }, { PHOTOS_ENABLED: "true" }) })).toBe(false);
  });
  it("stays closed without the bucket, whatever the flag says", () => {
    expect(photosOpen({ PHOTOS_ENABLED: "true" })).toBe(false);
    expect(photosOpen({ PHOTOS: undefined, PHOTOS_ENABLED: "true" })).toBe(false);
    expect(photosOpen({})).toBe(false);
  });
});
