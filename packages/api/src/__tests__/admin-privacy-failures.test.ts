/**
 * Masked dashboards must not leak what is inside per-tenant failure lists, and
 * the scrubbing rules for error / free text have to be precise: whole-token
 * matches, no collateral damage, and every shape of connection detail covered.
 *
 * R1: tenants[].metrics.ops.failures[] (the --json snapshot) is masked like the
 * platform-level failures[]. C1-C5: injected cases for the text rules.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { setColorEnabled } from "../lib/admin/tui.js";
import {
  collectPlatformStats, CONTROL_SQL, type SqlRunner, type DbTarget, type PlatformStats, type TenantWithMetrics,
} from "../lib/admin/stats.js";
import { buildDemoStats } from "../lib/admin/demo.js";
import { maskStats, maskTenant, maskConnectionInfo, maskErrorText, maskFreeText } from "../lib/admin/privacy.js";
import { QUEUE_PROBE_SQL } from "../lib/admin/queues.js";
import { DirectRunner } from "../lib/admin/runners.js";

beforeAll(() => setColorEnabled(false));

const NOW = new Date("2026-09-12T10:00:00Z");

// ── R1: per-tenant failure lists ────────────────────────────────

const SECRETS = {
  recurringRef: "Monthly retainer for Sharma Traders",
  bankRef: "HDFC_Aug2026.csv",
  email: "rahul.sharma@sharmatraders.in",
  phone: "9876543210",
  pan: "ABCDE1234F",
  gstin: "27AABCU9603R1ZM",
  ip: "10.9.8.7",
  token: "SECRET123",
  tenantName: "Acme Traders",
  dbHost: "pg-eu-1.internal.example",
};

const failures = [
  {
    kind: "recurring", ref: SECRETS.recurringRef, at: "2026-09-12T09:00:00Z",
    message: `template for ${SECRETS.email} failed; call ${SECRETS.phone}; PAN ${SECRETS.pan}; GSTIN ${SECRETS.gstin}; via ${SECRETS.ip}:6543; ` +
      `see https://api.example.com/v1/x?key=${SECRETS.token}; tenant ${SECRETS.tenantName} on ${SECRETS.dbHost}`,
  },
  { kind: "bank_import", ref: SECRETS.bankRef, at: "2026-09-12T08:00:00Z", message: "stalled in review" },
  { kind: "einvoice", ref: "INV-2026-0042", at: "2026-09-12T07:00:00Z", message: "[ErrorCode:2150] Duplicate IRN" },
];

const tenantRow = (i: number, name: string, dbName: string | null) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, name, slug: name.toLowerCase().replace(/\s+/g, "-"), plan: "pro", status: "active",
  db_name: dbName, db_host: dbName ? SECRETS.dbHost : null, db_port: dbName ? "6543" : null, created_at: "2026-08-01T00:00:00Z", members: 2,
});

function controlJson(shared: boolean) {
  return {
    tenants: [
      tenantRow(1, SECRETS.tenantName, shared ? null : "tenant_acme_traders"),
      tenantRow(2, "Beta Stores", shared ? null : "tenant_beta_stores"),
    ],
    users: { total: 1, verified: 1, new_7d: 0, new_30d: 0 },
    sessions: { active: 0, used_24h: 0, web: 0, bearer: 0 },
    api_keys: { total: 0, active: 0, used_7d: 0 },
    pending_invitations: 0,
    maintenance: { enabled: false, message: "", startsAt: null, endsAt: null },
    recent_users: [],
    db: { name: "hisaabo", version: "PostgreSQL 16.4", size_pretty: "1 MB", total_size_pretty: "1 MB", connections: 3, max_connections: 100, databases: 3, uptime_seconds: 10 },
  };
}

const tenantJson = {
  summary: { invoices: 1, sales_invoices: 1, purchase_invoices: 0, other_documents: 0, invoices_7d: 0, invoices_30d: 1, sales_total: 100, purchase_total: 0, receivable: 0, payable: 0, e_invoices: 0, last_invoice_at: null },
  by_status: [], monthly: [],
  counts: { businesses: 1, gst_businesses: 0, stores_enabled: 0, parties: 0, items: 0, payments: 0, payments_total: 0, expenses: 0, expenses_total: 0, store_orders: 0, store_orders_total: 0 },
  ops: { failures },
};

class FailureRunner implements SqlRunner {
  constructor(private readonly shared: boolean) {}
  describe() { return "fake"; }
  async queryJson(_target: DbTarget, sql: string): Promise<unknown> {
    if (sql === CONTROL_SQL) return controlJson(this.shared);
    if (sql === QUEUE_PROBE_SQL) return { installed: false };
    return tenantJson;
  }
  async close() { /* noop */ }
}

const collect = (shared: boolean): Promise<PlatformStats> => collectPlatformStats({ runner: new FailureRunner(shared), now: () => NOW });

function expectNoSecrets(json: string) {
  for (const [k, v] of Object.entries(SECRETS)) expect(json, `leaked ${k}`).not.toContain(v);
}

describe("R1: masked --json carries no per-tenant failure text", () => {
  for (const shared of [false, true]) {
    const shape = shared ? "shared-db" : "multi-db";

    it(`${shape}: tenants[].metrics.ops.failures[] is masked like failures[]`, async () => {
      const raw = await collect(shared);
      expect(raw.mode).toBe(shared ? "shared-db" : "multi-db");
      // the fixture really does carry the secrets
      const rawJson = JSON.stringify(raw);
      for (const [k, v] of Object.entries(SECRETS)) expect(rawJson, `fixture lacks ${k}`).toContain(v);
      const before = JSON.stringify(raw);

      // In shared-db mode the tenant rows carry no host, so the only host that can be known is the
      // runner's own (here the fixture's host stands in for the control host).
      const masked = maskStats(raw, { hosts: shared ? [SECRETS.dbHost] : [] });
      expectNoSecrets(JSON.stringify(masked, null, 2));

      // refs and messages follow the same rules as the platform-level list
      const perTenant = masked.tenants.find((t) => t.metrics)!.metrics!.ops.failures;
      expect(perTenant.map((f) => f.kind)).toEqual(["recurring", "bank_import", "einvoice"]);
      expect(perTenant[0].ref).toBe("Mon••••••");
      expect(perTenant[1].ref).toBe("HDF••••••");
      expect(perTenant[2].ref).toBe("INV-2026-0042"); // an invoice number is a business reference, kept
      expect(perTenant[2].message).toBe("[ErrorCode:2150] Duplicate IRN"); // data, kept
      expect(perTenant[0].message).toContain("PAN AB•••••••F");
      expect(perTenant[0].message).toContain("?•••");
      for (const f of masked.failures) {
        const same = perTenant.find((p) => p.kind === f.kind && p.at === f.at);
        expect(same, f.kind).toBeTruthy();
        expect({ ref: same!.ref, message: same!.message }).toEqual({ ref: f.ref, message: f.message });
      }

      // never mutates its input
      expect(JSON.stringify(raw)).toBe(before);
    });
  }

  it("shared-db tenants keep sharing one (masked) metrics object", async () => {
    const raw = await collect(true);
    expect(raw.tenants[0].metrics).toBe(raw.tenants[1].metrics);
    const masked = maskStats(raw);
    expect(masked.tenants[0].metrics).toBe(masked.tenants[1].metrics);
    expect(masked.tenants[0].metrics).not.toBe(raw.tenants[0].metrics);
  });

  it("maskTenant on its own masks the tenant's failures and leaves a null metrics alone", async () => {
    const raw = await collect(false);
    const one = maskTenant(raw.tenants[0]);
    expectNoSecrets(JSON.stringify(one));
    const broken: TenantWithMetrics = { ...raw.tenants[1], metrics: null, error: "boom" };
    expect(maskTenant(broken).metrics).toBeNull();
  });

  it("the demo data's failure refs do not survive masking", () => {
    const raw = buildDemoStats(NOW);
    const refs = raw.tenants.flatMap((t) => t.metrics?.ops.failures ?? []).filter((f) => f.kind === "recurring" || f.kind === "bank_import").map((f) => f.ref);
    expect(refs).toContain("HDFC_Aug2026.csv");
    const json = JSON.stringify(maskStats(raw));
    for (const ref of refs) expect(json).not.toContain(ref);
  });
});

// ── C1-C5: the text rules ───────────────────────────────────────

describe("C1: runner host and more connection shapes", () => {
  it("masks the control host the runner connects to, wherever it appears in error text", async () => {
    const runner = new DirectRunner("postgresql://u:p@pg-control.internal:5432/hisaabo", { connect: () => ({ unsafe: async () => [], end: async () => undefined }) });
    expect(runner.knownHosts()).toEqual(["pg-control.internal"]);
    expect(maskErrorText("lookup failed for pg-control.internal: refused", runner.knownHosts())).toBe("lookup failed for •••: refused");
    expect(maskErrorText("pg-control.internal-2 is another host", runner.knownHosts())).toBe("pg-control.internal-2 is another host"); // whole token only

    const raw = await collect(false);
    raw.errors = ["control: could not reach pg-control.internal after 3 tries"];
    const masked = maskStats(raw, { hosts: runner.knownHosts() });
    expect(masked.errors[0]).toBe("control: could not reach ••• after 3 tries");
    expect(JSON.stringify(masked)).not.toContain("pg-control.internal");
    await runner.close();
  });

  it("strips host \"…\", Host:, CN=, DNS: and bare IPv6", () => {
    const cases: [string, string][] = [
      ['could not translate host name "db.internal" to address: Name or service not known', 'could not translate host name "•••" to address: Name or service not known'],
      ['Is the server running on host "db" (10.0.0.5) and accepting TCP/IP connections on port 5432?', 'Is the server running on host "•••" (•••) and accepting TCP/IP connections on port 5432?'],
      ['connection to host "2001:db8::1" failed', 'connection to host "•••" failed'],
      ["upstream replied\nHost: db.internal:6543\nX-Id: 1", "upstream replied\nHost: •••\nX-Id: 1"],
      ["certificate verify failed: subject CN=db.internal,O=Acme", "certificate verify failed: subject CN=•••,O=Acme"],
      ["Hostname mismatch, certificate is not valid for DNS:db.internal", "Hostname mismatch, certificate is not valid for DNS:•••"],
      ["peer 2001:db8::1 reset", "peer ••• reset"],
      ["peer fe80::1 reset and ::1 too", "peer ••• reset and ••• too"],
      ["peer 2001:0db8:0000:0000:0000:ff00:0042:8329 reset", "peer ••• reset"],
    ];
    for (const [input, want] of cases) expect(maskConnectionInfo(input), input).toBe(want);
  });

  it("leaves times, ratios, MAC-like tokens and C++ scopes alone", () => {
    for (const s of ["failed at 10:30:00", "ratio 1:100", "aa:bb:cc:dd:ee:ff seen", "std::vector overflow", "Foo::bar threw"]) {
      expect(maskConnectionInfo(s), s).toBe(s);
    }
  });
});

describe("C2: bare hosts are whole tokens, and the URL placeholder is not a host", () => {
  it("a host called postgres does not rewrite /var/run/postgresql or postgresql://", async () => {
    const raw = await collect(false);
    raw.tenants[0] = { ...raw.tenants[0], dbHost: "postgres", dbPort: null, dbKey: "postgres/tenant_acme_traders", error: "server on postgres refused; socket /var/run/postgresql/.s.PGSQL.5432; url postgresql://u:p@db.internal/x" };
    const masked = maskStats(raw);
    const err = masked.tenants[0].error!;
    expect(err).toContain("/var/run/postgresql/.s.PGSQL.5432");
    expect(err).toContain("db://•••");
    expect(err).not.toContain("u:p@");
    expect(err).not.toMatch(/\bpostgres\b/);
    expect(err).toMatch(/^server on db-host-[0-9a-f]{6} refused;/);
  });

  it("the database-URL placeholder survives the bare-host pass", () => {
    expect(maskErrorText("failed: postgres://u:p@db/x", ["postgres"])).toBe("failed: db://•••");
  });
});

describe("C3: tenant names and slugs are whole tokens too", () => {
  it("a short slug does not rewrite the middle of other words", async () => {
    const raw = await collect(false);
    raw.tenants[1] = { ...raw.tenants[1], name: "Errant Ltd", slug: "err", error: "errors: could not terror err for err-2" };
    const masked = maskStats(raw);
    const handle = masked.tenants[1].slug;
    // standalone "err" is the tenant; "errors", "terror" and "err-2" are not
    expect(masked.tenants[1].error).toBe(`errors: could not terror ${handle} for err-2`);
  });
});

describe("C4: URL userinfo and query strings", () => {
  it("masks credentials and query strings of any URL in free text", () => {
    expect(maskFreeText("GET https://user:pass@api.example.com/v1/x?token=abc&sig=123 failed")).toBe("GET https://•••@api.example.com/v1/x?••• failed");
    expect(maskFreeText("ftp://admin:secret@files.example/path/file.csv")).toBe("ftp://•••@files.example/path/file.csv");
    expect(maskFreeText("see http://x.example/a?b=c#frag")).toBe("see http://x.example/a?•••#frag");
    expect(maskFreeText("redis://:hunter2@cache:6379/0")).toBe("redis://•••@cache:6379/0");
    // no userinfo, no query: untouched
    expect(maskFreeText("see https://docs.example.com/guide")).toBe("see https://docs.example.com/guide");
    expect(maskFreeText("mail me at a@b.co about it")).not.toContain("a@b.co");
  });
});

describe("C5: PAN", () => {
  it("masks PANs (and still GSTINs) in free text", () => {
    expect(maskFreeText("PAN ABCDE1234F on file")).toBe("PAN AB•••••••F on file");
    expect(maskFreeText("GSTIN 27AABCU9603R1ZM, PAN AABCU9603R")).toBe("GSTIN 27•••••••••••ZM, PAN AA•••••••R");
    expect(maskFreeText("ABCDE12345 and ABCD1234E are not PANs")).toBe("ABCDE12345 and ABCD1234E are not PANs");
  });
});

describe("regression: data in free text survives", () => {
  it("ErrorCode:2150, ratios, version numbers and invoice numbers are untouched", () => {
    for (const s of ["[ErrorCode:2150] Duplicate IRN", "INV-2026-0042 rejected", "pg-boss 12.37.1 on node 22.20.5", "retry 3/5 after 1:30", "HTTP 502 from IRP"]) {
      expect(maskFreeText(s), s).toBe(s);
    }
  });
});
