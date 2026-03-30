import { Command } from "commander";
import * as readline from "readline";
import { login, loginWithToken, logout, whoami } from "../auth.js";
import { setConfig, requireAuth } from "../config.js";
import { HisaaboClient, HisaaboApiError } from "../client.js";
import { fatalError, success, EXIT, outputJSON } from "../output.js";

// ── Commands ──────────────────────────────────────────────────────────────

import { dashboardCommand } from "../commands/dashboard.js";
import { invoiceListCommand } from "../commands/invoice/list.js";
import { invoiceGetCommand } from "../commands/invoice/get.js";
import { invoiceCreateCommand } from "../commands/invoice/create.js";
import { invoiceStatusCommand } from "../commands/invoice/status.js";
import { invoicePdfCommand } from "../commands/invoice/pdf.js";
import { invoiceDeleteCommand } from "../commands/invoice/delete.js";
import { partyListCommand } from "../commands/party/list.js";
import { partyGetCommand } from "../commands/party/get.js";
import { partyCreateCommand } from "../commands/party/create.js";
import { partyDeleteCommand } from "../commands/party/delete.js";
import { partyLedgerCommand } from "../commands/party/ledger.js";
import { itemListCommand } from "../commands/item/list.js";
import { itemCreateCommand } from "../commands/item/create.js";
import { itemDeleteCommand } from "../commands/item/delete.js";
import { itemStockCommand } from "../commands/item/stock.js";
import { paymentListCommand } from "../commands/payment/list.js";
import { paymentCreateCommand } from "../commands/payment/create.js";
import { paymentDeleteCommand } from "../commands/payment/delete.js";
import { expenseListCommand } from "../commands/expense/list.js";
import { expenseCreateCommand } from "../commands/expense/create.js";
import { expenseDeleteCommand } from "../commands/expense/delete.js";
import { gstR1Command, gstR3bCommand, gstR1CsvCommand } from "../commands/gst/index.js";
import {
  reportDaybookCommand, reportOutstandingCommand, reportTaxSummaryCommand,
  reportItemSalesCommand, reportStockSummaryCommand,
} from "../commands/report/index.js";
import {
  bankListCommand, bankGetCommand, bankCreateCommand, bankTransferCommand, bankTransactionsCommand,
} from "../commands/bank/index.js";
import {
  shipmentListCommand, shipmentGetCommand, shipmentCreateCommand, shipmentUpdateCommand,
} from "../commands/shipment/index.js";
import { targetListCommand, targetMyCommand, targetCreateCommand } from "../commands/target/index.js";
import { storeSettingsCommand, storeOrdersCommand } from "../commands/store/index.js";
import { importPartiesCommand, importItemsCommand } from "../commands/import/index.js";

// ── Program ───────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("hisaabo")
  .description("Hisaabo CLI — Invoicing and business management")
  .version("0.1.0");

// ── login ─────────────────────────────────────────────────────────────────

program
  .command("login")
  .description("Authenticate and configure your Hisaabo server")
  .option("--url <url>", "Server URL")
  .option("--email <email>", "Email address")
  .option("--password <password>", "Password")
  .option("--token <token>", "API key (hisaabo_key_...) for passwordless auth")
  .action(async (opts) => {
    let apiUrl = opts.url;

    // ── API key path — skip email/password flow ──
    if (opts.token) {
      if (!apiUrl) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
        console.log("\n  Hisaabo CLI\n  " + "─".repeat(11) + "\n");
        const u = await ask("  Server URL [http://localhost:3000]: ");
        rl.close();
        apiUrl = u.trim() || "http://localhost:3000";
      }
      await loginWithToken(apiUrl, opts.token);
      return;
    }

    // ── Email/password path ──
    let email = opts.email;
    let password = opts.password;

    if (!apiUrl || !email || !password) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
      console.log("\n  Hisaabo CLI\n  " + "─".repeat(11) + "\n");
      if (!apiUrl) {
        const u = await ask("  Server URL [http://localhost:3000]: ");
        apiUrl = u.trim() || "http://localhost:3000";
      }
      if (!email) email = (await ask("  Email: ")).trim();
      if (!password) {
        // Hide password input if possible
        password = (await ask("  Password: ")).trim();
      }
      rl.close();
      console.log("\n  Tip: Generate an API key at Settings → API Keys for passwordless CLI access.\n");
    }

    await login(apiUrl, email, password);
  });

// ── logout ────────────────────────────────────────────────────────────────

program
  .command("logout")
  .description("Log out and clear saved credentials")
  .action(async () => {
    await logout();
  });

// ── whoami ────────────────────────────────────────────────────────────────

program
  .command("whoami")
  .description("Show current user and active business")
  .option("--json", "JSON output")
  .action(async (opts) => {
    await whoami(!!opts.json);
  });

// ── switch (business) ─────────────────────────────────────────────────────

program
  .command("switch")
  .description("Switch active business")
  .option("--json", "JSON output")
  .action(async (opts) => {
    const cfg = requireAuth();
    const client = new HisaaboClient(cfg);
    try {
      const businesses = await client.business.list();
      if (opts.json) { outputJSON(businesses); return; }
      businesses.forEach((b, i) => {
        const active = b.id === cfg.businessId ? " [active]" : "";
        console.log(`  ${i + 1}  ${b.name.padEnd(28)}${active}`);
      });
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((res) => rl.question("\n  Select: ", res));
      rl.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      const selected = businesses[Math.max(0, Math.min(idx, businesses.length - 1))];
      if (!selected) fatalError("Invalid selection.", EXIT.USAGE);
      setConfig({ businessId: selected.id, businessName: selected.name });
      success(`Switched to: ${selected.name}`);
    } catch (e) {
      if (e instanceof HisaaboApiError) {
        if (e.hisaaboError.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      }
      fatalError(String(e instanceof Error ? e.message : e));
    }
  });

// ── dashboard ─────────────────────────────────────────────────────────────

program
  .command("dashboard")
  .alias("dash")
  .description("Show financial summary dashboard")
  .option("--json", "JSON output")
  .action(async (opts) => {
    await dashboardCommand({ json: opts.json });
  });

// ── invoice ───────────────────────────────────────────────────────────────

const invoice = program.command("invoice").description("Invoice management");

invoice
  .command("list")
  .description("List invoices")
  .option("--json", "JSON output")
  .option("--format <format>", "Output format: table, tsv, csv, ids")
  .option("--type <type>", "sale or purchase")
  .option("--status <status>", "Filter by status")
  .option("--party <name>", "Filter by party name")
  .option("--party-id <id>", "Filter by party ID")
  .option("--from <date>", "From date (YYYY-MM-DD)")
  .option("--to <date>", "To date (YYYY-MM-DD)")
  .option("--this-month", "Filter to current month")
  .option("--this-quarter", "Filter to current quarter")
  .option("--this-fy", "Filter to current financial year")
  .option("--page <n>", "Page number", parseInt)
  .option("--limit <n>", "Items per page", parseInt)
  .option("--search <q>", "Search invoices")
  .option("--sort-by <field>", "Sort field: date, amount, number")
  .option("--sort-dir <dir>", "Sort direction: asc, desc")
  .action(async (opts) => {
    await invoiceListCommand({
      json: opts.json,
      format: opts.format,
      type: opts.type,
      status: opts.status,
      party: opts.party,
      partyId: opts.partyId,
      from: opts.from,
      to: opts.to,
      thisMonth: opts.thisMonth,
      thisQuarter: opts.thisQuarter,
      thisFy: opts.thisFy,
      page: opts.page,
      limit: opts.limit,
      search: opts.search,
      sortBy: opts.sortBy,
      sortDir: opts.sortDir,
    });
  });

invoice
  .command("get <id>")
  .description("Get invoice details")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    await invoiceGetCommand(id, { json: opts.json });
  });

invoice
  .command("create")
  .description("Create a new invoice")
  .option("--json", "JSON output")
  .option("--party <name>", "Party name")
  .option("--party-id <id>", "Party UUID")
  .option("--type <type>", "sale or purchase")
  .option("--item <name>", "Item (repeatable)", (v, a: string[]) => [...a, v], [] as string[])
  .option("--qty <n>", "Quantity (per --item)", (v, a: string[]) => [...a, v], [] as string[])
  .option("--rate <n>", "Unit price (per --item)", (v, a: string[]) => [...a, v], [] as string[])
  .option("--delivery <method>", "Delivery method")
  .option("--notes <text>", "Invoice notes")
  .option("--terms <text>", "Terms and conditions")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (opts) => {
    await invoiceCreateCommand({
      json: opts.json,
      party: opts.party,
      partyId: opts.partyId,
      type: opts.type,
      items: opts.item,
      qty: opts.qty,
      rate: opts.rate,
      delivery: opts.delivery,
      notes: opts.notes,
      terms: opts.terms,
      yes: opts.yes,
    });
  });

invoice
  .command("status <id> <status>")
  .description("Update invoice status")
  .option("--json", "JSON output")
  .action(async (id, status, opts) => {
    await invoiceStatusCommand(id, status, { json: opts.json });
  });

invoice
  .command("pdf <id>")
  .description("Download invoice as PDF")
  .option("--output <path>", "Output path or directory")
  .option("--open", "Open after download")
  .action(async (id, opts) => {
    await invoicePdfCommand(id, { output: opts.output, open: opts.open });
  });

invoice
  .command("delete <id>")
  .description("Delete an invoice")
  .option("-y, --yes", "Skip confirmation")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    await invoiceDeleteCommand(id, { yes: opts.yes, json: opts.json });
  });

// ── party ─────────────────────────────────────────────────────────────────

const party = program.command("party").description("Party (customer/supplier) management");

party
  .command("list")
  .description("List parties")
  .option("--json", "JSON output")
  .option("--format <format>", "Output format: table, tsv, csv, ids")
  .option("--type <type>", "customer or supplier")
  .option("--search <q>", "Search")
  .option("--category <cat>", "Filter by category")
  .option("--page <n>", "Page number", parseInt)
  .option("--limit <n>", "Items per page", parseInt)
  .action(async (opts) => {
    await partyListCommand({
      json: opts.json,
      format: opts.format,
      type: opts.type,
      search: opts.search,
      category: opts.category,
      page: opts.page,
      limit: opts.limit,
    });
  });

party
  .command("get <id>")
  .description("Get party details")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    await partyGetCommand(id, { json: opts.json });
  });

party
  .command("create")
  .description("Create a new party")
  .option("--json", "JSON output")
  .option("--type <type>", "customer or supplier")
  .option("--name <name>", "Party name")
  .option("--phone <phone>", "Phone number")
  .option("--email <email>", "Email address")
  .option("--gstin <gstin>", "GSTIN")
  .option("--city <city>", "City")
  .option("--category <cat>", "Category")
  .option("-y, --yes", "Skip confirmation")
  .action(async (opts) => {
    await partyCreateCommand(opts);
  });

party
  .command("delete <id>")
  .description("Delete a party")
  .option("-y, --yes", "Skip confirmation")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    await partyDeleteCommand(id, { yes: opts.yes, json: opts.json });
  });

party
  .command("ledger <partyId>")
  .description("Show party ledger (debit/credit history)")
  .option("--json", "JSON output")
  .option("--format <format>", "Output format: table, tsv, csv")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--page <n>", "Page number", parseInt)
  .option("--limit <n>", "Items per page", parseInt)
  .action(async (partyId, opts) => {
    await partyLedgerCommand(partyId, opts);
  });

// ── item ──────────────────────────────────────────────────────────────────

const item = program.command("item").description("Item / product management");

item
  .command("list")
  .description("List items")
  .option("--json", "JSON output")
  .option("--format <format>", "Output format: table, tsv, csv, ids")
  .option("--search <q>", "Search")
  .option("--category <cat>", "Filter by category")
  .option("--type <type>", "product or service")
  .option("--low-stock", "Show only low-stock items")
  .option("--page <n>", "Page number", parseInt)
  .option("--limit <n>", "Items per page", parseInt)
  .action(async (opts) => {
    await itemListCommand({
      json: opts.json,
      format: opts.format,
      search: opts.search,
      category: opts.category,
      type: opts.type,
      lowStock: opts.lowStock,
      page: opts.page,
      limit: opts.limit,
    });
  });

item
  .command("get <id>")
  .description("Get item details")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    const cfg = requireAuth();
    const client = new HisaaboClient(cfg);
    try {
      const it = await client.item.get(id);
      if (opts.json) { outputJSON(it); return; }
      console.log(`\n  ${it.name} (${it.itemType})`);
      console.log("  " + "─".repeat(40));
      if (it.sku) console.log(`  SKU:      ${it.sku}`);
      if (it.hsn) console.log(`  HSN:      ${it.hsn}`);
      console.log(`  Unit:     ${it.unit}`);
      if (it.salePrice) console.log(`  Sale:     ₹${it.salePrice}`);
      if (it.purchasePrice) console.log(`  Purchase: ₹${it.purchasePrice}`);
      console.log(`  Tax:      ${it.taxPercent}%`);
      if (it.itemType === "product") console.log(`  Stock:    ${it.stockQuantity}`);
      console.log();
    } catch (e) {
      if (e instanceof HisaaboApiError && e.hisaaboError.code === "not_found") fatalError(`Item not found: ${id}`, EXIT.NOT_FOUND);
      fatalError(String(e instanceof Error ? e.message : e));
    }
  });

item
  .command("create")
  .description("Create a new item")
  .option("--json", "JSON output")
  .option("--name <name>", "Item name")
  .option("--unit <unit>", "Unit (pcs, kg, etc.)")
  .option("--sale-price <price>", "Sale price")
  .option("--purchase-price <price>", "Purchase price")
  .option("--tax <percent>", "Tax percentage")
  .option("--stock <qty>", "Opening stock quantity")
  .option("--hsn <code>", "HSN code")
  .option("--category <cat>", "Category")
  .option("--type <type>", "product or service")
  .option("-y, --yes", "Skip confirmation")
  .action(async (opts) => {
    await itemCreateCommand({
      json: opts.json,
      name: opts.name,
      unit: opts.unit,
      salePrice: opts.salePrice,
      purchasePrice: opts.purchasePrice,
      taxPercent: opts.tax,
      stock: opts.stock,
      hsn: opts.hsn,
      category: opts.category,
      type: opts.type,
      yes: opts.yes,
    });
  });

item
  .command("delete <id>")
  .description("Delete an item")
  .option("-y, --yes", "Skip confirmation")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    await itemDeleteCommand(id, { yes: opts.yes, json: opts.json });
  });

item
  .command("stock <id> <adjustment>")
  .description("Adjust item stock (+10, -5, 100)")
  .option("--json", "JSON output")
  .option("--reason <text>", "Reason for adjustment")
  .action(async (id, adjustment, opts) => {
    await itemStockCommand(id, adjustment, { json: opts.json, reason: opts.reason });
  });

// ── payment ───────────────────────────────────────────────────────────────

const payment = program.command("payment").description("Payment recording");

payment
  .command("list")
  .description("List payments")
  .option("--json", "JSON output")
  .option("--format <format>", "Output format: table, tsv, csv, ids")
  .option("--party-id <id>", "Filter by party")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--page <n>", "Page number", parseInt)
  .option("--limit <n>", "Items per page", parseInt)
  .action(async (opts) => {
    await paymentListCommand(opts);
  });

payment
  .command("create")
  .description("Record a payment")
  .option("--json", "JSON output")
  .option("--party-id <id>", "Party UUID")
  .option("--party <name>", "Party name")
  .option("--amount <amount>", "Payment amount")
  .option("--mode <mode>", "cash/bank/upi/cheque/other")
  .option("--invoice-id <id>", "Link to invoice")
  .option("--reference <ref>", "Reference number")
  .option("--date <date>", "Payment date")
  .option("--notes <text>", "Notes")
  .option("-y, --yes", "Skip confirmation")
  .action(async (opts) => {
    await paymentCreateCommand({
      json: opts.json,
      partyId: opts.partyId,
      party: opts.party,
      amount: opts.amount,
      mode: opts.mode,
      invoiceId: opts.invoiceId,
      reference: opts.reference,
      date: opts.date,
      notes: opts.notes,
      yes: opts.yes,
    });
  });

payment
  .command("delete <id>")
  .description("Delete a payment")
  .option("-y, --yes", "Skip confirmation")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    await paymentDeleteCommand(id, { yes: opts.yes, json: opts.json });
  });

// ── expense ───────────────────────────────────────────────────────────────

const expense = program.command("expense").description("Expense tracking");

expense
  .command("list")
  .description("List expenses")
  .option("--json", "JSON output")
  .option("--format <format>", "Output format: table, tsv, csv, ids")
  .option("--category <cat>", "Filter by category")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--page <n>", "Page number", parseInt)
  .option("--limit <n>", "Items per page", parseInt)
  .action(async (opts) => {
    await expenseListCommand(opts);
  });

expense
  .command("create")
  .description("Create a new expense")
  .option("--json", "JSON output")
  .option("--category <cat>", "Expense category")
  .option("--amount <amount>", "Amount")
  .option("--mode <mode>", "cash/bank/upi/cheque/other")
  .option("--description <text>", "Description")
  .option("--date <date>", "Expense date")
  .option("--reference <ref>", "Reference number")
  .action(async (opts) => {
    await expenseCreateCommand({
      json: opts.json,
      category: opts.category,
      amount: opts.amount,
      mode: opts.mode,
      description: opts.description,
      date: opts.date,
      reference: opts.reference,
    });
  });

expense
  .command("delete <id>")
  .description("Delete an expense")
  .option("-y, --yes", "Skip confirmation")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    await expenseDeleteCommand(id, { yes: opts.yes, json: opts.json });
  });

// ── gst ───────────────────────────────────────────────────────────────────

const gst = program.command("gst").description("GST reports");

gst
  .command("r1")
  .description("GSTR-1 report")
  .option("--json", "JSON output")
  .option("--quarter <q>", "Quarter: Q1, Q2, Q3, Q4")
  .option("--month <n>", "Month number (1-12)", parseInt)
  .option("--year <n>", "Year", parseInt)
  .action(async (opts) => {
    await gstR1Command({ json: opts.json, quarter: opts.quarter, month: opts.month, year: opts.year });
  });

gst
  .command("r3b")
  .description("GSTR-3B report")
  .option("--json", "JSON output")
  .option("--quarter <q>", "Quarter: Q1, Q2, Q3, Q4")
  .option("--month <n>", "Month number (1-12)", parseInt)
  .option("--year <n>", "Year", parseInt)
  .action(async (opts) => {
    await gstR3bCommand({ json: opts.json, quarter: opts.quarter, month: opts.month, year: opts.year });
  });

gst
  .command("r1-csv")
  .description("Download GSTR-1 as GSTN-compatible CSV")
  .option("--quarter <q>", "Quarter")
  .option("--month <n>", "Month", parseInt)
  .option("--year <n>", "Year", parseInt)
  .option("--output <path>", "Output file path")
  .action(async (opts) => {
    await gstR1CsvCommand({ quarter: opts.quarter, month: opts.month, year: opts.year, output: opts.output });
  });

// ── report ────────────────────────────────────────────────────────────────

const report = program.command("report").description("Business reports");

report
  .command("daybook")
  .description("Day book report (all transactions)")
  .option("--json", "JSON output")
  .option("--format <format>", "tsv or csv")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--this-month", "Current month")
  .option("--this-fy", "Current financial year")
  .action(async (opts) => {
    await reportDaybookCommand(opts);
  });

report
  .command("outstanding")
  .description("Outstanding receivables and payables")
  .option("--json", "JSON output")
  .option("--type <type>", "receivable, payable, or both")
  .action(async (opts) => {
    await reportOutstandingCommand({ json: opts.json, type: opts.type });
  });

report
  .command("tax-summary")
  .description("Tax summary by rate")
  .option("--json", "JSON output")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--this-fy", "Current financial year")
  .action(async (opts) => {
    await reportTaxSummaryCommand(opts);
  });

report
  .command("item-sales")
  .description("Item sales report")
  .option("--json", "JSON output")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--this-fy", "Current financial year")
  .action(async (opts) => {
    await reportItemSalesCommand(opts);
  });

report
  .command("stock")
  .description("Stock summary report")
  .option("--json", "JSON output")
  .option("--category <cat>", "Filter by category")
  .action(async (opts) => {
    await reportStockSummaryCommand({ json: opts.json, category: opts.category });
  });

// ── bank ─────────────────────────────────────────────────────────────────

const bank = program.command("bank").description("Bank account management");

bank
  .command("list")
  .description("List bank accounts with balances")
  .option("--json", "JSON output")
  .action(async (opts) => {
    await bankListCommand({ json: opts.json });
  });

bank
  .command("get <id>")
  .description("Get bank account details")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    await bankGetCommand(id, { json: opts.json });
  });

bank
  .command("create")
  .description("Create a new bank account")
  .option("--json", "JSON output")
  .option("--name <name>", "Account name")
  .option("--type <type>", "savings/current/cash/credit/other")
  .option("--bank <name>", "Bank name")
  .option("--account-number <num>", "Account number")
  .option("--ifsc <code>", "IFSC code")
  .option("--opening-balance <amount>", "Opening balance")
  .option("--default", "Set as default account")
  .option("-y, --yes", "Skip prompts")
  .action(async (opts) => {
    await bankCreateCommand({
      json: opts.json,
      name: opts.name,
      type: opts.type,
      bank: opts.bank,
      accountNumber: opts.accountNumber,
      ifsc: opts.ifsc,
      openingBalance: opts.openingBalance,
      default: opts.default,
      yes: opts.yes,
    });
  });

bank
  .command("transfer")
  .description("Transfer between bank accounts")
  .option("--json", "JSON output")
  .option("--from <id>", "Source account ID")
  .option("--to <id>", "Destination account ID")
  .option("--amount <amount>", "Transfer amount")
  .option("--description <text>", "Description")
  .option("--date <date>", "Transfer date")
  .action(async (opts) => {
    await bankTransferCommand({
      json: opts.json,
      from: opts.from,
      to: opts.to,
      amount: opts.amount,
      description: opts.description,
      date: opts.date,
    });
  });

bank
  .command("transactions <accountId>")
  .description("List transactions for a bank account")
  .option("--json", "JSON output")
  .option("--from <date>", "From date")
  .option("--to <date>", "To date")
  .option("--page <n>", "Page number", parseInt)
  .option("--limit <n>", "Items per page", parseInt)
  .action(async (accountId, opts) => {
    await bankTransactionsCommand(accountId, {
      json: opts.json,
      from: opts.from,
      to: opts.to,
      page: opts.page,
      limit: opts.limit,
    });
  });

// ── shipment ──────────────────────────────────────────────────────────────

const shipment = program.command("shipment").description("Shipment tracking");

shipment
  .command("list")
  .description("List shipments")
  .option("--json", "JSON output")
  .option("--status <status>", "Filter by status")
  .option("--invoice-id <id>", "Filter by invoice")
  .option("--page <n>", "Page number", parseInt)
  .option("--limit <n>", "Items per page", parseInt)
  .action(async (opts) => {
    await shipmentListCommand({
      json: opts.json,
      status: opts.status,
      invoiceId: opts.invoiceId,
      page: opts.page,
      limit: opts.limit,
    });
  });

shipment
  .command("get <id>")
  .description("Get shipment details")
  .option("--json", "JSON output")
  .action(async (id, opts) => {
    await shipmentGetCommand(id, { json: opts.json });
  });

shipment
  .command("create")
  .description("Create a new shipment")
  .option("--json", "JSON output")
  .option("--invoice-id <id>", "Invoice ID")
  .option("--party-id <id>", "Party ID")
  .option("--carrier <name>", "Carrier name")
  .option("--tracking <number>", "Tracking number")
  .option("--mode <mode>", "Shipping mode")
  .option("--date <date>", "Shipment date")
  .action(async (opts) => {
    await shipmentCreateCommand({
      json: opts.json,
      invoiceId: opts.invoiceId,
      partyId: opts.partyId,
      carrier: opts.carrier,
      tracking: opts.tracking,
      mode: opts.mode,
      date: opts.date,
    });
  });

shipment
  .command("update <id>")
  .description("Update shipment status or tracking")
  .option("--json", "JSON output")
  .option("--status <status>", "New status")
  .option("--tracking <number>", "Tracking number")
  .option("--carrier <name>", "Carrier")
  .action(async (id, opts) => {
    await shipmentUpdateCommand(id, {
      json: opts.json,
      status: opts.status,
      tracking: opts.tracking,
      carrier: opts.carrier,
    });
  });

// ── target ────────────────────────────────────────────────────────────────

const target = program.command("target").description("Sales target management");

target
  .command("list")
  .description("List sales targets")
  .option("--json", "JSON output")
  .action(async (opts) => {
    await targetListCommand({ json: opts.json });
  });

target
  .command("my")
  .description("Show my target progress")
  .option("--json", "JSON output")
  .action(async (opts) => {
    await targetMyCommand({ json: opts.json });
  });

target
  .command("create")
  .description("Create a new sales target")
  .option("--json", "JSON output")
  .option("--type <type>", "order_count, order_value, or item_quantity")
  .option("--period <period>", "daily, weekly, monthly, quarterly, or custom")
  .option("--value <n>", "Target value")
  .option("--start-date <date>", "Start date")
  .option("--end-date <date>", "End date")
  .option("--notes <text>", "Notes")
  .action(async (opts) => {
    await targetCreateCommand({
      json: opts.json,
      type: opts.type,
      period: opts.period,
      value: opts.value,
      startDate: opts.startDate,
      endDate: opts.endDate,
      notes: opts.notes,
    });
  });

// ── store ─────────────────────────────────────────────────────────────────

const store = program.command("store").description("Online store management");

store
  .command("settings")
  .description("Show store settings")
  .option("--json", "JSON output")
  .action(async (opts) => {
    await storeSettingsCommand({ json: opts.json });
  });

store
  .command("orders")
  .description("List store orders")
  .option("--json", "JSON output")
  .option("--status <status>", "Filter by order status")
  .option("--page <n>", "Page number", parseInt)
  .option("--limit <n>", "Items per page", parseInt)
  .action(async (opts) => {
    await storeOrdersCommand({
      json: opts.json,
      status: opts.status,
      page: opts.page,
      limit: opts.limit,
    });
  });

// ── import ────────────────────────────────────────────────────────────────

const importCmd = program.command("import").description("Bulk import data");

importCmd
  .command("parties <file>")
  .description("Import parties from JSON or CSV file")
  .option("--json", "JSON output")
  .option("--format <format>", "json or csv (auto-detected from extension)")
  .action(async (file, opts) => {
    await importPartiesCommand(file, { json: opts.json, format: opts.format });
  });

importCmd
  .command("items <file>")
  .description("Import items from JSON or CSV file")
  .option("--json", "JSON output")
  .option("--format <format>", "json or csv (auto-detected from extension)")
  .action(async (file, opts) => {
    await importItemsCommand(file, { json: opts.json, format: opts.format });
  });

// ── business (alias) ──────────────────────────────────────────────────────

const business = program.command("business").description("Business management");

business
  .command("list")
  .description("List all businesses")
  .option("--json", "JSON output")
  .action(async (opts) => {
    const cfg = requireAuth();
    const client = new HisaaboClient(cfg);
    try {
      const businesses = await client.business.list();
      if (opts.json) { outputJSON(businesses); return; }
      businesses.forEach((b, i) => {
        const active = b.id === cfg.businessId ? " [active]" : "";
        console.log(`  ${i + 1}  ${b.name.padEnd(30)} ${(b.gstin ?? "-").padEnd(18)} ${b.gstRegistrationType}${active}`);
      });
      console.log();
    } catch (e) {
      fatalError(String(e instanceof Error ? e.message : e));
    }
  });

business
  .command("switch")
  .description("Switch active business")
  .option("--json", "JSON output")
  .action(async (opts) => {
    const cfg = requireAuth();
    const client = new HisaaboClient(cfg);
    try {
      const businesses = await client.business.list();
      if (opts.json) { outputJSON(businesses); return; }
      businesses.forEach((b, i) => {
        const active = b.id === cfg.businessId ? " [active]" : "";
        console.log(`  ${i + 1}  ${b.name.padEnd(28)}${active}`);
      });
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((res) => rl.question("\n  Select: ", res));
      rl.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      const selected = businesses[Math.max(0, Math.min(idx, businesses.length - 1))];
      if (!selected) fatalError("Invalid selection.", EXIT.USAGE);
      setConfig({ businessId: selected.id, businessName: selected.name });
      success(`Switched to: ${selected.name}`);
    } catch (e) {
      if (e instanceof HisaaboApiError) {
        if (e.hisaaboError.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      }
      fatalError(String(e instanceof Error ? e.message : e));
    }
  });

// ── Run ────────────────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((err) => {
  fatalError(String(err instanceof Error ? err.message : err));
});
