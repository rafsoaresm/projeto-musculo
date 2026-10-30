import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "next-env.d.ts",
    "coverage/**",
    // The compiled editor of Frappe Builder and the files kept beside it are not ours to lint (MIT, see vendor/frappe-builder).
    "public/frappe-editor/**",
    "vendor/**",
    // A local harness that stands in for a Frappe server.
    "scripts/frappe-editor-spike/**",
  ]),
]);
