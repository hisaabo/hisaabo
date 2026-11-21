// Resolve a party from a `--party <name>` flag. Pure (no runtime imports) so it stays
// testable with `node --experimental-strip-types`; callers map the result onto
// fatalError()/exit codes.

export interface PartyRef {
  id: string;
  name: string;
}

/** The slice of `HisaaboClient["party"]` this helper needs (the `party.list` tRPC query). */
export interface PartyLookupClient {
  party: {
    list(input: { search: string; limit: number; page: number }): Promise<{ data: PartyRef[]; total: number }>;
  };
}

export type PartyResolution =
  | { ok: true; party: PartyRef }
  | { ok: false; reason: "usage" | "not_found"; message: string };

/** `party.list` caps `limit` at 100 (see paginationSchema). */
const PAGE_SIZE = 100;
/** Candidates shown in the ambiguity error before collapsing to "and N more". */
const MAX_LISTED = 10;

const norm = (s: string) => s.trim().toLowerCase();

/** `--party-id` and `--party` are alternatives; returns the usage error message, or null when fine. */
export function partyOptionError(opts: { partyId?: string; party?: string }): string | null {
  if (opts.partyId !== undefined && opts.party !== undefined) {
    return "--party-id and --party are mutually exclusive; pass only one";
  }
  if (opts.party !== undefined && norm(opts.party) === "") {
    return "--party must not be empty";
  }
  return null;
}

/**
 * Find the one party whose name equals `name` (trimmed, case-insensitive). `party.list` does a
 * substring search on name or phone, so the exact match is picked out of its results (all pages:
 * a short name such as "Raj" can be a substring of more than one page of parties).
 */
export async function resolvePartyByName(client: PartyLookupClient, name: string): Promise<PartyResolution> {
  const wanted = norm(name);
  if (wanted === "") return { ok: false, reason: "usage", message: "--party must not be empty" };

  const matches: PartyRef[] = [];
  let seen = 0;
  for (let page = 1; ; page++) {
    const res = await client.party.list({ search: name.trim(), limit: PAGE_SIZE, page });
    for (const p of res.data) if (norm(p.name) === wanted) matches.push({ id: p.id, name: p.name });
    seen += res.data.length;
    if (res.data.length < PAGE_SIZE || seen >= res.total) break;
  }

  if (matches.length === 1) return { ok: true, party: matches[0]! };
  if (matches.length === 0) {
    return {
      ok: false,
      reason: "not_found",
      message: `No party named "${name.trim()}". Check the spelling, or pass --party-id (find one with: hisaabo party list --search <text>)`,
    };
  }
  const listed = matches.slice(0, MAX_LISTED).map((p) => `  ${p.name}  ${p.id}`);
  if (matches.length > MAX_LISTED) listed.push(`  ...and ${matches.length - MAX_LISTED} more`);
  return {
    ok: false,
    reason: "usage",
    message: `${matches.length} parties are named "${name.trim()}"; pass --party-id to choose one:\n${listed.join("\n")}`,
  };
}
