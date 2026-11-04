/**
 * Rows go to D1 as ONE bound JSON value per statement (`json_each`), never in the SQL text. Splits rows into JSON arrays of at
 * most `max` bytes each; a single bigger row goes alone. The default (256 KB) is the chunk size measured in motor S6 on local
 * workerd (docs/VALIDACAO.md): a technical figure, not a production one.
 */
export const JSON_CHUNK_BYTES = 256_000;

export function chunkJson(rows: unknown[], max = JSON_CHUNK_BYTES): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let size = 2;
  for (const row of rows) {
    const text = JSON.stringify(row);
    if (current.length && size + text.length + 1 > max) {
      out.push(`[${current.join(",")}]`);
      current = [];
      size = 2;
    }
    current.push(text);
    size += text.length + 1;
  }
  if (current.length) out.push(`[${current.join(",")}]`);
  return out;
}
