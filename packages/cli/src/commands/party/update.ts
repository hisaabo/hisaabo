import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";

interface UpdateOpts {
  name?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  type?: string;
  billingAddress?: string;
  city?: string;
  state?: string;
  pincode?: string;
  category?: string;
  creditPeriod?: string;
  creditLimit?: string;
  json?: boolean;
}

export async function partyUpdateCommand(id: string, opts: UpdateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // Only send fields that were explicitly provided
  const data: Record<string, unknown> = {};
  if (opts.name !== undefined) data["name"] = opts.name;
  if (opts.phone !== undefined) data["phone"] = opts.phone;
  if (opts.email !== undefined) data["email"] = opts.email;
  if (opts.gstin !== undefined) data["gstin"] = opts.gstin;
  if (opts.type !== undefined) data["type"] = opts.type;
  if (opts.billingAddress !== undefined) data["billingAddress"] = opts.billingAddress;
  if (opts.city !== undefined) data["city"] = opts.city;
  if (opts.state !== undefined) data["state"] = opts.state;
  if (opts.pincode !== undefined) data["pincode"] = opts.pincode;
  if (opts.category !== undefined) data["category"] = opts.category;
  if (opts.creditPeriod !== undefined) data["creditPeriod"] = parseInt(opts.creditPeriod, 10);
  if (opts.creditLimit !== undefined) data["creditLimit"] = opts.creditLimit;

  if (Object.keys(data).length === 0) {
    fatalError("No fields to update. Provide at least one option.", EXIT.USAGE);
  }

  try {
    const result = await client.party.update(id, data as Parameters<typeof client.party.update>[1]);

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Updated party: ${result.name}`);
    console.log(`  ID: ${result.id}\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Party not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
