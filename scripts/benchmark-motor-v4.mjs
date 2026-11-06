#!/usr/bin/env node
/**
 * Motor V4, PR 5.2: roda a matriz de regressão e a medição do caso grande e imprime a tabela em Markdown (a que vai para `docs/VALIDACAO.md`).
 *
 * Uso: `node scripts/benchmark-motor-v4.mjs [--runs N] [--out arquivo.md]`
 *
 * Por baixo é o vitest (`tests/benchmark-matrix.test.ts`), porque a cadeia é TypeScript: o script só define o ambiente (`--expose-gc` para
 * medir o heap, N execuções do caso grande, arquivo de saída) e imprime o que o teste gravou. Local, Node: NÃO é Workers, D1 remoto nem
 * provedor real. As afirmações duras do teste (elegibilidade, determinismo, aderência) valem também aqui: o código de saída é o do vitest.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const runs = Number(flag("--runs") ?? 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 25) {
  console.error("--runs deve ser um inteiro de 1 a 25");
  process.exit(2);
}
const out = flag("--out") ?? join(mkdtempSync(join(tmpdir(), "motor-bench-")), "matriz.md");

const run = spawnSync("npx", ["vitest", "run", "tests/benchmark-matrix.test.ts"], {
  stdio: ["ignore", "inherit", "inherit"],
  env: { ...process.env, MOTOR_BENCH_RUNS: String(runs), MOTOR_BENCH_OUT: out, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --expose-gc`.trim() },
});
if (run.status !== 0) process.exit(run.status ?? 1);
process.stdout.write(`\n${readFileSync(out, "utf8")}\n(arquivo: ${out})\n`);
