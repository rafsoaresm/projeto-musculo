import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Local-only credentials. Never print secrets or replace existing values.
// Missing keys are appended to existing files, so older setups keep working.
const files = [
  [".dev.vars", "http://127.0.0.1:8787"],
  [".env.local", "http://127.0.0.1:3000"],
];
const generated = {
  AUTH_SECRET: () => randomBytes(48).toString("base64url"),
  PLATFORM_SETUP_TOKEN: () => randomBytes(48).toString("base64url"),
};
// EMAIL_TRANSPORT=capture keeps the text of e-mail in the local database for the browser tests; the
// application only honours it on localhost or 127.0.0.1.
// PUBLIC_FORMS_ENABLED and PRIVACY_NOTICE_URL open the contact form of the public pages, for the local browser tests only: the committed config and
// the production environment do not have them, so there the form stays closed until the platform opens it on purpose (see PENDENCIAS, J8 and J12).
const fixed = {
  DEMO_MODE: "true",
  EMAIL_TRANSPORT: "capture",
  PUBLIC_FORMS_ENABLED: "true",
  PRIVACY_NOTICE_URL: "http://127.0.0.1:8787/aviso-de-privacidade-de-teste",
};

async function read(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}
const value = (content, key) => content?.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1];

// Reuse a value already present in any local file so both runtimes agree.
const shared = {};
for (const key of Object.keys(generated)) {
  for (const [file] of files) {
    shared[key] ??= value(await read(file), key);
  }
  shared[key] ??= generated[key]();
}

for (const [file, origin] of files) {
  const current = await read(file);
  const wanted = { ...shared, AUTH_ORIGIN: origin, ...fixed };
  if (current === null) {
    const body = Object.entries(wanted)
      .map(([key, val]) => `${key}=${val}`)
      .join("\n");
    await writeFile(
      file,
      `# LOCAL ONLY. Configure independent secrets in Webflow.\n${body}\n`,
      { flag: "wx", mode: 0o600 },
    );
    console.log(`Created ${file} (local only; values hidden).`);
    continue;
  }
  const missing = Object.entries(wanted).filter(
    ([key]) => value(current, key) === undefined,
  );
  if (missing.length === 0) {
    console.log(`Preserved ${file}.`);
    continue;
  }
  const suffix = missing.map(([key, val]) => `${key}=${val}`).join("\n");
  await writeFile(
    file,
    `${current.endsWith("\n") ? current : `${current}\n`}${suffix}\n`,
    { mode: 0o600 },
  );
  console.log(
    `Updated ${file}: added ${missing.map(([key]) => key).join(", ")} (values hidden).`,
  );
}
