// Run with: node --experimental-strip-types --test packages/cli/test/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { partyOptionError, resolvePartyByName, type PartyLookupClient, type PartyRef } from "../src/resolve-party.ts";

const ACME: PartyRef = { id: "11111111-1111-4111-8111-111111111111", name: "Acme Traders" };
const ACME_CORP: PartyRef = { id: "22222222-2222-4222-8222-222222222222", name: "Acme Traders Corp" };

/** Fake `client.party.list` that mimics the API: substring name match, paged, `limit` max 100. */
function fakeClient(all: PartyRef[]) {
  const calls: Array<{ search: string; limit: number; page: number }> = [];
  const client: PartyLookupClient = {
    party: {
      async list(input) {
        calls.push(input);
        const hits = all.filter((p) => p.name.toLowerCase().includes(input.search.toLowerCase()));
        const start = (input.page - 1) * input.limit;
        return { data: hits.slice(start, start + input.limit), total: hits.length };
      },
    },
  };
  return { client, calls };
}

test("partyOptionError: --party-id and --party are mutually exclusive", () => {
  assert.match(partyOptionError({ partyId: ACME.id, party: "Acme" })!, /mutually exclusive/);
  assert.equal(partyOptionError({ partyId: ACME.id }), null);
  assert.equal(partyOptionError({ party: "Acme" }), null);
  assert.equal(partyOptionError({}), null);
});

test("partyOptionError: a blank --party is a usage error", () => {
  assert.match(partyOptionError({ party: "   " })!, /must not be empty/);
  assert.match(partyOptionError({ party: "" })!, /must not be empty/);
});

test("resolvePartyByName: exactly one exact match wins, even when the search also hits longer names", async () => {
  const { client, calls } = fakeClient([ACME_CORP, ACME]);
  const res = await resolvePartyByName(client, "Acme Traders");
  assert.deepEqual(res, { ok: true, party: ACME });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.search, "Acme Traders");
});

test("resolvePartyByName: match is case-insensitive and trimmed on both sides", async () => {
  const padded: PartyRef = { id: "33333333-3333-4333-8333-333333333333", name: "  Sharma Traders " };
  const { client, calls } = fakeClient([padded]);
  const res = await resolvePartyByName(client, "  sHaRmA tRaDeRs\t");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.party.id, padded.id);
  assert.equal(calls[0]!.search, "sHaRmA tRaDeRs", "the search sent to the API is trimmed");
});

test("resolvePartyByName: a partial name is not a match", async () => {
  const { client } = fakeClient([ACME_CORP]);
  const res = await resolvePartyByName(client, "Acme Traders");
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, "not_found");
    assert.match(res.message, /^No party named "Acme Traders"/);
  }
});

test("resolvePartyByName: no parties at all -> not_found", async () => {
  const { client } = fakeClient([]);
  const res = await resolvePartyByName(client, "  Nobody ");
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, "not_found");
    assert.match(res.message, /^No party named "Nobody"/);
  }
});

test("resolvePartyByName: several exact matches -> usage error listing name + id and pointing at --party-id", async () => {
  const twin: PartyRef = { id: "44444444-4444-4444-8444-444444444444", name: "acme traders" };
  const { client } = fakeClient([ACME, ACME_CORP, twin]);
  const res = await resolvePartyByName(client, "Acme Traders");
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, "usage");
    assert.match(res.message, /2 parties are named "Acme Traders"/);
    assert.ok(res.message.includes(`Acme Traders  ${ACME.id}`));
    assert.ok(res.message.includes(`acme traders  ${twin.id}`));
    assert.ok(!res.message.includes(ACME_CORP.id), "non-exact candidates are not listed");
    assert.match(res.message, /--party-id/);
  }
});

test("resolvePartyByName: a long candidate list is truncated", async () => {
  const dupes = Array.from({ length: 13 }, (_, i): PartyRef => ({ id: `id-${i}`, name: "Raj" }));
  const { client } = fakeClient(dupes);
  const res = await resolvePartyByName(client, "Raj");
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.match(res.message, /13 parties are named "Raj"/);
    assert.match(res.message, /\.\.\.and 3 more/);
    assert.ok(res.message.includes("id-9") && !res.message.includes("id-10"));
  }
});

test("resolvePartyByName: finds the exact match on a later page of substring hits", async () => {
  const many: PartyRef[] = Array.from({ length: 120 }, (_, i) => ({ id: `id-${i}`, name: `Raj ${String(i).padStart(3, "0")}` }));
  const target: PartyRef = { id: "55555555-5555-4555-8555-555555555555", name: "Raj" };
  const { client, calls } = fakeClient([...many, target]); // "Raj" is the 121st hit -> page 2
  const res = await resolvePartyByName(client, "Raj");
  assert.deepEqual(res, { ok: true, party: target });
  assert.deepEqual(calls.map((c) => [c.page, c.limit]), [[1, 100], [2, 100]]);
});

test("payment create wiring: both options documented, handler uses the shared resolver", () => {
  const registrar = readFileSync(new URL("../src/bin/registrars/payment.ts", import.meta.url), "utf8");
  const create = registrar.slice(registrar.indexOf('.command("create")'), registrar.indexOf('.command("delete <id>")'));
  assert.match(create, /\.option\("--party-id <id>", "[^"]*not with --party[^"]*"\)/);
  assert.match(create, /\.option\("--party <name>", "[^"]*exact match[^"]*not with --party-id[^"]*"\)/);
  assert.match(create, /party: opts\.party,/);

  const impl = readFileSync(new URL("../src/commands/payment/create.ts", import.meta.url), "utf8");
  assert.match(impl, /from "\.\.\/\.\.\/resolve-party\.js"/);
  assert.match(impl, /resolvePartyByName\(client, opts\.party\)/);
  assert.match(impl, /--party-id or --party is required/);
});
