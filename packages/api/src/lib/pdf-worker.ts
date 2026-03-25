import { parentPort, workerData } from "node:worker_threads";
import { generateInvoicePDF, type InvoicePDFData } from "./invoice-pdf.js";

const { data, format } = workerData as { data: InvoicePDFData; format: "a4" | "thermal" };

const doc = generateInvoicePDF(data, format);
const chunks: Buffer[] = [];
doc.on("data", (chunk: Buffer) => chunks.push(chunk));
doc.on("end", () => {
  parentPort?.postMessage(Buffer.concat(chunks));
});
doc.end();
