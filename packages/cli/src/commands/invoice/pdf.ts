import * as fs from "fs";
import * as path from "path";
import { HisaaboClient, HisaaboApiError, requestTimeoutMs } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, EXIT, success } from "../../output.js";
import { requireUuid, safeFilename, writeFileSafe } from "../../safety.js";

interface PdfOpts {
  output?: string;
  open?: boolean;
}

export async function invoicePdfCommand(id: string, opts: PdfOpts): Promise<void> {
  requireUuid(id, "invoice id");
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // First fetch the invoice to get the invoice number
  let invoiceNumber = id;
  try {
    const inv = await client.invoice.get(id);
    if (inv) invoiceNumber = inv.invoiceNumber;
  } catch {
    // Use id as-is if fetch fails
  }

  // Server-supplied number becomes a file name: reduce it to a safe basename
  const fileName = `${safeFilename(invoiceNumber, "invoice")}.pdf`;

  // Build PDF URL (id is a validated UUID)
  const pdfUrl = `${cfg.apiUrl}/api/invoice/${id}/pdf`;

  try {
    const res = await fetch(pdfUrl, {
      headers: {
        "Authorization": `Bearer ${cfg.token}`,
        "x-business-id": cfg.businessId,
        "x-tenant-id": cfg.tenantId,
        "x-client-type": "cli",
      },
      signal: AbortSignal.timeout(requestTimeoutMs()),
    });

    if (!res.ok) {
      fatalError(`Failed to download PDF: HTTP ${res.status}`, EXIT.GENERAL);
    }

    const buffer = await res.arrayBuffer();
    const bytes = Buffer.from(buffer);

    // Determine output path
    let outputPath: string;
    if (opts.output) {
      // If it's a directory, put the file inside it
      if (fs.existsSync(opts.output) && fs.statSync(opts.output).isDirectory()) {
        outputPath = path.join(opts.output, fileName);
      } else {
        outputPath = opts.output;
      }
    } else {
      outputPath = fileName;
    }

    writeFileSafe(outputPath, bytes);
    success(`Saved: ${outputPath} (${Math.round(bytes.length / 1024)} KB)`);

    if (opts.open) {
      const openPkg = await import("open");
      await openPkg.default(outputPath);
    }

  } catch (e) {
    if (e instanceof HisaaboApiError) {
      const err = e.hisaaboError;
      if (err.code === "not_found") fatalError(`Invoice not found: ${id}`, EXIT.NOT_FOUND);
      if (err.code === "unauthorized") fatalError("Session expired. Run: hisaabo login", EXIT.AUTH);
      if (err.code === "network_error") fatalError(err.message, EXIT.NETWORK);
    }
    fatalError(String(e instanceof Error ? e.message : e));
  }
}
