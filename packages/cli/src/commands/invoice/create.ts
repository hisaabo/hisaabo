import * as readline from "readline";
import { HisaaboClient, HisaaboApiError, type InvoiceLineItemInput } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, outputJSON, EXIT, success } from "../../output.js";
import { formatAmount, formatINR, todayISO } from "../../format.js";

interface CreateOpts {
  json?: boolean;
  party?: string;
  partyId?: string;
  type?: string;
  items?: string[];
  qty?: string[];
  rate?: string[];
  delivery?: string;
  notes?: string;
  terms?: string;
  yes?: boolean;
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function invoiceCreateCommand(opts: CreateOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  const isNonInteractive = !process.stdin.isTTY || opts.yes;

  try {
    // ── Determine type ──────────────────────────────────────────────
    let invoiceType: "sale" | "purchase" = "sale";
    if (opts.type === "purchase") invoiceType = "purchase";

    // ── Resolve party ───────────────────────────────────────────────
    let partyId = opts.partyId;
    let partyName = opts.party ?? "";

    if (!partyId) {
      if (!isNonInteractive) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        console.log(`\n  New ${invoiceType === "sale" ? "Sale Invoice" : "Purchase Bill"}`);
        console.log("  " + "─".repeat(40) + "\n");

        const search = await prompt(rl, "  Select Party:\n  > Search: ");
        const parties = await client.party.list({ search: search.trim(), limit: 5 });

        if (parties.data.length === 0) {
          rl.close();
          fatalError("No parties found. Create one with: hisaabo party create", EXIT.NOT_FOUND);
        }

        parties.data.forEach((p, i) => {
          console.log(`    ${i + 1}  ${p.name.padEnd(20)} ${(p.phone ?? "").padEnd(14)}  ${p.type}`);
        });

        const partyChoice = await prompt(rl, "\n  Party [1]: ");
        const idx = parseInt(partyChoice.trim() || "1", 10) - 1;
        const selected = parties.data[Math.max(0, Math.min(idx, parties.data.length - 1))];
        if (!selected) { rl.close(); fatalError("Invalid selection.", EXIT.USAGE); }
        partyId = selected.id;
        partyName = selected.name;
        console.log(`  Party: ${partyName}\n`);
        rl.close();
      } else {
        // Non-interactive: search by name
        if (!partyName) fatalError("--party or --party-id is required", EXIT.USAGE);
        const parties = await client.party.list({ search: partyName, limit: 5 });
        if (parties.data.length === 0) fatalError(`Party not found: ${partyName}`, EXIT.NOT_FOUND);
        partyId = parties.data[0]!.id;
        partyName = parties.data[0]!.name;
      }
    }

    // ── Build line items ────────────────────────────────────────────
    const lineItems: InvoiceLineItemInput[] = [];

    if (opts.items && opts.items.length > 0) {
      // Flag-based item creation
      for (let i = 0; i < opts.items.length; i++) {
        const itemName = opts.items[i]!;
        const qty = opts.qty?.[i] ?? "1";
        let unitPrice = opts.rate?.[i] ?? "";

        if (!unitPrice) {
          // Try to find the item and use its sale price
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
          // Try to find item by name for linking
          const items = await client.item.list({ search: itemName, limit: 3 });
          const matched = items.data.find((it) => it.name.toLowerCase().includes(itemName.toLowerCase()));
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
      // Interactive item wizard
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log("  Add Line Items (empty description to finish):\n");
      let itemNum = 1;

      while (true) {
        console.log(`  Item ${itemNum}:`);
        const search = await prompt(rl, "    Search item (or description): ");
        if (!search.trim()) break;

        let description = search.trim();
        let itemId: string | undefined;
        let defaultPrice = "";
        let defaultTax = "0";

        // Search for items
        const items = await client.item.list({ search: search.trim(), limit: 5 });
        if (items.data.length > 0) {
          items.data.forEach((it, i) => {
            const stock = it.itemType === "service" ? "-" : String(it.stockQuantity);
            const price = it.salePrice ? formatINR(it.salePrice) : "no price";
            console.log(`      ${i + 1}  ${it.name.padEnd(20)} ${price.padEnd(12)}  Stock: ${stock}`);
          });
          const choice = await prompt(rl, "    Item [1] (or 0 to use as description): ");
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

        const qtyStr = await prompt(rl, "    Quantity [1]: ");
        const qty = qtyStr.trim() || "1";

        const rateStr = await prompt(rl, `    Unit Price [${defaultPrice || "0.00"}]: `);
        const unitPrice = rateStr.trim() || defaultPrice || "0.00";

        const taxStr = await prompt(rl, `    Tax % [${defaultTax}]: `);
        const taxPercent = taxStr.trim() || defaultTax;

        const discStr = await prompt(rl, "    Discount % [0]: ");
        const discountPercent = discStr.trim() || "0";

        const amount = parseFloat(qty) * parseFloat(unitPrice) * (1 + parseFloat(taxPercent) / 100) * (1 - parseFloat(discountPercent) / 100);
        console.log(`    > ${description}  x${qty}  @${formatAmount(unitPrice)}  ${taxPercent}% tax  = ${formatAmount(String(amount))}\n`);

        lineItems.push({ itemId, description, quantity: qty, unitPrice, taxPercent, discountPercent });
        itemNum++;
      }
      rl.close();

      if (lineItems.length === 0) {
        fatalError("No line items added.", EXIT.USAGE);
      }
    } else {
      fatalError("No items specified. Use --item flags.", EXIT.USAGE);
    }

    // ── Summary & confirm ───────────────────────────────────────────
    const subtotal = lineItems.reduce((s, item) => {
      const amt = parseFloat(item.quantity) * parseFloat(item.unitPrice);
      return s + amt;
    }, 0);
    const taxTotal = lineItems.reduce((s, item) => {
      const amt = parseFloat(item.quantity) * parseFloat(item.unitPrice);
      const tax = parseFloat(item.taxPercent ?? "0") / 100;
      return s + amt * tax;
    }, 0);

    let invoiceDate = todayISO();
    let dueDate: string | undefined;
    let deliveryMethod = opts.delivery;
    let notes = opts.notes;
    let terms = opts.terms;

    if (!isNonInteractive) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      console.log("\n  ─── Invoice Summary ───────────────────────────");
      console.log(`  Subtotal:  ${formatAmount(String(subtotal))}`);
      console.log(`  Tax:       ${formatAmount(String(taxTotal))}`);
      console.log(`  Total:     ${formatAmount(String(subtotal + taxTotal))}`);
      console.log("  ───────────────────────────────────────────────\n");

      const dateStr = await prompt(rl, `  Invoice Date [${todayISO()}]: `);
      if (dateStr.trim()) invoiceDate = dateStr.trim();

      const dueStr = await prompt(rl, "  Due Date [optional]: ");
      if (dueStr.trim()) dueDate = dueStr.trim();

      const delivStr = await prompt(rl, "  Delivery Method [self_pickup]: ");
      deliveryMethod = delivStr.trim() || "self_pickup";

      const notesStr = await prompt(rl, "  Notes: ");
      if (notesStr.trim()) notes = notesStr.trim();

      const termsStr = await prompt(rl, "  Terms: ");
      if (termsStr.trim()) terms = termsStr.trim();

      console.log("  ───────────────────────────────────────────────");
      const confirm = await prompt(rl, "\n  Create this invoice? (y/n) [y]: ");
      rl.close();

      if (confirm.trim().toLowerCase() === "n") {
        console.log("  Cancelled.");
        process.exit(EXIT.SUCCESS);
      }
    }

    // ── Create ──────────────────────────────────────────────────────
    const invoice = await client.invoice.create({
      partyId: partyId!,
      type: invoiceType,
      invoiceDate,
      dueDate,
      deliveryMethod,
      notes,
      termsAndConditions: terms,
      lineItems,
    });

    if (opts.json) {
      outputJSON(invoice);
      return;
    }

    success(`Created: ${invoice.invoiceNumber} for ${formatINR(invoice.totalAmount)}`);
    console.log(`  View:    hisaabo invoice get ${invoice.invoiceNumber}`);
    console.log(`  PDF:     hisaabo invoice pdf ${invoice.invoiceNumber}\n`);

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
