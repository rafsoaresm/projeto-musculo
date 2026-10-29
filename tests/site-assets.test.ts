import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import type { D1Database, D1PreparedStatement, R2Bucket } from "@cloudflare/workers-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publishedSiteBySlug, sitesFor } from "@/db/sites";
import { publishedAssetBySlug, siteAssetsFor } from "@/db/site-assets";
import { emptyBlock, referencedAssetIds, type SiteContent } from "@/modules/meu-site/contracts";
import { MAX_ASSETS_PER_SITE } from "@/modules/meu-site/images";
import { ALL_MIGRATIONS, migrate } from "./helpers/migrate";

// Real local D1 and R2 with the real migrations and triggers. Identities are rows, as the server derives them from a
// verified session; the repository repeats membership, role and active login in each statement.
let mf: Miniflare;
let db: D1Database;
let bucket: R2Bucket;
const scope = (userId: string, organizationId = "org-a") => ({ userId, organizationId });
const T0 = new Date("2026-10-28T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const assets = (who = "owner-a", org = "org-a", withBucket = true) => siteAssetsFor(db, withBucket ? bucket : null, scope(who, org));
const sites = (who = "owner-a", org = "org-a") => sitesFor(db, scope(who, org));
const one = async <T,>(sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string, ...binds: unknown[]) => (await one<{ c: number }>(`SELECT COUNT(*) AS c FROM (${sql})`, ...binds))!.c;

const text = (value: string) => [...new TextEncoder().encode(value)];
const be32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const chunk = (type: string, data: number[] = []) => [...be32(data.length), ...text(type), ...data, 0, 0, 0, 0];
const png = (extra: number[][] = [], width = 4, height = 3) =>
  Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    ...extra.flat(),
    ...chunk("IDAT", [0x78, 0x9c, 0x63, 0x60, 0, 0]),
    ...chunk("IEND"),
  ]);
const secret = () => chunk("tEXt", [...text("Comment"), 0, ...text("GPSLatitude -23.55 Marina iPhone")]);

const withImage = (assetId: string, over: Partial<SiteContent> = {}): SiteContent => ({
  schemaVersion: 3,
  title: "Marina Treinos",
  description: "",
  contact: { whatsapp: "(11) 91234-5678", email: "", instagram: "" },
  theme: { accent: "blue", mode: "light", width: "narrow" },
  blocks: [
    { id: "h1", type: "hero", eyebrow: "", heading: "Treino sob medida", subheading: "", buttonLabel: "Falar", buttonChannel: "whatsapp" },
    { ...emptyBlock("image", "img1"), assetId, alt: "Marina no estúdio" } as SiteContent["blocks"][number],
  ],
  ...over,
});

async function saveAndPublish(content: SiteContent, minute: number, who = "owner-a", org = "org-a", withWarnings = false) {
  const repo = sites(who, org);
  const overview = (await repo.overview())!;
  const saved = await repo.saveDraft(content, overview.draft.revision, at(minute));
  if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
  return repo.publish(saved.revision, at(minute + 1), { withWarnings });
}

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('test'); } };",
      compatibilityDate: "2026-10-23",
      d1Databases: { DB: "site-assets-tests" },
      r2Buckets: { SITE_MEDIA: "site-assets-tests-bucket" },
      cf: false,
    }),
  );
  db = await mf.getD1Database("DB");
  bucket = (await mf.getR2Bucket("SITE_MEDIA")) as unknown as R2Bucket;
  await migrate(db, ALL_MIGRATIONS);
  const people = ["owner-a", "manager-a", "commercial-a", "tech-a", "finance-a", "owner-b", "outsider", "blocked-a", "revoked-a"];
  await db.batch([
    ...people.map((id) => db.prepare("INSERT INTO auth_user(id,name,email,created_at,updated_at) VALUES (?1,?1,?2,0,0)").bind(id, `${id}@example.test`)),
    db.prepare(`INSERT INTO users(id) VALUES ${people.filter((p) => p !== "blocked-a").map((p) => `('${p}')`).join(",")}`),
    db.prepare("INSERT INTO users(id, disabled_at) VALUES ('blocked-a', '2026-10-01T00:00:00.000Z')"),
    db.prepare("INSERT INTO organizations(id,name) VALUES ('org-a','Studio A'),('org-b','Studio B')"),
    db.prepare(
      `INSERT INTO memberships(organization_id,user_id,role,revoked_at) VALUES
       ('org-a','owner-a','OWNER',NULL),('org-a','manager-a','MANAGER',NULL),('org-a','commercial-a','COMMERCIAL',NULL),
       ('org-a','tech-a','TECHNICAL',NULL),('org-a','finance-a','FINANCE',NULL),('org-b','owner-b','OWNER',NULL),
       ('org-a','blocked-a','MANAGER',NULL),('org-a','revoked-a','MANAGER','2026-10-02T00:00:00.000Z')`,
    ),
  ]);
  expect(await sites("owner-a").create({ slug: "marina-a", title: "Marina A" }, at(0))).toEqual({ status: "created" });
  expect(await sites("owner-b", "org-b").create({ slug: "studio-b", title: "Studio B" }, at(0))).toEqual({ status: "created" });
});
afterAll(async () => {
  await mf?.dispose();
});

let firstId = "";
let secretKey = "";

describe("adding an image", () => {
  it("stores the cleaned file, indexes it, and writes a line in the trail", async () => {
    const outcome = await assets().add(png([secret()]), at(1));
    expect(outcome.status).toBe("stored");
    if (outcome.status !== "stored") return;
    firstId = outcome.asset.id;
    expect(outcome.asset).toMatchObject({ contentType: "image/png", width: 4, height: 3 });
    const row = (await one<{ key: string; sha: string; bytes: number; site: string }>("SELECT object_key AS key, sha256 AS sha, bytes, site_id AS site FROM site_assets WHERE id = ?", firstId))!;
    secretKey = row.key;
    expect(row.key).toMatch(new RegExp(`^sites/org-a/${row.site}/[0-9a-f-]{36}\\.png$`));
    const stored = await bucket.get(row.key);
    const body = new Uint8Array(await stored!.arrayBuffer());
    expect(Buffer.from(body).includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(Buffer.from(body).includes(Buffer.from("tEXt"))).toBe(false);
    expect(body.length).toBe(row.bytes);
    expect(stored!.httpMetadata?.contentType).toBe("image/png");
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(digest).toBe(row.sha);
    expect(await one("SELECT 1 AS x FROM access_audit_events WHERE action = 'SITE_IMAGE_ADDED' AND subject_id = ?", firstId)).not.toBeNull();
  });
  it("refuses what is not a JPEG or a PNG, what is too large, and stores nothing for it", async () => {
    const before = await count("SELECT 1 FROM site_assets");
    const objects = (await bucket.list()).objects.length;
    for (const bad of [new TextEncoder().encode("<svg onload=alert(1)></svg>"), new TextEncoder().encode("GIF89a....")])
      expect(await assets().add(bad, at(2))).toEqual({ status: "invalid", reason: "UNSUPPORTED" });
    expect(await assets().add(new Uint8Array(5 * 1024 * 1024 + 1), at(2))).toEqual({ status: "invalid", reason: "TOO_LARGE" });
    expect(await assets().add(png([], 9000, 10), at(2))).toEqual({ status: "invalid", reason: "BAD_DIMENSIONS" });
    expect(await count("SELECT 1 FROM site_assets")).toBe(before);
    expect((await bucket.list()).objects.length).toBe(objects);
  });
  it("is for the owner and a manager only: the commercial, technical and finance members, a stranger, a blocked and a removed login add nothing", async () => {
    const before = await count("SELECT 1 FROM site_assets");
    const objects = (await bucket.list()).objects.length;
    for (const who of ["commercial-a", "tech-a", "finance-a", "blocked-a", "revoked-a"]) expect(await assets(who).add(png(), at(3)), who).toEqual({ status: "forbidden" });
    expect(await assets("outsider", "org-a").add(png(), at(3))).toEqual({ status: "forbidden" });
    expect(await count("SELECT 1 FROM site_assets")).toBe(before);
    expect((await bucket.list()).objects.length).toBe(objects);
    expect((await assets("manager-a").add(png(), at(3))).status).toBe("stored");
  });
  it("says so when the storage is not provisioned, and adds nothing", async () => {
    const before = await count("SELECT 1 FROM site_assets");
    expect(await assets("owner-a", "org-a", false).add(png(), at(4))).toEqual({ status: "unavailable" });
    expect(await count("SELECT 1 FROM site_assets")).toBe(before);
  });
  it("stops at 60 images per site, in the repository and in the database", async () => {
    const siteB = (await one<{ id: string }>("SELECT id FROM sites WHERE organization_id = 'org-b'"))!.id;
    const fill = async (n: number, site: string, from: number) => {
      for (let i = 0; i < n; i++)
        await db
          .prepare("INSERT INTO site_assets(id,site_id,object_key,content_type,bytes,width,height,sha256,created_by) VALUES (?,?,?,'image/png',10,1,1,?,'owner-b')")
          .bind(`fill-${from + i}`, site, `fill/${from + i}`, "a".repeat(64))
          .run();
    };
    await fill(MAX_ASSETS_PER_SITE, siteB, 0);
    expect(await count("SELECT 1 FROM site_assets WHERE site_id = ?", siteB)).toBe(MAX_ASSETS_PER_SITE);
    await expect(fill(1, siteB, 999)).rejects.toThrow(/at most 60/);
    expect(await assets("owner-b", "org-b").add(png(), at(5))).toEqual({ status: "limit" });
    expect(await count("SELECT 1 FROM site_assets WHERE site_id = ?", siteB)).toBe(MAX_ASSETS_PER_SITE);
  });
});

describe("who sees the library", () => {
  it("lets the owner, a manager and a commercial member list and read, and nobody else", async () => {
    for (const who of ["owner-a", "manager-a", "commercial-a"]) {
      expect((await assets(who).list()).length, who).toBeGreaterThan(0);
      const read = await assets(who).read(firstId);
      expect(read, who).not.toBeNull();
      expect(read!.contentType).toBe("image/png");
      await read!.body.cancel();
    }
    for (const who of ["tech-a", "finance-a", "blocked-a", "revoked-a"]) {
      expect(await assets(who).list(), who).toEqual([]);
      expect(await assets(who).read(firstId), who).toBeNull();
    }
  });
  it("keeps each organization's images to itself, even knowing the identifier", async () => {
    expect(await assets("owner-b", "org-b").read(firstId)).toBeNull();
    expect((await assets("owner-b", "org-b").list()).every((a) => a.id.startsWith("fill-"))).toBe(true);
    expect(await assets("owner-a").read("fill-0")).toBeNull();
    expect(await assets("owner-b", "org-b").remove(firstId)).toEqual({ status: "not_found" });
    expect(await assets("owner-a").read("no-such-image")).toBeNull();
  });
});

describe("what is public", () => {
  it("serves an image to nobody while it is only in the library or in a draft, and not through another site's address", async () => {
    expect(await publishedAssetBySlug(db, bucket, "marina-a", firstId)).toBeNull();
    const overview = (await sites().overview())!;
    await sites().saveDraft(withImage(firstId), overview.draft.revision, at(10));
    expect(await publishedAssetBySlug(db, bucket, "marina-a", firstId)).toBeNull();
    expect(await publishedAssetBySlug(db, bucket, "studio-b", firstId)).toBeNull();
  });
  it("is served once a published version uses it, with the size in the page's reading, and no other image of the library", async () => {
    const outcome = await sites().publish((await sites().overview())!.draft.revision, at(11));
    expect(outcome).toEqual({ status: "published", number: 1 });
    const served = await publishedAssetBySlug(db, bucket, "marina-a", firstId);
    expect(served).not.toBeNull();
    expect(served!.contentType).toBe("image/png");
    await served!.body.cancel();
    const other = (await assets().list()).find((a) => a.id !== firstId)!;
    expect(await publishedAssetBySlug(db, bucket, "marina-a", other.id)).toBeNull();
    const page = (await publishedSiteBySlug(db, "marina-a"))!;
    expect(page.images).toEqual({ [firstId]: { width: 4, height: 3 } });
    expect(await count("SELECT 1 FROM site_release_assets WHERE asset_id = ?", firstId)).toBe(1);
  });
  it("answers the same for a malformed address or identifier", async () => {
    for (const [slug, id] of [["../etc", firstId], ["marina-a", "../x"], ["marina-a", ""], ["MARINA-A", firstId], ["marina-a", "' OR 1=1 --"], ["", firstId]] as const)
      expect(await publishedAssetBySlug(db, bucket, slug, id), `${slug} ${id}`).toBeNull();
    expect(await publishedAssetBySlug(db, null, "marina-a", firstId)).toBeNull();
  });
  it("stops at once when the page is taken offline, and comes back when a new version is published", async () => {
    expect(await sites().unpublish(at(12))).toBe(true);
    expect(await publishedAssetBySlug(db, bucket, "marina-a", firstId)).toBeNull();
    const outcome = await sites().publish((await sites().overview())!.draft.revision, at(13));
    expect(outcome.status).toBe("published");
    const served = await publishedAssetBySlug(db, bucket, "marina-a", firstId);
    expect(served).not.toBeNull();
    await served!.body.cancel();
  });
  it("is not served for a version that does not use it: a new version without it takes it out of the page", async () => {
    const withoutImage = withImage("", { blocks: [withImage(firstId).blocks[0]] });
    const outcome = await saveAndPublish(withoutImage, 14);
    expect(outcome.status).toBe("published");
    expect(await publishedAssetBySlug(db, bucket, "marina-a", firstId)).toBeNull();
    expect((await publishedSiteBySlug(db, "marina-a"))!.images).toEqual({});
  });
});

describe("publishing with images", () => {
  it("does not publish an image that is not in this site's library, one of another organization, a block with no image, or one with no description", async () => {
    const foreign = (await assets("owner-b", "org-b").list())[0].id;
    const messages = async (content: SiteContent) => {
      const outcome = await saveAndPublish(content, 20);
      return outcome.status === "warnings" ? outcome.issues.map((i) => i.message) : [outcome.status];
    };
    expect(await messages(withImage("not-there"))).toEqual([expect.stringContaining("não está mais na biblioteca")]);
    expect(await messages(withImage(foreign))).toEqual([expect.stringContaining("não está mais na biblioteca")]);
    expect(await messages(withImage(""))).toEqual([expect.stringContaining("escolha a imagem")]);
    const noAlt = withImage(firstId);
    (noAlt.blocks[1] as { alt: string }).alt = "";
    expect(await messages(noAlt)).toEqual([expect.stringContaining("texto alternativo")]);
    expect(await count("SELECT 1 FROM site_release_assets ra JOIN site_assets a ON a.id = ra.asset_id WHERE a.site_id <> ra.site_id")).toBe(0);
  });
  it("counts an image in a container, a background and the logo as used, and refuses a logo that is not in the library", async () => {
    const inColumn = withImage("x");
    inColumn.blocks = [inColumn.blocks[0], { ...emptyBlock("box", "cols"), children: [{ ...emptyBlock("image", "in-col"), assetId: firstId, alt: "No contêiner" }], style: { bgImage: firstId } } as SiteContent["blocks"][number]];
    inColumn.logoAssetId = firstId;
    expect(referencedAssetIds(inColumn)).toEqual([firstId]);
    const bad = { ...inColumn, logoAssetId: "gone" };
    const refused = await saveAndPublish(bad, 22);
    expect(refused.status).toBe("warnings");
    if (refused.status === "warnings") expect(refused.issues.map((i) => i.message)).toEqual([expect.stringContaining("logotipo")]);
    expect((await saveAndPublish(inColumn, 24)).status).toBe("published");
    const page = (await publishedSiteBySlug(db, "marina-a"))!;
    expect(Object.keys(page.images)).toEqual([firstId]);
  });
  it("publishes anyway an image that is not in the library, a background and a logo that are not, and leaves them out of what is public", async () => {
    const content = withImage("not-there");
    content.blocks = [content.blocks[0], content.blocks[1], { ...emptyBlock("box", "bg"), children: [], style: { bgImage: "gone-too" } } as SiteContent["blocks"][number], { ...emptyBlock("image", "ok"), assetId: firstId, alt: "Aqui" } as SiteContent["blocks"][number]];
    content.logoAssetId = "no-logo";
    expect((await saveAndPublish(content, 26)).status).toBe("warnings");
    const outcome = await saveAndPublish(content, 28, "owner-a", "org-a", true);
    expect(outcome.status).toBe("published");
    const page = (await publishedSiteBySlug(db, "marina-a"))!;
    // The release keeps what the person wrote, and serves only the images that are there.
    expect(Object.keys(page.images)).toEqual([firstId]);
    expect(await count("SELECT 1 FROM site_release_assets ra JOIN site_releases r ON r.id = ra.release_id WHERE r.number = ? AND ra.asset_id IN ('not-there', 'gone-too', 'no-logo')", page.number)).toBe(0);
    expect(await count("SELECT 1 FROM site_release_assets ra JOIN site_releases r ON r.id = ra.release_id WHERE r.number = ? AND ra.asset_id = ?", page.number, firstId)).toBe(1);
  });
});

describe("removing an image", () => {
  it("is for the owner and a manager, and not for the commercial members", async () => {
    const mine = (await assets("manager-a").list()).find((a) => a.id !== firstId)!;
    expect(await assets("commercial-a").remove(mine.id)).toEqual({ status: "not_found" });
    expect(await assets("tech-a").remove(mine.id)).toEqual({ status: "not_found" });
    const key = (await one<{ key: string }>("SELECT object_key AS key FROM site_assets WHERE id = ?", mine.id))!.key;
    expect(await assets("manager-a").remove(mine.id, at(30))).toEqual({ status: "removed" });
    expect(await one("SELECT 1 AS x FROM site_assets WHERE id = ?", mine.id)).toBeNull();
    expect(await bucket.get(key)).toBeNull();
    expect(await one("SELECT 1 AS x FROM access_audit_events WHERE action = 'SITE_IMAGE_REMOVED' AND subject_id = ?", mine.id)).not.toBeNull();
    expect(await assets().remove(mine.id)).toEqual({ status: "not_found" });
  });
  it("does not remove an image the draft uses, and never one a published version used", async () => {
    expect(await assets().remove(firstId)).toEqual({ status: "in_draft" });
    const overview = (await sites().overview())!;
    await sites().saveDraft(withImage("", { blocks: [withImage(firstId).blocks[0]] }), overview.draft.revision, at(31));
    expect(await assets().remove(firstId, at(32))).toEqual({ status: "published" });
    expect(await one("SELECT 1 AS x FROM site_assets WHERE id = ?", firstId)).not.toBeNull();
    expect(await bucket.get(secretKey)).not.toBeNull();
  });
});

describe("what the database refuses on its own", () => {
  it("keeps an image and what a release uses as they were made, and does not let a release use another site's image", async () => {
    await expect(db.prepare("UPDATE site_assets SET bytes = 1 WHERE id = ?").bind(firstId).run()).rejects.toThrow();
    await expect(db.prepare("DELETE FROM site_assets WHERE id = ?").bind(firstId).run()).rejects.toThrow();
    await expect(db.prepare("UPDATE site_release_assets SET asset_id = 'x' WHERE asset_id = ?").bind(firstId).run()).rejects.toThrow();
    await expect(db.prepare("DELETE FROM site_release_assets WHERE asset_id = ?").bind(firstId).run()).rejects.toThrow();
    const release = (await one<{ id: string; site: string }>("SELECT id, site_id AS site FROM site_releases ORDER BY number DESC LIMIT 1"))!;
    await expect(db.prepare("INSERT INTO site_release_assets(release_id, asset_id, site_id) VALUES (?, 'fill-1', ?)").bind(release.id, release.site).run()).rejects.toThrow();
    await expect(
      db.prepare("INSERT INTO site_assets(id,site_id,object_key,content_type,bytes,width,height,sha256,created_by) VALUES ('svg',?, 'k/svg','image/svg+xml',10,1,1,?, 'owner-a')").bind(release.site, "a".repeat(64)).run(),
    ).rejects.toThrow();
  });
});

// Two stores that cannot change together, and requests that do not wait for each other: each case below lets something else
// happen after the repository has checked and before it writes (the way another request would), by running it right before the
// repository's one `batch`.
const racing = (before: () => Promise<unknown>): D1Database =>
  ({ prepare: (sql: string) => db.prepare(sql), batch: async (statements: D1PreparedStatement[]) => (await before(), db.batch(statements)) }) as unknown as D1Database;
const revokeManager = () => db.prepare("UPDATE memberships SET revoked_at = '2026-10-28T00:00:00.000Z' WHERE user_id = 'manager-a'").run();
const restoreManager = () => db.prepare("UPDATE memberships SET revoked_at = NULL WHERE user_id = 'manager-a'").run();

describe("when something changes between the check and the write", () => {
  it("leaves no object, no line and no trail when the login loses its role after the check", async () => {
    const objects = (await bucket.list()).objects.length;
    const rows = await count("SELECT 1 FROM site_assets");
    const trail = await count("SELECT 1 FROM access_audit_events WHERE action = 'SITE_IMAGE_ADDED'");
    try {
      expect(await siteAssetsFor(racing(revokeManager), bucket, scope("manager-a")).add(png(), at(40))).toEqual({ status: "forbidden" });
    } finally {
      await restoreManager();
    }
    expect((await bucket.list()).objects.length).toBe(objects);
    expect(await count("SELECT 1 FROM site_assets")).toBe(rows);
    expect(await count("SELECT 1 FROM access_audit_events WHERE action = 'SITE_IMAGE_ADDED'")).toBe(trail);
  });
  it("leaves no object when the library fills up after the check, and says it is full", async () => {
    const site = (await one<{ id: string }>("SELECT id FROM sites WHERE organization_id = 'org-a'"))!.id;
    const objects = (await bucket.list()).objects.length;
    const fillUp = async () => {
      const missing = MAX_ASSETS_PER_SITE - (await count("SELECT 1 FROM site_assets WHERE site_id = ?", site));
      for (let i = 0; i < missing; i++)
        await db
          .prepare("INSERT INTO site_assets(id,site_id,object_key,content_type,bytes,width,height,sha256,created_by) VALUES (?,?,?,'image/png',10,1,1,?,'owner-a')")
          .bind(`race-${i}`, site, `race/${i}`, "b".repeat(64))
          .run();
    };
    expect(await siteAssetsFor(racing(fillUp), bucket, scope("owner-a")).add(png(), at(41))).toEqual({ status: "limit" });
    expect((await bucket.list()).objects.length).toBe(objects);
    await db.prepare("DELETE FROM site_assets WHERE id LIKE 'race-%'").run();
  });
  it("removes nothing when the login loses its role after the check: the line, the file and the trail stay as they were", async () => {
    const stored = await assets().add(png(), at(42));
    if (stored.status !== "stored") throw new Error(JSON.stringify(stored));
    const key = (await one<{ key: string }>("SELECT object_key AS key FROM site_assets WHERE id = ?", stored.asset.id))!.key;
    try {
      expect(await siteAssetsFor(racing(revokeManager), bucket, scope("manager-a")).remove(stored.asset.id, at(43))).toEqual({ status: "not_found" });
    } finally {
      await restoreManager();
    }
    expect(await one("SELECT 1 AS x FROM site_assets WHERE id = ?", stored.asset.id)).not.toBeNull();
    expect(await bucket.get(key)).not.toBeNull();
    expect(await one("SELECT 1 AS x FROM access_audit_events WHERE action = 'SITE_IMAGE_REMOVED' AND subject_id = ?", stored.asset.id)).toBeNull();
    expect(await assets().remove(stored.asset.id, at(44))).toEqual({ status: "removed" });
  });
  it("does not publish when an image the draft uses leaves the library after the check: no version, the page as it was", async () => {
    const stored = await assets().add(png(), at(45));
    if (stored.status !== "stored") throw new Error(JSON.stringify(stored));
    const overview = (await sites().overview())!;
    const saved = await sites().saveDraft(withImage(stored.asset.id), overview.draft.revision, at(46));
    if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
    const releases = await count("SELECT 1 FROM site_releases");
    const pointer = await one<{ release_id: string }>("SELECT release_id FROM site_published");
    const dropImage = () => db.prepare("DELETE FROM site_assets WHERE id = ?").bind(stored.asset.id).run();
    const outcome = await sitesFor(racing(dropImage), scope("owner-a")).publish(saved.revision, at(47));
    expect(outcome.status).toBe("conflict");
    expect(await count("SELECT 1 FROM site_releases")).toBe(releases);
    expect(await one("SELECT release_id FROM site_published")).toEqual(pointer);
    expect(await count("SELECT 1 FROM site_release_assets ra WHERE NOT EXISTS (SELECT 1 FROM site_assets a WHERE a.id = ra.asset_id)")).toBe(0);
  });
});

describe("images used by components", () => {
  const component = (assetId: string): NonNullable<SiteContent["components"]>[number] => ({
    id: "foto",
    name: "Foto",
    root: { ...emptyBlock("box", "foto-box"), children: [{ ...emptyBlock("image", "foto-img"), assetId, alt: "Marina" }] } as SiteContent["blocks"][number],
  });
  const instance = (id: string, overrides: object = {}) => ({ id, type: "component", componentId: "foto", overrides }) as SiteContent["blocks"][number];
  const page = (blocks: SiteContent["blocks"], assetId: string): SiteContent => ({ ...withImage("", { blocks }), components: [component(assetId)] });
  const hero = () => withImage("").blocks[0];

  it("counts the images of a component, in its definition and in what an instance chooses, as used by the page, and serves them from the published version", async () => {
    const stored = await assets().add(png([text("pad-components")].map((chunkText) => chunk("tEXt", [...chunkText]))), at(60));
    if (stored.status !== "stored") throw new Error(JSON.stringify(stored));
    const chosen = stored.asset.id;
    const content = page([hero(), instance("i1"), instance("i2", { "foto-img": { assetId: chosen, alt: "Outra" } })], firstId);
    expect(referencedAssetIds(content).sort()).toEqual([firstId, chosen].sort());
    const outcome = await saveAndPublish(content, 61);
    expect(outcome.status).toBe("published");
    const published = (await publishedSiteBySlug(db, "marina-a"))!;
    expect(Object.keys(published.images).sort()).toEqual([firstId, chosen].sort());
    expect(published.content.components).toHaveLength(1);
    for (const id of [firstId, chosen]) {
      const served = await publishedAssetBySlug(db, bucket, "marina-a", id);
      expect(served, id).not.toBeNull();
      await served!.body.cancel();
    }
  });
  it("does not let a component's image keep the library's image from being removed while the page uses it, and leaves out of the page one that is not there", async () => {
    // The image only the component uses is the draft's: it cannot be removed from the library.
    const alone = await assets().add(png([chunk("tEXt", [...text("only-the-component")])]), at(63));
    if (alone.status !== "stored") throw new Error(JSON.stringify(alone));
    const overview = (await sites().overview())!;
    const saved = await sites().saveDraft(page([hero(), instance("i1")], alone.asset.id), overview.draft.revision, at(64));
    if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
    expect(await assets().remove(alone.asset.id, at(65))).toEqual({ status: "in_draft" });
    // An image an instance chooses that is not in the library is a warning about the instance, and is left out of what is published.
    const missing = page([hero(), instance("i2", { "foto-img": { assetId: "gone" } })], firstId);
    const asked = await saveAndPublish(missing, 66);
    expect(asked.status).toBe("warnings");
    if (asked.status === "warnings") expect(asked.issues.map((issue) => issue.blockId)).toEqual(["i2"]);
    const anyway = await saveAndPublish(missing, 68, "owner-a", "org-a", true);
    expect(anyway.status).toBe("published");
    expect(Object.keys((await publishedSiteBySlug(db, "marina-a"))!.images)).toEqual([firstId]);
  });
});

describe("images used by the other pages of the site", () => {
  const pageWith = (home: SiteContent["blocks"], onPage: SiteContent["blocks"]): SiteContent => ({
    ...withImage("", { blocks: home }),
    pages: [{ id: "p1", slug: "sobre", title: "Sobre", description: "", blocks: onPage }],
  });
  const hero = () => withImage("").blocks[0];
  const imageBlock = (id: string, assetId: string) => ({ ...emptyBlock("image", id), assetId, alt: "Marina" }) as SiteContent["blocks"][number];

  it("counts an image of another page as used by the site, keeps it in the library while the draft uses it, and serves it from the published version", async () => {
    const stored = await assets().add(png([chunk("tEXt", [...text("only-on-the-page")])]), at(70));
    if (stored.status !== "stored") throw new Error(JSON.stringify(stored));
    const onPage = stored.asset.id;
    const content = pageWith([hero()], [imageBlock("p-img", onPage)]);
    expect(referencedAssetIds(content)).toEqual([onPage]);
    const overview = (await sites().overview())!;
    const saved = await sites().saveDraft(content, overview.draft.revision, at(71));
    if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
    // Nothing on the home page uses it, and still it is not for removal: the draft's page does.
    expect(await assets().remove(onPage, at(72))).toEqual({ status: "in_draft" });
    const outcome = await sites().publish(saved.revision, at(73));
    expect(outcome.status).toBe("published");
    const published = (await publishedSiteBySlug(db, "marina-a"))!;
    expect(Object.keys(published.images)).toEqual([onPage]);
    expect(published.content.pages![0].blocks[0]).toMatchObject({ id: "p-img", assetId: onPage });
    const served = await publishedAssetBySlug(db, bucket, "marina-a", onPage);
    expect(served).not.toBeNull();
    await served!.body.cancel();
  });
  it("warns, about the page, of an image that is not in the library, and leaves it out of the site when published anyway", async () => {
    const content = pageWith([hero()], [imageBlock("p-img", "gone")]);
    const overview = (await sites().overview())!;
    const saved = await sites().saveDraft(content, overview.draft.revision, at(74));
    if (saved.status !== "saved") throw new Error(JSON.stringify(saved));
    const asked = await sites().publish(saved.revision, at(75));
    expect(asked.status).toBe("warnings");
    if (asked.status === "warnings") expect(asked.issues.map((issue) => [issue.page, issue.blockId])).toEqual([["p1", "p-img"]]);
    expect((await sites().publish(saved.revision, at(76), { withWarnings: true })).status).toBe("published");
    expect(Object.keys((await publishedSiteBySlug(db, "marina-a"))!.images)).toEqual([]);
  });
});
