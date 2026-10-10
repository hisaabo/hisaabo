#!/usr/bin/env node
// ─── Hisaabo version manifests ────────────────────────────────────────────
// Single list of every file that carries the app version, so the release
// bump, CI and the tag-triggered release workflow all agree on it.
//
//   node scripts/versions.mjs check            all manifests share one version
//   node scripts/versions.mjs check v1.2.3     ...and it equals this tag/version
//   node scripts/versions.mjs set 1.2.3        write 1.2.3 everywhere, print files
//
// The version is passed as argv and never spliced into code.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/;

// JSON manifests: [file, key path]
const JSON_FILES = [
  ["package.json", "version"],
  ["apps/api-docs/package.json", "version"],
  ["apps/docs/package.json", "version"],
  ["apps/mobile/package.json", "version"],
  ["apps/store/package.json", "version"],
  ["apps/web/package.json", "version"],
  ["packages/api/package.json", "version"],
  ["packages/cli/package.json", "version"],
  ["packages/db/package.json", "version"],
  ["packages/mcp/package.json", "version"],
  ["packages/shared/package.json", "version"],
  ["apps/mobile/app.json", "expo.version"],
  ["apps/desktop/src-tauri/tauri.conf.json", "version"],
];

// Desktop crate: `version` in Cargo.toml's [package] table and the matching
// entry in Cargo.lock (cargo rewrites the lock if they differ).
const CARGO_TOML = "apps/desktop/src-tauri/Cargo.toml";
const CARGO_LOCK = "apps/desktop/src-tauri/Cargo.lock";
const CARGO_TOML_RE = /^(\[package\][^[]*?\nversion = ")([^"]+)(")/m;

function cargoLockRe(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(\\[\\[package\\]\\]\\nname = "${escaped}"\\nversion = ")([^"]+)(")`, "m");
}

const read = (f) => readFileSync(resolve(ROOT, f), "utf8");
const write = (f, s) => writeFileSync(resolve(ROOT, f), s);

function cargoCrateName() {
  const m = read(CARGO_TOML).match(/^\[package\][^[]*?\nname = "([^"]+)"/m);
  if (!m) throw new Error(`${CARGO_TOML}: no [package] name`);
  return m[1];
}

function getJson(file, keyPath) {
  let v = JSON.parse(read(file));
  for (const k of keyPath.split(".")) v = v?.[k];
  return v;
}

function readAll() {
  const out = JSON_FILES.map(([f, k]) => [`${f} (${k})`, getJson(f, k)]);
  out.push([CARGO_TOML, read(CARGO_TOML).match(CARGO_TOML_RE)?.[2]]);
  out.push([CARGO_LOCK, read(CARGO_LOCK).match(cargoLockRe(cargoCrateName()))?.[2]]);
  return out;
}

function check(expectedRaw) {
  const expected = expectedRaw?.replace(/^v/, "");
  const all = readAll();
  const want = expected ?? all[0][1];
  const bad = all.filter(([, v]) => v !== want);
  if (bad.length) {
    console.error(
      expected
        ? `Version manifests do not match ${expectedRaw}:`
        : `Version manifests disagree (expected ${want}, from ${all[0][0]}):`,
    );
    for (const [f, v] of bad) console.error(`  ${f}: ${v ?? "<missing>"}`);
    console.error("Run `pnpm release <version>` to bump every manifest together.");
    process.exit(1);
  }
  console.log(`All ${all.length} version manifests are at ${want}.`);
}

function set(version) {
  if (!SEMVER.test(version ?? "")) {
    console.error("Version must be semver (e.g. 0.5.0 or 1.0.0-beta.1)");
    process.exit(1);
  }
  const changed = [];
  for (const [file, keyPath] of JSON_FILES) {
    const obj = JSON.parse(read(file));
    const keys = keyPath.split(".");
    const last = keys.pop();
    let target = obj;
    for (const k of keys) target = target[k];
    target[last] = version;
    write(file, JSON.stringify(obj, null, 2) + "\n");
    changed.push(file);
  }
  for (const [file, re] of [
    [CARGO_TOML, CARGO_TOML_RE],
    [CARGO_LOCK, cargoLockRe(cargoCrateName())],
  ]) {
    const src = read(file);
    if (!re.test(src)) throw new Error(`${file}: version entry not found`);
    write(file, src.replace(re, `$1${version}$3`));
    changed.push(file);
  }
  // File list on stdout (for `git add`), one per line.
  console.log(changed.join("\n"));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "check") check(arg);
else if (cmd === "set") set(arg);
else {
  console.error("Usage: versions.mjs check [version|tag] | set <version>");
  process.exit(1);
}
