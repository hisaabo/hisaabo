import * as readline from "readline";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, outputTSV, outputCSV, outputIds,
  paginationFooter, EXIT, getWidthTier, hasColor, termWidth, success,
  type ColumnDef,
} from "../../output.js";
import {
  formatAmount, formatDate, formatStatus, formatINR,
  fyStart, todayISO, monthStart, monthEnd, currentFY,
} from "../../format.js";
import chalk from "chalk";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DocTypeConfig {
  /** kebab-case CLI command name, e.g. "credit-note" */
  cmd: string;
  /** Human-readable label, e.g. "Credit Note" */
  label: string;
  /** camelCase key on HisaaboClient, e.g. "creditNote" */
  nsKey: keyof HisaaboClient;
  /** Valid status values for this document type */
  statuses: string[];
}

interface ListOpts {
  json?: boolean;
  format?: string;
  status?: string;
  party?: string;
  from?: string;
  to?: string;
  thisMonth?: boolean;
  thisFy?: boolean;
  page?: number;
  limit?: number;
}

interface GetOpts {
  json?: boolean;
}

interface CreateOpts {
  json?: boolean;
  partyId?: string;
  party?: string;
  date?: string;
  dueDate?: string;
  item?: string[];
  qty?: string[];
  rate?: string[];
  notes?: string;
  discount?: string;
  yes?: boolean;
}

interface StatusOpts {
  json?: boolean;
}

interface DeleteOpts {
  yes?: boolean;
  json?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

type DocNamespace = {
  list(input: any): Promise<any>;
  getById(input: any): Promise<any>;
  create(input: any): Promise<any>;
  updateStatus(input: any): Promise<any>;
  delete(input: any): Promise<any>;
};

function getNs(client: HisaaboClient, nsKey: keyof HisaaboClient): DocNamespace {
  return client[nsKey] as unknown as DocNamespace;
}

async function promptLine(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── list ───────────────────────────────────────────────────────────────────

export async function docListCommand(dt: DocTypeConfig, opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const ns = getNs(client, dt.nsKey);

  let from = opts.from;
  let to = opts.to;
  if (opts.thisFy) { from = fyStart(); to = todayISO(); }
  else if (opts.thisMonth) { from = monthStart(); to = monthEnd(); }

  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await ns.list({
      status: opts.status ?? null,
      partySearch: opts.party ?? null,
      fromDate: from ?? null,
      toDate: to ?? null,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON({
        data: result.data,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          hasMore: result.page * result.limit < result.total,
        },
      });
      return;
    }

    const tier = getWidthTier();

    console.log(`\n ${dt.label}s` + " ".repeat(Math.max(1, 40 - dt.label.length)) + `FY ${currentFY()}`);
    console.log(` ${"═".repeat(68)}\n`);

    const narrowCols: ColumnDef<any>[] = [
      { key: "documentNumber", header: "#", width: 12 },
      { key: "partyName", header: "Party", width: 18 },
      { key: "totalAmount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status", header: "Status", width: 10, format: (v) => formatStatus(String(v ?? "")) },
    ];

    const standardCols: ColumnDef<any>[] = [
      { key: "documentNumber", header: "#", width: 12 },
      { key: "partyName", header: "Party", width: 18 },
      { key: "documentDate", header: "Date", width: 12, format: (v) => formatDate(String(v ?? "")) },
      { key: "totalAmount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status", header: "Status", width: 10, format: (v) => formatStatus(String(v ?? "")) },
    ];

    const wideCols: ColumnDef<any>[] = [
      { key: "documentNumber", header: "#", width: 12 },
      { key: "partyName", header: "Party", width: 20 },
      { key: "documentDate", header: "Date", width: 12, format: (v) => formatDate(String(v ?? "")) },
      { key: "dueDate", header: "Due", width: 12, format: (v) => formatDate(v ? String(v) : null) },
      { key: "totalAmount", header: "Amount (₹)", align: "right", width: 13, format: (v) => formatAmount(String(v ?? "0")) },
      { key: "status", header: "Status", width: 10, format: (v) => formatStatus(String(v ?? "")) },
    ];

    const cols = tier === "narrow" ? narrowCols : tier === "wide" ? wideCols : standardCols;

    if (opts.format === "tsv") {
      outputTSV(result.data, cols);
    } else if (opts.format === "csv") {
      outputCSV(result.data, cols);
    } else if (opts.format === "ids") {
      outputIds(result.data.map((r: any) => r.id));
    } else {
      outputTable(result.data, cols);
      paginationFooter(result.page, result.limit, result.total);
    }
  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

// ── get ────────────────────────────────────────────────────────────────────

export async function docGetCommand(dt: DocTypeConfig, id: string, opts: GetOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const ns = getNs(client, dt.nsKey);

  try {
    const doc = await ns.getById({ id });

    if (opts.json) {
      outputJSON(doc);
      return;
    }

    const w = Math.min(termWidth() - 2, 68);
    const inner = w - 2;

    function line(left: string, right?: string): void {
      if (right !== undefined) {
        const pad = Math.max(1, inner - left.length - right.length - 2);
        process.stdout.write(`│ ${left}${" ".repeat(pad)}${right} │\n`);
      } else {
        const vis = left.length;
        const pad = Math.max(0, inner - vis);
        process.stdout.write(`│ ${left}${" ".repeat(pad)} │\n`);
      }
    }

    function divider(): void {
      process.stdout.write(`├${"─".repeat(inner + 2)}┤\n`);
    }

    const docNum = doc.documentNumber ?? doc.number ?? id;
    const title = `${dt.label.toUpperCase()}  ${docNum}`;
    const statusBadge = formatStatus(doc.status ?? "draft");
    // eslint-disable-next-line no-control-regex
    const statusLen = statusBadge.replace(/\x1b\[[0-9;]*m/g, "").length;
    const topPad = Math.max(1, inner - title.length - statusLen);

    process.stdout.write(`\n ┌${"─".repeat(inner + 2)}┐\n`);
    process.stdout.write(`│ ${hasColor() ? chalk.bold(title) : title}${" ".repeat(topPad)}${statusBadge} │\n`);
    divider();
    if (doc.partyName) line(`Party:   ${doc.partyName}`);
    if (doc.documentDate ?? doc.date) line(`Date:    ${formatDate(doc.documentDate ?? doc.date)}`);
    if (doc.dueDate) line(`Due:     ${formatDate(doc.dueDate)}`);
    if (doc.createdByName) line(`Created: ${doc.createdByName}${doc.createdAt ? ` (${formatDate(doc.createdAt)})` : ""}`);
    divider();

    // Line items
    const items: any[] = doc.lineItems ?? doc.items ?? [];
    if (items.length > 0) {
      process.stdout.write(`│${"─".repeat(inner + 2)}│\n`);
      process.stdout.write(`│   #  ${"Item".padEnd(18)} ${"Qty".padStart(5)} ${"Rate (₹)".padStart(10)} ${"Amount (₹)".padStart(12)}  │\n`);
      process.stdout.write(`│  ${"──".padEnd(2)} ${"─".repeat(18)} ${"─".repeat(5)} ${"─".repeat(10)} ${"─".repeat(12)}  │\n`);

      items.forEach((item: any, i: number) => {
        const idx = String(i + 1).padStart(2);
        const desc = (item.description ?? item.name ?? "").slice(0, 18).padEnd(18);
        const qty = String(item.quantity ?? "1").padStart(5);
        const rate = formatAmount(String(item.unitPrice ?? item.rate ?? "0")).padStart(10);
        const amt = formatAmount(String(item.amount ?? "0")).padStart(12);
        process.stdout.write(`│   ${idx}  ${desc} ${qty} ${rate} ${amt}   │\n`);
      });

      process.stdout.write(`│${"─".repeat(inner + 2)}│\n`);
      divider();
    }

    // Totals
    if (doc.totalAmount !== undefined) {
      if (doc.subtotal !== undefined) line(`Subtotal:`, formatAmount(String(doc.subtotal)).padStart(16));
      if (doc.totalDiscount !== undefined && parseFloat(String(doc.totalDiscount)) !== 0)
        line(`Discount:`, ("-" + formatAmount(String(doc.totalDiscount))).padStart(16));
      process.stdout.write(`│  ${"─".repeat(inner - 2)}  │\n`);
      line(`Total:`, (hasColor() ? chalk.bold(formatAmount(String(doc.totalAmount))) : formatAmount(String(doc.totalAmount))).padStart(16));
    }

    if (doc.notes || doc.termsAndConditions) {
      divider();
      if (doc.notes) line(`Notes: ${doc.notes}`);
      if (doc.termsAndConditions) line(`Terms: ${doc.termsAndConditions}`);
    }

    process.stdout.write(` └${"─".repeat(inner + 2)}┘\n\n`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`${dt.label} not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

// ── create ─────────────────────────────────────────────────────────────────

export async function docCreateCommand(dt: DocTypeConfig, opts: CreateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const ns = getNs(client, dt.nsKey);

  const isNonInteractive = !process.stdin.isTTY || opts.yes;

  try {
    // ── Resolve party ──────────────────────────────────────────────
    let partyId = opts.partyId;
    let partyName = opts.party ?? "";

    if (!partyId) {
      if (!isNonInteractive) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log(`\n  New ${dt.label}`);
        console.log("  " + "─".repeat(40) + "\n");

        const search = await promptLine(rl, "  Select Party:\n  > Search: ");
        const parties = await client.party.list({ search: search.trim(), limit: 5 });

        if (parties.data.length === 0) {
          rl.close();
          fatalError("No parties found. Create one with: hisaabo party create", EXIT.NOT_FOUND);
        }

        parties.data.forEach((p: any, i: number) => {
          console.log(`    ${i + 1}  ${p.name.padEnd(20)} ${(p.phone ?? "").padEnd(14)}  ${p.type}`);
        });

        const partyChoice = await promptLine(rl, "\n  Party [1]: ");
        const idx = parseInt(partyChoice.trim() || "1", 10) - 1;
        const selected = parties.data[Math.max(0, Math.min(idx, parties.data.length - 1))];
        if (!selected) { rl.close(); fatalError("Invalid selection.", EXIT.USAGE); }
        partyId = selected.id;
        partyName = selected.name;
        console.log(`  Party: ${partyName}\n`);
        rl.close();
      } else {
        if (!partyName) fatalError("--party or --party-id is required", EXIT.USAGE);
        const parties = await client.party.list({ search: partyName, limit: 5 });
        if (parties.data.length === 0) fatalError(`Party not found: ${partyName}`, EXIT.NOT_FOUND);
        partyId = parties.data[0]!.id;
        partyName = parties.data[0]!.name;
      }
    }

    // ── Build line items ───────────────────────────────────────────
    const lineItems: Array<{ itemId?: string; description: string; quantity: string; unitPrice: string; taxPercent?: string; discountPercent?: string }> = [];

    if (opts.item && opts.item.length > 0) {
      for (let i = 0; i < opts.item.length; i++) {
        const itemName = opts.item[i]!;
        const qty = opts.qty?.[i] ?? "1";
        let unitPrice = opts.rate?.[i] ?? "";

        if (!unitPrice) {
          const items = await client.item.list({ search: itemName, limit: 3 });
          if (items.data.length > 0 && items.data[0]?.salePrice) {
            unitPrice = items.data[0].salePrice;
            lineItems.push({
              itemId: items.data[0].id,
              description: items.data[0].name,
              quantity: qty,
              unitPrice,
              taxPercent: items.data[0].taxPercent,
            });
          } else {
            fatalError(`Item not found or has no price: ${itemName}. Use --rate to specify price.`, EXIT.NOT_FOUND);
          }
        } else {
          const items = await client.item.list({ search: itemName, limit: 3 });
          const matched = items.data.find((it: any) =>
            it.name.toLowerCase().includes(itemName.toLowerCase()),
          );
          if (matched) {
            lineItems.push({
              itemId: matched.id,
              description: matched.name,
              quantity: qty,
              unitPrice,
              taxPercent: matched.taxPercent,
            });
          } else {
            lineItems.push({ description: itemName, quantity: qty, unitPrice });
          }
        }
      }
    } else if (!isNonInteractive) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log("  Add Line Items (empty description to finish):\n");
      let itemNum = 1;

      while (true) {
        console.log(`  Item ${itemNum}:`);
        const search = await promptLine(rl, "    Search item (or description): ");
        if (!search.trim()) break;

        let description = search.trim();
        let itemId: string | undefined;
        let defaultPrice = "";
        let defaultTax = "0";

        const items = await client.item.list({ search: search.trim(), limit: 5 });
        if (items.data.length > 0) {
          items.data.forEach((it: any, i: number) => {
            const stock = it.itemType === "service" ? "-" : String(it.stockQuantity);
            const price = it.salePrice ? formatINR(it.salePrice) : "no price";
            console.log(`      ${i + 1}  ${it.name.padEnd(20)} ${price.padEnd(12)}  Stock: ${stock}`);
          });
          const choice = await promptLine(rl, "    Item [1] (or 0 to use as description): ");
          const idx = parseInt(choice.trim() || "1", 10);
          if (idx > 0) {
            const selected = items.data[idx - 1];
            if (selected) {
              itemId = selected.id;
              description = selected.name;
              defaultPrice = selected.salePrice ?? "";
              defaultTax = selected.taxPercent;
            }
          }
        }

        const qtyStr = await promptLine(rl, "    Quantity [1]: ");
        const qty = qtyStr.trim() || "1";

        const rateStr = await promptLine(rl, `    Unit Price [${defaultPrice || "0.00"}]: `);
        const unitPrice = rateStr.trim() || defaultPrice || "0.00";

        const taxStr = await promptLine(rl, `    Tax % [${defaultTax}]: `);
        const taxPercent = taxStr.trim() || defaultTax;

        const discStr = await promptLine(rl, "    Discount % [0]: ");
        const discountPercent = discStr.trim() || "0";

        const amount =
          parseFloat(qty) *
          parseFloat(unitPrice) *
          (1 + parseFloat(taxPercent) / 100) *
          (1 - parseFloat(discountPercent) / 100);
        console.log(
          `    > ${description}  x${qty}  @${formatAmount(unitPrice)}  ${taxPercent}% tax  = ${formatAmount(String(amount))}\n`,
        );

        lineItems.push({ itemId, description, quantity: qty, unitPrice, taxPercent, discountPercent });
        itemNum++;
      }
      rl.close();

      if (lineItems.length === 0) fatalError("No line items added.", EXIT.USAGE);
    } else {
      fatalError("No items specified. Use --item flags.", EXIT.USAGE);
    }

    // ── Summary & confirm ──────────────────────────────────────────
    const subtotal = lineItems.reduce((s, item) => {
      return s + parseFloat(item.quantity) * parseFloat(item.unitPrice);
    }, 0);
    const taxTotal = lineItems.reduce((s, item) => {
      const amt = parseFloat(item.quantity) * parseFloat(item.unitPrice);
      return s + amt * (parseFloat(item.taxPercent ?? "0") / 100);
    }, 0);

    let documentDate = opts.date ?? todayISO();
    let dueDate = opts.dueDate;
    let notes = opts.notes;

    if (!isNonInteractive) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log(`\n  ─── ${dt.label} Summary ───────────────────────────`);
      console.log(`  Subtotal:  ${formatAmount(String(subtotal))}`);
      console.log(`  Tax:       ${formatAmount(String(taxTotal))}`);
      console.log(`  Total:     ${formatAmount(String(subtotal + taxTotal))}`);
      console.log("  ───────────────────────────────────────────────\n");

      const dateStr = await promptLine(rl, `  Date [${todayISO()}]: `);
      if (dateStr.trim()) documentDate = dateStr.trim();

      const dueStr = await promptLine(rl, "  Due Date [optional]: ");
      if (dueStr.trim()) dueDate = dueStr.trim();

      const notesStr = await promptLine(rl, "  Notes: ");
      if (notesStr.trim()) notes = notesStr.trim();

      console.log("  ───────────────────────────────────────────────");
      const confirm = await promptLine(rl, `\n  Create this ${dt.label}? (y/n) [y]: `);
      rl.close();

      if (confirm.trim().toLowerCase() === "n") {
        console.log("  Cancelled.");
        process.exit(EXIT.SUCCESS);
      }
    }

    // ── Create ────────────────────────────────────────────────────
    const doc = await ns.create({
      partyId: partyId!,
      documentDate,
      dueDate,
      notes,
      lineItems,
      ...(opts.discount ? { invoiceDiscount: opts.discount } : {}),
    });

    if (opts.json) {
      outputJSON(doc);
      return;
    }

    const docNum = doc.documentNumber ?? doc.number ?? doc.id;
    const total = doc.totalAmount ?? String(subtotal + taxTotal);
    success(`Created: ${docNum} for ${formatINR(total)}`);
    console.log(`  View:    hisaabo ${dt.cmd} get ${doc.id}\n`);

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

// ── update-status ──────────────────────────────────────────────────────────

export async function docStatusCommand(
  dt: DocTypeConfig,
  id: string,
  status: string,
  opts: StatusOpts,
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const ns = getNs(client, dt.nsKey);

  if (!dt.statuses.includes(status)) {
    fatalError(`Invalid status: ${status}. Valid: ${dt.statuses.join(", ")}`, EXIT.USAGE);
  }

  try {
    const before = await ns.getById({ id });
    const updated = await ns.updateStatus({ id, status });

    if (opts.json) {
      outputJSON(updated);
      return;
    }

    const fromBadge = formatStatus(before.status ?? "draft");
    const toBadge = formatStatus(status);
    console.log(`  ${id} status updated: ${fromBadge} -> ${toBadge}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`${dt.label} not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "validation_failed") fatalError(e.message, EXIT.VALIDATION);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

// ── delete ─────────────────────────────────────────────────────────────────

export async function docDeleteCommand(
  dt: DocTypeConfig,
  id: string,
  opts: DeleteOpts,
): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const ns = getNs(client, dt.nsKey);

  try {
    const doc = await ns.getById({ id });
    const docNum = doc.documentNumber ?? doc.number ?? id;

    if (!opts.yes && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(
          `  Delete ${docNum} (${doc.partyName ?? ""}, ${doc.totalAmount ?? ""})? (y/N): `,
          resolve,
        );
      });
      rl.close();
      if (answer.trim().toLowerCase() !== "y") {
        console.log("  Cancelled.");
        process.exit(0);
      }
    }

    const result = await ns.delete({ id });

    if (opts.json) {
      outputJSON(result);
      return;
    }

    success(`Deleted: ${docNum}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`${dt.label} not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "forbidden") fatalError(err.message, EXIT.FORBIDDEN);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
