// Web Crypto only: the same code runs in workerd (production) and Node (tests).
const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** The SHA-256 of bytes, as lowercase hex. */
export async function sha256HexOfBytes(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares fixed-length digests so timing does not reveal a matching prefix. */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let difference = x.length ^ y.length;
  for (let i = 0; i < x.length; i++)
    difference |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return difference === 0;
}

/** 256 random bits, URL-safe, 43 characters. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export const isTokenShape = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
