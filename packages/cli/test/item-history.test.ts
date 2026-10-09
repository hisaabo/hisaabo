// Run with: node --experimental-strip-types --test packages/cli/test/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parsePeriod } from "../src/commands/item/history-options.ts";

test("parsePeriod passes valid periods through and leaves undefined alone", () => {
  assert.equal(parsePeriod(undefined), undefined);
  for (const p of ["6m", "1y", "all"]) assert.equal(parsePeriod(p), p);
});

test("parsePeriod rejects unknown periods", () => {
  assert.throws(() => parsePeriod("3m"), /Invalid --period "3m"/);
});

test("item registrar wires the summary commands with period/unit options", () => {
  const src = readFileSync(new URL("../src/bin/registrars/item.ts", import.meta.url), "utf8");
  for (const cmd of ["price-summary <id>", "stock-summary <id>", "stock-movements <id>"]) {
    assert.ok(src.includes(`.command("${cmd}")`), `missing ${cmd}`);
  }
  assert.ok(src.includes('"--period <period>'));
  assert.ok(src.includes('"--unit <unit>'));
});
