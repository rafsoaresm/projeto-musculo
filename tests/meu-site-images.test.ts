import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, imageObjectKey, sanitizeImage } from "@/modules/meu-site/images";

const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());
const text = (value: string) => [...new TextEncoder().encode(value)];
const be32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: number[]) => {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: number[] = []) => [...be32(data.length), ...text(type), ...data, ...be32(crc32([...text(type), ...data]))];
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ihdr = (width = 2, height = 2, colorType = 6) => chunk("IHDR", [...be32(width), ...be32(height), 8, colorType, 0, 0, 0]);
const png = (...chunks: number[][]) => bytes(SIGNATURE, ...chunks);
const basic = () => png(ihdr(), chunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0, 0]), chunk("IEND"));
const contains = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle));

const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const jpeg = (extra: number[][] = [], size: [number, number] = [0x01e0, 0x0280]) =>
  bytes(
    [0xff, 0xd8],
    segment(0xe0, [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...extra,
    segment(0xc0, [8, size[0] >> 8, size[0] & 255, size[1] >> 8, size[1] & 255, 1, 1, 0x11, 0]),
    segment(0xda, [1, 1, 0, 0, 63, 0]),
    [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9],
  );

describe("a PNG for the public page", () => {
  it("passes as it is when it has only what draws it, and says its size", () => {
    const input = basic();
    const result = sanitizeImage(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.type).toBe("image/png");
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(Buffer.from(result.bytes).equals(Buffer.from(input))).toBe(true);
  });
  it("loses what can carry text, a position, a time or an animation, and keeps what draws it and the colors", () => {
    const dirty = png(
      ihdr(),
      chunk("sRGB", [0]),
      chunk("gAMA", [0, 1, 0x86, 0xa0]),
      chunk("tEXt", [...text("Comment"), 0, ...text("GPSLatitude -23.55 Marina iPhone")]),
      chunk("eXIf", [...text("Exif"), 0, 0, ...text("secret-device")]),
      chunk("tIME", [7, 0xea, 10, 28, 12, 0, 0]),
      chunk("pHYs", [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]),
      chunk("iCCP", [...text("profile"), 0, 0, 1, 2, 3]),
      chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]),
      chunk("fcTL", new Array(26).fill(0)),
      chunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0, 0]),
      chunk("fdAT", [0, 0, 0, 1, 1, 2, 3]),
      chunk("zTXt", [...text("Author"), 0, 0, 1, 2]),
      chunk("iTXt", [...text("XML:com.adobe.xmp"), 0, 0, 0, 0, 0, ...text("<x:xmpmeta>")]),
      chunk("IEND"),
    );
    const result = sanitizeImage(dirty);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const secret of ["GPSLatitude", "iPhone", "secret-device", "xmpmeta", "profile", "Author"]) expect(contains(result.bytes, secret), secret).toBe(false);
    for (const type of ["tEXt", "eXIf", "tIME", "pHYs", "iCCP", "acTL", "fcTL", "fdAT", "zTXt", "iTXt"]) expect(contains(result.bytes, type), type).toBe(false);
    for (const type of ["IHDR", "sRGB", "gAMA", "IDAT", "IEND"]) expect(contains(result.bytes, type), type).toBe(true);
    expect(result.bytes.length).toBeLessThan(dirty.length);
  });
  it("drops whatever comes after the end of the image, so a file that is also something else is not kept as that", () => {
    const polyglot = bytes([...basic()], text("<script>alert(1)</script>"));
    const result = sanitizeImage(polyglot);
    expect(result.ok).toBe(true);
    if (result.ok) expect(contains(result.bytes, "<script")).toBe(false);
  });
  it("refuses a chunk that is needed to draw it and is not known, a bad header, a missing end, no data and a palette image without palette", () => {
    const refused = (input: Uint8Array) => {
      const result = sanitizeImage(input);
      return result.ok ? "ok" : result.reason;
    };
    expect(refused(png(ihdr(), chunk("ZZZZ", [1]), chunk("IDAT", [1]), chunk("IEND")))).toBe("UNSUPPORTED");
    expect(refused(png(chunk("IDAT", [1]), chunk("IEND")))).toBe("UNSUPPORTED");
    expect(refused(png(chunk("IHDR", [1, 2, 3])))).toBe("UNSUPPORTED");
    expect(refused(png(ihdr(), chunk("IDAT", [1])))).toBe("TRUNCATED");
    expect(refused(png(ihdr(), chunk("IEND")))).toBe("TRUNCATED");
    expect(refused(png(ihdr(2, 2, 3), chunk("IDAT", [1]), chunk("IEND")))).toBe("TRUNCATED");
    expect(refused(bytes(SIGNATURE, be32(999999), text("IHDR"), new Array(20).fill(0)))).toBe("TRUNCATED");
    expect(refused(bytes(SIGNATURE, be32(13), text("IHDR")))).toBe("UNSUPPORTED");
    expect(refused(png(chunk("IHDR", [...be32(2), ...be32(2), 8, 6, 1, 0, 0]), chunk("IDAT", [1]), chunk("IEND")))).toBe("UNSUPPORTED");
  });
  it("takes only a header that is exactly the one of the format, first, and only the methods the format defines", () => {
    const refused = (header: number[]) => {
      const result = sanitizeImage(png(header, chunk("IDAT", [1]), chunk("IEND")));
      return result.ok ? "ok" : result.reason;
    };
    const fields = (compression: number, filter: number, interlace: number) => [...be32(2), ...be32(2), 8, 6, compression, filter, interlace];
    expect(refused(chunk("IHDR", fields(0, 0, 0)))).toBe("ok");
    expect(refused(chunk("IHDR", fields(0, 0, 1)))).toBe("ok");
    expect(refused(chunk("IHDR", fields(0, 0, 2)))).toBe("UNSUPPORTED");
    expect(refused(chunk("IHDR", fields(0, 1, 0)))).toBe("UNSUPPORTED");
    expect(refused(chunk("IHDR", fields(1, 0, 0)))).toBe("UNSUPPORTED");
    // The right fields in a chunk that is not the header, or a header with more than it has: not the format.
    expect(refused(chunk("tEXt", fields(0, 0, 0)))).toBe("UNSUPPORTED");
    expect(refused(chunk("IHDR", [...fields(0, 0, 0), 0]))).toBe("UNSUPPORTED");
  });
  it("refuses sizes the page does not take: zero, over the side, or too many pixels for memory", () => {
    const refused = (width: number, height: number) => {
      const result = sanitizeImage(png(ihdr(width, height), chunk("IDAT", [1]), chunk("IEND")));
      return result.ok ? "ok" : result.reason;
    };
    expect(refused(0, 5)).toBe("BAD_DIMENSIONS");
    expect(refused(5, 0)).toBe("BAD_DIMENSIONS");
    expect(refused(8193, 10)).toBe("BAD_DIMENSIONS");
    expect(refused(8192, 8192)).toBe("BAD_DIMENSIONS");
    expect(8192 * 8192).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expect(refused(4000, 4000)).toBe("ok");
  });
});

describe("a JPEG for the public page", () => {
  it("passes, says its size and loses EXIF, XMP, comments and other application data", () => {
    const dirty = jpeg([
      segment(0xe1, [...text("Exif\0\0"), ...text("GPSLatitude -23.55 iPhone")]),
      segment(0xe1, [...text("http://ns.adobe.com/xap/1.0/\0"), ...text("<x:xmpmeta>")]),
      segment(0xfe, text("comment with a name")),
      segment(0xed, text("Photoshop 3.0 IPTC")),
    ]);
    const result = sanitizeImage(dirty);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.type).toBe("image/jpeg");
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
    for (const secret of ["GPSLatitude", "iPhone", "xmpmeta", "comment with a name", "IPTC"]) expect(contains(result.bytes, secret), secret).toBe(false);
  });
  it("refuses a JPEG that is cut, has no data, or draws more pixels than the page takes", () => {
    const refused = (input: Uint8Array) => {
      const result = sanitizeImage(input);
      return result.ok ? "ok" : result.reason;
    };
    expect(refused(jpeg().subarray(0, 20))).toBe("TRUNCATED");
    expect(refused(bytes([0xff, 0xd8, 0xff, 0xd9]))).toBe("TRUNCATED");
    expect(refused(jpeg([], [8000, 8000]))).toBe("BAD_DIMENSIONS");
    expect(refused(jpeg([], [0, 5]))).toBe("BAD_DIMENSIONS");
  });
});

describe("what is not a JPEG or a PNG", () => {
  const refused = (input: Uint8Array) => {
    const result = sanitizeImage(input);
    return result.ok ? "ok" : result.reason;
  };
  it("is refused whatever it says it is: SVG, GIF, WebP, HTML, text, empty", () => {
    expect(refused(bytes(text('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')))).toBe("UNSUPPORTED");
    expect(refused(bytes(text("GIF89a"), [1, 0, 1, 0, 0, 0, 0]))).toBe("UNSUPPORTED");
    expect(refused(bytes(text("RIFF"), [0, 0, 0, 0], text("WEBPVP8 "), [0, 0, 0, 0]))).toBe("UNSUPPORTED");
    expect(refused(bytes(text("<!doctype html><script>alert(1)</script>")))).toBe("UNSUPPORTED");
    expect(refused(bytes(text("just text")))).toBe("UNSUPPORTED");
    expect(refused(new Uint8Array())).toBe("UNSUPPORTED");
    expect(refused(bytes([0x89, 0x50, 0x4e]))).toBe("UNSUPPORTED");
  });
  it("is refused when it is larger than the limit, before anything is read", () => {
    expect(refused(new Uint8Array(MAX_IMAGE_BYTES + 1))).toBe("TOO_LARGE");
  });
});

describe("the key of the object", () => {
  it("is under the organization and the site, unguessable, and has the extension of what was kept", () => {
    const one = imageObjectKey("org-1", "site-1", "image/png");
    const two = imageObjectKey("org-1", "site-1", "image/jpeg");
    expect(one).toMatch(/^sites\/org-1\/site-1\/[0-9a-f-]{36}\.png$/);
    expect(two).toMatch(/\.jpg$/);
    expect(imageObjectKey("org-1", "site-1", "image/png")).not.toBe(one);
  });
});
