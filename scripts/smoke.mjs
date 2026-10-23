import assert from "node:assert/strict";

const origin = process.env.SMOKE_ORIGIN || "http://127.0.0.1:3000";
const mount = (process.env.BASE_URL || "").replace(/\/$/, "");
for (const [path, expected] of [
  ["/", "Um método. Todo o percurso."],
  ["/entrar", "Bom ter você de volta."],
  ["/projeto", "O produto, por inteiro."],
  // Each private area answers an anonymous visitor with the sign-in page.
  ["/gestor", "Bom ter você de volta."],
  ["/profissional", "Bom ter você de volta."],
  ["/aluno", "Bom ter você de volta."],
  ["/alunos", "Bom ter você de volta."],
]) {
  const response = await fetch(`${origin}${mount}${path}`);
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.ok(html.includes(expected), `Expected content on ${path}`);
  assert.ok(html.includes('lang="pt-BR"'));
  for (const match of html.matchAll(
    /(?:src|href)="([^" ]*\/_next\/[^" ]+)"/g,
  )) {
    const asset = new URL(match[1].replaceAll("&amp;", "&"), origin);
    assert.equal(
      (await fetch(asset)).status,
      200,
      `Missing asset: ${asset.pathname}`,
    );
  }
  console.log(`PASS ${mount}${path}: HTML and assets`);
}
const health = await fetch(`${origin}${mount}/api/health`);
assert.equal(health.status, 200);
assert.equal(health.headers.get("cache-control"), "no-store");
const status = await health.json();
assert.equal(status.capabilities.periodization, "available");
assert.equal(status.capabilities.persistence, "available");
assert.equal(status.capabilities.storage, "webflow_sqlite");
assert.equal((await fetch(`${origin}${mount}/pagina-inexistente`)).status, 404);
console.log("PASS health and 404");
