import * as readline from "readline";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

interface CreateOpts {
  json?: boolean;
  type?: string;
  name?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  city?: string;
  category?: string;
  yes?: boolean;
}

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

export async function partyCreateCommand(opts: CreateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const isNonInteractive = !process.stdin.isTTY || opts.yes;

  let type = opts.type as "customer" | "supplier" | undefined;
  let name = opts.name;
  let phone = opts.phone;
  let email = opts.email;
  let gstin = opts.gstin;
  let city = opts.city;
  let category = opts.category;

  if (!isNonInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log("\n  New Party\n  " + "─".repeat(30) + "\n");

    if (!type) {
      const t = await prompt(rl, "  Type (customer/supplier) [customer]: ");
      type = (t.trim() || "customer") as "customer" | "supplier";
    }
    if (!name) {
      name = (await prompt(rl, "  Name: ")).trim();
    }
    if (!phone) {
      const p = await prompt(rl, "  Phone: ");
      phone = p.trim() || undefined;
    }
    if (!email) {
      const e = await prompt(rl, "  Email: ");
      email = e.trim() || undefined;
    }
    if (!gstin) {
      const g = await prompt(rl, "  GSTIN: ");
      gstin = g.trim() || undefined;
    }
    if (!city) {
      const c = await prompt(rl, "  City: ");
      city = c.trim() || undefined;
    }
    rl.close();
  }

  if (!name) fatalError("--name is required", EXIT.USAGE);
  if (!type) type = "customer";

  try {
    const party = await client.party.create({ type, name, phone, email, gstin, city, category });

    if (opts.json) {
      outputJSON(party);
      return;
    }

    success(`Created: ${party.name} (${party.type})`);
    console.log(`  ID: ${party.id}\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
