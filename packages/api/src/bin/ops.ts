#!/usr/bin/env tsx
/**
 * ops — shell CLI for the /ops operator dashboard and the job queue
 * (docs/architecture/queue.md §10).
 *
 * This is the ONLY way to create, enroll, re-role or remove /ops operators:
 * shell access is the root of trust, so a hijacked mailbox can never enroll
 * itself. Every write is recorded in ops_audit_log as cli:<os user>.
 *
 * USAGE:
 *   pnpm --filter @hisaabo/api ops <command>
 *   docker compose exec api node packages/api/dist/bin/ops.js <command>
 */
import { config } from "dotenv";
config({ path: "../../.env", quiet: true });

import * as p from "@clack/prompts";
import color from "picocolors";
import { closeControlClient } from "@hisaabo/db";
import { createBoss } from "../queue/boss.js";
import { JOBS, getJob } from "../queue/registry.js";
import { cliActor, writeOpsAudit } from "../ops/audit.js";
import {
  addOperator,
  enrollOperator,
  findOperatorByEmail,
  listOperators,
  removeOperator,
  revokeOperatorSessions,
  type OpsRole,
} from "../ops/operators.js";
import { listJobs, listQueues, queueSeries, resolveQueue, retryJobs, deleteJobs, setPaused, useOpsBoss, boss } from "../ops/data.js";
import { QUEUE_SCHEMA } from "@hisaabo/db";

const HELP = `${color.bold("ops")} — operators and job queue for Hisaabo

${color.bold("Operators")} (who may sign in to /ops)
  ops operator add <email> --role admin|viewer   add, or change role (revokes their sessions)
  ops operator remove <email>                     delete the operator and their sessions
  ops operator list
  ops operator enroll <email>                     (re)generate TOTP secret + recovery codes, printed once
  ops operator revoke-sessions <email>

${color.bold("Queues")}
  ops queue list                                  counts per queue
  ops queue stats <queue> [--hours n]             recent throughput snapshots
  ops queue failed [--queue q] [--limit n]        failed (dead-lettered) jobs
  ops queue retry <id…>                           redrive failed jobs to their queue
  ops queue retry --queue q --all-failed          redrive every failed job of a queue
  ops queue forget <id…>                          delete failed jobs
  ops queue flush [--queue q]                     delete all failed jobs (of one queue)
  ops queue clear <queue> [--yes]                 delete jobs still waiting in a queue
  ops queue pause <queue> | resume <queue>        workers stop / resume fetching

Exit codes: 0 ok, 1 error, 2 usage.`;

class UsageError extends Error {}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) throw new UsageError(`--${name} needs a value`);
  return v;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (!["--yes", "--all-failed"].includes(args[i])) i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function table(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log(color.dim("(none)"));
    return;
  }
  const cols = Object.keys(rows[0]);
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  console.log(cols.map((c, i) => color.bold(c.padEnd(width[i]))).join("  "));
  for (const r of rows) console.log(cols.map((c, i) => String(r[c] ?? "").padEnd(width[i])).join("  "));
}

const actor = cliActor();

async function audit(action: string, extra: { queue?: string | null; jobIds?: string[]; details?: Record<string, unknown> } = {}) {
  await writeOpsAudit({ actor, action, result: "ok", ...extra });
}

// ── Operators ─────────────────────────────────────────────────

async function operatorCommand(args: string[]): Promise<void> {
  const [sub, email] = positional(args);
  switch (sub) {
    case "add": {
      if (!email) throw new UsageError("ops operator add <email> --role admin|viewer");
      const role = flag(args, "role");
      if (role !== "admin" && role !== "viewer") throw new UsageError("--role must be admin or viewer");
      const { operator, created } = await addOperator(email, role as OpsRole, actor);
      await audit(created ? "operator_add" : "operator_update", { details: { email: operator.email, role } });
      console.log(`${created ? "Added" : "Updated"} ${operator.email} as ${role}.`);
      if (!operator.totpEnrolledAt) console.log(`Next: ${color.cyan(`ops operator enroll ${operator.email}`)}`);
      return;
    }
    case "remove": {
      if (!email) throw new UsageError("ops operator remove <email>");
      const removed = await removeOperator(email);
      if (!removed) throw new Error(`No operator with email ${email}`);
      await audit("operator_remove", { details: { email: removed.email } });
      console.log(`Removed ${removed.email}; their /ops sessions are gone.`);
      return;
    }
    case "list": {
      const ops = await listOperators();
      table(ops.map((o) => ({
        email: o.email,
        role: o.role,
        enrolled: o.totpEnrolledAt ? o.totpEnrolledAt.toISOString().slice(0, 10) : "no",
        status: o.disabledAt ? "disabled" : o.lockedUntil && o.lockedUntil > new Date() ? "locked" : "active",
        recoveryCodes: o.recoveryCodeHashes.length,
      })));
      return;
    }
    case "enroll": {
      if (!email) throw new UsageError("ops operator enroll <email>");
      const existing = await findOperatorByEmail(email);
      if (existing?.totpEnrolledAt && !args.includes("--yes")) {
        const ok = await p.confirm({ message: `${existing.email} is already enrolled. Replace their authenticator and recovery codes (signs them out)?` });
        if (p.isCancel(ok) || !ok) throw new Error("Cancelled");
      }
      const { operator, enrollment } = await enrollOperator(email);
      await audit("operator_enroll", { details: { email: operator.email } });
      console.log(`\n${color.bold("TOTP enrolment for")} ${operator.email}`);
      console.log(color.yellow("Shown once. Add it to an authenticator app now; it is stored encrypted and cannot be shown again.\n"));
      console.log(`Secret:       ${color.bold(enrollment.secret)}`);
      console.log(`otpauth URI:  ${enrollment.uri}\n`);
      console.log(color.bold("Recovery codes") + " (each works once; keep them offline):");
      for (const code of enrollment.recoveryCodes) console.log(`  ${code}`);
      console.log("");
      return;
    }
    case "revoke-sessions": {
      if (!email) throw new UsageError("ops operator revoke-sessions <email>");
      const op = await findOperatorByEmail(email);
      if (!op) throw new Error(`No operator with email ${email}`);
      const n = await revokeOperatorSessions(op.id);
      await audit("operator_revoke_sessions", { details: { email: op.email, count: n } });
      console.log(`Revoked ${n} session(s) for ${op.email}.`);
      return;
    }
    default:
      throw new UsageError(`Unknown operator command: ${sub ?? "(none)"}`);
  }
}

// ── Queues ────────────────────────────────────────────────────

function requireQueue(name: string | undefined): string {
  if (!name) throw new UsageError("A queue name is required");
  const resolved = resolveQueue(name);
  if (!resolved || resolved.dead) {
    throw new Error(`Unknown queue "${name}". Known: ${JOBS.map((j) => j.name).join(", ")}`);
  }
  return name;
}

/** Group dead-lettered job ids by their dead-letter queue. */
async function locateFailed(ids: string[]): Promise<Map<string, string[]>> {
  const b = await boss();
  const deadQueues = JOBS.map((j) => j.deadLetter);
  const { rows } = await b.getDb().executeSql(
    `SELECT name, id::text AS id FROM ${QUEUE_SCHEMA}.job WHERE name = ANY($1) AND id = ANY($2::uuid[])`,
    [deadQueues, ids],
  );
  const out = new Map<string, string[]>();
  for (const r of rows as { name: string; id: string }[]) out.set(r.name, [...(out.get(r.name) ?? []), r.id]);
  const found = new Set((rows as { id: string }[]).map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) console.log(color.yellow(`Not found among failed jobs: ${missing.join(", ")}`));
  return out;
}

function validIds(ids: string[]): string[] {
  for (const id of ids) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new UsageError(`Not a job id: ${id}`);
  }
  if (ids.length > 500) throw new UsageError("At most 500 ids at a time");
  return [...new Set(ids)];
}

async function queueCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = positional(args);
  switch (sub) {
    case "list": {
      const queues = await listQueues();
      table(queues.map((q) => ({
        queue: q.name, pool: q.pool, paused: q.paused ? "yes" : "", queued: q.queued, deferred: q.deferred,
        active: q.active, failed: q.failed, "done/min": q.completedPerMin ?? "-", "oldest(s)": q.oldestReadySeconds ?? "-",
      })));
      return;
    }
    case "stats": {
      const name = requireQueue(rest[0]);
      const hours = Number(flag(args, "hours") ?? 1);
      const series = await queueSeries(name, Number.isFinite(hours) && hours > 0 ? hours : 1);
      table(series.slice(-30).map((s) => ({
        at: s.at.slice(0, 16).replace("T", " "), queued: s.queued, active: s.active, completed: s.completed,
        failed: s.failed, "wait p95(s)": s.waitP95 ?? "-", "run p95(s)": s.runP95 ?? "-",
      })));
      return;
    }
    case "failed": {
      const queue = flag(args, "queue");
      if (queue) requireQueue(queue);
      const limit = Number(flag(args, "limit") ?? 50);
      const { jobs } = await listJobs({ tab: "failed", queue, limit: Number.isFinite(limit) ? limit : 50 });
      table(jobs.map((j) => ({
        id: j.id, queue: j.queue.replace(/\.dead$/, ""), tenant: j.tenant ?? "-", created: j.createdOn.slice(0, 19).replace("T", " "),
        error: (j.error ?? "").slice(0, 80),
      })));
      return;
    }
    case "retry": {
      if (args.includes("--all-failed")) {
        const name = requireQueue(flag(args, "queue"));
        const def = getJob(name)!;
        const b = await boss();
        let total = 0;
        for (;;) {
          const moved = await b.redrive(def.deadLetter, { limit: 1000 });
          total += moved;
          if (moved < 1000) break;
        }
        await audit("jobs_retry", { queue: name, details: { all: true, count: total } });
        console.log(`Redrove ${total} failed job(s) back to ${name}.`);
        return;
      }
      const ids = validIds(rest);
      if (ids.length === 0) throw new UsageError("ops queue retry <id…> | --queue q --all-failed");
      for (const [dead, group] of await locateFailed(ids)) {
        const n = await retryJobs(dead, group);
        await audit("jobs_retry", { queue: dead, jobIds: group, details: { count: n } });
        console.log(`Redrove ${n} job(s) from ${dead}.`);
      }
      return;
    }
    case "forget": {
      const ids = validIds(rest);
      if (ids.length === 0) throw new UsageError("ops queue forget <id…>");
      for (const [dead, group] of await locateFailed(ids)) {
        const n = await deleteJobs(dead, group);
        await audit("jobs_delete", { queue: dead, jobIds: group, details: { count: n } });
        console.log(`Deleted ${n} failed job(s) from ${dead}.`);
      }
      return;
    }
    case "flush": {
      const queue = flag(args, "queue");
      const defs = queue ? [getJob(requireQueue(queue))!] : [...JOBS];
      const b = await boss();
      for (const def of defs) {
        await b.deleteAllJobs(def.deadLetter);
        await audit("queue_flush", { queue: def.deadLetter });
      }
      console.log(`Deleted all failed jobs${queue ? ` of ${queue}` : ""}.`);
      return;
    }
    case "clear": {
      const name = requireQueue(rest[0]);
      if (!args.includes("--yes")) {
        const ok = await p.confirm({ message: `Delete every job still WAITING in ${name}? This cannot be undone.` });
        if (p.isCancel(ok) || !ok) throw new Error("Cancelled");
      }
      const b = await boss();
      await b.deleteQueuedJobs(name);
      await audit("queue_clear", { queue: name });
      console.log(`Cleared waiting jobs from ${name}.`);
      return;
    }
    case "pause":
    case "resume": {
      const name = requireQueue(rest[0]);
      await setPaused(name, sub === "pause", actor);
      await audit(`queue_${sub}`, { queue: name });
      console.log(`${name} ${sub === "pause" ? "paused: workers stop fetching within ~10 s" : "resumed"}.`);
      return;
    }
    default:
      throw new UsageError(`Unknown queue command: ${sub ?? "(none)"}`);
  }
}

// ── Main ──────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  const [group, ...args] = argv;
  if (!group || group === "help" || group === "--help" || group === "-h") {
    console.log(HELP);
    return group ? 0 : 2;
  }
  let started: Awaited<ReturnType<typeof createBoss>> | null = null;
  try {
    if (group === "operator") {
      await operatorCommand(args);
    } else if (group === "queue") {
      started = createBoss({ instanceName: "cli", registerInstance: false, application_name: "hisaabo-ops-cli", max: 2 });
      await started.start();
      useOpsBoss(started);
      await queueCommand(args);
    } else {
      throw new UsageError(`Unknown command: ${group}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(color.red(err.message));
      console.error(`Run ${color.cyan("ops help")} for usage.`);
      return 2;
    }
    console.error(color.red((err as Error).message));
    return 1;
  } finally {
    if (started) await started.stop({ graceful: false, close: true }).catch(() => {});
  }
}

const invokedDirectly = process.argv[1] && /\bops\.(ts|js)$/.test(process.argv[1]);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(async (code) => {
    await closeControlClient().catch(() => {});
    process.exit(code);
  });
}
