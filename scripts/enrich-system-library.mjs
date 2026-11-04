// Generates migrations/0045_exercise_metadata_inferred_seed.sql from the library inference rules
// (motor S4, decision Q3 of 04/11/2026). The rules are data (src/modules/biblioteca/metadata/inference-rules.json);
// the inference itself is src/modules/biblioteca/metadata/inference-core.ts, the same code the app runs for
// "Inferir metadados das minhas fichas". That file has no imports, so Node runs it with type stripping:
//   node --experimental-strip-types scripts/enrich-system-library.mjs          (writes the migration)
//   node --experimental-strip-types scripts/enrich-system-library.mjs --check  (fails if the file differs)
// On Node >= 22.18 the flag is already the default and only prints a notice. A test (tests/exercise-metadata-inference.test.ts)
// renders the same file in Vitest and compares it byte for byte, so a rules change without regenerating fails `npm run check`.
import { readFile, writeFile } from "node:fs/promises";
import { parseSystemSeed, renderSeedSql } from "../src/modules/biblioteca/metadata/inference-core.ts";

const root = new URL("../", import.meta.url);
const STEM = "0045_exercise_metadata_inferred_seed";
// Fixed stamp: the generated file must not depend on when it was generated.
const STAMP = "2026-11-04T00:00:00.000Z";

const rules = JSON.parse(await readFile(new URL("src/modules/biblioteca/metadata/inference-rules.json", root), "utf8"));
const seed = parseSystemSeed(await readFile(new URL("migrations/0005_exercise_library.sql", root), "utf8"));
if (seed.length !== 64) throw new Error(`expected the 64 system exercises of 0005, found ${seed.length}`);
const sql = renderSeedSql(rules, seed, STEM, STAMP);
const target = new URL(`migrations/${STEM}.sql`, root);

if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== sql) {
    console.error(`${STEM}.sql is out of date: run node --experimental-strip-types scripts/enrich-system-library.mjs`);
    process.exit(1);
  }
  console.log(`${STEM}.sql is up to date.`);
} else {
  await writeFile(target, sql);
  console.log(`wrote migrations/${STEM}.sql`);
}
