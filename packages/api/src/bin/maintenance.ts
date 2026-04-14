#!/usr/bin/env tsx
/**
 * maintenance.ts — Interactive TUI for managing Hisaabo's maintenance mode.
 *
 * This is the ONLY way to set maintenance mode — there is no API mutation.
 *
 * USAGE:
 *   pnpm --filter @hisaabo/api maintenance
 *   npx tsx packages/api/src/bin/maintenance.ts
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import * as p from "@clack/prompts";
import color from "picocolors";
import { controlDb, systemConfig } from "@hisaabo/db";
import { eq } from "drizzle-orm";

// ── Types ───────────────────────────────────────────────────────

interface MaintenanceValue {
  enabled: boolean;
  message: string;
  startsAt: string | null;
  endsAt: string | null;
}

const MAINTENANCE_KEY = "maintenance";

const DEFAULT_VALUE: MaintenanceValue = {
  enabled: false,
  message: "",
  startsAt: null,
  endsAt: null,
};

// ── Helpers ─────────────────────────────────────────────────────

function formatDatetime(iso: string | null): string {
  if (!iso) return color.dim("not set");
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    hour12: false,
  });
}

function getStatusLabel(value: MaintenanceValue): string {
  if (value.enabled) {
    return color.red(color.bold("ACTIVE"));
  }
  if (value.startsAt && new Date(value.startsAt) > new Date()) {
    return color.yellow(color.bold("SCHEDULED"));
  }
  return color.green(color.bold("INACTIVE"));
}

function displayStatus(value: MaintenanceValue): string {
  const lines = [
    `Status:        ${getStatusLabel(value)}`,
    `Message:       ${value.message ? color.white(value.message) : color.dim("none")}`,
    `Starts at:     ${formatDatetime(value.startsAt)}`,
    `Estimated end: ${formatDatetime(value.endsAt)}`,
  ];
  return lines.join("\n");
}

async function fetchCurrentValue(): Promise<MaintenanceValue> {
  const [row] = await controlDb
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, MAINTENANCE_KEY));

  if (!row) return { ...DEFAULT_VALUE };
  return row.value as MaintenanceValue;
}

async function upsertValue(value: MaintenanceValue): Promise<void> {
  await controlDb
    .insert(systemConfig)
    .values({
      key: MAINTENANCE_KEY,
      value,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value,
        updatedAt: new Date(),
      },
    });
}

function validateIsoDatetime(input: string): string | undefined {
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) {
    return "Invalid date. Use ISO format, e.g. 2026-04-15T02:00:00Z";
  }
}

function handleCancel<T>(value: T | symbol): asserts value is T {
  if (p.isCancel(value)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  p.intro(color.bgCyan(color.black(" Hisaabo Maintenance Mode ")));

  // Fetch and display current status
  const current = await fetchCurrentValue();
  p.note(displayStatus(current), "Current Status");

  // Ask what to do
  const action = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "schedule", label: "Schedule maintenance", hint: "set message + start/end time, enabled=false" },
      { value: "activate", label: "Activate maintenance NOW", hint: "blocks all users immediately" },
      { value: "deactivate", label: "Deactivate maintenance", hint: "clear everything and re-open" },
      { value: "view", label: "View current status", hint: "just display and exit" },
    ],
  });
  handleCancel(action);

  // ── View ────────────────────────────────────────────────────

  if (action === "view") {
    p.outro(color.green("No changes made."));
    process.exit(0);
  }

  // ── Deactivate ──────────────────────────────────────────────

  if (action === "deactivate") {
    const confirm = await p.confirm({
      message: "Deactivate maintenance mode?",
    });
    handleCancel(confirm);

    if (!confirm) {
      p.outro(color.yellow("No changes made."));
      process.exit(0);
    }

    const newValue: MaintenanceValue = {
      enabled: false,
      message: "",
      startsAt: null,
      endsAt: null,
    };
    await upsertValue(newValue);

    p.note(displayStatus(newValue), "Updated Status");
    p.outro(color.green("Maintenance mode deactivated. All users can access the system."));
    process.exit(0);
  }

  // ── Schedule ────────────────────────────────────────────────

  if (action === "schedule") {
    const message = await p.text({
      message: "Maintenance message (shown to users):",
      placeholder: "Database migration — estimated 30 minutes",
      validate: (v) => {
        if (!v || !v.trim()) return "Message is required.";
      },
    });
    handleCancel(message);

    const startsAt = await p.text({
      message: "Start time (ISO format):",
      placeholder: "2026-04-15T02:00:00Z",
      validate: (v) => {
        if (!v) return "Start time is required.";
        return validateIsoDatetime(v);
      },
    });
    handleCancel(startsAt);

    const endsAt = await p.text({
      message: "Estimated end time (ISO format, leave empty to skip):",
      placeholder: "2026-04-15T04:00:00Z",
      validate: (v) => {
        if (!v || !v.trim()) return undefined; // optional
        return validateIsoDatetime(v);
      },
    });
    handleCancel(endsAt);

    const newValue: MaintenanceValue = {
      enabled: false,
      message: String(message).trim(),
      startsAt: new Date(String(startsAt).trim()).toISOString(),
      endsAt: String(endsAt).trim() ? new Date(String(endsAt).trim()).toISOString() : null,
    };
    await upsertValue(newValue);

    p.note(displayStatus(newValue), "Updated Status");
    p.outro(color.green("Maintenance scheduled. Remember to activate it when the window starts."));
    process.exit(0);
  }

  // ── Activate NOW ────────────────────────────────────────────

  if (action === "activate") {
    const message = await p.text({
      message: "Maintenance message (shown to users):",
      placeholder: "We are performing scheduled maintenance. Please check back shortly.",
      validate: (v) => {
        if (!v || !v.trim()) return "Message is required.";
      },
    });
    handleCancel(message);

    const endsAt = await p.text({
      message: "Estimated end time (ISO format, leave empty to skip):",
      placeholder: "2026-04-15T04:00:00Z",
      validate: (v) => {
        if (!v || !v.trim()) return undefined; // optional
        return validateIsoDatetime(v);
      },
    });
    handleCancel(endsAt);

    const confirm = await p.confirm({
      message: color.red("This will block ALL users immediately. Continue?"),
    });
    handleCancel(confirm);

    if (!confirm) {
      p.outro(color.yellow("No changes made."));
      process.exit(0);
    }

    const newValue: MaintenanceValue = {
      enabled: true,
      message: String(message).trim(),
      startsAt: new Date().toISOString(),
      endsAt: String(endsAt).trim() ? new Date(String(endsAt).trim()).toISOString() : null,
    };
    await upsertValue(newValue);

    p.note(displayStatus(newValue), "Updated Status");
    p.outro(color.red("Maintenance mode ACTIVATED. All users are blocked."));
    process.exit(0);
  }
}

main().catch((err) => {
  p.cancel(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
