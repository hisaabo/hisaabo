// Run with: pnpm --filter @hisaabo/cli test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// `hisaabo einvoice cancel` cancels the IRN and the invoice (0.10.1). The prompt, the
// success line and the help text must all say so.
const command = readFileSync(new URL("../src/commands/einvoice/index.ts", import.meta.url), "utf8");
const registrar = readFileSync(new URL("../src/bin/registrars/einvoice.ts", import.meta.url), "utf8");

test("the confirmation prompt says the invoice is cancelled too and a new one may be needed", () => {
  const prompt = command.slice(command.indexOf("export async function eInvoiceCancelCommand"));
  assert.match(prompt, /This also cancels the invoice/);
  assert.match(prompt, /stock and returns are adjusted/);
  assert.match(prompt, /issue a new invoice/);
});

test("the success line says the invoice was cancelled with the e-invoice", () => {
  assert.match(command, /cancelled, and the invoice with it/);
});

test("the help text says the invoice is cancelled too", () => {
  assert.match(registrar, /Cancel an e-invoice \(IRN\) and its invoice/);
});
