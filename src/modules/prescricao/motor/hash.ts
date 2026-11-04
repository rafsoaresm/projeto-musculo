import { cmp } from "./vocabulary";
import type { EngineInput } from "./types";

/** JSON canônico: chaves ordenadas por ponto de código, `undefined` omitido. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => cmp(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  return JSON.stringify(value);
}

/**
 * Entrada canônica: listas que são conjuntos (catálogo, histórico, linhas existentes, travas) em
 * ordem estável, para que a mesma informação em outra ordem gere o mesmo texto e o mesmo hash.
 */
export function canonicalInput(input: EngineInput): string {
  return canonicalJson({
    ...input,
    catalog: [...input.catalog].sort((a, b) => cmp(a.id, b.id)),
    history: [...input.history].sort(
      (a, b) => cmp(a.exerciseId, b.exerciseId) || cmp(a.date, b.date) || cmp(a.ref ?? "", b.ref ?? "") || cmp(canonicalJson(a), canonicalJson(b)),
    ),
    existing: [...input.existing].sort((a, b) => cmp(a.prescribedExerciseId, b.prescribedExerciseId)),
    locked: [...input.locked].sort((a, b) => a.phaseIndex - b.phaseIndex || cmp(a.slotKey, b.slotKey)),
  });
}

/** Texto canônico de um pedido (para request_hash na idempotência). */
export function canonicalRequest(kind: string, payload: unknown): string {
  return canonicalJson({ kind, payload });
}

/** SHA-256 em hexadecimal (Web Crypto: existe em Workers e no Node). Assíncrono: fica com o chamador. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
