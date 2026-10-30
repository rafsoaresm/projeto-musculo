import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builderFilesFor, cleanFileName, type AddFileOutcome } from "@/db/builder-files";
import { publishedAssetBySlug } from "@/db/site-assets";
import { UPLOAD_METHODS, handleUpload, mountOf } from "@/modules/frappe-editor/upload";
import { MAX_IMAGE_BYTES } from "@/modules/meu-site/images";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// A PNG that has only what draws it (the same bytes the check of the first editor's images takes as they are).
const text = (value: string) => [...new TextEncoder().encode(value)];
const be32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: number[]) => {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: number[] = []) => [...be32(data.length), ...text(type), ...data, ...be32(crc32([...text(type), ...data]))];
const png = () =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [...be32(2), ...be32(2), 8, 6, 0, 0, 0]), ...chunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0, 0]), ...chunk("IEND")]);

/** A bucket in memory: what the repository and the public route ask of the real one. */
function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, value: Uint8Array) {
      objects.set(key, value);
    },
    async get(key: string) {
      const value = objects.get(key);
      return value ? { body: new Blob([value as BlobPart]).stream() } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

let mf: Miniflare;
let db: D1Database;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "builder-files-tests" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "commercial-a", "owner-b", "revoked-a"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),('org-b','owner-b','OWNER',NULL),('org-a','revoked-a','MANAGER','2026-10-02T00:00:00.000Z')`,
    ),
    db.prepare("INSERT INTO sites(id, organization_id, slug, created_by) VALUES ('site-a','org-a','studio-a','owner-a'),('site-b','org-b','studio-b','owner-b')"),
  ]);
});
afterAll(async () => {
  await mf.dispose();
});

describe("the name of a file", () => {
  it("is what a person would call it: the last part, without paths or marks, with the extension of what it is", () => {
    expect(cleanFileName("C:\\fotos\\Marina treino.PNG", "image/png")).toBe("Marina treino.PNG");
    expect(cleanFileName("../../etc/passwd", "image/png")).toBe("passwd.png");
    expect(cleanFileName("<script>alert(1)</script>.jpg", "image/jpeg")).toBe("script.jpg");
    expect(cleanFileName("", "image/jpeg")).toBe("imagem.jpg");
    expect(cleanFileName("..", "image/png")).toBe("imagem.png");
    expect(cleanFileName("foto", "image/jpeg")).toBe("foto.jpg");
    expect(cleanFileName("x".repeat(400), "image/png")).toHaveLength(154);
  });
});

describe("the files sent from the editor", () => {
  it("are stored cleaned under the organization, indexed, audited, and public by their address and nobody else's", async () => {
    const { bucket, objects } = memoryBucket();
    const stored = await builderFilesFor(db, bucket, scope("owner-a")).add(png(), "Treino.png", new Date("2026-10-30T12:00:00.000Z"));
    expect(stored.status).toBe("stored");
    if (stored.status !== "stored") return;
    expect(stored.file).toMatchObject({ fileName: "Treino.png", contentType: "image/png", width: 2, height: 2 });
    expect([...objects.keys()].every((key) => key.startsWith("sites/org-a/editor/") && key.endsWith(".png"))).toBe(true);
    const row = await db.prepare("SELECT organization_id, sha256, created_by FROM builder_files WHERE id = ?").bind(stored.file.id).first<{ organization_id: string; sha256: string; created_by: string }>();
    expect(row).toMatchObject({ organization_id: "org-a", created_by: "owner-a" });
    expect(row!.sha256).toHaveLength(64);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM access_audit_events WHERE action = 'SITE_FILE_ADDED' AND subject_id = ?").bind(stored.file.id).first<{ c: number }>()).toEqual({ c: 1 });

    const served = await publishedAssetBySlug(db, bucket, "studio-a", stored.file.id);
    expect(served?.contentType).toBe("image/png");
    expect(served?.bytes).toBe(objects.values().next().value!.length);
    await served!.body.cancel();
    // another site's address, an id that is not one, an id that does not exist
    expect(await publishedAssetBySlug(db, bucket, "studio-b", stored.file.id)).toBeNull();
    expect(await publishedAssetBySlug(db, bucket, "studio-a", "not-an-id")).toBeNull();
    expect(await publishedAssetBySlug(db, bucket, "studio-a", crypto.randomUUID())).toBeNull();
    expect(await publishedAssetBySlug(db, null, "studio-a", stored.file.id)).toBeNull();
  });

  it("are not taken from whoever may not write the site, and a refused file leaves nothing in the storage", async () => {
    const { bucket, objects } = memoryBucket();
    for (const who of ["commercial-a", "revoked-a"]) expect((await builderFilesFor(db, bucket, scope(who)).add(png(), "x.png")).status, who).toBe("forbidden");
    expect((await builderFilesFor(db, bucket, scope("owner-b", "org-a")).add(png(), "x.png")).status).toBe("forbidden");
    expect(objects.size).toBe(0);
    expect(await db.prepare("SELECT COUNT(*) AS c FROM builder_files WHERE created_by IN ('commercial-a','revoked-a')").first<{ c: number }>()).toEqual({ c: 0 });
  });

  it("must be a JPEG or a PNG that can be drawn, as for the first editor, and are not taken where the storage is not provisioned", async () => {
    const { bucket, objects } = memoryBucket();
    const files = builderFilesFor(db, bucket, scope("owner-a"));
    for (const bad of [new TextEncoder().encode("<svg onload=alert(1)>"), new TextEncoder().encode("GIF89a"), Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])]) expect((await files.add(bad, "x.png")).status).toBe("invalid");
    expect((await files.add(new Uint8Array(MAX_IMAGE_BYTES + 1), "x.png")) as AddFileOutcome).toEqual({ status: "invalid", reason: "TOO_LARGE" });
    expect(objects.size).toBe(0);
    expect((await builderFilesFor(db, null, scope("owner-a")).add(png(), "x.png")).status).toBe("unavailable");
  });

  it("stop at 300 per organization, and a file does not change", async () => {
    const { bucket } = memoryBucket();
    const have = (await db.prepare("SELECT COUNT(*) AS c FROM builder_files WHERE organization_id = 'org-b'").first<{ c: number }>())!.c;
    const fill = Array.from({ length: 300 - have }, (_, index) =>
      db
        .prepare("INSERT INTO builder_files(organization_id, id, object_key, file_name, content_type, bytes, width, height, sha256, created_by) VALUES ('org-b', ?1, ?2, 'a.png', 'image/png', 1, 1, 1, ?3, 'owner-b')")
        .bind(crypto.randomUUID(), `fill-${index}`, "0".repeat(64)),
    );
    await db.batch(fill);
    expect((await builderFilesFor(db, bucket, scope("owner-b", "org-b")).add(png(), "x.png")).status).toBe("limit");
    await expect(db.prepare("UPDATE builder_files SET file_name = 'x' WHERE organization_id = 'org-b'").run()).rejects.toThrow(/does not change/);
  });
});

describe("the upload of the editor's file picker", () => {
  const form = (fields: Record<string, string | Blob>, name = "foto.png") => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "string") data.append(key, value);
      else data.append(key, value, name);
    }
    return data;
  };
  const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("https://host.test/treinador/api/builder-editor/api/method/builder.api.upload_builder_asset", { method: "POST", body, headers });
  const stored = (): AddFileOutcome => ({ status: "stored", file: { id: "0b9f2f7a-3c1e-4d55-9a7e-6f5d4c3b2a10", fileName: "foto.png", contentType: "image/png", bytes: 77, width: 2, height: 2, createdAt: "x" } });
  const deps = (over: Partial<Parameters<typeof handleUpload>[1]> = {}) => ({ add: async () => stored(), slug: "studio-a", mount: "/treinador", ...over });

  it("answers the way the picker reads: the address of the file under the mount path", async () => {
    const result = await handleUpload(post(form({ file: new Blob([png()]), is_private: "0", folder: "Home/Builder Uploads" })), deps());
    expect(result).toEqual({ ok: true, message: { name: "0b9f2f7a-3c1e-4d55-9a7e-6f5d4c3b2a10", file_name: "foto.png", file_url: "/treinador/s/studio-a/m/0b9f2f7a-3c1e-4d55-9a7e-6f5d4c3b2a10", file_size: 77, is_private: 0, folder: "Home/Builder Uploads" } });
  });
  it("knows the mount path from the address it was asked at", () => {
    expect(mountOf("https://h.test/treinador/api/builder-editor/api/method/x")).toBe("/treinador");
    expect(mountOf("https://h.test/app/api/builder-editor/api/method/x")).toBe("/app");
    expect(mountOf("https://h.test/api/builder-editor/api/method/x")).toBe("");
    expect([...UPLOAD_METHODS].sort()).toEqual(["builder.api.upload_builder_asset", "upload_file"]);
  });
  it("says in words what is wrong: not a form, no file, too large, no address for the site, a file that cannot be drawn, the limit, no storage, no right", async () => {
    const json = await handleUpload(post("{}", { "content-type": "application/json" }), deps());
    expect(json).toMatchObject({ ok: false, status: 400 });
    expect(await handleUpload(post(form({ is_private: "0" })), deps())).toMatchObject({ ok: false, status: 400, message: "Nenhum arquivo foi enviado." });
    expect(await handleUpload(post(form({ file: new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)]) })), deps())).toMatchObject({ ok: false, status: 413 });
    expect(await handleUpload(post(form({ file: new Blob([png()]) }), { "content-length": String(MAX_IMAGE_BYTES * 2) }), deps())).toMatchObject({ ok: false, status: 413 });
    expect(await handleUpload(post(form({ file: new Blob([png()]) })), deps({ slug: null }))).toMatchObject({ ok: false, status: 417, message: expect.stringContaining("endereço do site") });
    expect(await handleUpload(post(form({ file: new Blob([png()]) })), deps({ add: async () => ({ status: "invalid", reason: "UNSUPPORTED" }) }))).toMatchObject({ ok: false, status: 417, message: "A imagem precisa ser JPEG ou PNG." });
    expect(await handleUpload(post(form({ file: new Blob([png()]) })), deps({ add: async () => ({ status: "limit" }) }))).toMatchObject({ ok: false, status: 417 });
    expect(await handleUpload(post(form({ file: new Blob([png()]) })), deps({ add: async () => ({ status: "unavailable" }) }))).toMatchObject({ ok: false, status: 503 });
    expect(await handleUpload(post(form({ file: new Blob([png()]) })), deps({ add: async () => ({ status: "forbidden" }) }))).toMatchObject({ ok: false, status: 403 });
  });
});
