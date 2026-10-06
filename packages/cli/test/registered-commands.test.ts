// Run with: node --experimental-strip-types --test packages/cli/test/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const registrarSource = walk(join(SRC, "bin"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/** Exported `...Command` functions of a commands/ file (barrel re-exports excluded). */
function exportedCommands(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+Command)\b/gm)].map((m) => m[1]!);
}

test("every exported command function in src/commands is wired into a registrar", () => {
  const missing: string[] = [];
  for (const file of walk(join(SRC, "commands"))) {
    for (const name of exportedCommands(file)) {
      if (!new RegExp(`\\b${name}\\b`).test(registrarSource)) {
        missing.push(`${relative(SRC, file)}: ${name}`);
      }
    }
  }
  assert.deepEqual(missing, [], `unregistered commands (add them to src/bin/registrars/**):\n${missing.join("\n")}`);
});

test("every commands/ file is referenced by a registrar or another commands/ file", () => {
  const files = walk(join(SRC, "commands"));
  const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  const unreferenced: string[] = [];
  for (const file of files) {
    const rel = relative(join(SRC, "commands"), file).replace(/\.ts$/, "");
    const base = rel.split("/").pop()!;
    const re = new RegExp(`commands/${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.js`);
    if (re.test(registrarSource)) continue;
    // referenced from a sibling (e.g. an index.ts barrel) that is itself reachable
    const sibling = [...sources].some(
      ([f, s]) => f !== file && new RegExp(`from\\s+["']\\./${base}\\.js["']`).test(s) && f.startsWith(file.slice(0, file.lastIndexOf("/"))),
    );
    if (!sibling) unreferenced.push(rel);
  }
  assert.deepEqual(unreferenced, [], `commands files not referenced by any registrar:\n${unreferenced.join("\n")}`);
});
