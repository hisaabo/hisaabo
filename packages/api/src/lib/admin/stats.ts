/**
 * stats.ts — Platform-wide statistics for the admin dashboard.
 *
 * Pure SQL, no ORM: the dashboard has to work both inside the API container
 * (direct connection) and from an operator's shell via
 * `docker compose exec postgres psql`, so every query is a single statement
 * that returns ONE row with ONE json column. That keeps the transport
 * trivial (one JSON blob per round trip) and makes the two runners produce
 * byte-identical results.
 *
 * Multi-tenant deployments keep one physical database per tenant. We query
 * each distinct database once and sum the results; tenants that share a
 * database (self-hosted mode) are never double counted.
 */

// ── Runner contract ─────────────────────────────────────────────

export interface DbTarget {
  /** Database name; null means "the control database we are connected to". */
  name: string | null;
  host?: string | null;
  port?: string | null;
}

export interface SqlRunner {
  /** Human-readable description shown in the header. Credentials/hosts only when `reveal` is true. */
  describe(reveal?: boolean): string;
  /** Execute `sql` (a single SELECT yielding one row/one json column) and return the parsed JSON. */
  queryJson(target: DbTarget, sql: string): Promise<unknown>;
  close(): Promise<void>;
}

// ── Result types ────────────────────────────────────────────────

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  dbName: string | null;
  dbHost: string | null;
  dbPort: string | null;
  members: number;
  createdAt: string;
}

export interface MonthPoint {
  month: string; // YYYY-MM
  count: number;
  amount: number;
}

export interface OpsFailure {
  kind: "einvoice" | "recurring" | "bank_import" | "store_order" | string;
  ref: string;
  message: string;
  at: string;
}

export interface TenantOps {
  eInvoice: { pending: number; generated: number; cancelled: number; failed: number; stalePending: number; exhausted: number };
  recurring: { activeTemplates: number; pausedTemplates: number; overdueTemplates: number; ok7d: number; failed7d: number; skipped7d: number; ok30d: number; failed30d: number };
  bank: { imports: number; completed: number; inProgress: number; review: number; stale: number; matched30d: number; unmatched30d: number };
  gstr2b: { uploads: number; uploads30d: number; unmatched30d: number; new30d: number; lastUploadAt: string | null };
  store: { byStatus: Record<string, number>; stalePending: number };
  shipments: { byStatus: Record<string, number>; stuck: number };
  ewb: { active: number; cancelled: number; expired: number; expiring24h: number; overdueExpiry: number };
  failures: OpsFailure[];
}

export interface TenantMetrics {
  ops: TenantOps;
  businesses: number;
  gstBusinesses: number;
  storesEnabled: number;
  parties: number;
  items: number;
  invoices: number;
  salesInvoices: number;
  purchaseInvoices: number;
  otherDocuments: number;
  invoices7d: number;
  invoices30d: number;
  salesTotal: number;
  purchaseTotal: number;
  receivable: number;
  payable: number;
  eInvoices: number;
  lastInvoiceAt: string | null;
  payments: number;
  paymentsTotal: number;
  expenses: number;
  expensesTotal: number;
  storeOrders: number;
  storeOrdersTotal: number;
  byStatus: Record<string, number>;
  monthly: MonthPoint[];
}

export interface ControlStats {
  tenants: TenantRow[];
  users: { total: number; verified: number; new7d: number; new30d: number };
  sessions: { active: number; used24h: number; web: number; bearer: number };
  apiKeys: { total: number; active: number; used7d: number };
  pendingInvitations: number;
  maintenance: { enabled: boolean; message: string; startsAt: string | null; endsAt: string | null } | null;
  recentUsers: { email: string; name: string | null; createdAt: string }[];
  db: {
    name: string;
    version: string;
    sizePretty: string;
    totalSizePretty: string;
    connections: number;
    maxConnections: number;
    databases: number;
    uptimeSeconds: number;
  };
}

export interface TenantWithMetrics extends TenantRow {
  /** Which physical database the tenant lives in ("control" when shared). */
  dbKey: string;
  sharedDb: boolean;
  metrics: TenantMetrics | null;
  error: string | null;
}

export interface PlatformFailure extends OpsFailure {
  tenantId: string;
  tenantName: string;
}

export interface PlatformStats {
  /** Most recent operational failures across all tenants, newest first. */
  failures: PlatformFailure[];
  collectedAt: string;
  durationMs: number;
  mode: "multi-db" | "shared-db";
  control: ControlStats;
  totals: TenantMetrics;
  tenants: TenantWithMetrics[];
  /** Number of distinct tenant databases queried, and how many failed. */
  databases: { queried: number; failed: number };
  errors: string[];
}

// ── SQL ─────────────────────────────────────────────────────────

export const CONTROL_SQL = `
select json_build_object(
  'tenants', (
    select coalesce(json_agg(t order by t.created_at desc), '[]'::json) from (
      select t.id, t.name, t.slug, t.plan, t.status, t.db_name, t.db_host, t.db_port, t.created_at,
             (select count(*) from tenant_members m where m.tenant_id = t.id) as members
      from tenants t
    ) t
  ),
  'users', (
    select row_to_json(u) from (
      select count(*) as total,
             count(*) filter (where email_verified) as verified,
             count(*) filter (where created_at >= now() - interval '7 days') as new_7d,
             count(*) filter (where created_at >= now() - interval '30 days') as new_30d
      from users
    ) u
  ),
  'sessions', (
    select row_to_json(s) from (
      select count(*) filter (where expires_at > now()) as active,
             count(*) filter (where last_used_at >= now() - interval '24 hours') as used_24h,
             count(*) filter (where expires_at > now() and auth_method = 'cookie') as web,
             count(*) filter (where expires_at > now() and auth_method = 'bearer') as bearer
      from sessions
    ) s
  ),
  'api_keys', (
    select row_to_json(k) from (
      select count(*) as total,
             count(*) filter (where expires_at is null or expires_at > now()) as active,
             count(*) filter (where last_used_at >= now() - interval '7 days') as used_7d
      from api_keys
    ) k
  ),
  'pending_invitations', (select count(*) from invitations where accepted_at is null and expires_at > now()),
  'maintenance', (select value from system_config where key = 'maintenance'),
  'recent_users', (
    select coalesce(json_agg(r), '[]'::json) from (
      select email, name, created_at from users order by created_at desc limit 10
    ) r
  ),
  'db', (
    select row_to_json(d) from (
      select current_database() as name,
             version() as version,
             pg_size_pretty(pg_database_size(current_database())) as size_pretty,
             (select pg_size_pretty(sum(pg_database_size(datname))) from pg_database where not datistemplate) as total_size_pretty,
             (select count(*) from pg_stat_activity where datname is not null) as connections,
             (select setting::int from pg_settings where name = 'max_connections') as max_connections,
             (select count(*) from pg_database where not datistemplate) as databases,
             extract(epoch from now() - pg_postmaster_start_time())::bigint as uptime_seconds
    ) d
  )
) as data
`;

export const TENANT_SQL = `
select json_build_object(
  'summary', (
    select row_to_json(s) from (
      select
        count(*) filter (where document_type = 'invoice') as invoices,
        count(*) filter (where document_type = 'invoice' and type = 'sale') as sales_invoices,
        count(*) filter (where document_type = 'invoice' and type = 'purchase') as purchase_invoices,
        count(*) filter (where document_type <> 'invoice') as other_documents,
        count(*) filter (where document_type = 'invoice' and created_at >= now() - interval '7 days') as invoices_7d,
        count(*) filter (where document_type = 'invoice' and created_at >= now() - interval '30 days') as invoices_30d,
        coalesce(sum(total_amount) filter (where document_type = 'invoice' and type = 'sale' and status <> 'cancelled'), 0) as sales_total,
        coalesce(sum(total_amount) filter (where document_type = 'invoice' and type = 'purchase' and status <> 'cancelled'), 0) as purchase_total,
        coalesce(sum(total_amount - amount_paid) filter (where document_type = 'invoice' and type = 'sale' and status not in ('paid', 'cancelled', 'draft')), 0) as receivable,
        coalesce(sum(total_amount - amount_paid) filter (where document_type = 'invoice' and type = 'purchase' and status not in ('paid', 'cancelled', 'draft')), 0) as payable,
        count(*) filter (where irn is not null) as e_invoices,
        max(created_at) as last_invoice_at
      from invoices where deleted_at is null
    ) s
  ),
  'by_status', (
    select coalesce(json_agg(x), '[]'::json) from (
      select status, count(*) as n from invoices
      where deleted_at is null and document_type = 'invoice'
      group by status
    ) x
  ),
  'monthly', (
    select coalesce(json_agg(x order by x.month), '[]'::json) from (
      select to_char(date_trunc('month', invoice_date), 'YYYY-MM') as month,
             count(*) as n,
             coalesce(sum(total_amount), 0) as amount
      from invoices
      where deleted_at is null and document_type = 'invoice' and type = 'sale' and status <> 'cancelled'
        and invoice_date >= date_trunc('month', now()) - interval '11 months'
      group by 1
    ) x
  ),
  'ops', (
    select json_build_object(
      'einvoice', (
        select row_to_json(x) from (
          select count(*) filter (where e_invoice_status = 'pending') as pending,
                 count(*) filter (where e_invoice_status = 'generated') as generated,
                 count(*) filter (where e_invoice_status = 'cancelled') as cancelled,
                 count(*) filter (where e_invoice_status = 'failed') as failed,
                 count(*) filter (where e_invoice_status = 'pending' and updated_at < now() - interval '1 hour') as stale_pending,
                 count(*) filter (where e_invoice_status = 'failed' and coalesce(e_invoice_retry_count, 0) >= 3) as exhausted
          from invoices where deleted_at is null
        ) x
      ),
      'recurring', (
        select row_to_json(x) from (
          select (select count(*) from recurring_invoice_templates where status = 'active') as active_templates,
                 (select count(*) from recurring_invoice_templates where status = 'paused') as paused_templates,
                 (select count(*) from recurring_invoice_templates where status = 'active' and next_run_date < now() - interval '1 day') as overdue_templates,
                 (select count(*) from recurring_invoice_runs where status = 'success' and executed_at >= now() - interval '7 days') as ok_7d,
                 (select count(*) from recurring_invoice_runs where status = 'failed' and executed_at >= now() - interval '7 days') as failed_7d,
                 (select count(*) from recurring_invoice_runs where status = 'skipped_limit' and executed_at >= now() - interval '7 days') as skipped_7d,
                 (select count(*) from recurring_invoice_runs where status = 'success' and executed_at >= now() - interval '30 days') as ok_30d,
                 (select count(*) from recurring_invoice_runs where status = 'failed' and executed_at >= now() - interval '30 days') as failed_30d
        ) x
      ),
      'bank', (
        select row_to_json(x) from (
          select count(*) as imports,
                 count(*) filter (where status = 'completed') as completed,
                 count(*) filter (where status in ('pending', 'mapped', 'processing')) as in_progress,
                 count(*) filter (where status = 'review') as review,
                 count(*) filter (where status <> 'completed' and updated_at < now() - interval '3 days') as stale,
                 coalesce(sum(matched_lines) filter (where created_at >= now() - interval '30 days'), 0) as matched_30d,
                 coalesce(sum(unmatched_lines) filter (where created_at >= now() - interval '30 days'), 0) as unmatched_30d
          from bank_statement_imports
        ) x
      ),
      'gstr2b', (
        select row_to_json(x) from (
          select count(*) as uploads,
                 count(*) filter (where uploaded_at >= now() - interval '30 days') as uploads_30d,
                 coalesce(sum(unmatched_records) filter (where uploaded_at >= now() - interval '30 days'), 0) as unmatched_30d,
                 coalesce(sum(new_records) filter (where uploaded_at >= now() - interval '30 days'), 0) as new_30d,
                 max(uploaded_at) as last_upload_at
          from gstr2b_uploads
        ) x
      ),
      'store', (
        select coalesce(json_agg(x), '[]'::json) from (
          select status, count(*) as n,
                 count(*) filter (where status = 'pending' and created_at < now() - interval '24 hours') as stale
          from store_orders group by status
        ) x
      ),
      'shipments', (
        select coalesce(json_agg(x), '[]'::json) from (
          select status, count(*) as n,
                 count(*) filter (where status in ('shipped', 'in_transit') and updated_at < now() - interval '7 days') as stuck
          from shipments group by status
        ) x
      ),
      'ewb', (
        select row_to_json(x) from (
          select count(*) filter (where status in ('generated', 'active')) as active,
                 count(*) filter (where status = 'cancelled') as cancelled,
                 count(*) filter (where status = 'expired') as expired,
                 count(*) filter (where status in ('generated', 'active') and valid_upto > now() and valid_upto < now() + interval '24 hours') as expiring_24h,
                 count(*) filter (where status in ('generated', 'active') and valid_upto < now()) as overdue_expiry
          from eway_bills
        ) x
      ),
      'failures', (
        select coalesce(json_agg(f order by f.at desc), '[]'::json) from (
          (select 'einvoice' as kind, invoice_number as ref, coalesce(e_invoice_error, 'IRN generation failed') as message, updated_at as at
             from invoices where deleted_at is null and e_invoice_status = 'failed' order by updated_at desc limit 5)
          union all
          (select 'recurring', t.name, coalesce(r.error_message, 'run failed'), r.executed_at
             from recurring_invoice_runs r join recurring_invoice_templates t on t.id = r.template_id
             where r.status = 'failed' order by r.executed_at desc limit 5)
          union all
          (select 'bank_import', file_name, 'stalled in ' || status::text, updated_at
             from bank_statement_imports where status <> 'completed' and updated_at < now() - interval '3 days' order by updated_at desc limit 5)
          union all
          (select 'store_order', order_number, 'unconfirmed for ' || greatest(1, extract(day from now() - created_at)::int) || 'd', created_at
             from store_orders where status = 'pending' and created_at < now() - interval '24 hours' order by created_at desc limit 5)
        ) f
      )
    )
  ),
  'counts', (
    select row_to_json(c) from (
      select
        (select count(*) from businesses) as businesses,
        (select count(*) from businesses where gst_registration_type <> 'unregistered') as gst_businesses,
        (select count(*) from businesses where store_enabled) as stores_enabled,
        (select count(*) from parties) as parties,
        (select count(*) from items where deleted_at is null) as items,
        (select count(*) from payments where deleted_at is null) as payments,
        (select coalesce(sum(amount), 0) from payments where deleted_at is null) as payments_total,
        (select count(*) from expenses where deleted_at is null) as expenses,
        (select coalesce(sum(amount), 0) from expenses where deleted_at is null) as expenses_total,
        (select count(*) from store_orders) as store_orders,
        (select coalesce(sum(total_amount), 0) from store_orders where status <> 'cancelled') as store_orders_total
    ) c
  )
) as data
`;

// ── Normalisation ───────────────────────────────────────────────

type Row = Record<string, unknown>;

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function obj(v: unknown): Row {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
}

function arr(v: unknown): Row[] {
  return Array.isArray(v) ? (v as Row[]) : [];
}

export function parseControlStats(raw: unknown): ControlStats {
  const d = obj(raw);
  const users = obj(d.users);
  const sessions = obj(d.sessions);
  const keys = obj(d.api_keys);
  const db = obj(d.db);
  const maint = d.maintenance ? obj(d.maintenance) : null;
  return {
    tenants: arr(d.tenants).map((t) => ({
      id: String(t.id),
      name: String(t.name ?? ""),
      slug: String(t.slug ?? ""),
      plan: String(t.plan ?? "free"),
      status: String(t.status ?? "active"),
      dbName: str(t.db_name),
      dbHost: str(t.db_host),
      dbPort: str(t.db_port),
      members: num(t.members),
      createdAt: str(t.created_at) ?? "",
    })),
    users: { total: num(users.total), verified: num(users.verified), new7d: num(users.new_7d), new30d: num(users.new_30d) },
    sessions: { active: num(sessions.active), used24h: num(sessions.used_24h), web: num(sessions.web), bearer: num(sessions.bearer) },
    apiKeys: { total: num(keys.total), active: num(keys.active), used7d: num(keys.used_7d) },
    pendingInvitations: num(d.pending_invitations),
    maintenance: maint
      ? {
          enabled: Boolean(maint.enabled),
          message: String(maint.message ?? ""),
          startsAt: str(maint.startsAt),
          endsAt: str(maint.endsAt),
        }
      : null,
    recentUsers: arr(d.recent_users).map((u) => ({
      email: String(u.email ?? ""),
      name: str(u.name),
      createdAt: str(u.created_at) ?? "",
    })),
    db: {
      name: String(db.name ?? ""),
      version: String(db.version ?? "").replace(/^PostgreSQL\s+([\d.]+).*$/s, "PostgreSQL $1"),
      sizePretty: String(db.size_pretty ?? "—"),
      totalSizePretty: String(db.total_size_pretty ?? "—"),
      connections: num(db.connections),
      maxConnections: num(db.max_connections),
      databases: num(db.databases),
      uptimeSeconds: num(db.uptime_seconds),
    },
  };
}

/** Last 12 calendar months ending now, as YYYY-MM keys (oldest first). */
export function lastTwelveMonths(now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function emptyOps(): TenantOps {
  return {
    eInvoice: { pending: 0, generated: 0, cancelled: 0, failed: 0, stalePending: 0, exhausted: 0 },
    recurring: { activeTemplates: 0, pausedTemplates: 0, overdueTemplates: 0, ok7d: 0, failed7d: 0, skipped7d: 0, ok30d: 0, failed30d: 0 },
    bank: { imports: 0, completed: 0, inProgress: 0, review: 0, stale: 0, matched30d: 0, unmatched30d: 0 },
    gstr2b: { uploads: 0, uploads30d: 0, unmatched30d: 0, new30d: 0, lastUploadAt: null },
    store: { byStatus: {}, stalePending: 0 },
    shipments: { byStatus: {}, stuck: 0 },
    ewb: { active: 0, cancelled: 0, expired: 0, expiring24h: 0, overdueExpiry: 0 },
    failures: [],
  };
}

function parseOps(raw: unknown): TenantOps {
  const d = obj(raw);
  const e = obj(d.einvoice);
  const r = obj(d.recurring);
  const b = obj(d.bank);
  const g = obj(d.gstr2b);
  const w = obj(d.ewb);
  const store: TenantOps["store"] = { byStatus: {}, stalePending: 0 };
  for (const row of arr(d.store)) {
    store.byStatus[String(row.status)] = num(row.n);
    store.stalePending += num(row.stale);
  }
  const shipments: TenantOps["shipments"] = { byStatus: {}, stuck: 0 };
  for (const row of arr(d.shipments)) {
    shipments.byStatus[String(row.status)] = num(row.n);
    shipments.stuck += num(row.stuck);
  }
  return {
    eInvoice: { pending: num(e.pending), generated: num(e.generated), cancelled: num(e.cancelled), failed: num(e.failed), stalePending: num(e.stale_pending), exhausted: num(e.exhausted) },
    recurring: {
      activeTemplates: num(r.active_templates), pausedTemplates: num(r.paused_templates), overdueTemplates: num(r.overdue_templates),
      ok7d: num(r.ok_7d), failed7d: num(r.failed_7d), skipped7d: num(r.skipped_7d), ok30d: num(r.ok_30d), failed30d: num(r.failed_30d),
    },
    bank: { imports: num(b.imports), completed: num(b.completed), inProgress: num(b.in_progress), review: num(b.review), stale: num(b.stale), matched30d: num(b.matched_30d), unmatched30d: num(b.unmatched_30d) },
    gstr2b: { uploads: num(g.uploads), uploads30d: num(g.uploads_30d), unmatched30d: num(g.unmatched_30d), new30d: num(g.new_30d), lastUploadAt: str(g.last_upload_at) },
    store,
    shipments,
    ewb: { active: num(w.active), cancelled: num(w.cancelled), expired: num(w.expired), expiring24h: num(w.expiring_24h), overdueExpiry: num(w.overdue_expiry) },
    failures: arr(d.failures).map((f) => ({ kind: String(f.kind ?? "unknown"), ref: String(f.ref ?? ""), message: String(f.message ?? ""), at: str(f.at) ?? "" })),
  };
}

function addInto(target: Record<string, number>, source: Record<string, number>): void {
  for (const [k, v] of Object.entries(source)) target[k] = (target[k] ?? 0) + v;
}

function sumOps(list: TenantOps[]): TenantOps {
  const t = emptyOps();
  for (const o of list) {
    addInto(t.eInvoice as unknown as Record<string, number>, o.eInvoice as unknown as Record<string, number>);
    addInto(t.recurring as unknown as Record<string, number>, o.recurring as unknown as Record<string, number>);
    addInto(t.bank as unknown as Record<string, number>, o.bank as unknown as Record<string, number>);
    addInto(t.ewb as unknown as Record<string, number>, o.ewb as unknown as Record<string, number>);
    t.gstr2b.uploads += o.gstr2b.uploads;
    t.gstr2b.uploads30d += o.gstr2b.uploads30d;
    t.gstr2b.unmatched30d += o.gstr2b.unmatched30d;
    t.gstr2b.new30d += o.gstr2b.new30d;
    if (o.gstr2b.lastUploadAt && (!t.gstr2b.lastUploadAt || o.gstr2b.lastUploadAt > t.gstr2b.lastUploadAt)) t.gstr2b.lastUploadAt = o.gstr2b.lastUploadAt;
    addInto(t.store.byStatus, o.store.byStatus);
    t.store.stalePending += o.store.stalePending;
    addInto(t.shipments.byStatus, o.shipments.byStatus);
    t.shipments.stuck += o.shipments.stuck;
  }
  // Per-tenant failure lists are merged at the platform level (with tenant attribution).
  return t;
}

export function emptyMetrics(now: Date = new Date()): TenantMetrics {
  return {
    ops: emptyOps(),
    businesses: 0, gstBusinesses: 0, storesEnabled: 0, parties: 0, items: 0,
    invoices: 0, salesInvoices: 0, purchaseInvoices: 0, otherDocuments: 0,
    invoices7d: 0, invoices30d: 0, salesTotal: 0, purchaseTotal: 0,
    receivable: 0, payable: 0, eInvoices: 0, lastInvoiceAt: null,
    payments: 0, paymentsTotal: 0, expenses: 0, expensesTotal: 0,
    storeOrders: 0, storeOrdersTotal: 0, byStatus: {},
    monthly: lastTwelveMonths(now).map((month) => ({ month, count: 0, amount: 0 })),
  };
}

export function parseTenantMetrics(raw: unknown, now: Date = new Date()): TenantMetrics {
  const d = obj(raw);
  const s = obj(d.summary);
  const cnt = obj(d.counts);
  const byStatus: Record<string, number> = {};
  for (const row of arr(d.by_status)) byStatus[String(row.status)] = num(row.n);
  const monthlyMap = new Map<string, MonthPoint>();
  for (const row of arr(d.monthly)) {
    const month = String(row.month);
    monthlyMap.set(month, { month, count: num(row.n), amount: num(row.amount) });
  }
  return {
    ops: parseOps(d.ops),
    businesses: num(cnt.businesses),
    gstBusinesses: num(cnt.gst_businesses),
    storesEnabled: num(cnt.stores_enabled),
    parties: num(cnt.parties),
    items: num(cnt.items),
    invoices: num(s.invoices),
    salesInvoices: num(s.sales_invoices),
    purchaseInvoices: num(s.purchase_invoices),
    otherDocuments: num(s.other_documents),
    invoices7d: num(s.invoices_7d),
    invoices30d: num(s.invoices_30d),
    salesTotal: num(s.sales_total),
    purchaseTotal: num(s.purchase_total),
    receivable: num(s.receivable),
    payable: num(s.payable),
    eInvoices: num(s.e_invoices),
    lastInvoiceAt: str(s.last_invoice_at),
    payments: num(cnt.payments),
    paymentsTotal: num(cnt.payments_total),
    expenses: num(cnt.expenses),
    expensesTotal: num(cnt.expenses_total),
    storeOrders: num(cnt.store_orders),
    storeOrdersTotal: num(cnt.store_orders_total),
    byStatus,
    monthly: lastTwelveMonths(now).map((month) => monthlyMap.get(month) ?? { month, count: 0, amount: 0 }),
  };
}

/** Sum a list of metrics into one. */
export function sumMetrics(list: TenantMetrics[], now: Date = new Date()): TenantMetrics {
  const total = emptyMetrics(now);
  total.ops = sumOps(list.map((m) => m.ops));
  for (const m of list) {
    for (const k of Object.keys(total) as (keyof TenantMetrics)[]) {
      if (k === "byStatus" || k === "monthly" || k === "lastInvoiceAt" || k === "ops") continue;
      (total[k] as number) += m[k] as number;
    }
    for (const [status, n] of Object.entries(m.byStatus)) total.byStatus[status] = (total.byStatus[status] ?? 0) + n;
    m.monthly.forEach((p, i) => {
      if (total.monthly[i]) {
        total.monthly[i].count += p.count;
        total.monthly[i].amount += p.amount;
      }
    });
    if (m.lastInvoiceAt && (!total.lastInvoiceAt || m.lastInvoiceAt > total.lastInvoiceAt)) {
      total.lastInvoiceAt = m.lastInvoiceAt;
    }
  }
  return total;
}

// ── Collection ──────────────────────────────────────────────────

export interface CollectOptions {
  runner: SqlRunner;
  concurrency?: number;
  now?: () => Date;
}

const CONTROL_KEY = "control";

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Flatten per-tenant failure lists into one newest-first feed, attributing each to its tenant. */
export function mergeFailures(tenants: TenantWithMetrics[], limit = 50): PlatformFailure[] {
  const seen = new Set<string>(); // shared-db mode: several tenant rows share one metrics object
  const out: PlatformFailure[] = [];
  for (const t of tenants) {
    if (!t.metrics || seen.has(t.dbKey)) continue;
    seen.add(t.dbKey);
    for (const f of t.metrics.ops.failures) out.push({ ...f, tenantId: t.id, tenantName: t.sharedDb ? "" : t.name });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n")[0].slice(0, 200);
}

export async function collectPlatformStats(opts: CollectOptions): Promise<PlatformStats> {
  const now = opts.now ?? (() => new Date());
  const started = Date.now();
  const control = parseControlStats(await opts.runner.queryJson({ name: null }, CONTROL_SQL));

  // Group live tenants by physical database so shared DBs are queried once.
  const targets = new Map<string, DbTarget>();
  const keyFor = (t: TenantRow): string => {
    if (!t.dbName) return CONTROL_KEY;
    const server = [t.dbHost, t.dbPort].filter(Boolean).join(":");
    return server ? `${server}/${t.dbName}` : t.dbName;
  };
  for (const t of control.tenants) {
    if (t.status === "deleted") continue;
    const k = keyFor(t);
    if (!targets.has(k)) targets.set(k, t.dbName ? { name: t.dbName, host: t.dbHost, port: t.dbPort } : { name: null });
  }
  // Self-hosted with zero tenant rows still has data in the control DB.
  if (targets.size === 0) targets.set(CONTROL_KEY, { name: null });

  const keys = [...targets.keys()];
  const results = await mapLimit(keys, opts.concurrency ?? 4, async (k) => {
    try {
      return { key: k, metrics: parseTenantMetrics(await opts.runner.queryJson(targets.get(k)!, TENANT_SQL), now()), error: null as string | null };
    } catch (e) {
      return { key: k, metrics: null, error: errorMessage(e) };
    }
  });
  const byKey = new Map(results.map((r) => [r.key, r]));
  const errors = results.filter((r) => r.error).map((r) => `${r.key}: ${r.error}`);

  const tenants: TenantWithMetrics[] = control.tenants.map((t) => {
    const k = keyFor(t);
    const r = t.status === "deleted" ? undefined : byKey.get(k);
    return {
      ...t,
      dbKey: k,
      sharedDb: k === CONTROL_KEY,
      metrics: r?.metrics ?? null,
      error: r?.error ?? null,
    };
  });

  const mode: PlatformStats["mode"] = keys.some((k) => k !== CONTROL_KEY) ? "multi-db" : "shared-db";
  return {
    failures: mergeFailures(tenants),
    collectedAt: now().toISOString(),
    durationMs: Date.now() - started,
    mode,
    control,
    totals: sumMetrics(results.flatMap((r) => (r.metrics ? [r.metrics] : [])), now()),
    tenants,
    databases: { queried: keys.length, failed: errors.length },
    errors,
  };
}
