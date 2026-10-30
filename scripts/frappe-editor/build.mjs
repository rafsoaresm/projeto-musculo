#!/usr/bin/env node
/**
 * Builds the editor of Frappe Builder (MIT, see vendor/frappe-builder/LICENSE) so that this app can serve it:
 *   node scripts/frappe-editor/build.mjs
 *
 * What it does, in order: gets the two repositories at the commits pinned below (reusing a checkout that is already there), applies the
 * patches of vendor/frappe-builder/patches (skipping the ones already applied), installs the packages, compiles the editor with a base that
 * does not name a mount path, copies the files to public/frappe-editor and writes the page that loads them
 * (src/modules/frappe-editor/shell.generated.ts). Both outputs are committed: the Webflow Cloud build only clones this repository, so it
 * cannot compile the editor itself.
 *
 * Where the checkouts live: FRAPPE_EDITOR_WORK (default: ../frappe-editor-src next to this repository). `builder` and `frappe` must be
 * siblings, because the editor links ../../frappe/ui. Needs network the first time (git and the package registry).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFonts } from "./fonts.mjs";
import { writeResetCss } from "./reset-css.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PINS = {
  builder: { url: "https://github.com/rafsoaresm/builder.git", commit: "43388886422dfb2e0a95b9de151736be208dab75" },
  frappe: { url: "https://github.com/frappe/frappe.git", commit: "5a8bfd7067a1bffe58666698a34edd81332d11ae" },
};
const WORK = path.resolve(process.env.FRAPPE_EDITOR_WORK || path.join(ROOT, "..", "frappe-editor-src"));
const OUT = path.join(ROOT, "public", "frappe-editor");
const SHELL_TS = path.join(ROOT, "src", "modules", "frappe-editor", "shell.generated.ts");

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: "inherit", ...options });
const out = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", ...options }).trim();

function checkout(name, sparse) {
  const dir = path.join(WORK, name);
  const { url, commit } = PINS[name];
  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(WORK, { recursive: true });
    run("git", ["clone", "--filter=blob:none", ...(sparse ? ["--sparse"] : []), url, dir]);
  }
  if (sparse) run("git", ["sparse-checkout", "set", sparse], { cwd: dir });
  if (out("git", ["rev-parse", "HEAD"], { cwd: dir }) !== commit) {
    run("git", ["fetch", "--depth", "1", "origin", commit], { cwd: dir });
    run("git", ["checkout", "--force", commit], { cwd: dir });
  }
  return dir;
}

function applyPatches(builderDir) {
  const dir = path.join(ROOT, "vendor", "frappe-builder", "patches");
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".patch")).sort()) {
    const patch = path.join(dir, file);
    const tries = (extra) => {
      try {
        execFileSync("git", ["apply", ...extra, "--check", patch], { cwd: builderDir, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    if (tries([])) {
      run("git", ["apply", patch], { cwd: builderDir });
      console.log(`patch applied: ${file}`);
    } else if (tries(["--reverse"])) {
      console.log(`patch already applied: ${file}`);
    } else {
      throw new Error(`the patch ${file} fits neither the clean nor the patched checkout of the editor`);
    }
  }
}

/** The page that loads the editor: the files are named by a script that works out the mount path from the address, so no path is fixed in them. */
function shellFrom(html, fonts) {
  const entry = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+)"/)?.[1];
  const styles = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((match) => match[1]);
  const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((match) => match[1]);
  if (!entry || styles.length === 0) throw new Error("the page of the editor has no entry script or no style sheet");
  return `<!DOCTYPE html>
<html lang="pt-BR" class="overscroll-none">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>Editor do site</title>
<script>
(function () {
  // The editor lives under <mount>/profissional/meu-site/editor; whatever is before that is where the app is mounted.
  var marker = "/profissional/meu-site/editor";
  var at = location.pathname.indexOf(marker);
  var mount = at > 0 ? location.pathname.slice(0, at) : "";
  var files = mount + "/frappe-editor/";
  window.builder_path = mount + marker;
  window.__EDITOR_API__ = mount + "/api/builder-editor";
  window.__EDITOR_FILES__ = files;
  // The page of the site, published from here, is at <mount>/site/<address> (the address is written in by the route that serves this page).
  window.__EDITOR_SITE_URL__ = window.__EDITOR_SITE__ ? mount + "/site/" + window.__EDITOR_SITE__ : "";
  window.csrf_token = "";
  window.site_name = location.hostname;
  window.builder_version = "embedded";
  window.is_fc_site = "False";
  window.is_developer_mode = "False";
  window.is_read_only_mode = "False";
  window.translated_messages = {};
  var head = document.head;
  // The fonts the app ships, offered by the editor's font picker (and drawn from the files of the app, never from a third party).
  window.__EDITOR_FONTS__ = ${JSON.stringify(fonts.map(({ family, variants }) => ({ family, variants })))};
  var faces = ${JSON.stringify(fonts.flatMap(({ family, faces }) => faces.map((face) => ({ family, ...face }))))};
  var fontStyle = document.createElement("style");
  fontStyle.textContent = faces.map(function (face) {
    return '@font-face{font-family:"' + face.family + '";font-style:' + face.style + ';font-weight:' + face.weight + ';font-display:swap;src:url("' + files + "fonts/" + face.file + '") format("woff2")}';
  }).join("");
  head.appendChild(fontStyle);
  ${JSON.stringify(styles)}.forEach(function (href) {
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = files + href;
    head.appendChild(link);
  });
  ${JSON.stringify(preloads)}.forEach(function (href) {
    var link = document.createElement("link");
    link.rel = "modulepreload";
    link.href = files + href;
    head.appendChild(link);
  });
  var script = document.createElement("script");
  script.type = "module";
  script.src = files + ${JSON.stringify(entry)};
  head.appendChild(script);
})();
</script>
</head>
<body class="overscroll-none bg-surface-base no-scrollbar selection:bg-gray-500/30" style="scrollbar-width: auto;">
<div id="app"></div>
<div id="popovers"></div>
</body>
</html>
`;
}

/**
 * The editor names a few files by the address they have on a Frappe site (`/assets/builder/images/...`), which under another mount is
 * not where they are. In the style sheets they become paths relative to the sheet; in the scripts, an address worked out when the page
 * loads (`window.__EDITOR_FILES__`, set by the page that loads the editor). Anything of that kind left over stops the build, so a new
 * one in a later version of the editor is noticed here and not by a person looking at a broken picture.
 */
function relocateFixedAddresses(dir) {
  const FILES = "window.__EDITOR_FILES__";
  for (const file of fs.readdirSync(dir)) {
    const target = path.join(dir, file);
    if (file.endsWith(".css")) {
      const css = fs.readFileSync(target, "utf8").replace(/url\((["']?)\/assets\/builder\/(fonts|images)\//g, "url($1../$2/");
      fs.writeFileSync(target, css);
    } else if (file.endsWith(".js")) {
      const js = fs
        .readFileSync(target, "utf8")
        // `/assets/builder/images/x.png` as a value
        .replace(/`\/assets\/builder\/(images|fonts)\/([A-Za-z0-9_.\-/]+)`/g, "(" + FILES + "+`$1/$2`)")
        // `url(/assets/builder/images/x.png) center / contain`
        .replace(/`url\(\/assets\/builder\/(images|fonts)\/([A-Za-z0-9_.\-/]+)\)([^`$]*)`/g, "(`url(`+" + FILES + "+`$1/$2)$3`)")
        // `this.src='/assets/builder/images/x.png'` in an attribute
        .replace(/`this\.src='\/assets\/builder\/(images|fonts)\/([A-Za-z0-9_.\-/]+)'`/g, "(`this.src='`+" + FILES + "+`$1/$2'`)");
      fs.writeFileSync(target, js);
    }
  }
  const left = fs
    .readdirSync(dir)
    .filter((file) => /\.(js|css)$/.test(file) && fs.readFileSync(path.join(dir, file), "utf8").includes("/assets/builder/"));
  if (left.length > 0) throw new Error(`an address of a Frappe site is left in: ${left.join(", ")}`);
}

const builderDir = checkout("builder");
checkout("frappe", "ui");
applyPatches(builderDir);

const env = { ...process.env, CYPRESS_INSTALL_BINARY: "0", NODE_OPTIONS: "--max-old-space-size=6144" };
run("yarn", ["install", "--ignore-engines"], { cwd: path.join(WORK, "frappe", "ui"), env });
run("yarn", ["install", "--ignore-engines"], { cwd: path.join(builderDir, "frontend"), env });

const dist = fs.mkdtempSync(path.join(os.tmpdir(), "frappe-editor-"));
const shell = path.join(dist, "..", `${path.basename(dist)}-shell.html`);
run("npx", ["vite", "build"], {
  cwd: path.join(builderDir, "frontend"),
  env: { ...env, FRAPPE_EDITOR_OUT: dist, FRAPPE_EDITOR_BASE: "./", FRAPPE_EDITOR_SHELL: shell, FRAPPE_EDITOR_NO_HOST: "1" },
});

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(dist, "assets"), path.join(OUT, "assets"), { recursive: true });
// What the editor takes from its public folder (the logos), and the fonts and images it names by a fixed address of a Frappe site.
for (const file of fs.readdirSync(dist)) if (file !== "assets" && file !== "index.html") fs.cpSync(path.join(dist, file), path.join(OUT, file), { recursive: true });
for (const folder of ["fonts", "images"]) fs.cpSync(path.join(builderDir, "builder", "public", folder), path.join(OUT, folder), { recursive: true });
relocateFixedAddresses(path.join(OUT, "assets"));
const { catalog: fonts } = writeFonts();
fs.mkdirSync(path.dirname(SHELL_TS), { recursive: true });
fs.writeFileSync(
  SHELL_TS,
  `// Written by scripts/frappe-editor/build.mjs; do not edit.\n/** The page that loads the compiled editor of Frappe Builder (public/frappe-editor). */\nexport const EDITOR_SHELL = ${JSON.stringify(shellFrom(fs.readFileSync(shell, "utf8"), fonts))};\n`,
);
fs.rmSync(dist, { recursive: true, force: true });
fs.rmSync(shell, { force: true });
console.log(`done: ${path.relative(ROOT, OUT)}, ${path.relative(ROOT, SHELL_TS)} and ${writeResetCss(builderDir)}`);
