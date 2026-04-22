#!/usr/bin/env node
// Fails CI if any production dependency ships under a denied license.
// Reads `pnpm licenses list --prod --json` and evaluates SPDX expressions:
//   - "A OR B" passes if any alternative is acceptable.
//   - "A AND B" passes only if every part is acceptable.
// Allowlisted packages can bypass a specific SPDX id when review has cleared them.

import { execFileSync } from "node:child_process";

const DENIED = new Set([
  "AGPL-1.0",
  "AGPL-1.0-only",
  "AGPL-1.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "SSPL-1.0",
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "BUSL-1.1",
  "CPAL-1.0",
  "EUPL-1.1",
  "EUPL-1.2",
  "OSL-3.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "CC-BY-SA-4.0",
]);

// Packages that have been reviewed and approved despite denied SPDX ids.
// Keep this list small and add a link to the review/justification.
const ALLOWLIST = new Set([
  // name@version — reason
]);

function parseExpression(expr) {
  // Returns a nested tree: {op: 'OR'|'AND'|'LICENSE', value}
  const tokens = tokenize(expr);
  const { node } = parseOr(tokens, 0);
  return node;
}

function tokenize(expr) {
  const out = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === "(" || c === ")") { out.push(c); i++; continue; }
    let j = i;
    while (j < expr.length && !" \t()".includes(expr[j])) j++;
    const word = expr.slice(i, j);
    if (/^OR$/i.test(word)) out.push("OR");
    else if (/^AND$/i.test(word)) out.push("AND");
    else if (/^WITH$/i.test(word)) out.push("WITH");
    else out.push({ lic: word });
    i = j;
  }
  return out;
}

function parseOr(tokens, pos) {
  let { node, pos: next } = parseAnd(tokens, pos);
  const parts = [node];
  while (next < tokens.length && tokens[next] === "OR") {
    const r = parseAnd(tokens, next + 1);
    parts.push(r.node);
    next = r.pos;
  }
  return { node: parts.length === 1 ? node : { op: "OR", parts }, pos: next };
}

function parseAnd(tokens, pos) {
  let { node, pos: next } = parseAtom(tokens, pos);
  const parts = [node];
  while (next < tokens.length && tokens[next] === "AND") {
    const r = parseAtom(tokens, next + 1);
    parts.push(r.node);
    next = r.pos;
  }
  return { node: parts.length === 1 ? node : { op: "AND", parts }, pos: next };
}

function parseAtom(tokens, pos) {
  const tok = tokens[pos];
  if (tok === "(") {
    const r = parseOr(tokens, pos + 1);
    if (tokens[r.pos] !== ")") throw new Error(`expected ) in expression`);
    return { node: r.node, pos: r.pos + 1 };
  }
  if (tok && typeof tok === "object" && tok.lic) {
    // Handle "GPL-2.0 WITH Classpath-exception-2.0" — treat as the base license.
    let next = pos + 1;
    if (tokens[next] === "WITH" && tokens[next + 1] && tokens[next + 1].lic) {
      next += 2;
    }
    return { node: { op: "LICENSE", value: tok.lic }, pos: next };
  }
  throw new Error(`unexpected token at pos ${pos}: ${JSON.stringify(tok)}`);
}

function evaluate(node) {
  if (node.op === "LICENSE") return !DENIED.has(node.value);
  if (node.op === "OR") return node.parts.some(evaluate);
  if (node.op === "AND") return node.parts.every(evaluate);
  throw new Error(`unknown node ${node.op}`);
}

function licenseIsAcceptable(raw) {
  if (!raw || raw === "UNKNOWN" || raw === "Unknown") return false;
  try {
    const tree = parseExpression(raw);
    return evaluate(tree);
  } catch {
    // If we can't parse, be conservative and reject.
    return false;
  }
}

function main() {
  let raw;
  try {
    raw = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    console.error("Failed to run `pnpm licenses list`:", err.message);
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse pnpm licenses JSON:", err.message);
    process.exit(2);
  }

  const violations = [];
  const unknowns = [];
  let total = 0;

  for (const [license, pkgs] of Object.entries(data)) {
    for (const pkg of pkgs) {
      total++;
      const versions = (pkg.versions || []).join(",");
      const id = `${pkg.name}@${versions}`;
      if (ALLOWLIST.has(id)) continue;
      if (license === "UNKNOWN" || license === "Unknown" || !license) {
        unknowns.push({ id, license });
        continue;
      }
      if (!licenseIsAcceptable(license)) {
        violations.push({ id, license });
      }
    }
  }

  console.log(`Scanned ${total} production packages.`);

  if (unknowns.length > 0) {
    console.error(`\nUnknown/missing license (${unknowns.length}):`);
    for (const u of unknowns) console.error(`  - ${u.id}  [${u.license || "none"}]`);
  }

  if (violations.length > 0) {
    console.error(`\nDenied licenses (${violations.length}):`);
    for (const v of violations) console.error(`  - ${v.id}  [${v.license}]`);
    console.error(
      "\nIf a package has been reviewed and approved, add it to ALLOWLIST in scripts/license-check.mjs with a justification.",
    );
  }

  if (violations.length > 0 || unknowns.length > 0) {
    process.exit(1);
  }

  console.log("No denied or unknown licenses in production dependencies.");
}

main();
