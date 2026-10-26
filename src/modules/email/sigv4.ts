/**
 * AWS Signature Version 4, with the Web Crypto that every Worker has: no SDK, no Node. It signs the
 * request it is given and nothing else; the secret never leaves this function. It is checked against
 * the published AWS examples (tests/ses.test.ts), not only against itself.
 */
const encoder = new TextEncoder();
const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (data: string | Uint8Array<ArrayBuffer>) =>
  hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? encoder.encode(data) : data));

async function hmac(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, encoder.encode(data));
}

/** The key derived for one day, region and service. `day` is YYYYMMDD. */
export async function signingKey(secretAccessKey: string, day: string, region: string, service: string) {
  const date = await hmac(`AWS4${secretAccessKey}`, day);
  const regional = await hmac(date, region);
  const serviced = await hmac(regional, service);
  return hmac(serviced, "aws4_request");
}

// RFC 3986: what encodeURIComponent leaves alone, minus the characters AWS wants encoded.
const encode = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string;
  url: string;
  /** Headers to sign besides host and x-amz-date, which are added. */
  headers?: Record<string, string>;
  body?: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}

/**
 * Returns the headers to send: the ones given, `x-amz-date` and `authorization`. `host` is signed
 * but not returned, because the runtime sets it from the address.
 */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const stamp = input.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  headers["x-amz-date"] = stamp;
  const signed: Record<string, string> = { ...headers, host: url.host };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((name) => `${name}:${signed[name]}\n`).join("");
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  // Outside S3 the path is encoded twice; the paths used here only have unreserved characters.
  const canonicalPath = url.pathname.split("/").map((segment) => encode(encode(decodeURIComponent(segment)))).join("/") || "/";
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    names.join(";"),
    await sha256Hex(input.body ?? ""),
  ].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = hex(await hmac(await signingKey(input.secretAccessKey, day, input.region, input.service), toSign));
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return headers;
}
