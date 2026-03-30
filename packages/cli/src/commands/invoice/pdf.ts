import * as fs from "fs";
import * as path from "path";
import { HisaaboClient, HisaaboApiError } from "../../client.js";
import { requireAuth } from "../../config.js";
import { fatalError, EXIT, success } from "../../output.js";

interface PdfOpts {
  output?: string;
  open?: boolean;
}

export async function invoicePdfCommand(id: string, opts: PdfOpts): Promise<void> {
  const cfg = requireAuth();
  const client = new HisaaboClient(cfg);

  // First fetch the invoice to get the invoice number
  let invoiceNumber = id;
  try {
    const inv = await client.invoice.get(id);
    invoiceNumber = inv.invoiceNumber;
  } catch {
    // Use id as-is if fetch fails
  }

  // Build PDF URL
  const pdfUrl = `${cfg.apiUrl}/api/invoice/${id}/pdf`;

  try {
    const res = await fetch(pdfUrl, {
      headers: {
        "Authorization": `Bearer ${cfg.token}`,
        "x-business-id": cfg.businessId,
        "x-tenant-id": cfg.tenantId,
        "x-client-type": "cli",
      },
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
        outputPath = path.join(opts.output, `${invoiceNumber}.pdf`);
      } else {
        outputPath = opts.output;
      }
    } else {
      outputPath = `${invoiceNumber}.pdf`;
    }

    fs.writeFileSync(outputPath, bytes);
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
