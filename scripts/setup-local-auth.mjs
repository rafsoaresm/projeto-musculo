import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Local-only credentials. Never print secrets or replace existing configuration.
let secret = randomBytes(48).toString("base64url");
for (const file of [".dev.vars", ".env.local"]) {
  try {
    const content = await readFile(file, "utf8");
    const existing = content.match(/^AUTH_SECRET=(.+)$/m);
    if (existing) secret = existing[1];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
for (const [file, origin] of [
  [".dev.vars", "http://127.0.0.1:8787"],
  [".env.local", "http://127.0.0.1:3000"],
]) {
  try {
    await writeFile(
      file,
      `# LOCAL ONLY. Configure independent secrets in Webflow.\nAUTH_SECRET=${secret}\nAUTH_ORIGIN=${origin}\n`,
      { flag: "wx", mode: 0o600 },
    );
    console.log(`Created ${file} (local only; value hidden).`);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    console.log(`Preserved ${file}.`);
  }
}
