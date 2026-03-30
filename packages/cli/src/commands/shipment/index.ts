import { HisaaboClient, HisaaboApiError, type ShipmentSummary } from "../../client.js";
import { requireAuth } from "../../config.js";
import {
  fatalError, outputJSON, outputTable, paginationFooter, EXIT, success, type ColumnDef,
} from "../../output.js";
import { formatDate, formatStatus } from "../../format.js";

interface ListOpts {
  json?: boolean;
  status?: string;
  invoiceId?: string;
  page?: number;
  limit?: number;
}

export async function shipmentListCommand(opts: ListOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  try {
    const result = await client.shipment.list({
      status: opts.status as ShipmentSummary["status"] | undefined ?? null,
      invoiceId: opts.invoiceId ?? null,
      page,
      limit,
    });

    if (opts.json) {
      outputJSON({ data: result.data, pagination: { page: result.page, limit: result.limit, total: result.total } });
      return;
    }

    console.log(`\n Shipments  ${result.total} total\n`);

    const cols: ColumnDef<ShipmentSummary>[] = [
      { key: "invoiceNumber", header: "Invoice", width: 12, format: (v) => String(v ?? "-") },
      { key: "partyName", header: "Party", width: 18, format: (v) => String(v ?? "-") },
      { key: "carrier", header: "Carrier", width: 12, format: (v) => String(v ?? "-") },
      { key: "trackingNumber", header: "Tracking", width: 16, format: (v) => String(v ?? "-") },
      { key: "status", header: "Status", width: 10, format: (v) => formatStatus(String(v ?? "")) },
      { key: "shipmentDate", header: "Shipped", width: 12, format: (v) => formatDate(v ? String(v) : null) },
    ];

    outputTable(result.data, cols);
    paginationFooter(result.page, result.limit, result.total);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function shipmentGetCommand(id: string, opts: { json?: boolean }): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const shipment = await client.shipment.get(id);
    if (!shipment) fatalError(`Shipment not found: ${id}`, EXIT.NOT_FOUND);

    if (opts.json) {
      outputJSON(shipment);
      return;
    }

    console.log(`\n  Shipment ${id}`);
    console.log("  " + "─".repeat(45));
    if (shipment!.invoiceNumber) console.log(`  Invoice:  ${shipment!.invoiceNumber}`);
    if (shipment!.partyName) console.log(`  Party:    ${shipment!.partyName}`);
    if (shipment!.carrier) console.log(`  Carrier:  ${shipment!.carrier}`);
    if (shipment!.trackingNumber) console.log(`  Tracking: ${shipment!.trackingNumber}`);
    if (shipment!.trackingUrl) console.log(`  URL:      ${shipment!.trackingUrl}`);
    console.log(`  Status:   ${formatStatus(shipment!.status)}`);
    if (shipment!.shipmentDate) console.log(`  Shipped:  ${formatDate(shipment!.shipmentDate)}`);
    if (shipment!.estimatedDelivery) console.log(`  Est. Del: ${formatDate(shipment!.estimatedDelivery)}`);
    if (shipment!.actualDelivery) console.log(`  Delivered:${formatDate(shipment!.actualDelivery)}`);
    console.log();

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}

export async function shipmentCreateCommand(opts: {
  json?: boolean;
  invoiceId?: string;
  partyId?: string;
  carrier?: string;
  tracking?: string;
  mode?: string;
  date?: string;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const shipment = await client.shipment.create({
      invoiceId: opts.invoiceId,
      partyId: opts.partyId,
      carrier: opts.carrier,
      trackingNumber: opts.tracking,
      mode: opts.mode,
      shipmentDate: opts.date,
    });

    if (opts.json) {
      outputJSON(shipment);
      return;
    }

    success(`Shipment created: ${shipment.id}`);
    if (shipment.trackingNumber) console.log(`  Tracking: ${shipment.trackingNumber}`);
    console.log();

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

export async function shipmentUpdateCommand(id: string, opts: {
  json?: boolean;
  status?: string;
  tracking?: string;
  carrier?: string;
}): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  try {
    const shipment = await client.shipment.update({
      id,
      status: opts.status as ShipmentSummary["status"] | undefined,
      trackingNumber: opts.tracking,
      carrier: opts.carrier,
    });

    if (opts.json) {
      outputJSON(shipment);
      return;
    }

    success(`Shipment updated: ${formatStatus(shipment.status)}`);

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Shipment not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
